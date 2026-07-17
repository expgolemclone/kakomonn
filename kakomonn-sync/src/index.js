import { DurableObject } from "cloudflare:workers";

const GOAL = 50;
const DAILY_COUNT_OBJECT_NAME = "primary";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const OPERATION_ID_PATTERN = /^[0-9a-f]{32}$/;
const RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
};

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...RESPONSE_HEADERS, ...extraHeaders },
  });
}

function errorResponse(error, status, extraHeaders = {}) {
  return jsonResponse({ error }, status, extraHeaders);
}

export function getTokyoDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}`;
}

async function secretsEqual(received, expected) {
  if (typeof received !== "string" || typeof expected !== "string") {
    return false;
  }

  const encoder = new TextEncoder();
  const [receivedDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(received)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const receivedBytes = new Uint8Array(receivedDigest);
  const expectedBytes = new Uint8Array(expectedDigest);
  let difference = receivedBytes.length ^ expectedBytes.length;

  for (let index = 0; index < receivedBytes.length; index += 1) {
    difference |= receivedBytes[index] ^ expectedBytes[index];
  }

  return difference === 0;
}

async function isAuthorized(request, env) {
  if (typeof env.SYNC_TOKEN !== "string" || env.SYNC_TOKEN.length === 0) {
    return null;
  }

  const authorization = request.headers.get("Authorization") ?? "";
  const prefix = "Bearer ";
  if (!authorization.startsWith(prefix)) {
    return false;
  }

  return secretsEqual(authorization.slice(prefix.length), env.SYNC_TOKEN);
}

function parseStateRow(row) {
  return {
    date: row.date,
    count: row.count,
    goal: GOAL,
  };
}

export class DailyCount extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS daily_state (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          date TEXT NOT NULL,
          count INTEGER NOT NULL CHECK (count BETWEEN 0 AND ${GOAL})
        );
        CREATE TABLE IF NOT EXISTS processed_operations (
          operation_id TEXT PRIMARY KEY
        ) WITHOUT ROWID;
      `);
    });
  }

  ensureDate(date) {
    const existing = this.ctx.storage.sql
      .exec("SELECT date, count FROM daily_state WHERE singleton = 1")
      .toArray()[0];

    if (existing?.date === date) {
      return { state: existing, stale: false };
    }

    if (existing?.date > date) {
      return { state: existing, stale: true };
    }

    this.ctx.storage.sql.exec("DELETE FROM processed_operations");
    this.ctx.storage.sql.exec(
      `INSERT INTO daily_state (singleton, date, count)
       VALUES (1, ?, 0)
       ON CONFLICT (singleton) DO UPDATE SET date = excluded.date, count = 0`,
      date
    );
    return { state: { date, count: 0 }, stale: false };
  }

  getCount(date) {
    if (!DATE_PATTERN.test(date)) {
      throw new TypeError("invalid date");
    }

    return this.ctx.storage.transactionSync(() =>
      parseStateRow(this.ensureDate(date).state)
    );
  }

  recordCorrect(date, operationId) {
    if (!DATE_PATTERN.test(date) || !OPERATION_ID_PATTERN.test(operationId)) {
      throw new TypeError("invalid correct operation");
    }

    return this.ctx.storage.transactionSync(() => {
      const ensured = this.ensureDate(date);
      if (ensured.stale) {
        return {
          error: "date_changed",
          state: parseStateRow(ensured.state),
        };
      }

      const state = ensured.state;
      if (state.count >= GOAL) {
        return parseStateRow(state);
      }

      const inserted = this.ctx.storage.sql
        .exec(
          `INSERT INTO processed_operations (operation_id)
           VALUES (?)
           ON CONFLICT (operation_id) DO NOTHING
           RETURNING operation_id`,
          operationId
        )
        .toArray();

      if (inserted.length > 0) {
        this.ctx.storage.sql.exec(
          `UPDATE daily_state
           SET count = MIN(?, count + 1)
           WHERE singleton = 1`,
          GOAL
        );
      }

      const updated = this.ctx.storage.sql
        .exec("SELECT date, count FROM daily_state WHERE singleton = 1")
        .toArray()[0];
      return parseStateRow(updated);
    });
  }
}

function getDailyCountStub(env) {
  const id = env.DAILY_COUNT.idFromName(DAILY_COUNT_OBJECT_NAME);
  return env.DAILY_COUNT.get(id);
}

async function parseCorrectRequest(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return null;
  }

  if (
    body === null ||
    typeof body !== "object" ||
    !DATE_PATTERN.test(body.date) ||
    !OPERATION_ID_PATTERN.test(body.operationId)
  ) {
    return null;
  }

  return { date: body.date, operationId: body.operationId };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isCountPath = url.pathname === "/v1/count";
    const isCorrectPath = url.pathname === "/v1/correct";

    if (!isCountPath && !isCorrectPath) {
      return errorResponse("not_found", 404);
    }

    const expectedMethod = isCountPath ? "GET" : "POST";
    if (request.method !== expectedMethod) {
      return errorResponse("method_not_allowed", 405, {
        Allow: expectedMethod,
      });
    }

    const authorized = await isAuthorized(request, env);
    if (authorized === null) {
      return errorResponse("server_misconfigured", 500);
    }
    if (!authorized) {
      return errorResponse("unauthorized", 401);
    }

    const today = getTokyoDate();
    const stub = getDailyCountStub(env);

    if (isCountPath) {
      return jsonResponse(await stub.getCount(today));
    }

    const correct = await parseCorrectRequest(request);
    if (correct === null) {
      return errorResponse("invalid_request", 400);
    }
    if (correct.date !== today) {
      return jsonResponse(
        { error: "date_changed", state: await stub.getCount(today) },
        409
      );
    }

    const result = await stub.recordCorrect(
      correct.date,
      correct.operationId
    );
    if (result?.error === "date_changed") {
      return jsonResponse(result, 409);
    }

    return jsonResponse(result);
  },
};
