const CURRENT_SCHEMA_VERSION = 13;

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
      last_attempt_date TEXT,
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
      attempted_question_count INTEGER NOT NULL DEFAULT 0
        CHECK (attempted_question_count >= 0),
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      correct_attempt_count INTEGER NOT NULL DEFAULT 0
        CHECK (correct_attempt_count >= 0),
      new_question_count INTEGER NOT NULL DEFAULT 0
        CHECK (new_question_count >= 0),
      CHECK (correct_attempt_count <= attempt_count),
      PRIMARY KEY (site, date)
    ) WITHOUT ROWID;

    CREATE TABLE questions (
      site TEXT NOT NULL,
      question_id TEXT NOT NULL,
      question_number INTEGER NOT NULL,
      attempted INTEGER NOT NULL DEFAULT 0 CHECK (attempted IN (0, 1)),
      PRIMARY KEY (site, question_id)
    ) WITHOUT ROWID;

    CREATE TABLE catalog_metadata (
      site TEXT PRIMARY KEY,
      question_count INTEGER NOT NULL CHECK (question_count > 0),
      updated_at_ms INTEGER NOT NULL,
      generation INTEGER NOT NULL CHECK (generation > 0),
      question_ids_json TEXT NOT NULL
    ) WITHOUT ROWID;

    CREATE TABLE study_time_sessions (
      site TEXT NOT NULL,
      date TEXT NOT NULL,
      session_id TEXT NOT NULL,
      active_ms INTEGER NOT NULL CHECK (active_ms >= 0),
      PRIMARY KEY (site, date, session_id)
    ) WITHOUT ROWID;

    CREATE TABLE study_time_daily (
      site TEXT NOT NULL,
      date TEXT NOT NULL,
      study_time_ms INTEGER NOT NULL CHECK (study_time_ms >= 0),
      PRIMARY KEY (site, date)
    ) WITHOUT ROWID;

    CREATE TABLE learning_metrics (
      site TEXT PRIMARY KEY,
      stability_days REAL NOT NULL CHECK (stability_days >= 0),
      attempted_question_count INTEGER NOT NULL CHECK (attempted_question_count >= 0)
    ) WITHOUT ROWID;

    CREATE TABLE daily_kpi_achievements (
      site TEXT NOT NULL,
      date TEXT NOT NULL,
      operation_id TEXT NOT NULL UNIQUE,
      achieved_at_ms INTEGER NOT NULL CHECK (achieved_at_ms > 0),
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

function migrateSchemaV12ToV13(storage) {
  storage.sql.exec(`
    CREATE TABLE cumulative_learning_metrics (
      site TEXT PRIMARY KEY,
      stability_days REAL NOT NULL CHECK (stability_days >= 0),
      attempted_question_count INTEGER NOT NULL CHECK (attempted_question_count >= 0)
    ) WITHOUT ROWID;
    INSERT INTO cumulative_learning_metrics
      SELECT site, stability_days, attempted_question_count FROM learning_metrics;
    DROP TABLE learning_metrics;
    ALTER TABLE cumulative_learning_metrics RENAME TO learning_metrics;
    UPDATE schema_metadata SET version = 13 WHERE singleton = 1;
  `);
}

function createIndexes(storage) {
  storage.sql.exec(`
    CREATE INDEX IF NOT EXISTS cards_by_site_due_number
      ON cards (site, due_ms, CAST(question_id AS INTEGER), question_id);
    CREATE INDEX IF NOT EXISTS attempts_by_site_attempted_at_operation
      ON attempts (site, attempted_at_ms, operation_id);
    CREATE INDEX IF NOT EXISTS questions_by_site_attempted_number
      ON questions (site, attempted, question_number, question_id);
  `);
}

export function initializeLearningSchema(storage, nowMs = Date.now()) {
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) throw new TypeError("invalid schema initialization time");
  storage.transactionSync(() => {
    const tables = new Set(storage.sql.exec(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    ).toArray().map(row => row.name));
    if (tables.size === 0) {
      createCurrentTables(storage);
      createIndexes(storage);
      return;
    }
    const required = ["attempts", "cards", "catalog_metadata", "questions", "schema_metadata",
      "stability_history", "daily_kpi_achievements", "learning_metrics",
      "study_time_daily", "study_time_sessions"];
    if (required.some(name => !tables.has(name))) throw new Error("incomplete LearningState schema");
    const version = storage.sql.exec(
      "SELECT version FROM schema_metadata WHERE singleton = 1",
    ).toArray()[0]?.version;
    if (version === CURRENT_SCHEMA_VERSION) return;
    if (version !== 12) throw new Error("unsupported LearningState schema version");
    migrateSchemaV12ToV13(storage);
    createIndexes(storage);
  });
}
