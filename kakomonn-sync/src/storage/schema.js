import { getTokyoDate } from "../dates.js";

const CURRENT_SCHEMA_VERSION = 4;
export const DEFAULT_DAILY_STABILITY_DAYS_DELTA_GOAL = 30;

function tableDefinition(storage, tableName) {
  return storage.sql
    .exec("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", tableName)
    .toArray()[0]?.sql;
}

function createCurrentTables(storage) {
  storage.sql.exec(`
    CREATE TABLE cards (
      site TEXT NOT NULL,
      question_id TEXT NOT NULL,
      due_ms INTEGER NOT NULL,
      stability REAL NOT NULL CHECK (stability >= 0),
      difficulty REAL NOT NULL,
      scheduled_days INTEGER NOT NULL,
      learning_steps INTEGER NOT NULL,
      reps INTEGER NOT NULL,
      lapses INTEGER NOT NULL,
      state INTEGER NOT NULL,
      last_review_ms INTEGER,
      PRIMARY KEY (site, question_id)
    ) WITHOUT ROWID;

    CREATE TABLE attempts (
      site TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      attempted_at_ms INTEGER NOT NULL,
      answer_result TEXT NOT NULL CHECK (answer_result IN ('correct', 'incorrect')),
      previous_card_stability_days REAL NOT NULL CHECK (previous_card_stability_days >= 0),
      resulting_card_stability_days REAL NOT NULL CHECK (resulting_card_stability_days >= 0),
      PRIMARY KEY (operation_id)
    ) WITHOUT ROWID;

    CREATE TABLE stability_history (
      site TEXT NOT NULL,
      date TEXT NOT NULL,
      opening_stability_days INTEGER NOT NULL CHECK (opening_stability_days >= 0),
      closing_stability_days INTEGER NOT NULL CHECK (closing_stability_days >= 0),
      PRIMARY KEY (site, date)
    ) WITHOUT ROWID;

    CREATE TABLE questions (
      site TEXT NOT NULL,
      question_id TEXT NOT NULL,
      PRIMARY KEY (site, question_id)
    ) WITHOUT ROWID;

    CREATE TABLE catalog_metadata (
      site TEXT PRIMARY KEY,
      question_count INTEGER NOT NULL CHECK (question_count > 0),
      updated_at_ms INTEGER NOT NULL,
      generation INTEGER NOT NULL CHECK (generation > 0)
    ) WITHOUT ROWID;

    CREATE TABLE site_settings (
      site TEXT PRIMARY KEY,
      daily_stability_days_delta_goal INTEGER NOT NULL CHECK (daily_stability_days_delta_goal >= 1)
    ) WITHOUT ROWID;

    CREATE TABLE daily_stability_days_delta_achievements (
      site TEXT NOT NULL,
      date TEXT NOT NULL,
      operation_id TEXT NOT NULL UNIQUE,
      achieved_at_ms INTEGER NOT NULL CHECK (achieved_at_ms > 0),
      today_stability_days_delta INTEGER NOT NULL CHECK (today_stability_days_delta >= 1),
      daily_stability_days_delta_goal INTEGER NOT NULL CHECK (daily_stability_days_delta_goal >= 1),
      PRIMARY KEY (site, date)
    ) WITHOUT ROWID;

    CREATE TABLE schema_metadata (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      version INTEGER NOT NULL CHECK (version > 0)
    ) WITHOUT ROWID;

    INSERT INTO schema_metadata (singleton, version)
    VALUES (1, ${CURRENT_SCHEMA_VERSION});
  `);
}

function migrateSchemaV2ToV3(storage) {
  storage.sql.exec(`
    ALTER TABLE attempts RENAME TO attempts_v2;

    CREATE TABLE attempts (
      site TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      attempted_at_ms INTEGER NOT NULL,
      answer_result TEXT NOT NULL CHECK (answer_result IN ('correct', 'incorrect')),
      previous_card_stability_days REAL NOT NULL CHECK (previous_card_stability_days >= 0),
      resulting_card_stability_days REAL NOT NULL CHECK (resulting_card_stability_days >= 0),
      PRIMARY KEY (operation_id)
    ) WITHOUT ROWID;

    INSERT INTO attempts (
      site, operation_id, question_id, attempted_at_ms, answer_result,
      previous_card_stability_days, resulting_card_stability_days
    )
    SELECT site, operation_id, question_id, answered_at_ms, result,
           previous_stability, resulting_stability
    FROM attempts_v2;

    DROP TABLE attempts_v2;

    ALTER TABLE site_settings RENAME TO site_settings_v2;

    CREATE TABLE site_settings (
      site TEXT PRIMARY KEY,
      daily_stability_days_delta_goal INTEGER NOT NULL CHECK (daily_stability_days_delta_goal >= 1)
    ) WITHOUT ROWID;

    INSERT INTO site_settings (site, daily_stability_days_delta_goal)
    SELECT site, daily_stability_days_goal
    FROM site_settings_v2;

    DROP TABLE site_settings_v2;

    UPDATE schema_metadata SET version = 3 WHERE singleton = 1;
  `);
}

function migrateSchemaV3ToV4(storage) {
  storage.sql.exec(`
    CREATE TABLE daily_stability_days_delta_achievements (
      site TEXT NOT NULL,
      date TEXT NOT NULL,
      operation_id TEXT NOT NULL UNIQUE,
      achieved_at_ms INTEGER NOT NULL CHECK (achieved_at_ms > 0),
      today_stability_days_delta INTEGER NOT NULL CHECK (today_stability_days_delta >= 1),
      daily_stability_days_delta_goal INTEGER NOT NULL CHECK (daily_stability_days_delta_goal >= 1),
      PRIMARY KEY (site, date)
    ) WITHOUT ROWID;

    UPDATE schema_metadata SET version = ${CURRENT_SCHEMA_VERSION} WHERE singleton = 1;
  `);
}

function migrateLegacySchema(storage, today) {
  storage.sql.exec(`
    DROP INDEX IF EXISTS attempts_by_site;
    DROP INDEX IF EXISTS attempts_by_site_answered_at_question;

    ALTER TABLE attempts RENAME TO attempts_v4;

    CREATE TABLE attempts (
      site TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      attempted_at_ms INTEGER NOT NULL,
      answer_result TEXT NOT NULL CHECK (answer_result IN ('correct', 'incorrect')),
      previous_card_stability_days REAL NOT NULL CHECK (previous_card_stability_days >= 0),
      resulting_card_stability_days REAL NOT NULL CHECK (resulting_card_stability_days >= 0),
      PRIMARY KEY (operation_id)
    ) WITHOUT ROWID;

    INSERT INTO attempts (
      site, operation_id, question_id, attempted_at_ms, answer_result,
      previous_card_stability_days, resulting_card_stability_days
    )
    SELECT site, operation_id, question_id, answered_at_ms, result,
           previous_stability, resulting_stability
    FROM attempts_v4;

    DROP TABLE attempts_v4;
    DROP TABLE mastery_history;
    DROP TABLE learning_metadata;

    CREATE TABLE stability_history (
      site TEXT NOT NULL,
      date TEXT NOT NULL,
      opening_stability_days INTEGER NOT NULL CHECK (opening_stability_days >= 0),
      closing_stability_days INTEGER NOT NULL CHECK (closing_stability_days >= 0),
      PRIMARY KEY (site, date)
    ) WITHOUT ROWID;

    CREATE TABLE site_settings (
      site TEXT PRIMARY KEY,
      daily_stability_days_delta_goal INTEGER NOT NULL CHECK (daily_stability_days_delta_goal >= 1)
    ) WITHOUT ROWID;

    CREATE TABLE daily_stability_days_delta_achievements (
      site TEXT NOT NULL,
      date TEXT NOT NULL,
      operation_id TEXT NOT NULL UNIQUE,
      achieved_at_ms INTEGER NOT NULL CHECK (achieved_at_ms > 0),
      today_stability_days_delta INTEGER NOT NULL CHECK (today_stability_days_delta >= 1),
      daily_stability_days_delta_goal INTEGER NOT NULL CHECK (daily_stability_days_delta_goal >= 1),
      PRIMARY KEY (site, date)
    ) WITHOUT ROWID;

    CREATE TABLE schema_metadata (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      version INTEGER NOT NULL CHECK (version > 0)
    ) WITHOUT ROWID;

    INSERT INTO schema_metadata (singleton, version)
    VALUES (1, ${CURRENT_SCHEMA_VERSION});
  `);

  storage.sql.exec(
    `INSERT INTO site_settings (site, daily_stability_days_delta_goal)
     SELECT site, ? FROM catalog_metadata`,
    DEFAULT_DAILY_STABILITY_DAYS_DELTA_GOAL
  );
  const sites = storage.sql.exec("SELECT site FROM catalog_metadata").toArray();
  for (const { site } of sites) {
    const stabilityDays = storage.sql
      .exec(
        `SELECT CAST(COALESCE(SUM(c.stability), 0) AS INTEGER) AS stability_days
         FROM questions q
         LEFT JOIN cards c ON c.site = q.site AND c.question_id = q.question_id
         WHERE q.site = ?`,
        site
      )
      .toArray()[0].stability_days;
    storage.sql.exec(
      `INSERT INTO stability_history (
         site, date, opening_stability_days, closing_stability_days
       ) VALUES (?, ?, ?, ?)`,
      site,
      today,
      stabilityDays,
      stabilityDays
    );
  }
}

function installIndexes(storage) {
  storage.sql.exec("DROP INDEX IF EXISTS attempts_by_site");
  storage.sql.exec(`
    CREATE INDEX IF NOT EXISTS cards_by_site_stability
      ON cards (site, stability);
    CREATE INDEX IF NOT EXISTS cards_by_site_due
      ON cards (site, due_ms, question_id);
    CREATE INDEX IF NOT EXISTS attempts_by_site_attempted_at_question
      ON attempts (site, attempted_at_ms, question_id);
  `);
}

export function initializeLearningSchema(storage, nowMs = Date.now()) {
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) {
    throw new TypeError("invalid schema initialization time");
  }
  storage.transactionSync(() => {
    const schemaV3Tables = [
      "attempts",
      "cards",
      "catalog_metadata",
      "questions",
      "schema_metadata",
      "site_settings",
      "stability_history",
    ];
    const currentTables = [
      ...schemaV3Tables,
      "daily_stability_days_delta_achievements",
    ];
    const legacyTables = [
      "attempts",
      "cards",
      "catalog_metadata",
      "learning_metadata",
      "mastery_history",
      "questions",
    ];
    const existingSchemaV3 = schemaV3Tables.filter(
      (name) => tableDefinition(storage, name) !== undefined
    );
    const existingLegacy = legacyTables.filter(
      (name) => tableDefinition(storage, name) !== undefined
    );

    if (existingSchemaV3.length === 0 && existingLegacy.length === 0) {
      createCurrentTables(storage);
    } else if (
      tableDefinition(storage, "schema_metadata") === undefined &&
      existingLegacy.length === legacyTables.length
    ) {
      migrateLegacySchema(storage, getTokyoDate(new Date(nowMs)));
    } else if (existingSchemaV3.length !== schemaV3Tables.length) {
      throw new Error("incomplete LearningState schema");
    }

    let version = storage.sql
      .exec("SELECT version FROM schema_metadata WHERE singleton = 1")
      .toArray()[0]?.version;
    if (version === 2) {
      migrateSchemaV2ToV3(storage);
      version = 3;
    }
    if (version === 3) {
      migrateSchemaV3ToV4(storage);
      version = CURRENT_SCHEMA_VERSION;
    }
    if (version !== CURRENT_SCHEMA_VERSION) {
      throw new Error("unsupported LearningState schema version");
    }
    if (currentTables.some((name) => tableDefinition(storage, name) === undefined)) {
      throw new Error("incomplete LearningState schema");
    }
    installIndexes(storage);
  });
}
