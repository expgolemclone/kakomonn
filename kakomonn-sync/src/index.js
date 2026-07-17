import { DurableObject } from "cloudflare:workers";

const MILESTONE_INTERVAL = 50;
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
    milestoneInterval: MILESTONE_INTERVAL,
  };
}

function tableDefinition(storage, tableName) {
  return storage.sql
    .exec(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
      tableName
    )
    .toArray()[0]?.sql;
}

function tableColumns(storage, tableName) {
  return storage.sql
    .exec(`PRAGMA table_info(${tableName})`)
    .toArray()
    .map((column) => column.name);
}

function createCurrentSchema(storage) {
  storage.sql.exec(`
    CREATE TABLE daily_state (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      date TEXT NOT NULL,
      count INTEGER NOT NULL CHECK (count >= 0)
    );
    CREATE TABLE processed_operations (
      operation_id TEXT PRIMARY KEY,
      resulting_count INTEGER CHECK (
        resulting_count IS NULL OR resulting_count >= 1
      )
    ) WITHOUT ROWID;
  `);
}

function assertColumns(actual, expected, tableName) {
  if (
    actual.length !== expected.length ||
    actual.some((column, index) => column !== expected[index])
  ) {
    throw new Error(`unexpected ${tableName} schema`);
  }
}

export function initializeSchema(storage) {
  storage.transactionSync(() => {
    const dailyDefinition = tableDefinition(storage, "daily_state");
    const operationsDefinition = tableDefinition(
      storage,
      "processed_operations"
    );

    if (dailyDefinition === undefined && operationsDefinition === undefined) {
      createCurrentSchema(storage);
      return;
    }
    if (dailyDefinition === undefined || operationsDefinition === undefined) {
      throw new Error("incomplete DailyCount schema");
    }

    assertColumns(
      tableColumns(storage, "daily_state"),
      ["singleton", "date", "count"],
      "daily_state"
    );
    const operationColumns = tableColumns(storage, "processed_operations");
    if (
      operationColumns.length === 2 &&
      operationColumns[0] === "operation_id" &&
      operationColumns[1] === "resulting_count" &&
      /count\s*>=\s*0/i.test(dailyDefinition)
    ) {
      return;
    }

    const isLegacySchema =
      operationColumns.length === 1 &&
      operationColumns[0] === "operation_id" &&
      /count\s+BETWEEN\s+0\s+AND\s+50/i.test(dailyDefinition);
    if (!isLegacySchema) {
      throw new Error("unsupported DailyCount schema");
    }

    storage.sql.exec(`
      CREATE TABLE daily_state_next (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        date TEXT NOT NULL,
        count INTEGER NOT NULL CHECK (count >= 0)
      );
      INSERT INTO daily_state_next (singleton, date, count)
      SELECT singleton, date, count FROM daily_state;

      CREATE TABLE processed_operations_next (
        operation_id TEXT PRIMARY KEY,
        resulting_count INTEGER CHECK (
          resulting_count IS NULL OR resulting_count >= 1
        )
      ) WITHOUT ROWID;
      INSERT INTO processed_operations_next (operation_id, resulting_count)
      SELECT operation_id, NULL FROM processed_operations;

      DROP TABLE processed_operations;
      DROP TABLE daily_state;
      ALTER TABLE daily_state_next RENAME TO daily_state;
      ALTER TABLE processed_operations_next RENAME TO processed_operations;
    `);
  });
}

function completedMilestone(resultingCount) {
  return Number.isSafeInteger(resultingCount) &&
    resultingCount > 0 &&
    resultingCount % MILESTONE_INTERVAL === 0
    ? resultingCount
    : null;
}

export class DailyCount extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      initializeSchema(this.ctx.storage);
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

      const processed = this.ctx.storage.sql
        .exec(
          `SELECT resulting_count
           FROM processed_operations
           WHERE operation_id = ?`,
          operationId
        )
        .toArray()[0];
      if (processed !== undefined) {
        return {
          state: parseStateRow(ensured.state),
          completedMilestone: completedMilestone(processed.resulting_count),
        };
      }

      const updated = this.ctx.storage.sql
        .exec(
          `UPDATE daily_state
           SET count = count + 1
           WHERE singleton = 1
           RETURNING date, count`
        )
        .toArray()[0];
      this.ctx.storage.sql.exec(
        `INSERT INTO processed_operations (operation_id, resulting_count)
         VALUES (?, ?)`,
        operationId,
        updated.count
      );
      return {
        state: parseStateRow(updated),
        completedMilestone: completedMilestone(updated.count),
      };
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
