import { DurableObject } from "cloudflare:workers";

const MILESTONE_INTERVAL = 50;
const DAILY_COUNT_OBJECT_NAME = "primary";
const MAX_HISTORY_DAYS = 31;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const OPERATION_ID_PATTERN = /^[0-9a-f]{32}$/;
const SITE_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.kakomonn\.com$/;
const LEGACY_SITE = "chushoks.kakomonn.com";
const ANSWER_RESULTS = new Set(["correct", "incorrect"]);
const AZURE_SPEECH_TOKEN_URL =
  "https://japaneast.api.cognitive.microsoft.com/sts/v1.0/issueToken";
const AZURE_SPEECH_TOKEN_TTL_SECONDS = 600;
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

function nextDate(value) {
  return isoDateFromOrdinal(dateOrdinal(value) + 1);
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

function isSite(value) {
  return typeof value === "string" && SITE_PATTERN.test(value);
}

function parseStateRow(site, row, availability) {
  return {
    site,
    date: row.date,
    counts: {
      correct: row.correct_count,
      answered:
        row.date < availability.answered ? null : row.answered_count,
    },
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

function assertColumns(actual, expected, tableName) {
  if (
    actual.length !== expected.length ||
    actual.some((column, index) => column !== expected[index])
  ) {
    throw new Error(`unexpected ${tableName} schema`);
  }
}

function createSiteLearningLogSchema(storage) {
  storage.sql.exec(`
    CREATE TABLE daily_state (
      site TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      correct_count INTEGER NOT NULL CHECK (correct_count >= 0),
      answered_count INTEGER NOT NULL CHECK (
        answered_count >= correct_count
      )
    );
    CREATE TABLE processed_answers (
      site TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      result TEXT NOT NULL CHECK (result IN ('correct', 'incorrect')),
      completed_milestone INTEGER CHECK (
        completed_milestone IS NULL OR completed_milestone >= 1
      ),
      PRIMARY KEY (site, operation_id)
    ) WITHOUT ROWID;
    CREATE TABLE daily_history (
      site TEXT NOT NULL,
      date TEXT NOT NULL,
      correct_count INTEGER NOT NULL CHECK (correct_count >= 0),
      answered_count INTEGER CHECK (
        answered_count IS NULL OR answered_count >= correct_count
      ),
      PRIMARY KEY (site, date)
    ) WITHOUT ROWID;
    CREATE TABLE tracking_metadata (
      site TEXT PRIMARY KEY,
      correct_available_from TEXT,
      answered_available_from TEXT
    );
  `);
}

function createSiteLessLearningLogSchema(storage) {
  storage.sql.exec(`
    CREATE TABLE daily_state (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      date TEXT NOT NULL,
      correct_count INTEGER NOT NULL CHECK (correct_count >= 0),
      answered_count INTEGER NOT NULL CHECK (
        answered_count >= correct_count
      )
    );
    CREATE TABLE processed_answers (
      operation_id TEXT PRIMARY KEY,
      result TEXT NOT NULL CHECK (result IN ('correct', 'incorrect')),
      completed_milestone INTEGER CHECK (
        completed_milestone IS NULL OR completed_milestone >= 1
      )
    ) WITHOUT ROWID;
    CREATE TABLE daily_history (
      date TEXT PRIMARY KEY,
      correct_count INTEGER NOT NULL CHECK (correct_count >= 0),
      answered_count INTEGER CHECK (
        answered_count IS NULL OR answered_count >= correct_count
      )
    ) WITHOUT ROWID;
    CREATE TABLE tracking_metadata (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      correct_available_from TEXT,
      answered_available_from TEXT
    );
  `);
}

function validateLegacyDailySchema(storage) {
  const dailyDefinition = tableDefinition(storage, "daily_state");
  const operationsDefinition = tableDefinition(storage, "processed_operations");
  if (dailyDefinition === undefined || operationsDefinition === undefined) {
    throw new Error("incomplete legacy DailyCount schema");
  }

  assertColumns(
    tableColumns(storage, "daily_state"),
    ["singleton", "date", "count"],
    "legacy daily_state"
  );
  assertColumns(
    tableColumns(storage, "processed_operations"),
    ["operation_id", "resulting_count"],
    "processed_operations"
  );
  if (!/count\s*>=\s*0/i.test(dailyDefinition)) {
    throw new Error("unsupported legacy daily_state schema");
  }
}

function validateLegacyHistorySchema(storage) {
  validateLegacyDailySchema(storage);
  if (
    tableDefinition(storage, "daily_history") === undefined ||
    tableDefinition(storage, "tracking_metadata") === undefined
  ) {
    throw new Error("incomplete legacy history schema");
  }
  assertColumns(
    tableColumns(storage, "daily_history"),
    ["date", "count"],
    "legacy daily_history"
  );
  assertColumns(
    tableColumns(storage, "tracking_metadata"),
    ["singleton", "available_from"],
    "legacy tracking_metadata"
  );
}

function validateSiteLessLearningLogSchema(storage) {
  const tableNames = [
    "daily_state",
    "processed_answers",
    "daily_history",
    "tracking_metadata",
  ];
  if (tableNames.some((name) => tableDefinition(storage, name) === undefined)) {
    throw new Error("incomplete learning log schema");
  }

  assertColumns(
    tableColumns(storage, "daily_state"),
    ["singleton", "date", "correct_count", "answered_count"],
    "daily_state"
  );
  assertColumns(
    tableColumns(storage, "processed_answers"),
    ["operation_id", "result", "completed_milestone"],
    "processed_answers"
  );
  assertColumns(
    tableColumns(storage, "daily_history"),
    ["date", "correct_count", "answered_count"],
    "daily_history"
  );
  assertColumns(
    tableColumns(storage, "tracking_metadata"),
    ["singleton", "correct_available_from", "answered_available_from"],
    "tracking_metadata"
  );

  const dailyDefinition = tableDefinition(storage, "daily_state");
  if (
    !/correct_count\s*>=\s*0/i.test(dailyDefinition) ||
    !/answered_count\s*>=\s*correct_count/i.test(dailyDefinition)
  ) {
    throw new Error("unsupported daily_state schema");
  }
}

function validateSiteLearningLogSchema(storage) {
  const tableNames = [
    "daily_state",
    "processed_answers",
    "daily_history",
    "tracking_metadata",
  ];
  if (tableNames.some((name) => tableDefinition(storage, name) === undefined)) {
    throw new Error("incomplete site learning log schema");
  }

  assertColumns(
    tableColumns(storage, "daily_state"),
    ["site", "date", "correct_count", "answered_count"],
    "daily_state"
  );
  assertColumns(
    tableColumns(storage, "processed_answers"),
    ["site", "operation_id", "result", "completed_milestone"],
    "processed_answers"
  );
  assertColumns(
    tableColumns(storage, "daily_history"),
    ["site", "date", "correct_count", "answered_count"],
    "daily_history"
  );
  assertColumns(
    tableColumns(storage, "tracking_metadata"),
    ["site", "correct_available_from", "answered_available_from"],
    "tracking_metadata"
  );

  const dailyDefinition = tableDefinition(storage, "daily_state");
  if (
    !/correct_count\s*>=\s*0/i.test(dailyDefinition) ||
    !/answered_count\s*>=\s*correct_count/i.test(dailyDefinition)
  ) {
    throw new Error("unsupported daily_state schema");
  }
}

function migrateLegacySchema(storage, hasHistory) {
  validateLegacyDailySchema(storage);
  if (hasHistory) {
    validateLegacyHistorySchema(storage);
  }

  storage.sql.exec("ALTER TABLE daily_state RENAME TO legacy_daily_state");
  storage.sql.exec(
    "ALTER TABLE processed_operations RENAME TO legacy_processed_operations"
  );
  if (hasHistory) {
    storage.sql.exec(
      "ALTER TABLE daily_history RENAME TO legacy_daily_history"
    );
    storage.sql.exec(
      "ALTER TABLE tracking_metadata RENAME TO legacy_tracking_metadata"
    );
  }

  createSiteLessLearningLogSchema(storage);
  storage.sql.exec(`
    INSERT INTO daily_state (
      singleton,
      date,
      correct_count,
      answered_count
    )
    SELECT singleton, date, count, count
    FROM legacy_daily_state;

    INSERT INTO processed_answers (
      operation_id,
      result,
      completed_milestone
    )
    SELECT
      operation_id,
      'correct',
      CASE
        WHEN resulting_count > 0
          AND resulting_count % ${MILESTONE_INTERVAL} = 0
        THEN resulting_count
        ELSE NULL
      END
    FROM legacy_processed_operations;
  `);

  if (hasHistory) {
    storage.sql.exec(`
      INSERT INTO daily_history (date, correct_count, answered_count)
      SELECT date, count, NULL
      FROM legacy_daily_history;

      INSERT INTO tracking_metadata (
        singleton,
        correct_available_from,
        answered_available_from
      )
      SELECT singleton, available_from, NULL
      FROM legacy_tracking_metadata;

      INSERT OR IGNORE INTO tracking_metadata (
        singleton,
        correct_available_from,
        answered_available_from
      ) VALUES (1, NULL, NULL);
    `);
  } else {
    storage.sql.exec(`
      INSERT INTO tracking_metadata (
        singleton,
        correct_available_from,
        answered_available_from
      ) VALUES (1, NULL, NULL);
    `);
  }

  storage.sql.exec("DROP TABLE legacy_processed_operations");
  storage.sql.exec("DROP TABLE legacy_daily_state");
  if (hasHistory) {
    storage.sql.exec("DROP TABLE legacy_tracking_metadata");
    storage.sql.exec("DROP TABLE legacy_daily_history");
  }
}

function migrateSiteLessSchema(storage) {
  validateSiteLessLearningLogSchema(storage);
  for (const tableName of [
    "daily_state",
    "processed_answers",
    "daily_history",
    "tracking_metadata",
  ]) {
    storage.sql.exec(
      `ALTER TABLE ${tableName} RENAME TO site_less_${tableName}`
    );
  }

  createSiteLearningLogSchema(storage);
  storage.sql.exec(
    `INSERT INTO daily_state (
       site, date, correct_count, answered_count
     )
     SELECT ?, date, correct_count, answered_count
     FROM site_less_daily_state`,
    LEGACY_SITE
  );
  storage.sql.exec(
    `INSERT INTO processed_answers (
       site, operation_id, result, completed_milestone
     )
     SELECT ?, operation_id, result, completed_milestone
     FROM site_less_processed_answers`,
    LEGACY_SITE
  );
  storage.sql.exec(
    `INSERT INTO daily_history (
       site, date, correct_count, answered_count
     )
     SELECT ?, date, correct_count, answered_count
     FROM site_less_daily_history`,
    LEGACY_SITE
  );
  storage.sql.exec(
    `INSERT INTO tracking_metadata (
       site, correct_available_from, answered_available_from
     )
     SELECT ?, correct_available_from, answered_available_from
     FROM site_less_tracking_metadata`,
    LEGACY_SITE
  );

  for (const tableName of [
    "processed_answers",
    "daily_state",
    "tracking_metadata",
    "daily_history",
  ]) {
    storage.sql.exec(`DROP TABLE site_less_${tableName}`);
  }
}

export function initializeSchema(storage) {
  storage.transactionSync(() => {
    const newTableNames = [
      "daily_state",
      "processed_answers",
      "daily_history",
      "tracking_metadata",
    ];
    const legacyOperations = tableDefinition(storage, "processed_operations");
    const newDefinitions = newTableNames.map((name) =>
      tableDefinition(storage, name)
    );

    if (
      legacyOperations === undefined &&
      newDefinitions.every((definition) => definition === undefined)
    ) {
      createSiteLearningLogSchema(storage);
      return;
    }

    if (
      legacyOperations === undefined &&
      newDefinitions.every((definition) => definition !== undefined)
    ) {
      const dailyColumns = tableColumns(storage, "daily_state");
      if (dailyColumns[0] === "site") {
        validateSiteLearningLogSchema(storage);
        return;
      }
      if (dailyColumns[0] === "singleton") {
        migrateSiteLessSchema(storage);
        validateSiteLearningLogSchema(storage);
        return;
      }
      throw new Error("unexpected DailyCount schema");
    }

    const hasLegacyDaily =
      legacyOperations !== undefined && newDefinitions[0] !== undefined;
    const hasLegacyHistory =
      newDefinitions[2] !== undefined && newDefinitions[3] !== undefined;
    const hasNewAnswers = newDefinitions[1] !== undefined;
    if (
      hasLegacyDaily &&
      !hasNewAnswers &&
      (hasLegacyHistory ||
        (newDefinitions[2] === undefined && newDefinitions[3] === undefined))
    ) {
      migrateLegacySchema(storage, hasLegacyHistory);
      migrateSiteLessSchema(storage);
      validateSiteLearningLogSchema(storage);
      return;
    }

    throw new Error("unexpected DailyCount schema");
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

  trackingAvailability(site) {
    const row = this.ctx.storage.sql
      .exec(
        `SELECT correct_available_from, answered_available_from
         FROM tracking_metadata
         WHERE site = ?`,
        site
      )
      .toArray()[0];
    return row === undefined
      ? undefined
      : {
          correct: row.correct_available_from,
          answered: row.answered_available_from,
        };
  }

  ensureTrackingAvailability(site, date) {
    const existing = this.trackingAvailability(site);
    if (existing === undefined) {
      this.ctx.storage.sql.exec(
        `INSERT INTO tracking_metadata (
           site,
           correct_available_from,
           answered_available_from
         ) VALUES (?, ?, ?)`,
        site,
        date,
        date
      );
      return { correct: date, answered: date };
    }

    const availability = {
      correct: existing.correct ?? date,
      answered: existing.answered ?? nextDate(date),
    };
    if (existing.correct === null || existing.answered === null) {
      this.ctx.storage.sql.exec(
        `UPDATE tracking_metadata
         SET correct_available_from = ?, answered_available_from = ?
         WHERE site = ?`,
        availability.correct,
        availability.answered,
        site
      );
    }
    return availability;
  }

  ensureDate(site, date) {
    const availability = this.ensureTrackingAvailability(site, date);
    const existing = this.ctx.storage.sql
      .exec(
        `SELECT date, correct_count, answered_count
         FROM daily_state
         WHERE site = ?`,
        site
      )
      .toArray()[0];

    if (existing?.date === date) {
      return { state: existing, stale: false, availability };
    }

    if (existing?.date > date) {
      return { state: existing, stale: true, availability };
    }

    if (existing !== undefined && existing.date >= availability.correct) {
      this.ctx.storage.sql.exec(
         `INSERT INTO daily_history (
           site,
           date,
           correct_count,
           answered_count
         ) VALUES (?, ?, ?, ?)`,
        site,
        existing.date,
        existing.correct_count,
        existing.date < availability.answered
          ? null
          : existing.answered_count
      );
    }
    this.ctx.storage.sql.exec(
      "DELETE FROM processed_answers WHERE site = ?",
      site
    );

    if (existing === undefined) {
      this.ctx.storage.sql.exec(
         `INSERT INTO daily_state (
           site,
           date,
           correct_count,
           answered_count
         ) VALUES (?, ?, 0, 0)`,
        site,
        date
      );
    } else {
      this.ctx.storage.sql.exec(
         `UPDATE daily_state
         SET date = ?, correct_count = 0, answered_count = 0
         WHERE site = ?`,
        date,
        site
      );
    }
    return {
      state: { date, correct_count: 0, answered_count: 0 },
      stale: false,
      availability,
    };
  }

  getState(site, date) {
    if (!isSite(site) || dateOrdinal(date) === null) {
      throw new TypeError("invalid date");
    }

    return this.ctx.storage.transactionSync(() => {
      const ensured = this.ensureDate(site, date);
      return parseStateRow(site, ensured.state, ensured.availability);
    });
  }

  getHistory(site, today, from, to) {
    const range = parseHistoryRange(from, to);
    if (!isSite(site) || dateOrdinal(today) === null || range === null) {
      throw new TypeError("invalid history range");
    }

    return this.ctx.storage.transactionSync(() => {
      const ensured = this.ensureDate(site, today);
      if (ensured.stale) {
        throw new Error("history date moved backwards");
      }
      const availability = ensured.availability;

      const counts = new Map(
        this.ctx.storage.sql
          .exec(
            `SELECT date, correct_count, answered_count
             FROM daily_history
             WHERE site = ? AND date >= ? AND date <= ?
             ORDER BY date`,
            site,
            from,
            to
          )
          .toArray()
          .map((row) => [row.date, row])
      );
      if (ensured.state.date >= from && ensured.state.date <= to) {
        counts.set(ensured.state.date, ensured.state);
      }

      const days = [];
      for (
        let ordinal = range.fromOrdinal;
        ordinal <= range.toOrdinal;
        ordinal += 1
      ) {
        const date = isoDateFromOrdinal(ordinal);
        const row = counts.get(date);
        days.push({
          date,
          counts: {
            correct:
              date < availability.correct || date > today
                ? null
                : (row?.correct_count ?? 0),
            answered:
              date < availability.answered || date > today
                ? null
                : (row?.answered_count ?? 0),
          },
        });
      }
      return {
        site,
        timeZone: "Asia/Tokyo",
        today,
        availableFrom: availability,
        from,
        to,
        days,
      };
    });
  }

  recordAnswer(site, date, operationId, result) {
    if (
      !isSite(site) ||
      dateOrdinal(date) === null ||
      !OPERATION_ID_PATTERN.test(operationId) ||
      !ANSWER_RESULTS.has(result)
    ) {
      throw new TypeError("invalid answer operation");
    }

    return this.ctx.storage.transactionSync(() => {
      const ensured = this.ensureDate(site, date);
      if (ensured.stale) {
        return {
          error: "date_changed",
          state: parseStateRow(site, ensured.state, ensured.availability),
        };
      }

      const processed = this.ctx.storage.sql
        .exec(
          `SELECT result, completed_milestone
           FROM processed_answers
           WHERE site = ? AND operation_id = ?`,
          site,
          operationId
        )
        .toArray()[0];
      if (processed !== undefined) {
        if (processed.result !== result) {
          return {
            error: "operation_conflict",
            state: parseStateRow(site, ensured.state, ensured.availability),
          };
        }
        return {
          state: parseStateRow(site, ensured.state, ensured.availability),
          completedMilestone: processed.completed_milestone,
        };
      }

      const correctIncrement = result === "correct" ? 1 : 0;
      const updated = this.ctx.storage.sql
        .exec(
          `UPDATE daily_state
           SET
             correct_count = correct_count + ?,
             answered_count = answered_count + 1
           WHERE site = ?
           RETURNING date, correct_count, answered_count`,
          correctIncrement,
          site
        )
        .toArray()[0];
      const milestone =
        result === "correct" ? completedMilestone(updated.correct_count) : null;
      this.ctx.storage.sql.exec(
        `INSERT INTO processed_answers (
           site,
           operation_id,
           result,
           completed_milestone
         ) VALUES (?, ?, ?, ?)`,
        site,
        operationId,
        result,
        milestone
      );
      return {
        state: parseStateRow(site, updated, ensured.availability),
        completedMilestone: milestone,
      };
    });
  }

  listSites() {
    return this.ctx.storage.sql
      .exec("SELECT site FROM tracking_metadata ORDER BY site")
      .toArray()
      .map((row) => row.site);
  }
}

function getDailyCountStub(env) {
  const id = env.DAILY_COUNT.idFromName(DAILY_COUNT_OBJECT_NAME);
  return env.DAILY_COUNT.get(id);
}

export async function issueSpeechToken(env, fetcher = fetch) {
  if (
    typeof env.AZURE_SPEECH_KEY !== "string" ||
    env.AZURE_SPEECH_KEY.length === 0
  ) {
    return errorResponse("server_misconfigured", 500);
  }

  let response;
  try {
    response = await fetcher(AZURE_SPEECH_TOKEN_URL, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": env.AZURE_SPEECH_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "",
    });
  } catch {
    return errorResponse("speech_service_unavailable", 502);
  }

  if (!response.ok) {
    return errorResponse(
      response.status === 401 || response.status === 403
        ? "server_misconfigured"
        : "speech_service_unavailable",
      response.status === 401 || response.status === 403 ? 500 : 502
    );
  }

  const token = (await response.text()).trim();
  if (!token || token.length > 8192 || /\s/.test(token)) {
    return errorResponse("invalid_speech_response", 502);
  }

  return jsonResponse({
    token,
    expiresInSeconds: AZURE_SPEECH_TOKEN_TTL_SECONDS,
  });
}

async function parseAnswerRequest(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return null;
  }

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  const keys = Object.keys(body).sort();
  if (
    keys.length !== 4 ||
    keys[0] !== "date" ||
    keys[1] !== "operationId" ||
    keys[2] !== "result" ||
    keys[3] !== "site" ||
    dateOrdinal(body.date) === null ||
    !OPERATION_ID_PATTERN.test(body.operationId) ||
    !ANSWER_RESULTS.has(body.result) ||
    !isSite(body.site)
  ) {
    return null;
  }

  return {
    date: body.date,
    operationId: body.operationId,
    result: body.result,
    site: body.site,
  };
}

function parseHistoryRequest(url) {
  const keys = [...url.searchParams.keys()];
  if (
    keys.length !== 3 ||
    keys.some((key) => !["from", "site", "to"].includes(key)) ||
    url.searchParams.getAll("from").length !== 1 ||
    url.searchParams.getAll("to").length !== 1 ||
    url.searchParams.getAll("site").length !== 1 ||
    !isSite(url.searchParams.get("site"))
  ) {
    return null;
  }
  return parseHistoryRange(
    url.searchParams.get("from"),
    url.searchParams.get("to")
  );
}

function parseStateSite(url) {
  const keys = [...url.searchParams.keys()];
  if (
    keys.length !== 1 ||
    keys[0] !== "site" ||
    url.searchParams.getAll("site").length !== 1
  ) {
    return null;
  }
  const site = url.searchParams.get("site");
  return isSite(site) ? site : null;
}

export async function handleRequest(request, env, fetcher = fetch) {
  const url = new URL(request.url);
  const routes = new Map([
    ["/v3/sites", "GET"],
    ["/v3/state", "GET"],
    ["/v3/history", "GET"],
    ["/v3/answers", "POST"],
    ["/v3/speech-token", "POST"],
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

  if (url.pathname === "/v3/speech-token") {
    if (url.search !== "") {
      return errorResponse("invalid_request", 400);
    }
    return issueSpeechToken(env, fetcher);
  }

  const today = getTokyoDate();
  const stub = getDailyCountStub(env);
  if (url.pathname === "/v3/sites") {
    if (url.search !== "") {
      return errorResponse("invalid_request", 400);
    }
    return jsonResponse({ sites: await stub.listSites() });
  }
  if (url.pathname === "/v3/state") {
    const site = parseStateSite(url);
    if (site === null) {
      return errorResponse("invalid_request", 400);
    }
    return jsonResponse(await stub.getState(site, today));
  }
  if (url.pathname === "/v3/history") {
    const range = parseHistoryRequest(url);
    if (range === null) {
      return errorResponse("invalid_request", 400);
    }
    const site = url.searchParams.get("site");
    return jsonResponse(
      await stub.getHistory(site, today, range.from, range.to)
    );
  }

  if (url.search !== "") {
    return errorResponse("invalid_request", 400);
  }

  const answer = await parseAnswerRequest(request);
  if (answer === null) {
    return errorResponse("invalid_request", 400);
  }
  if (answer.date !== today) {
    return jsonResponse(
      {
        error: "date_changed",
        state: await stub.getState(answer.site, today),
      },
      409
    );
  }

  const result = await stub.recordAnswer(
    answer.site,
    answer.date,
    answer.operationId,
    answer.result
  );
  if (
    result?.error === "date_changed" ||
    result?.error === "operation_conflict"
  ) {
    return jsonResponse(result, 409);
  }
  return jsonResponse(result);
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
