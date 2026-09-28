import { env, runInDurableObject, evictDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleRequest } from "../src/index.js";
import { copyFailureComment, copyFailureMarker, COPY_FAILURE_COMMENTS_URL } from "../src/copy-failure-reports.js";

const SITE = "chushoks.kakomonn.com";
const report = (reason = "markdown_unavailable") => ({ site: SITE, questionId: "45124", reason });
const stub = () => env.COPY_FAILURE_REPORTS.get(env.COPY_FAILURE_REPORTS.idFromName("primary"));
function request(body = report(), token = "test-sync-token", path = "/v12/copy-failures", method = "POST") {
  return new Request(`https://example.test${path}`, {
    method, headers: { Authorization: `Bearer ${token}` },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
}
async function rows() {
  return runInDurableObject(stub(), (_, state) => state.storage.sql.exec("SELECT * FROM copy_failures ORDER BY stage").toArray());
}
async function due() {
  await runInDurableObject(stub(), async (_, state) => {
    state.storage.sql.exec("UPDATE copy_failures SET next_attempt_ms = 0 WHERE comment_id IS NULL");
    await state.storage.delete("retryAfterMs");
  });
}
async function deliver() {
  await due();
  await runInDurableObject(stub(), (instance) => instance.alarm());
}
beforeEach(async () => {
  await runInDurableObject(stub(), async (_, state) => {
    state.storage.sql.exec("DELETE FROM copy_failures");
    await state.storage.deleteAlarm();
    await state.storage.delete("retryAfterMs");
  });
});
afterEach(() => vi.restoreAllMocks());

describe("copy failure acceptance", () => {
  it("acknowledges durable acceptance even when GitHub has no configured secret", async () => {
    const fetcher = vi.fn();
    const response = await handleRequest(request(), env, fetcher);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await rows()).toMatchObject([{ reason: "markdown_unavailable", comment_id: null }]);
    await runInDurableObject(stub(), async (_, state) => expect(await state.storage.getAlarm()).not.toBeNull());
    await deliver();
    expect(await rows()).toMatchObject([{ comment_id: null, retry_count: 1 }]);
  });
  it("rejects unauthorized, malformed, private and unknown fields", async () => {
    for (const body of [null, [], { ...report(), markdown: "private" },
      { ...report(), reason: "unknown" }, { ...report(), reason: "toString" },
      { ...report(), site: "evil.test" }, { ...report(), questionId: "9223372036854775808" }]) {
      expect((await handleRequest(request(body), env)).status).toBe(400);
    }
    expect((await handleRequest(request(report(), "wrong"), env)).status).toBe(401);
    expect((await handleRequest(request(report(), "test-sync-token", "/v12/copy-failures?extra=1"), env)).status).toBe(400);
    expect((await handleRequest(request(null, "test-sync-token", "/v12/copy-failures", "GET"), env)).status).toBe(405);
    expect(await rows()).toEqual([]);
  });
  it("atomically groups simultaneous reports by question and stage, retaining the first reason", async () => {
    await Promise.all(Array.from({ length: 8 }, () => stub().accept(report("clipboard_write_failed"))));
    await stub().accept(report("clipboard_write_timeout"));
    await stub().accept(report());
    expect(await rows()).toMatchObject([
      { stage: "clipboard", reason: "clipboard_write_failed" },
      { stage: "markdown", reason: "markdown_unavailable" },
    ]);
  });
});

describe("durable GitHub delivery", () => {
  it("posts a redacted comment once, stops the alarm and suppresses later duplicates", async () => {
    await stub().accept(report());
    const github = vi.fn(async () => ({ id: 101 }));
    await runInDurableObject(stub(), (instance) => vi.spyOn(instance, "github").mockImplementation(github));
    await deliver();
    expect(github).toHaveBeenCalledExactlyOnceWith(COPY_FAILURE_COMMENTS_URL, "POST", { body: copyFailureComment(report()) });
    expect(copyFailureComment(report())).toBe(
      `https://${SITE}/questions/45124\n\nstage=markdown, code=markdown_unavailable\n\n${copyFailureMarker(report())}`,
    );
    await stub().accept(report());
    await runInDurableObject(stub(), (instance) => instance.alarm());
    expect(github).toHaveBeenCalledTimes(1);
    expect(await rows()).toMatchObject([{ comment_id: 101, next_attempt_ms: null }]);
    await runInDurableObject(stub(), async (_, state) => expect(await state.storage.getAlarm()).toBeNull());
  });
  it("recovers an ambiguous post after eviction, including paginated comments", async () => {
    await stub().accept(report());
    await runInDurableObject(stub(), (_, state) => {
      state.storage.sql.exec("UPDATE copy_failures SET posting = 1");
    });
    await evictDurableObject(stub());
    const github = vi.fn(async (url) => url.endsWith("page=1")
      ? Array.from({ length: 100 }, (_, i) => ({ id: i + 1, body: "unrelated" }))
      : [{ id: 202, body: copyFailureComment(report()) }]);
    await runInDurableObject(stub(), (instance) => vi.spyOn(instance, "github").mockImplementation(github));
    await deliver();
    expect(github).toHaveBeenCalledTimes(2);
    expect(github.mock.calls.every((call) => call.length === 1)).toBe(true);
    expect(await rows()).toMatchObject([{ comment_id: 202 }]);
  });
  it("reconciles before retrying a failed post and preserves the queue", async () => {
    await stub().accept(report());
    const github = vi.fn().mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce([]).mockResolvedValueOnce({ id: 303 });
    await runInDurableObject(stub(), (instance) => vi.spyOn(instance, "github").mockImplementation(github));
    await deliver();
    const [failed] = await rows();
    expect(failed).toMatchObject({ posting: 1, comment_id: null, retry_count: 1 });
    expect(failed.next_attempt_ms).toBeGreaterThan(Date.now());
    await deliver();
    expect(github.mock.calls.map((call) => call[1] ?? "GET")).toEqual(["POST", "GET", "POST"]);
    expect(await rows()).toMatchObject([{ comment_id: 303 }]);
  });
  it("honors GitHub retry-after for the entire destination, including newly received reports", async () => {
    await stub().accept(report());
    await due();

    const github = vi.fn(async () => new Response("denied", { status: 429, headers: { "retry-after": "7200" } }));
    const original = globalThis.fetch;
    try {
      await runInDurableObject(stub(), async (instance) => {
        const savedEnvironment = instance.env;
        instance.env = { ...instance.env, GITHUB_COPY_FAILURE_TOKEN: "test-github-secret" };
        vi.stubGlobal("fetch", github);
        try {
          await instance.alarm();
        } finally {
          vi.stubGlobal("fetch", original);
          instance.env = savedEnvironment;
        }
      });
      await stub().accept({ ...report(), questionId: "45125" });
      await runInDurableObject(stub(), async (instance, state) => {
        expect(await state.storage.getAlarm()).toBeGreaterThan(Date.now() + 7190000);
        await instance.alarm();
      });
      expect(github).toHaveBeenCalledTimes(1);
      const [, options] = github.mock.calls[0];
      expect(options.headers.Authorization).toBe("Bearer test-github-secret");
      expect(options.body).not.toContain("test-github-secret");
    } finally {
      vi.stubGlobal("fetch", original);
    }
  });
});
