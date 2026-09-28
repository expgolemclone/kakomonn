import { DurableObject } from "cloudflare:workers";
import { COPY_FAILURE_STAGES, isCopyFailure } from "../../contracts/kakomonn.mjs";

export const COPY_FAILURE_COMMENTS_URL =
  "https://api.github.com/repos/expgolemclone/kakomonn/issues/29/comments";
const GITHUB_API_VERSION = "2026-03-10";
const REQUEST_TIMEOUT_MS = 30000;
const RETRY_MIN_MS = 60000;
const RETRY_MAX_MS = 6 * 60 * 60 * 1000;

export function copyFailureMarker(report) {
  return `<!-- copy-failure:${report.site}:${report.questionId}:${COPY_FAILURE_STAGES[report.reason]} -->`;
}

export function copyFailureComment(report) {
  return [
    `https://${report.site}/questions/${report.questionId}`,
    `stage=${COPY_FAILURE_STAGES[report.reason]}, code=${report.reason}`,
    copyFailureMarker(report),
  ].join("\n\n");
}

class DeliveryError extends Error {
  constructor(retryAtMs = 0, status = null) {
    super("copy_failure_delivery_failed");
    this.retryAtMs = retryAtMs;
    this.status = status;
  }
}

function rateLimitRetryAt(response) {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(seconds)) return Date.now() + Math.max(0, seconds) * 1000;
    if (Number.isFinite(date)) return date;
  }
  if (response.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    if (Number.isFinite(reset)) return reset * 1000;
  }
  return 0;
}

export class CopyFailureReports extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.deliveryPromise = null;
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS copy_failures (
        site TEXT NOT NULL,
        question_id TEXT NOT NULL,
        stage TEXT NOT NULL CHECK (stage IN ('markdown', 'clipboard')),
        reason TEXT NOT NULL,
        comment_id INTEGER,
        posting INTEGER NOT NULL DEFAULT 0 CHECK (posting IN (0, 1)),
        retry_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_ms INTEGER,
        PRIMARY KEY (site, question_id, stage)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS pending_copy_failures
      ON copy_failures (next_attempt_ms) WHERE comment_id IS NULL;
    `);
  }

  async accept(report) {
    if (!isCopyFailure(report)) throw new TypeError("invalid copy failure");
    await this.resumeAfterCredentialChange();
    this.ctx.storage.sql.exec(
      `INSERT INTO copy_failures (site, question_id, stage, reason, next_attempt_ms)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT(site, question_id, stage) DO NOTHING`,
      report.site, report.questionId, COPY_FAILURE_STAGES[report.reason], report.reason,
      Date.now() + 1000,
    );
    await this.scheduleNextAlarm();
    return { accepted: true };
  }

  async resumeAfterCredentialChange() {
    const token = this.env.GITHUB_COPY_FAILURE_TOKEN;
    if (typeof token !== "string" || token.length === 0) return;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(
      `${token}\0${COPY_FAILURE_COMMENTS_URL}\0${GITHUB_API_VERSION}`,
    ));
    const fingerprint = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0")).join("");
    if (await this.ctx.storage.get("githubCredentialFingerprint") === fingerprint) return;
    // A new credential has an independent GitHub limit and can retry earlier failures now.
    await this.ctx.storage.delete("retryAfterMs");
    this.ctx.storage.sql.exec(
      `UPDATE copy_failures SET retry_count = 0, next_attempt_ms = ?
       WHERE comment_id IS NULL`, Date.now() + 1000,
    );
    await this.ctx.storage.put("githubCredentialFingerprint", fingerprint);
  }

  async scheduleNextAlarm() {
    const row = this.ctx.storage.sql.exec(
      `SELECT next_attempt_ms FROM copy_failures WHERE comment_id IS NULL
       ORDER BY next_attempt_ms LIMIT 1`,
    ).toArray()[0];
    if (row === undefined) {
      await this.ctx.storage.deleteAlarm();
    } else {
      const retryAfterMs = await this.ctx.storage.get("retryAfterMs") ?? 0;
      await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, row.next_attempt_ms, retryAfterMs));
    }
  }

  async github(url, method = "GET", body = undefined) {
    const token = this.env.GITHUB_COPY_FAILURE_TOKEN;
    if (typeof token !== "string" || token.length === 0) throw new DeliveryError();
    const response = await fetch(url, {
      method,
      redirect: "error",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "kakomonn-sync",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new DeliveryError(rateLimitRetryAt(response), response.status);
    return response.json();
  }

  async findPostedComment(report) {
    const marker = copyFailureMarker(report);
    for (let page = 1; ; page += 1) {
      const comments = await this.github(`${COPY_FAILURE_COMMENTS_URL}?per_page=100&page=${page}`);
      if (!Array.isArray(comments)) throw new DeliveryError();
      const found = comments.find((comment) =>
        typeof comment.body === "string" && comment.body.includes(marker) &&
        Number.isSafeInteger(comment.id) && comment.id > 0,
      );
      if (found !== undefined) return found.id;
      if (comments.length < 100) return null;
    }
  }

  alarm() {
    if (this.deliveryPromise !== null) return this.deliveryPromise;
    this.deliveryPromise = this.deliverPending().finally(() => {
      this.deliveryPromise = null;
    });
    return this.deliveryPromise;
  }

  async deliverPending() {
    try {
      if ((await this.ctx.storage.get("retryAfterMs") ?? 0) > Date.now()) return;
      for (let count = 0; count < 10; count += 1) {
        const row = this.ctx.storage.sql.exec(
          `SELECT * FROM copy_failures WHERE comment_id IS NULL AND next_attempt_ms <= ?
           ORDER BY next_attempt_ms LIMIT 1`, Date.now(),
        ).toArray()[0];
        if (row === undefined) break;
        const report = { site: row.site, questionId: row.question_id, reason: row.reason };
        const keys = [row.site, row.question_id, row.stage];
        // Persist a recovery deadline before any external side effect.
        this.ctx.storage.sql.exec(
          `UPDATE copy_failures SET next_attempt_ms = ?
           WHERE site = ? AND question_id = ? AND stage = ?`,
          Date.now() + RETRY_MIN_MS, ...keys,
        );
        await this.scheduleNextAlarm();
        try {
          let commentId = row.posting === 1 ? await this.findPostedComment(report) : null;
          if (commentId === null) {
            this.ctx.storage.sql.exec(
              `UPDATE copy_failures SET posting = 1
               WHERE site = ? AND question_id = ? AND stage = ?`, ...keys,
            );
            const comment = await this.github(COPY_FAILURE_COMMENTS_URL, "POST", {
              body: copyFailureComment(report),
            });
            if (!Number.isSafeInteger(comment?.id) || comment.id <= 0) throw new DeliveryError();
            commentId = comment.id;
          }
          this.ctx.storage.sql.exec(
            `UPDATE copy_failures SET comment_id = ?, posting = 0, next_attempt_ms = NULL
             WHERE site = ? AND question_id = ? AND stage = ?`, commentId, ...keys,
          );
        } catch (error) {
          console.error("copy_failure_delivery_attempt", error?.status ?? error?.name ?? "unknown",
            error?.message ?? "no-message");
          const delay = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** Math.min(row.retry_count, 9));
          const retryAtMs = Math.max(Date.now() + delay, error?.retryAtMs ?? 0);
          this.ctx.storage.sql.exec(
            `UPDATE copy_failures SET retry_count = retry_count + 1, next_attempt_ms = ?
             WHERE site = ? AND question_id = ? AND stage = ?`,
            retryAtMs, ...keys,
          );
          await this.ctx.storage.put("retryAfterMs", retryAtMs);
          break;
        }
      }
    } finally {
      await this.scheduleNextAlarm();
    }
  }
}

export function getCopyFailureReportsStub(env) {
  return env.COPY_FAILURE_REPORTS.get(env.COPY_FAILURE_REPORTS.idFromName("primary"));
}
