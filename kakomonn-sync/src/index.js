import { DurableObject } from "cloudflare:workers";

const MILESTONE_INTERVAL = 50;
const DAILY_COUNT_OBJECT_NAME = "primary";
const MAX_HISTORY_DAYS = 31;
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

function dateOrdinal(value) {
  if (!DATE_PATTERN.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return null;
  }
  return Math.floor(date.getTime() / 86_400_000);
}

function isoDateFromOrdinal(ordinal) {
  return new Date(ordinal * 86_400_000).toISOString().slice(0, 10);
}

function parseHistoryRange(from, to) {
  const fromOrdinal = dateOrdinal(from);
  const toOrdinal = dateOrdinal(to);
  if (
    fromOrdinal === null ||
    toOrdinal === null ||
    fromOrdinal > toOrdinal ||
    toOrdinal - fromOrdinal + 1 > MAX_HISTORY_DAYS
  ) {
    return null;
  }
  return { from, to, fromOrdinal, toOrdinal };
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

function createHistorySchema(storage) {
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
    CREATE TABLE daily_history (
      date TEXT PRIMARY KEY,
      count INTEGER NOT NULL CHECK (count >= 0)
    ) WITHOUT ROWID;
    CREATE TABLE tracking_metadata (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      available_from TEXT NOT NULL
    );
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

function validateDailyAndOperationSchema(storage) {
  const dailyDefinition = tableDefinition(storage, "daily_state");
  const operationsDefinition = tableDefinition(storage, "processed_operations");
  if (dailyDefinition === undefined || operationsDefinition === undefined) {
    throw new Error("incomplete DailyCount schema");
  }

  assertColumns(
    tableColumns(storage, "daily_state"),
    ["singleton", "date", "count"],
    "daily_state"
  );
  assertColumns(
    tableColumns(storage, "processed_operations"),
    ["operation_id", "resulting_count"],
    "processed_operations"
  );
  if (!/count\s*>=\s*0/i.test(dailyDefinition)) {
    throw new Error("unsupported daily_state schema");
  }
}

function validateHistorySchema(storage) {
  validateDailyAndOperationSchema(storage);
  if (
    tableDefinition(storage, "daily_history") === undefined ||
    tableDefinition(storage, "tracking_metadata") === undefined
  ) {
    throw new Error("incomplete history schema");
  }
  assertColumns(
    tableColumns(storage, "daily_history"),
    ["date", "count"],
    "daily_history"
  );
  assertColumns(
    tableColumns(storage, "tracking_metadata"),
    ["singleton", "available_from"],
    "tracking_metadata"
  );
}

export function initializeSchema(storage) {
  storage.transactionSync(() => {
    const definitions = [
      "daily_state",
      "processed_operations",
      "daily_history",
      "tracking_metadata",
    ].map((tableName) => tableDefinition(storage, tableName));

    if (definitions.every((definition) => definition === undefined)) {
      createHistorySchema(storage);
      return;
    }

    const hasDailySchema = definitions[0] !== undefined && definitions[1] !== undefined;
    const hasHistorySchema = definitions[2] !== undefined && definitions[3] !== undefined;
    if (hasDailySchema && !hasHistorySchema) {
      validateDailyAndOperationSchema(storage);
      storage.sql.exec(`
        CREATE TABLE daily_history (
          date TEXT PRIMARY KEY,
          count INTEGER NOT NULL CHECK (count >= 0)
        ) WITHOUT ROWID;
        CREATE TABLE tracking_metadata (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          available_from TEXT NOT NULL
        );
      `);
      return;
    }

    if (!definitions.every((definition) => definition !== undefined)) {
      throw new Error("incomplete DailyCount history schema");
    }
    validateHistorySchema(storage);
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

  trackingStart() {
    return this.ctx.storage.sql
      .exec(
        "SELECT available_from FROM tracking_metadata WHERE singleton = 1"
      )
      .toArray()[0]?.available_from;
  }

  ensureTrackingStart(date) {
    const availableFrom = this.trackingStart();
    if (availableFrom !== undefined) {
      return availableFrom;
    }
    this.ctx.storage.sql.exec(
      "INSERT INTO tracking_metadata (singleton, available_from) VALUES (1, ?)",
      date
    );
    return date;
  }

  ensureDate(date) {
    const existing = this.ctx.storage.sql
      .exec("SELECT date, count FROM daily_state WHERE singleton = 1")
      .toArray()[0];

    if (existing?.date === date) {
      this.ensureTrackingStart(date);
      return { state: existing, stale: false };
    }

    if (existing?.date > date) {
      return { state: existing, stale: true };
    }

    const availableFrom = this.trackingStart();
    if (existing !== undefined && availableFrom !== undefined) {
      this.ctx.storage.sql.exec(
        "INSERT INTO daily_history (date, count) VALUES (?, ?)",
        existing.date,
        existing.count
      );
    }
    this.ensureTrackingStart(date);
    this.ctx.storage.sql.exec("DELETE FROM processed_operations");

    if (existing === undefined) {
      this.ctx.storage.sql.exec(
        "INSERT INTO daily_state (singleton, date, count) VALUES (1, ?, 0)",
        date
      );
    } else {
      this.ctx.storage.sql.exec(
        "UPDATE daily_state SET date = ?, count = 0 WHERE singleton = 1",
        date
      );
    }
    return { state: { date, count: 0 }, stale: false };
  }

  getCount(date) {
    if (dateOrdinal(date) === null) {
      throw new TypeError("invalid date");
    }

    return this.ctx.storage.transactionSync(() =>
      parseStateRow(this.ensureDate(date).state)
    );
  }

  getHistory(today, from, to) {
    const range = parseHistoryRange(from, to);
    if (dateOrdinal(today) === null || range === null) {
      throw new TypeError("invalid history range");
    }

    return this.ctx.storage.transactionSync(() => {
      const ensured = this.ensureDate(today);
      if (ensured.stale) {
        throw new Error("history date moved backwards");
      }
      const availableFrom = this.trackingStart();
      if (availableFrom === undefined) {
        throw new Error("tracking metadata is missing");
      }

      const counts = new Map(
        this.ctx.storage.sql
          .exec(
            `SELECT date, count FROM daily_history
             WHERE date >= ? AND date <= ?
             ORDER BY date`,
            from,
            to
          )
          .toArray()
          .map((row) => [row.date, row.count])
      );
      if (ensured.state.date >= from && ensured.state.date <= to) {
        counts.set(ensured.state.date, ensured.state.count);
      }

      const days = [];
      for (
        let ordinal = range.fromOrdinal;
        ordinal <= range.toOrdinal;
        ordinal += 1
      ) {
        const date = isoDateFromOrdinal(ordinal);
        days.push({
          date,
          count:
            date < availableFrom || date > today ? null : (counts.get(date) ?? 0),
        });
      }
      return {
        timeZone: "Asia/Tokyo",
        today,
        availableFrom,
        from,
        to,
        days,
      };
    });
  }

  recordCorrect(date, operationId) {
    if (dateOrdinal(date) === null || !OPERATION_ID_PATTERN.test(operationId)) {
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
    dateOrdinal(body.date) === null ||
    !OPERATION_ID_PATTERN.test(body.operationId)
  ) {
    return null;
  }

  return { date: body.date, operationId: body.operationId };
}

function parseHistoryRequest(url) {
  const keys = [...url.searchParams.keys()];
  if (
    keys.length !== 2 ||
    keys.some((key) => key !== "from" && key !== "to") ||
    url.searchParams.getAll("from").length !== 1 ||
    url.searchParams.getAll("to").length !== 1
  ) {
    return null;
  }
  return parseHistoryRange(
    url.searchParams.get("from"),
    url.searchParams.get("to")
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const routes = new Map([
      ["/v1/count", "GET"],
      ["/v1/history", "GET"],
      ["/v1/correct", "POST"],
    ]);
    const expectedMethod = routes.get(url.pathname);
    if (expectedMethod === undefined) {
      return errorResponse("not_found", 404);
    }
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
    if (url.pathname === "/v1/count") {
      return jsonResponse(await stub.getCount(today));
    }
    if (url.pathname === "/v1/history") {
      const range = parseHistoryRequest(url);
      if (range === null) {
        return errorResponse("invalid_request", 400);
      }
      return jsonResponse(await stub.getHistory(today, range.from, range.to));
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

    const result = await stub.recordCorrect(correct.date, correct.operationId);
    if (result?.error === "date_changed") {
      return jsonResponse(result, 409);
    }
    return jsonResponse(result);
  },
};
