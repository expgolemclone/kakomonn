import { getTokyoDate, tokyoDateRangeMs } from "../dates.js";
import { canonicalQuestionIds } from "../contracts.js";

const CURRENT_SCHEMA_VERSION = 9;

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

    CREATE TABLE learning_metrics (
      site TEXT PRIMARY KEY,
      stability_days REAL NOT NULL CHECK (stability_days >= 0),
      attempted_question_count INTEGER NOT NULL CHECK (attempted_question_count >= 0),
      daily_metrics_date TEXT NOT NULL,
      today_attempted_question_count INTEGER NOT NULL CHECK (today_attempted_question_count >= 0),
      today_attempt_count INTEGER NOT NULL CHECK (today_attempt_count >= 0),
      today_correct_attempt_count INTEGER NOT NULL CHECK (today_correct_attempt_count >= 0),
      CHECK (today_correct_attempt_count <= today_attempt_count)
    ) WITHOUT ROWID;

    CREATE TABLE daily_due_card_achievements (
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

    UPDATE schema_metadata SET version = 4 WHERE singleton = 1;
  `);
}

function migrateSchemaV4ToV5(storage, today, startMs, endMs) {
  storage.sql.exec(`
    CREATE TABLE learning_metrics (
      site TEXT PRIMARY KEY,
      stability_days REAL NOT NULL CHECK (stability_days >= 0),
      attempted_question_count INTEGER NOT NULL CHECK (attempted_question_count >= 0),
      attempted_question_count_date TEXT NOT NULL,
      today_attempted_question_count INTEGER NOT NULL CHECK (today_attempted_question_count >= 0)
    ) WITHOUT ROWID;

    INSERT INTO learning_metrics (
      site, stability_days, attempted_question_count,
      attempted_question_count_date, today_attempted_question_count
    )
    SELECT metadata.site,
           COALESCE((
             SELECT SUM(cards.stability)
             FROM cards
             JOIN questions
               ON questions.site = cards.site
              AND questions.question_id = cards.question_id
             WHERE cards.site = metadata.site
           ), 0),
           (
             SELECT COUNT(*)
             FROM cards
             WHERE cards.site = metadata.site
           ),
           ?,
           (
             SELECT COUNT(*)
             FROM cards
             WHERE cards.site = metadata.site
               AND cards.last_review_ms >= ?
               AND cards.last_review_ms < ?
           )
    FROM catalog_metadata metadata`,
    today,
    startMs,
    endMs
  );

  storage.sql.exec(`
    UPDATE schema_metadata SET version = 5 WHERE singleton = 1;
  `);
}

function migrateSchemaV5ToV6(storage) {
  storage.sql.exec(`
    DROP INDEX IF EXISTS cards_by_site_stability;
    UPDATE schema_metadata SET version = 6 WHERE singleton = 1;
  `);
}

function migrateSchemaV6ToV7(storage) {
  storage.sql.exec(`
    DROP TABLE site_settings;
    DROP TABLE daily_stability_days_delta_achievements;

    CREATE TABLE daily_due_card_achievements (
      site TEXT NOT NULL,
      date TEXT NOT NULL,
      operation_id TEXT NOT NULL UNIQUE,
      achieved_at_ms INTEGER NOT NULL CHECK (achieved_at_ms > 0),
      PRIMARY KEY (site, date)
    ) WITHOUT ROWID;

    UPDATE schema_metadata SET version = 7 WHERE singleton = 1;
  `);
}

function migrateSchemaV7ToV8(storage, today, startMs, endMs) {
  storage.sql.exec(`
    ALTER TABLE learning_metrics RENAME TO learning_metrics_v7;

    CREATE TABLE learning_metrics (
      site TEXT PRIMARY KEY,
      stability_days REAL NOT NULL CHECK (stability_days >= 0),
      attempted_question_count INTEGER NOT NULL CHECK (attempted_question_count >= 0),
      daily_metrics_date TEXT NOT NULL,
      today_attempted_question_count INTEGER NOT NULL CHECK (today_attempted_question_count >= 0),
      today_attempt_count INTEGER NOT NULL CHECK (today_attempt_count >= 0),
      today_correct_attempt_count INTEGER NOT NULL CHECK (today_correct_attempt_count >= 0),
      CHECK (today_correct_attempt_count <= today_attempt_count)
    ) WITHOUT ROWID;
  `);
  storage.sql.exec(
    `
    INSERT INTO learning_metrics (
      site, stability_days, attempted_question_count, daily_metrics_date,
      today_attempted_question_count, today_attempt_count,
      today_correct_attempt_count
    )
    SELECT metrics.site,
           metrics.stability_days,
           metrics.attempted_question_count,
           ?,
           CASE WHEN metrics.attempted_question_count_date = ?
                THEN metrics.today_attempted_question_count
                ELSE 0 END,
           (
             SELECT COUNT(*)
             FROM attempts
             WHERE attempts.site = metrics.site
               AND attempts.attempted_at_ms >= ?
               AND attempts.attempted_at_ms < ?
           ),
           (
             SELECT COUNT(*)
             FROM attempts
             WHERE attempts.site = metrics.site
               AND attempts.attempted_at_ms >= ?
               AND attempts.attempted_at_ms < ?
               AND attempts.answer_result = 'correct'
           )
    FROM learning_metrics_v7 metrics;
    `,
    today,
    today,
    startMs,
    endMs,
    startMs,
    endMs
  );
  storage.sql.exec(`
    DROP TABLE learning_metrics_v7;
    UPDATE schema_metadata SET version = 8 WHERE singleton = 1;
  `);
}

function migrateSchemaV8ToV9(storage) {
  storage.sql.exec(`
    ALTER TABLE cards ADD COLUMN last_attempt_date TEXT;
    ALTER TABLE questions
      ADD COLUMN question_number INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE questions
      ADD COLUMN attempted INTEGER NOT NULL DEFAULT 0
      CHECK (attempted IN (0, 1));
    ALTER TABLE catalog_metadata
      ADD COLUMN question_ids_json TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE stability_history
      ADD COLUMN attempted_question_count INTEGER NOT NULL DEFAULT 0
      CHECK (attempted_question_count >= 0);
    ALTER TABLE stability_history
      ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0
      CHECK (attempt_count >= 0);
    ALTER TABLE stability_history
      ADD COLUMN correct_attempt_count INTEGER NOT NULL DEFAULT 0
      CHECK (correct_attempt_count >= 0);

    UPDATE questions
    SET question_number = CAST(question_id AS INTEGER),
        attempted = CASE WHEN EXISTS (
          SELECT 1 FROM cards
          WHERE cards.site = questions.site
            AND cards.question_id = questions.question_id
        ) THEN 1 ELSE 0 END;
  `);

  const attempts = storage.sql
    .exec(
      `SELECT site, question_id, attempted_at_ms, answer_result
       FROM attempts ORDER BY site, attempted_at_ms, operation_id`
    )
    .toArray();
  const lastAttemptDates = new Map();
  const dailyMetrics = new Map();
  for (const attempt of attempts) {
    const date = getTokyoDate(new Date(attempt.attempted_at_ms));
    lastAttemptDates.set(`${attempt.site}\0${attempt.question_id}`, {
      site: attempt.site,
      questionId: attempt.question_id,
      date,
    });
    const dailyKey = `${attempt.site}\0${date}`;
    let metrics = dailyMetrics.get(dailyKey);
    if (metrics === undefined) {
      metrics = {
        site: attempt.site,
        date,
        questionIds: new Set(),
        attemptCount: 0,
        correctAttemptCount: 0,
      };
      dailyMetrics.set(dailyKey, metrics);
    }
    metrics.questionIds.add(attempt.question_id);
    metrics.attemptCount += 1;
    if (attempt.answer_result === "correct") {
      metrics.correctAttemptCount += 1;
    }
  }
  for (const value of lastAttemptDates.values()) {
    storage.sql.exec(
      `UPDATE cards SET last_attempt_date = ?
       WHERE site = ? AND question_id = ?`,
      value.date,
      value.site,
      value.questionId
    );
  }
  for (const metrics of dailyMetrics.values()) {
    storage.sql.exec(
      `UPDATE stability_history
       SET attempted_question_count = ?, attempt_count = ?,
           correct_attempt_count = ?
       WHERE site = ? AND date = ?`,
      metrics.questionIds.size,
      metrics.attemptCount,
      metrics.correctAttemptCount,
      metrics.site,
      metrics.date
    );
  }

  const catalogSites = storage.sql
    .exec("SELECT site FROM catalog_metadata ORDER BY site")
    .toArray();
  for (const { site } of catalogSites) {
    const questionIds = canonicalQuestionIds(
      storage.sql
        .exec("SELECT question_id FROM questions WHERE site = ?", site)
        .toArray()
        .map((row) => row.question_id)
    );
    storage.sql.exec(
      `UPDATE catalog_metadata SET question_ids_json = ? WHERE site = ?`,
      JSON.stringify(questionIds),
      site
    );
  }
  storage.sql.exec(
    "UPDATE schema_metadata SET version = 9 WHERE singleton = 1"
  );
}

function migrateLegacySchema(storage, today) {
  const { startMs, endMs } = tokyoDateRangeMs(today);
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

    CREATE TABLE learning_metrics (
      site TEXT PRIMARY KEY,
      stability_days REAL NOT NULL CHECK (stability_days >= 0),
      attempted_question_count INTEGER NOT NULL CHECK (attempted_question_count >= 0),
      daily_metrics_date TEXT NOT NULL,
      today_attempted_question_count INTEGER NOT NULL CHECK (today_attempted_question_count >= 0),
      today_attempt_count INTEGER NOT NULL CHECK (today_attempt_count >= 0),
      today_correct_attempt_count INTEGER NOT NULL CHECK (today_correct_attempt_count >= 0),
      CHECK (today_correct_attempt_count <= today_attempt_count)
    ) WITHOUT ROWID;

    CREATE TABLE daily_due_card_achievements (
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
    VALUES (1, 8);
  `);

  const sites = storage.sql.exec("SELECT site FROM catalog_metadata").toArray();
  for (const { site } of sites) {
    const learningMetrics = storage.sql
      .exec(
        `SELECT COALESCE((
                  SELECT SUM(cards.stability)
                  FROM cards
                  JOIN questions
                    ON questions.site = cards.site
                   AND questions.question_id = cards.question_id
                  WHERE cards.site = ?
                ), 0) AS stability_days,
                (
                  SELECT COUNT(*)
                  FROM cards
                  WHERE cards.site = ?
                ) AS attempted_question_count,
                (
                  SELECT COUNT(DISTINCT question_id)
                  FROM attempts
                  WHERE site = ? AND attempted_at_ms >= ? AND attempted_at_ms < ?
                ) AS today_attempted_question_count,
                (
                  SELECT COUNT(*)
                  FROM attempts
                  WHERE site = ? AND attempted_at_ms >= ? AND attempted_at_ms < ?
                ) AS today_attempt_count,
                (
                  SELECT COUNT(*)
                  FROM attempts
                  WHERE site = ? AND attempted_at_ms >= ? AND attempted_at_ms < ?
                    AND answer_result = 'correct'
                ) AS today_correct_attempt_count`,
        site,
        site,
        site,
        startMs,
        endMs,
        site,
        startMs,
        endMs,
        site,
        startMs,
        endMs
      )
      .toArray()[0];
    storage.sql.exec(
      `INSERT INTO learning_metrics (
         site, stability_days, attempted_question_count,
         daily_metrics_date, today_attempted_question_count,
         today_attempt_count, today_correct_attempt_count
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      site,
      learningMetrics.stability_days,
      learningMetrics.attempted_question_count,
      today,
      learningMetrics.today_attempted_question_count,
      learningMetrics.today_attempt_count,
      learningMetrics.today_correct_attempt_count
    );
    const stabilityDays = Math.trunc(learningMetrics.stability_days);
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
  storage.sql.exec(
    "DROP INDEX IF EXISTS attempts_by_site_attempted_at_question"
  );
  storage.sql.exec(`
    CREATE INDEX IF NOT EXISTS cards_by_site_due
      ON cards (site, due_ms, question_id);
    CREATE INDEX IF NOT EXISTS attempts_by_site_attempted_at_operation
      ON attempts (site, attempted_at_ms, operation_id);
    CREATE INDEX IF NOT EXISTS questions_by_site_attempted_number
      ON questions (site, attempted, question_number, question_id);
  `);
}

export function initializeLearningSchema(storage, nowMs = Date.now()) {
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) {
    throw new TypeError("invalid schema initialization time");
  }
  storage.transactionSync(() => {
    const today = getTokyoDate(new Date(nowMs));
    const { startMs, endMs } = tokyoDateRangeMs(today);
    const versionedCoreTables = [
      "attempts",
      "cards",
      "catalog_metadata",
      "questions",
      "schema_metadata",
      "stability_history",
    ];
    const schemaV3Tables = [...versionedCoreTables, "site_settings"];
    const currentTables = [
      ...versionedCoreTables,
      "daily_due_card_achievements",
      "learning_metrics",
    ];
    const thresholdMetricTables = [
      ...schemaV3Tables,
      "daily_stability_days_delta_achievements",
    ];
    const requiredTablesByVersion = new Map([
      [2, schemaV3Tables],
      [3, schemaV3Tables],
      [4, thresholdMetricTables],
      [5, [...thresholdMetricTables, "learning_metrics"]],
      [6, [...thresholdMetricTables, "learning_metrics"]],
      [7, currentTables],
      [8, currentTables],
      [CURRENT_SCHEMA_VERSION, currentTables],
    ]);
    const legacyTables = [
      "attempts",
      "cards",
      "catalog_metadata",
      "learning_metadata",
      "mastery_history",
      "questions",
    ];
    const hasSchemaMetadata =
      tableDefinition(storage, "schema_metadata") !== undefined;
    let version;
    if (hasSchemaMetadata) {
      version = storage.sql
        .exec("SELECT version FROM schema_metadata WHERE singleton = 1")
        .toArray()[0]?.version;
      const requiredTables = requiredTablesByVersion.get(version);
      if (requiredTables === undefined) {
        throw new Error("unsupported LearningState schema version");
      }
      if (requiredTables.some((name) => tableDefinition(storage, name) === undefined)) {
        throw new Error("incomplete LearningState schema");
      }
      if (version === CURRENT_SCHEMA_VERSION) {
        return;
      }
    } else {
      const existingSchemaV3 = schemaV3Tables.filter(
        (name) => tableDefinition(storage, name) !== undefined
      );
      const existingLegacy = legacyTables.filter(
        (name) => tableDefinition(storage, name) !== undefined
      );
      if (existingSchemaV3.length === 0 && existingLegacy.length === 0) {
        createCurrentTables(storage);
        version = CURRENT_SCHEMA_VERSION;
      } else if (existingLegacy.length === legacyTables.length) {
        migrateLegacySchema(storage, today);
        version = 8;
      } else {
        throw new Error("incomplete LearningState schema");
      }
    }

    if (version === 2) {
      migrateSchemaV2ToV3(storage);
      version = 3;
    }
    if (version === 3) {
      migrateSchemaV3ToV4(storage);
      version = 4;
    }
    if (version === 4) {
      migrateSchemaV4ToV5(storage, today, startMs, endMs);
      version = 5;
    }
    if (version === 5) {
      migrateSchemaV5ToV6(storage);
      version = 6;
    }
    if (version === 6) {
      migrateSchemaV6ToV7(storage);
      version = 7;
    }
    if (version === 7) {
      migrateSchemaV7ToV8(storage, today, startMs, endMs);
      version = 8;
    }
    if (version === 8) {
      migrateSchemaV8ToV9(storage);
      version = 9;
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
