import {
  env,
  runInDurableObject as runInRawDurableObject,
  SELF,
} from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { ratingForResult } from "../src/fsrs.js";
import { getTokyoDate } from "../src/dates.js";
import { initializeLearningSchema } from "../src/storage/schema.js";
import { Rating } from "ts-fsrs";

const SITE = "chushoks.kakomonn.com";
const OTHER_SITE = "shindans.kakomonn.com";
const TOKEN = "test-sync-token";
const AUTHORIZATION = { Authorization: `Bearer ${TOKEN}` };
const NOW = Date.parse("2026-08-10T00:00:00.000Z");
const DAY_MS = 86_400_000;
const TODAY_START_MS = Date.parse("2026-08-09T15:00:00.000Z");
const TODAY_END_MS = TODAY_START_MS + DAY_MS;

function operationId(value) {
  return value.toString(16).padStart(32, "0");
}

function stub() {
  return env.LEARNING_STATE.get(env.LEARNING_STATE.idFromName("primary"));
}

async function reset() {
  const raw = stub();
  await runInRawDurableObject(raw, (_instance, state) => {
    state.storage.sql.exec(`
      DROP TRIGGER IF EXISTS audit_questions_insert;
      DROP TRIGGER IF EXISTS audit_questions_delete;
      DROP TRIGGER IF EXISTS audit_learning_metrics_update;
      DROP TRIGGER IF EXISTS audit_stability_history_update;
      DROP TABLE IF EXISTS usage_audit;
    `);
    for (const table of [
      "daily_kpi_achievements",
      "attempts",
      "stability_history",
      "cards",
      "questions",
      "learning_metrics",
      "catalog_metadata",
    ]) {
      state.storage.sql.exec(`DELETE FROM ${table}`);
    }
  });
  await raw.replaceCatalog(SITE, ["1", "2", "3", "4"], 0, NOW);
}

function rebuildUsageTablesAsV8(storage) {
  storage.sql.exec(`
    DROP INDEX IF EXISTS cards_by_site_due;
    DROP INDEX IF EXISTS cards_by_site_due_number;
    DROP INDEX IF EXISTS attempts_by_site_attempted_at_operation;
    DROP INDEX IF EXISTS questions_by_site_attempted_number;

    DROP TABLE daily_kpi_achievements;
    CREATE TABLE daily_due_card_achievements (
      site TEXT NOT NULL, date TEXT NOT NULL,
      operation_id TEXT NOT NULL UNIQUE, achieved_at_ms INTEGER NOT NULL,
      PRIMARY KEY (site, date)
    ) WITHOUT ROWID;

    ALTER TABLE cards RENAME TO cards_v9;
    CREATE TABLE cards (
      site TEXT NOT NULL, question_id TEXT NOT NULL, due_ms INTEGER NOT NULL,
      stability REAL NOT NULL, difficulty REAL NOT NULL,
      scheduled_days INTEGER NOT NULL, learning_steps INTEGER NOT NULL,
      reps INTEGER NOT NULL, lapses INTEGER NOT NULL, state INTEGER NOT NULL,
      last_review_ms INTEGER, PRIMARY KEY (site, question_id)
    ) WITHOUT ROWID;
    INSERT INTO cards
    SELECT site, question_id, due_ms, stability, difficulty, scheduled_days,
           learning_steps, reps, lapses, state, last_review_ms
    FROM cards_v9;
    DROP TABLE cards_v9;

    ALTER TABLE questions RENAME TO questions_v9;
    CREATE TABLE questions (
      site TEXT NOT NULL, question_id TEXT NOT NULL,
      PRIMARY KEY (site, question_id)
    ) WITHOUT ROWID;
    INSERT INTO questions SELECT site, question_id FROM questions_v9;
    DROP TABLE questions_v9;

    ALTER TABLE learning_metrics RENAME TO learning_metrics_v10;
    CREATE TABLE learning_metrics (
      site TEXT PRIMARY KEY,
      stability_days REAL NOT NULL,
      attempted_question_count INTEGER NOT NULL,
      daily_metrics_date TEXT NOT NULL,
      today_attempted_question_count INTEGER NOT NULL,
      today_attempt_count INTEGER NOT NULL,
      today_correct_attempt_count INTEGER NOT NULL
    ) WITHOUT ROWID;
    INSERT INTO learning_metrics
    SELECT site, stability_days, attempted_question_count, daily_metrics_date,
           today_attempted_question_count, today_attempt_count,
           today_correct_attempt_count
    FROM learning_metrics_v10;
    DROP TABLE learning_metrics_v10;

    ALTER TABLE catalog_metadata RENAME TO catalog_metadata_v9;
    CREATE TABLE catalog_metadata (
      site TEXT PRIMARY KEY, question_count INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL, generation INTEGER NOT NULL
    ) WITHOUT ROWID;
    INSERT INTO catalog_metadata
    SELECT site, question_count, updated_at_ms, generation
    FROM catalog_metadata_v9;
    DROP TABLE catalog_metadata_v9;

    ALTER TABLE stability_history RENAME TO stability_history_v9;
    CREATE TABLE stability_history (
      site TEXT NOT NULL, date TEXT NOT NULL,
      opening_stability_days INTEGER NOT NULL,
      closing_stability_days INTEGER NOT NULL,
      PRIMARY KEY (site, date)
    ) WITHOUT ROWID;
    INSERT INTO stability_history
    SELECT site, date, opening_stability_days, closing_stability_days
    FROM stability_history_v9;
    DROP TABLE stability_history_v9;
  `);
}

async function seedReviewCard(
  questionId,
  stability,
  dueMs = NOW - 1000,
  lastReviewMs = NOW - 30 * DAY_MS,
  site = SITE
) {
  const lastAttemptDate = getTokyoDate(new Date(lastReviewMs));
  await runInRawDurableObject(stub(), (_instance, state) => {
    state.storage.sql.exec(
      `INSERT INTO cards (
         site, question_id, due_ms, stability, difficulty, scheduled_days,
         learning_steps, reps, lapses, state, last_review_ms, last_attempt_date
       ) VALUES (?, ?, ?, ?, 5, 30, 0, 5, 0, 2, ?, ?)
       ON CONFLICT(site, question_id) DO UPDATE SET
         due_ms = excluded.due_ms,
         stability = excluded.stability,
         difficulty = excluded.difficulty,
         scheduled_days = excluded.scheduled_days,
         learning_steps = excluded.learning_steps,
         reps = excluded.reps,
         lapses = excluded.lapses,
         state = excluded.state,
         last_review_ms = excluded.last_review_ms,
         last_attempt_date = excluded.last_attempt_date`,
      site,
      questionId,
      dueMs,
      stability,
      lastReviewMs,
      lastAttemptDate
    );
    state.storage.sql.exec(
      `UPDATE questions SET attempted = 1
       WHERE site = ? AND question_id = ?`,
      site,
      questionId
    );
    state.storage.sql.exec(
      `UPDATE learning_metrics
       SET stability_days = (
             SELECT COALESCE(SUM(cards.stability), 0)
             FROM cards
             JOIN questions
               ON questions.site = cards.site
              AND questions.question_id = cards.question_id
             WHERE cards.site = ?
           ),
           attempted_question_count = (
             SELECT COUNT(*) FROM cards WHERE cards.site = ?
           ),
           daily_metrics_date = '2026-08-10',
           today_attempted_question_count = (
             SELECT COUNT(*) FROM cards
             WHERE cards.site = ?
               AND cards.last_review_ms >= ?
               AND cards.last_review_ms < ?
           )
       WHERE site = ?`,
      site,
      site,
      site,
      TODAY_START_MS,
      TODAY_END_MS,
      site
    );
  });
}

async function seedTodayNewQuestionCount(
  count,
  date = "2026-08-10",
  site = SITE
) {
  await runInRawDurableObject(stub(), (_instance, state) => {
    state.storage.sql.exec(
      `UPDATE learning_metrics
       SET daily_metrics_date = ?, today_new_question_count = ?
       WHERE site = ?`,
      date,
      count,
      site
    );
  });
}

beforeEach(reset);

describe("LearningState schema", () => {
  it("checks the current schema with two SQL statements", () => {
    const statements = [];
    const currentTables = [
      "attempts",
      "cards",
      "catalog_metadata",
      "questions",
      "schema_metadata",
      "stability_history",
      "daily_kpi_achievements",
      "learning_metrics",
    ];
    const storage = {
      transactionSync(callback) {
        return callback();
      },
      sql: {
        exec(statement) {
          statements.push(statement);
          const rows = statement.includes("sqlite_master")
            ? currentTables.map((name) => ({ name }))
            : [{ version: 11 }];
          return { toArray: () => rows };
        },
      },
    };

    initializeLearningSchema(storage, NOW);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("sqlite_master");
    expect(statements[1]).toContain("SELECT version");
  });

  it("returns immediately for the current schema version", async () => {
    await runInRawDurableObject(stub(), (_instance, state) => {
      initializeLearningSchema(state.storage, NOW);
      state.storage.sql.exec(
        "CREATE INDEX IF NOT EXISTS attempts_by_site ON attempts (site)"
      );
      initializeLearningSchema(state.storage, NOW);
      const indexes = state.storage.sql
        .exec(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'attempts_by_site'"
        )
        .toArray()
        .map((row) => row.name);
      expect(indexes).toEqual(["attempts_by_site"]);
    });
  });

  it("migrates schema v10 by replacing the due-card index without changing data", async () => {
    await seedReviewCard("2", 3.5);
    await runInRawDurableObject(stub(), (_instance, state) => {
      const cardBefore = state.storage.sql
        .exec(
          `SELECT site, question_id, due_ms, stability FROM cards
           WHERE site = ? AND question_id = '2'`,
          SITE
        )
        .toArray()[0];
      state.storage.sql.exec(`
        DROP INDEX cards_by_site_due_number;
        CREATE INDEX cards_by_site_due ON cards (site, due_ms, question_id);
        UPDATE schema_metadata SET version = 10 WHERE singleton = 1;
      `);

      initializeLearningSchema(state.storage, NOW);

      expect(
        state.storage.sql.exec("SELECT version FROM schema_metadata").toArray()[0]
      ).toEqual({ version: 11 });
      expect(
        state.storage.sql
          .exec(
            `SELECT site, question_id, due_ms, stability FROM cards
             WHERE site = ? AND question_id = '2'`,
            SITE
          )
          .toArray()[0]
      ).toEqual(cardBefore);
      expect(
        state.storage.sql
          .exec(
            `SELECT name FROM sqlite_master
             WHERE type = 'index' AND name LIKE 'cards_by_site_due%'
             ORDER BY name`
          )
          .toArray()
      ).toEqual([{ name: "cards_by_site_due_number" }]);

      const duePlan = state.storage.sql
        .exec(
          `EXPLAIN QUERY PLAN
           SELECT c.question_id, c.due_ms
           FROM cards c
           JOIN questions q
             ON q.site = c.site AND q.question_id = c.question_id
           WHERE c.site = ? AND c.due_ms <= ?
           ORDER BY c.due_ms, CAST(c.question_id AS INTEGER), c.question_id
           LIMIT 1`,
          SITE,
          NOW
        )
        .toArray()
        .map((row) => row.detail)
        .join(" ");
      expect(duePlan).toContain("cards_by_site_due_number");
      expect(duePlan).not.toContain("TEMP B-TREE");
    });
  });

  it("migrates schema v8 usage data and installs bounded-query indexes", async () => {
    await runInRawDurableObject(stub(), (_instance, state) => {
      rebuildUsageTablesAsV8(state.storage);
      state.storage.sql.exec(
        `INSERT INTO cards (
           site, question_id, due_ms, stability, difficulty, scheduled_days,
           learning_steps, reps, lapses, state, last_review_ms
         ) VALUES (?, '2', ?, 3.5, 5, 1, 0, 1, 0, 2, ?)`,
        SITE,
        NOW + DAY_MS,
        NOW
      );
      state.storage.sql.exec(
        `INSERT INTO attempts (
           site, operation_id, question_id, attempted_at_ms, answer_result,
           previous_card_stability_days, resulting_card_stability_days
         ) VALUES (?, ?, '2', ?, 'correct', 0, 3.5)`,
        SITE,
        operationId(999),
        NOW
      );
      state.storage.sql.exec(
        `UPDATE stability_history SET closing_stability_days = 3
         WHERE site = ? AND date = '2026-08-10'`,
        SITE
      );
      state.storage.sql.exec(
        "UPDATE schema_metadata SET version = 8 WHERE singleton = 1"
      );

      initializeLearningSchema(state.storage, NOW);

      expect(
        state.storage.sql.exec("SELECT version FROM schema_metadata").toArray()[0]
      ).toEqual({ version: 11 });
      expect(
        state.storage.sql
          .exec(
            `SELECT last_attempt_date FROM cards
             WHERE site = ? AND question_id = '2'`,
            SITE
          )
          .toArray()[0]
      ).toEqual({ last_attempt_date: "2026-08-10" });
      expect(
        state.storage.sql
          .exec(
            `SELECT question_number, attempted FROM questions
             WHERE site = ? AND question_id = '2'`,
            SITE
          )
          .toArray()[0]
      ).toEqual({ question_number: 2, attempted: 1 });
      expect(
        state.storage.sql
          .exec(
            `SELECT question_ids_json FROM catalog_metadata WHERE site = ?`,
            SITE
          )
          .toArray()[0]
      ).toEqual({ question_ids_json: '["1","2","3","4"]' });
      expect(
        state.storage.sql
          .exec(
            `SELECT attempted_question_count, new_question_count,
                    attempt_count, correct_attempt_count
             FROM stability_history
             WHERE site = ? AND date = '2026-08-10'`,
            SITE
          )
          .toArray()[0]
      ).toEqual({
        attempted_question_count: 1,
        new_question_count: 1,
        attempt_count: 1,
        correct_attempt_count: 1,
      });

      const unseenPlan = state.storage.sql
        .exec(
          `EXPLAIN QUERY PLAN
           SELECT question_id FROM questions
           WHERE site = ? AND attempted = 0
           ORDER BY question_number, question_id LIMIT 1`,
          SITE
        )
        .toArray()
        .map((row) => row.detail)
        .join(" ");
      expect(unseenPlan).toContain("questions_by_site_attempted_number");
      const attemptsPlan = state.storage.sql
        .exec(
          `EXPLAIN QUERY PLAN
           SELECT operation_id FROM attempts
           WHERE site = ? AND attempted_at_ms >= ? AND attempted_at_ms < ?
           ORDER BY attempted_at_ms, operation_id`,
          SITE,
          TODAY_START_MS,
          TODAY_END_MS
        )
        .toArray()
        .map((row) => row.detail)
        .join(" ");
      expect(attemptsPlan).toContain("attempts_by_site_attempted_at_operation");
    });
  });

  it("migrates schema v5 and removes retired KPI storage", async () => {
    await runInRawDurableObject(stub(), (_instance, state) => {
      rebuildUsageTablesAsV8(state.storage);
      state.storage.sql.exec(`
        DROP TABLE daily_due_card_achievements;
        CREATE TABLE site_settings (
          site TEXT PRIMARY KEY,
          daily_stability_days_delta_goal INTEGER NOT NULL
        ) WITHOUT ROWID;
        CREATE TABLE daily_stability_days_delta_achievements (
          site TEXT NOT NULL, date TEXT NOT NULL,
          operation_id TEXT NOT NULL UNIQUE, achieved_at_ms INTEGER NOT NULL,
          today_stability_days_delta INTEGER NOT NULL,
          daily_stability_days_delta_goal INTEGER NOT NULL,
          PRIMARY KEY (site, date)
        ) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS attempts_by_site ON attempts (site);
        CREATE INDEX IF NOT EXISTS cards_by_site_stability
          ON cards (site, stability);
        ALTER TABLE learning_metrics RENAME TO learning_metrics_v8;
        CREATE TABLE learning_metrics (
          site TEXT PRIMARY KEY,
          stability_days REAL NOT NULL,
          attempted_question_count INTEGER NOT NULL,
          attempted_question_count_date TEXT NOT NULL,
          today_attempted_question_count INTEGER NOT NULL
        ) WITHOUT ROWID;
        INSERT INTO learning_metrics
        SELECT site, stability_days, attempted_question_count,
               daily_metrics_date, today_attempted_question_count
        FROM learning_metrics_v8;
        DROP TABLE learning_metrics_v8;
        UPDATE schema_metadata SET version = 5 WHERE singleton = 1;
      `);
      initializeLearningSchema(state.storage, NOW);
      expect(
        state.storage.sql.exec("SELECT version FROM schema_metadata").toArray()[0]
      ).toEqual({ version: 11 });
      expect(
        state.storage.sql
          .exec(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('site_settings', 'daily_stability_days_delta_achievements')"
          )
          .toArray()
      ).toEqual([]);
      expect(
        state.storage.sql
            .exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'daily_kpi_achievements'")
          .toArray()
      ).toEqual([{ name: "daily_kpi_achievements" }]);
      const indexes = state.storage.sql
        .exec(
          `SELECT name FROM sqlite_master
           WHERE type = 'index' AND name IN (?, ?, ?, ?, ?, ?)
           ORDER BY name`,
          "attempts_by_site",
          "attempts_by_site_attempted_at_question",
          "attempts_by_site_attempted_at_operation",
          "cards_by_site_due_number",
          "cards_by_site_stability",
          "questions_by_site_attempted_number"
        )
        .toArray()
        .map((row) => row.name);
      expect(indexes).toEqual([
        "attempts_by_site_attempted_at_operation",
        "cards_by_site_due_number",
        "questions_by_site_attempted_number",
      ]);
    });
  });

  it("migrates the deployed schema v7 after retired tables were removed", async () => {
    await runInRawDurableObject(stub(), (_instance, state) => {
      rebuildUsageTablesAsV8(state.storage);
      state.storage.sql.exec(`
        ALTER TABLE learning_metrics RENAME TO learning_metrics_v8;
        CREATE TABLE learning_metrics (
          site TEXT PRIMARY KEY,
          stability_days REAL NOT NULL,
          attempted_question_count INTEGER NOT NULL,
          attempted_question_count_date TEXT NOT NULL,
          today_attempted_question_count INTEGER NOT NULL
        ) WITHOUT ROWID;
        INSERT INTO learning_metrics
        SELECT site, stability_days, attempted_question_count,
               daily_metrics_date, today_attempted_question_count
        FROM learning_metrics_v8;
        DROP TABLE learning_metrics_v8;
        UPDATE schema_metadata SET version = 7 WHERE singleton = 1;
      `);

      initializeLearningSchema(state.storage, NOW);

      expect(
        state.storage.sql.exec("SELECT version FROM schema_metadata").toArray()[0]
      ).toEqual({ version: 11 });
      expect(
        state.storage.sql
          .exec(
            `SELECT daily_metrics_date, today_attempted_question_count,
                    today_attempt_count, today_correct_attempt_count,
                    today_new_question_count
             FROM learning_metrics WHERE site = ?`,
            SITE
          )
          .toArray()[0]
      ).toEqual({
        daily_metrics_date: "2026-08-10",
        today_attempted_question_count: 0,
        today_attempt_count: 0,
        today_correct_attempt_count: 0,
        today_new_question_count: 0,
      });
    });
  });

  it("migrates legacy data to schema v11 without retaining threshold-based fields", async () => {
    await runInRawDurableObject(stub(), (_instance, state) => {
      state.storage.sql.exec(`
        DROP TABLE daily_kpi_achievements;
        DROP TABLE attempts;
        DROP TABLE stability_history;
        DROP TABLE cards;
        DROP TABLE questions;
        DROP TABLE learning_metrics;
        DROP TABLE catalog_metadata;
        DROP TABLE schema_metadata;

        CREATE TABLE cards (
          site TEXT NOT NULL, question_id TEXT NOT NULL, due_ms INTEGER NOT NULL,
          stability REAL NOT NULL, difficulty REAL NOT NULL, scheduled_days INTEGER NOT NULL,
          learning_steps INTEGER NOT NULL, reps INTEGER NOT NULL, lapses INTEGER NOT NULL,
          state INTEGER NOT NULL, last_review_ms INTEGER,
          PRIMARY KEY (site, question_id)
        ) WITHOUT ROWID;
        CREATE TABLE attempts (
          site TEXT NOT NULL, operation_id TEXT NOT NULL, question_id TEXT NOT NULL,
          answered_at_ms INTEGER NOT NULL, result TEXT NOT NULL,
          previous_stability REAL NOT NULL, resulting_stability REAL NOT NULL,
          mastery_delta INTEGER NOT NULL, resulting_mastered_count INTEGER NOT NULL,
          completed_milestone INTEGER, PRIMARY KEY (operation_id)
        ) WITHOUT ROWID;
        CREATE TABLE mastery_history (
          site TEXT NOT NULL, date TEXT NOT NULL, mastered_count INTEGER NOT NULL,
          PRIMARY KEY (site, date)
        ) WITHOUT ROWID;
        CREATE TABLE questions (
          site TEXT NOT NULL, question_id TEXT NOT NULL, PRIMARY KEY (site, question_id)
        ) WITHOUT ROWID;
        CREATE TABLE learning_metadata (
          site TEXT PRIMARY KEY, highest_mastery_milestone INTEGER NOT NULL
        ) WITHOUT ROWID;
        CREATE TABLE catalog_metadata (
          site TEXT PRIMARY KEY, question_count INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL, generation INTEGER NOT NULL
        ) WITHOUT ROWID;
      `);
      state.storage.sql.exec(
        "INSERT INTO questions (site, question_id) VALUES (?, '1')",
        SITE
      );
      state.storage.sql.exec(
        "INSERT INTO catalog_metadata VALUES (?, 1, ?, 1)",
        SITE,
        NOW
      );
      state.storage.sql.exec(
        "INSERT INTO cards VALUES (?, '1', ?, 12.9, 5, 30, 0, 5, 0, 2, ?)",
        SITE,
        NOW,
        NOW
      );
      state.storage.sql.exec(
        `INSERT INTO attempts VALUES (
           ?, ?, '1', ?, 'correct', 10, 12.9, 0, 0, NULL
         )`,
        SITE,
        operationId(900),
        NOW
      );
      state.storage.sql.exec(
        "INSERT INTO mastery_history VALUES (?, '2026-08-09', 4)",
        SITE
      );
      state.storage.sql.exec(
        "INSERT INTO learning_metadata VALUES (?, 50)",
        SITE
      );

      initializeLearningSchema(state.storage, NOW);

      expect(
        state.storage.sql.exec("SELECT version FROM schema_metadata").toArray()[0]
      ).toEqual({ version: 11 });
      expect(
        state.storage.sql
          .exec("SELECT * FROM daily_kpi_achievements")
          .toArray()
      ).toEqual([]);
      expect(
        state.storage.sql.exec("SELECT * FROM stability_history").toArray()[0]
      ).toEqual({
        site: SITE,
        date: "2026-08-10",
        opening_stability_days: 12,
        closing_stability_days: 12,
        attempted_question_count: 1,
        attempt_count: 1,
        correct_attempt_count: 1,
        new_question_count: 1,
      });
      expect(
        state.storage.sql.exec("SELECT * FROM learning_metrics").toArray()[0]
      ).toEqual({
        site: SITE,
        stability_days: 12.9,
        attempted_question_count: 1,
        daily_metrics_date: "2026-08-10",
        today_attempted_question_count: 1,
        today_attempt_count: 1,
        today_correct_attempt_count: 1,
        today_new_question_count: 1,
      });
      expect(
        state.storage.sql.exec("SELECT * FROM attempts").toArray()[0]
      ).toEqual({
        site: SITE,
        operation_id: operationId(900),
        question_id: "1",
        attempted_at_ms: NOW,
        answer_result: "correct",
        previous_card_stability_days: 10,
        resulting_card_stability_days: 12.9,
      });
      expect(
        state.storage.sql
          .exec(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('mastery_history', 'learning_metadata')"
          )
          .toArray()
      ).toEqual([]);
    });
  });

  it("migrates schema v2 data to v11 without losing rows", async () => {
    await runInRawDurableObject(stub(), (_instance, state) => {
      state.storage.sql.exec(`
        DROP TABLE daily_kpi_achievements;
        DROP TABLE attempts;
        DROP TABLE stability_history;
        DROP TABLE cards;
        DROP TABLE questions;
        DROP TABLE learning_metrics;
        DROP TABLE catalog_metadata;
        DROP TABLE schema_metadata;

        CREATE TABLE cards (
          site TEXT NOT NULL, question_id TEXT NOT NULL, due_ms INTEGER NOT NULL,
          stability REAL NOT NULL, difficulty REAL NOT NULL, scheduled_days INTEGER NOT NULL,
          learning_steps INTEGER NOT NULL, reps INTEGER NOT NULL, lapses INTEGER NOT NULL,
          state INTEGER NOT NULL, last_review_ms INTEGER,
          PRIMARY KEY (site, question_id)
        ) WITHOUT ROWID;
        CREATE TABLE attempts (
          site TEXT NOT NULL, operation_id TEXT NOT NULL, question_id TEXT NOT NULL,
          answered_at_ms INTEGER NOT NULL, result TEXT NOT NULL,
          previous_stability REAL NOT NULL, resulting_stability REAL NOT NULL,
          PRIMARY KEY (operation_id)
        ) WITHOUT ROWID;
        CREATE TABLE stability_history (
          site TEXT NOT NULL, date TEXT NOT NULL,
          opening_stability_days INTEGER NOT NULL, closing_stability_days INTEGER NOT NULL,
          PRIMARY KEY (site, date)
        ) WITHOUT ROWID;
        CREATE TABLE questions (
          site TEXT NOT NULL, question_id TEXT NOT NULL, PRIMARY KEY (site, question_id)
        ) WITHOUT ROWID;
        CREATE TABLE catalog_metadata (
          site TEXT PRIMARY KEY, question_count INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL, generation INTEGER NOT NULL
        ) WITHOUT ROWID;
        CREATE TABLE site_settings (
          site TEXT PRIMARY KEY, daily_stability_days_goal INTEGER NOT NULL
        ) WITHOUT ROWID;
        CREATE TABLE schema_metadata (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1), version INTEGER NOT NULL
        ) WITHOUT ROWID;

        INSERT INTO schema_metadata (singleton, version) VALUES (1, 2);
      `);
      state.storage.sql.exec(
        "INSERT INTO questions (site, question_id) VALUES (?, '1')",
        SITE
      );
      state.storage.sql.exec(
        "INSERT INTO catalog_metadata VALUES (?, 1, ?, 1)",
        SITE,
        NOW
      );
      state.storage.sql.exec(
        `INSERT INTO attempts VALUES (?, ?, '1', ?, 'incorrect', 10, 2.5)`,
        SITE,
        operationId(901),
        NOW
      );
      state.storage.sql.exec(
        "INSERT INTO cards VALUES (?, '1', ?, 2.5, 5, 1, 0, 1, 1, 2, ?)",
        SITE,
        NOW,
        NOW
      );
      state.storage.sql.exec(
        "INSERT INTO stability_history VALUES (?, '2026-08-10', 0, 2)",
        SITE
      );
      state.storage.sql.exec(
        "INSERT INTO site_settings VALUES (?, 45)",
        SITE
      );

      initializeLearningSchema(state.storage, NOW);

      expect(
        state.storage.sql.exec("SELECT version FROM schema_metadata").toArray()[0]
      ).toEqual({ version: 11 });
      expect(
        state.storage.sql
          .exec("SELECT * FROM daily_kpi_achievements")
          .toArray()
      ).toEqual([]);
      expect(
        state.storage.sql.exec("SELECT * FROM attempts").toArray()[0]
      ).toEqual({
        site: SITE,
        operation_id: operationId(901),
        question_id: "1",
        attempted_at_ms: NOW,
        answer_result: "incorrect",
        previous_card_stability_days: 10,
        resulting_card_stability_days: 2.5,
      });
      expect(
        state.storage.sql
          .exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'site_settings'")
          .toArray()
      ).toEqual([]);
      expect(
        state.storage.sql.exec("SELECT * FROM learning_metrics").toArray()[0]
      ).toEqual({
        site: SITE,
        stability_days: 2.5,
        attempted_question_count: 1,
        daily_metrics_date: "2026-08-10",
        today_attempted_question_count: 1,
        today_attempt_count: 1,
        today_correct_attempt_count: 0,
        today_new_question_count: 1,
      });
      expect(
        state.storage.sql.exec("SELECT * FROM stability_history").toArray()[0]
      ).toEqual({
        site: SITE,
        date: "2026-08-10",
        opening_stability_days: 0,
        closing_stability_days: 2,
        attempted_question_count: 1,
        attempt_count: 1,
        correct_attempt_count: 0,
        new_question_count: 1,
      });
      expect(
        state.storage.sql
          .exec(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%_v2'"
          )
          .toArray()
      ).toEqual([]);
    });
  });

  it("migrates schema v4 aggregates into one metrics row", async () => {
    await runInRawDurableObject(stub(), (_instance, state) => {
      rebuildUsageTablesAsV8(state.storage);
      state.storage.sql.exec(`
        DROP TABLE daily_due_card_achievements;
        CREATE TABLE site_settings (
          site TEXT PRIMARY KEY,
          daily_stability_days_delta_goal INTEGER NOT NULL
        ) WITHOUT ROWID;
        CREATE TABLE daily_stability_days_delta_achievements (
          site TEXT NOT NULL, date TEXT NOT NULL,
          operation_id TEXT NOT NULL UNIQUE, achieved_at_ms INTEGER NOT NULL,
          today_stability_days_delta INTEGER NOT NULL,
          daily_stability_days_delta_goal INTEGER NOT NULL,
          PRIMARY KEY (site, date)
        ) WITHOUT ROWID;
      `);
      state.storage.sql.exec(
        "INSERT INTO cards VALUES (?, '1', ?, 1.9, 5, 1, 0, 1, 0, 2, ?)",
        SITE,
        NOW,
        NOW
      );
      state.storage.sql.exec(
        "INSERT INTO cards VALUES (?, '2', ?, 2.8, 5, 1, 0, 1, 0, 2, ?)",
        SITE,
        NOW,
        NOW
      );
      state.storage.sql.exec("DROP TABLE learning_metrics");
      state.storage.sql.exec(
        "UPDATE schema_metadata SET version = 4 WHERE singleton = 1"
      );

      initializeLearningSchema(state.storage, NOW);

      expect(
        state.storage.sql.exec("SELECT version FROM schema_metadata").toArray()[0]
      ).toEqual({ version: 11 });
      const cursor = state.storage.sql.exec(
        `SELECT stability_days, attempted_question_count,
                daily_metrics_date, today_attempted_question_count,
                today_attempt_count, today_correct_attempt_count,
                today_new_question_count
         FROM learning_metrics WHERE site = ?`,
        SITE
      );
      const metrics = cursor.toArray()[0];
      expect(metrics.stability_days).toBeCloseTo(4.7);
      expect(metrics.attempted_question_count).toBe(2);
      expect(metrics.daily_metrics_date).toBe("2026-08-10");
      expect(metrics.today_attempted_question_count).toBe(2);
      expect(metrics.today_attempt_count).toBe(0);
      expect(metrics.today_correct_attempt_count).toBe(0);
      expect(metrics.today_new_question_count).toBe(0);
      expect(cursor.rowsRead).toBe(1);
    });
  });
});

describe("learning metrics", () => {
  it("maps answer results to FSRS ratings", () => {
    expect(ratingForResult("correct")).toBe(Rating.Easy);
    expect(ratingForResult("incorrect")).toBe(Rating.Again);
  });

  it("sums raw stability before flooring once", async () => {
    await seedReviewCard("1", 1.9);
    await seedReviewCard("2", 2.8);
    await expect(stub().getState(SITE, NOW)).resolves.toMatchObject({
      learningMetrics: { stabilityDays: 4 },
    });
  });

  it("counts only current catalog cards and treats unseen questions as zero", async () => {
    await seedReviewCard("1", 12.9);
    await seedReviewCard("2", 3.2);
    await expect(stub().getState(SITE, NOW)).resolves.toMatchObject({
      learningMetrics: { stabilityDays: 16, attemptedQuestionCount: 2 },
      catalog: { questionCount: 4 },
    });

    await stub().replaceCatalog(SITE, ["2", "3", "4"], 1, NOW);
    await expect(stub().getState(SITE, NOW)).resolves.toMatchObject({
      learningMetrics: {
        stabilityDays: 3,
        todayStabilityDaysDelta: 3,
        attemptedQuestionCount: 2,
      },
      catalog: { questionCount: 3, generation: 2 },
    });
  });

  it("refreshes identical catalogs without rewriting question rows", async () => {
    await runInRawDurableObject(stub(), (_instance, state) => {
      state.storage.sql.exec(`
        CREATE TABLE usage_audit (event TEXT NOT NULL);
        CREATE TRIGGER audit_questions_insert AFTER INSERT ON questions
        BEGIN
          INSERT INTO usage_audit VALUES ('insert:' || NEW.question_id);
        END;
        CREATE TRIGGER audit_questions_delete AFTER DELETE ON questions
        BEGIN
          INSERT INTO usage_audit VALUES ('delete:' || OLD.question_id);
        END;
      `);
    });

    await expect(
      stub().replaceCatalog(SITE, ["4", "2", "1", "3"], 1, NOW + 1000)
    ).resolves.toEqual({
      site: SITE,
      questionCount: 4,
      updatedAtMs: NOW + 1000,
      generation: 1,
      question: {
        questionId: "1",
        url: `https://${SITE}/questions/1`,
        kind: "new",
        dueMs: null,
      },
    });
    await runInRawDurableObject(stub(), (_instance, state) => {
      expect(state.storage.sql.exec("SELECT * FROM usage_audit").toArray()).toEqual(
        []
      );
    });

    await expect(
      stub().replaceCatalog(SITE, ["2", "3", "4", "5"], 1, NOW + 2000)
    ).resolves.toMatchObject({ questionCount: 4, generation: 2 });
    await runInRawDurableObject(stub(), (_instance, state) => {
      expect(
        state.storage.sql.exec("SELECT event FROM usage_audit ORDER BY event").toArray()
      ).toEqual([{ event: "delete:1" }, { event: "insert:5" }]);
    });
  });

  it("replaces the maximum catalog size with bulk SQL", async () => {
    const firstCatalog = Array.from({ length: 10_000 }, (_, index) =>
      String(index + 1)
    );
    await expect(
      stub().replaceCatalog(SITE, firstCatalog, 1, NOW + 1000)
    ).resolves.toEqual({
      site: SITE,
      questionCount: 10_000,
      updatedAtMs: NOW + 1000,
      generation: 2,
      question: {
        questionId: "1",
        url: `https://${SITE}/questions/1`,
        kind: "new",
        dueMs: null,
      },
    });

    await runInRawDurableObject(stub(), (_instance, state) => {
      state.storage.sql.exec(`
        CREATE TABLE usage_audit (event TEXT NOT NULL);
        CREATE TRIGGER audit_questions_insert AFTER INSERT ON questions
        BEGIN
          INSERT INTO usage_audit VALUES ('insert');
        END;
        CREATE TRIGGER audit_questions_delete AFTER DELETE ON questions
        BEGIN
          INSERT INTO usage_audit VALUES ('delete');
        END;
      `);
    });
    await expect(
      stub().replaceCatalog(SITE, [...firstCatalog].reverse(), 2, NOW + 1500)
    ).resolves.toEqual({
      site: SITE,
      questionCount: 10_000,
      updatedAtMs: NOW + 1500,
      generation: 2,
      question: {
        questionId: "1",
        url: `https://${SITE}/questions/1`,
        kind: "new",
        dueMs: null,
      },
    });
    await runInRawDurableObject(stub(), (_instance, state) => {
      expect(state.storage.sql.exec("SELECT * FROM usage_audit").toArray()).toEqual(
        []
      );
      state.storage.sql.exec(`
        DROP TRIGGER audit_questions_insert;
        DROP TRIGGER audit_questions_delete;
        DROP TABLE usage_audit;
      `);
    });

    const secondCatalog = Array.from({ length: 10_000 }, (_, index) =>
      String(index + 5001)
    );
    await expect(
      stub().replaceCatalog(SITE, secondCatalog, 2, NOW + 2000)
    ).resolves.toEqual({
      site: SITE,
      questionCount: 10_000,
      updatedAtMs: NOW + 2000,
      generation: 3,
      question: {
        questionId: "5001",
        url: `https://${SITE}/questions/5001`,
        kind: "new",
        dueMs: null,
      },
    });
    await runInRawDurableObject(stub(), (_instance, state) => {
      expect(
        state.storage.sql
          .exec(
            `SELECT COUNT(*) AS question_count,
                    SUM(
                      CASE WHEN CAST(question_id AS INTEGER) BETWEEN 5001 AND 15000
                           THEN 1 ELSE 0 END
                    ) AS expected_question_count
             FROM questions WHERE site = ?`,
            SITE
          )
          .toArray()[0]
      ).toEqual({
        question_count: 10_000,
        expected_question_count: 10_000,
      });
    });
    await expect(stub().getState(SITE, NOW + 2000)).resolves.toMatchObject({
      learningMetrics: {
        stabilityDays: 0,
        attemptedQuestionCount: 0,
      },
      catalog: { questionCount: 10_000, generation: 3 },
    });
  });

  it("returns the v11 attempt contract for correct and incorrect answers", async () => {
    const correct = await stub().recordAttempt(
      SITE,
      "1",
      operationId(1),
      "correct",
      NOW
    );
    expect(correct.attempt).toMatchObject({
      questionId: "1",
      answerResult: "correct",
      attemptedAtMs: NOW,
      previousCardStabilityDays: 0,
      previousStabilityDays: 0,
    });
    expect(correct.attempt.resultingCardStabilityDays).toBeGreaterThan(0);
    expect(correct.attempt.resultingStabilityDays).toBeGreaterThanOrEqual(0);
    expect(correct.attempt).not.toHaveProperty("result");
    expect(correct.attempt).not.toHaveProperty("previousStability");
    expect(correct).not.toHaveProperty("totals");
    expect(correct.learningMetrics).toMatchObject({
      attemptedQuestionCount: 1,
      todayAttemptedQuestionCount: 1,
      todayCorrectRatePercent: 100,
    });
    expect(correct.learningMetrics).toHaveProperty("stabilityDays");
    expect(correct.learningMetrics).toHaveProperty("todayStabilityDaysDelta");
    await runInRawDurableObject(stub(), (_instance, state) => {
      const card = state.storage.sql
        .exec(
          "SELECT due_ms, stability FROM cards WHERE site = ? AND question_id = ?",
          SITE,
          "1"
        )
        .toArray()[0];
      expect(card.due_ms).toBeGreaterThan(NOW);
      expect(card.stability).toBe(correct.attempt.resultingCardStabilityDays);
    });

    await seedReviewCard("2", 35, NOW - 1000, NOW);
    const incorrect = await stub().recordAttempt(
      SITE,
      "2",
      operationId(2),
      "incorrect",
      NOW + 1000
    );
    expect(incorrect.attempt.answerResult).toBe("incorrect");
    expect(incorrect.attempt.previousCardStabilityDays).toBe(35);
    expect(incorrect.attempt.resultingCardStabilityDays).toBeLessThan(35);
    expect(incorrect.attempt.resultingStabilityDays).toBeLessThan(
      incorrect.attempt.previousStabilityDays
    );
    expect(incorrect.learningMetrics.todayCorrectRatePercent).toBe(50);
  });
});

describe("attempt idempotency and attempted question totals", () => {
  it("updates only attempt metrics during an early same-day repeat", async () => {
    await seedReviewCard("1", 35, NOW + DAY_MS, NOW - DAY_MS);
    await runInRawDurableObject(stub(), (_instance, state) => {
      state.storage.sql.exec(
        `UPDATE stability_history
         SET opening_stability_days = 35, closing_stability_days = 35
         WHERE site = ? AND date = '2026-08-10'`,
        SITE
      );
    });
    await stub().recordAttempt(SITE, "1", operationId(39), "correct", NOW);
    await runInRawDurableObject(stub(), (_instance, state) => {
      state.storage.sql.exec(`
        CREATE TABLE usage_audit (event TEXT NOT NULL);
        CREATE TRIGGER audit_learning_metrics_update AFTER UPDATE ON learning_metrics
        BEGIN
          INSERT INTO usage_audit VALUES ('learning_metrics');
        END;
        CREATE TRIGGER audit_stability_history_update AFTER UPDATE ON stability_history
        BEGIN
          INSERT INTO usage_audit VALUES ('stability_history');
        END;
      `);
    });

    const repeated = await stub().recordAttempt(
      SITE,
      "1",
      operationId(40),
      "incorrect",
      NOW + 1000
    );
    expect(repeated.learningMetrics).toMatchObject({
      stabilityDays: 35,
      todayStabilityDaysDelta: 0,
      attemptedQuestionCount: 1,
      todayAttemptedQuestionCount: 1,
      todayCorrectRatePercent: 50,
    });
    await runInRawDurableObject(stub(), (_instance, state) => {
      expect(state.storage.sql.exec("SELECT * FROM usage_audit").toArray()).toEqual(
        [
          { event: "learning_metrics" },
          { event: "stability_history" },
        ]
      );
    });
  });

  it("records early practice without rescheduling the card or stability metrics", async () => {
    await seedReviewCard("1", 35, NOW + DAY_MS, NOW - 30 * DAY_MS);
    const before = await runInRawDurableObject(stub(), (_instance, state) =>
      state.storage.transactionSync(() => {
        state.storage.sql.exec(
          `UPDATE stability_history
           SET opening_stability_days = 35, closing_stability_days = 35
           WHERE site = ? AND date = '2026-08-10'`,
          SITE
        );
        return state.storage.sql
          .exec("SELECT * FROM cards WHERE site = ? AND question_id = '1'", SITE)
          .toArray()[0];
      })
    );

    const correct = await stub().recordAttempt(
      SITE,
      "1",
      operationId(40),
      "correct",
      NOW
    );
    expect(correct.attempt).toMatchObject({
      previousCardStabilityDays: 35,
      resultingCardStabilityDays: 35,
      previousStabilityDays: 35,
      resultingStabilityDays: 35,
    });
    expect(correct.learningMetrics).toMatchObject({
      stabilityDays: 35,
      todayStabilityDaysDelta: 0,
      attemptedQuestionCount: 1,
      todayAttemptedQuestionCount: 1,
      todayCorrectRatePercent: 100,
    });

    const incorrect = await stub().recordAttempt(
      SITE,
      "1",
      operationId(41),
      "incorrect",
      NOW + 1000
    );
    expect(incorrect.attempt).toMatchObject({
      previousCardStabilityDays: 35,
      resultingCardStabilityDays: 35,
      previousStabilityDays: 35,
      resultingStabilityDays: 35,
    });
    expect(incorrect.learningMetrics).toMatchObject({
      stabilityDays: 35,
      todayStabilityDaysDelta: 0,
      attemptedQuestionCount: 1,
      todayAttemptedQuestionCount: 1,
      todayCorrectRatePercent: 50,
    });

    await runInRawDurableObject(stub(), (_instance, state) => {
      expect(
        state.storage.sql
          .exec("SELECT * FROM cards WHERE site = ? AND question_id = '1'", SITE)
          .toArray()[0]
      ).toEqual({ ...before, last_attempt_date: "2026-08-10" });
      expect(
        state.storage.sql
          .exec(
            `SELECT answer_result, previous_card_stability_days,
                    resulting_card_stability_days
             FROM attempts WHERE site = ? AND question_id = '1'
             ORDER BY attempted_at_ms`,
            SITE
          )
          .toArray()
      ).toEqual([
        {
          answer_result: "correct",
          previous_card_stability_days: 35,
          resulting_card_stability_days: 35,
        },
        {
          answer_result: "incorrect",
          previous_card_stability_days: 35,
          resulting_card_stability_days: 35,
        },
      ]);
    });
  });

  it("applies a review exactly when its due time arrives", async () => {
    await seedReviewCard("1", 35, NOW, NOW - 30 * DAY_MS);
    const result = await stub().recordAttempt(
      SITE,
      "1",
      operationId(42),
      "correct",
      NOW
    );
    expect(result.attempt.resultingCardStabilityDays).toBeGreaterThan(35);
    expect(result.attempt.resultingStabilityDays).toBeGreaterThan(
      result.attempt.previousStabilityDays
    );
  });

  it("does not apply the same operation twice", async () => {
    const first = await stub().recordAttempt(
      SITE,
      "1",
      operationId(3),
      "correct",
      NOW
    );
    const retry = await stub().recordAttempt(
      SITE,
      "1",
      operationId(3),
      "correct",
      NOW + 60_000
    );
    expect(retry.attempt).toMatchObject({
      questionId: first.attempt.questionId,
      answerResult: first.attempt.answerResult,
      attemptedAtMs: first.attempt.attemptedAtMs,
      previousCardStabilityDays: first.attempt.previousCardStabilityDays,
      resultingCardStabilityDays: first.attempt.resultingCardStabilityDays,
    });
    expect(retry.attempt.previousStabilityDays).toBe(
      first.attempt.resultingStabilityDays
    );
    expect(retry.attempt.resultingStabilityDays).toBe(
      first.attempt.resultingStabilityDays
    );
    await runInRawDurableObject(stub(), (_instance, state) => {
      expect(
        state.storage.sql
          .exec("SELECT reps FROM cards WHERE site = ? AND question_id = '1'", SITE)
          .toArray()[0].reps
      ).toBe(1);
      expect(
        state.storage.sql.exec("SELECT COUNT(*) AS count FROM attempts").toArray()[0]
          .count
      ).toBe(1);
    });
  });

  it("returns current totals when an older operation is retried", async () => {
    await seedReviewCard("1", 10);
    await seedReviewCard("2", 20);
    const first = await stub().recordAttempt(
      SITE,
      "1",
      operationId(4),
      "correct",
      NOW
    );
    const second = await stub().recordAttempt(
      SITE,
      "2",
      operationId(5),
      "correct",
      NOW + 1000
    );
    const retry = await stub().recordAttempt(
      SITE,
      "1",
      operationId(4),
      "correct",
      NOW + 2000
    );
    expect(retry.attempt).toMatchObject({
      questionId: first.attempt.questionId,
      answerResult: first.attempt.answerResult,
      attemptedAtMs: first.attempt.attemptedAtMs,
      previousCardStabilityDays: first.attempt.previousCardStabilityDays,
      resultingCardStabilityDays: first.attempt.resultingCardStabilityDays,
    });
    expect(retry.attempt.previousStabilityDays).toBe(
      second.learningMetrics.stabilityDays
    );
    expect(retry.attempt.resultingStabilityDays).toBe(
      second.learningMetrics.stabilityDays
    );
    expect(retry.learningMetrics).toEqual(second.learningMetrics);
  });

  it("counts distinct attempted questions by lifetime and Tokyo date", async () => {
    const beforeMidnight = Date.parse("2026-08-10T14:59:59.999Z");
    const afterMidnight = Date.parse("2026-08-10T15:00:00.000Z");
    await stub().recordAttempt(SITE, "1", operationId(6), "correct", beforeMidnight);
    await expect(stub().getState(SITE, afterMidnight)).resolves.toMatchObject({
      today: "2026-08-11",
      learningMetrics: {
        attemptedQuestionCount: 1,
        todayAttemptedQuestionCount: 0,
        todayCorrectRatePercent: null,
      },
    });
    await stub().recordAttempt(SITE, "1", operationId(7), "correct", afterMidnight);
    await stub().recordAttempt(
      SITE,
      "2",
      operationId(8),
      "incorrect",
      afterMidnight + 1
    );

    await expect(stub().getState(SITE, afterMidnight + 1)).resolves.toMatchObject({
      today: "2026-08-11",
      learningMetrics: {
        attemptedQuestionCount: 2,
        todayAttemptedQuestionCount: 2,
        todayCorrectRatePercent: 50,
      },
    });
    await expect(stub().getHistory(SITE, 2, afterMidnight + 1)).resolves.toMatchObject({
      days: [
        {
          date: "2026-08-10",
          dailyAttemptedQuestionCount: 1,
          dailyCorrectRatePercent: 100,
        },
        {
          date: "2026-08-11",
          dailyAttemptedQuestionCount: 2,
          dailyCorrectRatePercent: 50,
        },
      ],
    });
  });

  it("rounds daily correct rates and counts repeated questions as attempts", async () => {
    await seedReviewCard("1", 35, NOW + DAY_MS, NOW - DAY_MS);
    await stub().recordAttempt(SITE, "1", operationId(43), "correct", NOW);
    await stub().recordAttempt(SITE, "1", operationId(44), "incorrect", NOW + 1);
    const third = await stub().recordAttempt(
      SITE,
      "1",
      operationId(45),
      "correct",
      NOW + 2
    );

    expect(third.learningMetrics).toMatchObject({
      todayAttemptedQuestionCount: 1,
      todayCorrectRatePercent: 67,
    });
    await expect(stub().getHistory(SITE, 1, NOW + 2)).resolves.toMatchObject({
      days: [
        {
          dailyAttemptedQuestionCount: 1,
          dailyCorrectRatePercent: 67,
        },
      ],
    });
  });

  it("keeps a removed and readded question out of the unseen queue", async () => {
    await stub().recordAttempt(SITE, "1", operationId(46), "correct", NOW);
    await stub().replaceCatalog(SITE, ["2", "3", "4"], 1, NOW + 1);
    await stub().replaceCatalog(SITE, ["4", "1", "3", "2"], 2, NOW + 2);

    await expect(stub().nextQuestion(SITE, NOW + 2)).resolves.toMatchObject({
      questionId: "2",
      kind: "new",
    });
    await runInRawDurableObject(stub(), (_instance, state) => {
      expect(
        state.storage.sql
          .exec(
            `SELECT question_number, attempted FROM questions
             WHERE site = ? AND question_id = '1'`,
            SITE
          )
          .toArray()[0]
      ).toEqual({ question_number: 1, attempted: 1 });
    });

    const repeated = await stub().recordAttempt(
      SITE,
      "1",
      operationId(47),
      "correct",
      NOW + 3
    );
    expect(repeated.learningMetrics.attemptedQuestionCount).toBe(1);
  });

  it("orders unseen questions by numeric question number", async () => {
    await stub().replaceCatalog(SITE, ["10", "3", "2"], 1, NOW + 1);
    await expect(stub().nextQuestion(SITE, NOW + 1)).resolves.toEqual({
      questionId: "2",
      kind: "new",
      dueMs: null,
    });
  });

  it("rejects operationId reuse with a different payload", async () => {
    await stub().recordAttempt(SITE, "1", operationId(9), "correct", NOW);
    await expect(
      stub().recordAttempt(SITE, "2", operationId(9), "correct", NOW)
    ).resolves.toEqual({ error: "operation_conflict" });
    await expect(
      stub().recordAttempt(SITE, "1", operationId(9), "incorrect", NOW)
    ).resolves.toEqual({ error: "operation_conflict" });
  });
});

describe("daily KPI celebrations", () => {
  it("counts the first answer regardless of correctness and celebrates question 50", async () => {
    await seedTodayNewQuestionCount(49);

    await expect(stub().getState(SITE, NOW)).resolves.toMatchObject({
      learningMetrics: {
        dailyKpiCompleted: false,
        todayNewQuestionCount: 49,
        newQuestionGoal: 50,
        newQuestionsRemaining: 1,
      },
    });

    const result = await stub().recordAttempt(
      SITE,
      "1",
      operationId(28),
      "incorrect",
      NOW
    );

    expect(result.learningMetrics).toMatchObject({
      dailyKpiCompleted: true,
      dueCardsCompleted: true,
      dueCardsRemaining: 0,
      todayNewQuestionCount: 50,
      newQuestionGoal: 50,
      newQuestionsRemaining: 0,
    });
    expect(result.celebration).toEqual({
      site: SITE,
      date: "2026-08-10",
      dailyKpiCompleted: true,
    });

    const repeated = await stub().recordAttempt(
      SITE,
      "1",
      operationId(27),
      "correct",
      NOW + 1
    );
    expect(repeated.learningMetrics.todayNewQuestionCount).toBe(50);
    expect(repeated).not.toHaveProperty("celebration");
  });

  it("isolates the daily new-question goal by site", async () => {
    await stub().replaceCatalog(OTHER_SITE, ["1"], 0, NOW);
    await seedTodayNewQuestionCount(49, "2026-08-10", OTHER_SITE);

    const otherResult = await stub().recordAttempt(
      OTHER_SITE,
      "1",
      operationId(26),
      "correct",
      NOW
    );

    expect(otherResult.learningMetrics.dailyKpiCompleted).toBe(true);
    await expect(stub().getState(SITE, NOW)).resolves.toMatchObject({
      learningMetrics: {
        dailyKpiCompleted: false,
        todayNewQuestionCount: 0,
        newQuestionsRemaining: 50,
      },
    });
  });

  it("does not celebrate when the daily KPI was already complete", async () => {
    await seedTodayNewQuestionCount(50);

    const result = await stub().recordAttempt(
      SITE,
      "1",
      operationId(25),
      "correct",
      NOW
    );

    expect(result.learningMetrics).toMatchObject({
      dailyKpiCompleted: true,
      todayNewQuestionCount: 51,
      newQuestionGoal: 50,
      newQuestionsRemaining: 0,
    });
    expect(result).not.toHaveProperty("celebration");
  });

  it("counts only due cards in the current catalog", async () => {
    await seedReviewCard("1", 30, NOW);
    await seedReviewCard("2", 30, NOW + 1);

    await expect(stub().getState(SITE, NOW)).resolves.toMatchObject({
      learningMetrics: {
        dueCardsCompleted: false,
        dueCardsRemaining: 1,
      },
    });

    const earlyAttempt = await stub().recordAttempt(
      SITE,
      "2",
      operationId(35),
      "correct",
      NOW
    );
    expect(earlyAttempt.learningMetrics).toMatchObject({
      dueCardsCompleted: false,
      dueCardsRemaining: 1,
    });

    await stub().replaceCatalog(SITE, ["2", "3", "4"], 1, NOW);
    await expect(stub().getState(SITE, NOW)).resolves.toMatchObject({
      learningMetrics: {
        dueCardsCompleted: true,
        dueCardsRemaining: 0,
      },
    });

    await expect(stub().getState(SITE, NOW + 1)).resolves.toMatchObject({
      learningMetrics: {
        dueCardsCompleted: false,
        dueCardsRemaining: 1,
      },
    });
  });

  it("returns one celebration when the final due card is answered", async () => {
    await seedTodayNewQuestionCount(50);
    await seedReviewCard("1", 30);
    await seedReviewCard("2", 30);
    const partial = await stub().recordAttempt(
      SITE,
      "1",
      operationId(29),
      "correct",
      NOW
    );
    expect(partial.learningMetrics.dueCardsCompleted).toBe(false);
    expect(partial.learningMetrics.dueCardsRemaining).toBe(1);
    expect(partial.learningMetrics.dailyKpiCompleted).toBe(false);
    expect(partial).not.toHaveProperty("celebration");

    const first = await stub().recordAttempt(
      SITE,
      "2",
      operationId(30),
      "correct",
      NOW
    );
    expect(first.learningMetrics.dueCardsCompleted).toBe(true);
    expect(first.learningMetrics.dueCardsRemaining).toBe(0);
    expect(first.learningMetrics.dailyKpiCompleted).toBe(true);
    expect(first.celebration).toEqual({
      site: SITE,
      date: "2026-08-10",
      dailyKpiCompleted: true,
    });

    const retry = await stub().recordAttempt(
      SITE,
      "2",
      operationId(30),
      "correct",
      NOW + 1000
    );
    expect(retry.celebration).toEqual(first.celebration);
    await runInRawDurableObject(stub(), (_instance, state) => {
      expect(
        state.storage.sql
          .exec("SELECT * FROM daily_kpi_achievements")
          .toArray()
      ).toEqual([
        {
          site: SITE,
          date: "2026-08-10",
          operation_id: operationId(30),
          achieved_at_ms: NOW,
        },
      ]);
    });
  });

  it("does not celebrate a second completion on the same site and Tokyo date", async () => {
    await seedTodayNewQuestionCount(50);
    await seedReviewCard("1", 30);
    const first = await stub().recordAttempt(
      SITE,
      "1",
      operationId(31),
      "correct",
      NOW
    );
    expect(first).toHaveProperty("celebration");

    await seedReviewCard("2", 30, NOW + 500);
    await expect(stub().getState(SITE, NOW + 500)).resolves.toMatchObject({
      learningMetrics: {
        dailyKpiCompleted: true,
        dueCardsCompleted: false,
        dueCardsRemaining: 1,
      },
    });

    const repeated = await stub().recordAttempt(
      SITE,
      "2",
      operationId(32),
      "correct",
      NOW + 1000
    );
    expect(repeated.learningMetrics.dailyKpiCompleted).toBe(true);
    expect(repeated.learningMetrics.dueCardsCompleted).toBe(true);
    expect(repeated).not.toHaveProperty("celebration");
  });

  it("allows another celebration on the next Tokyo date", async () => {
    await seedTodayNewQuestionCount(50);
    await seedReviewCard("1", 30);
    const first = await stub().recordAttempt(
      SITE,
      "1",
      operationId(33),
      "correct",
      NOW
    );
    await seedReviewCard("2", 30, NOW + DAY_MS);
    await seedTodayNewQuestionCount(50, "2026-08-11");
    const nextDay = await stub().recordAttempt(
      SITE,
      "2",
      operationId(34),
      "correct",
      NOW + DAY_MS
    );

    expect(first.celebration.date).toBe("2026-08-10");
    expect(nextDay.celebration).toMatchObject({
      site: SITE,
      date: "2026-08-11",
      dailyKpiCompleted: true,
    });
  });

  it("does not create celebrations from catalog changes", async () => {
    await seedReviewCard("1", 100);
    await stub().replaceCatalog(SITE, ["1", "2", "3"], 1, NOW + 1000);

    await runInRawDurableObject(stub(), (_instance, state) => {
      expect(
        state.storage.sql
          .exec("SELECT COUNT(*) AS count FROM daily_kpi_achievements")
          .toArray()[0].count
      ).toBe(0);
    });
  });
});

describe("stability history", () => {
  it("uses opening and closing totals for the daily delta", async () => {
    const first = await stub().recordAttempt(
      SITE,
      "1",
      operationId(10),
      "correct",
      NOW
    );
    const second = await stub().recordAttempt(
      SITE,
      "2",
      operationId(11),
      "correct",
      NOW + 1000
    );
    const state = await stub().getState(SITE, NOW + 1000);
    expect(state.learningMetrics.stabilityDays).toBe(
      second.learningMetrics.stabilityDays
    );
    expect(state.learningMetrics.todayStabilityDaysDelta).toBe(
      second.learningMetrics.stabilityDays
    );
    expect(state.learningMetrics.stabilityDays).toBeGreaterThanOrEqual(
      first.learningMetrics.stabilityDays
    );
  });

  it("returns null before tracking starts and carries known totals forward", async () => {
    const initial = await stub().getHistory(SITE, 7, NOW);
    expect(
      initial.days.slice(0, 6).every((day) => day.closingStabilityDays === null)
    ).toBe(true);
    expect(
      initial.days.slice(0, 6).every((day) => day.stabilityDaysDelta === null)
    ).toBe(true);
    expect(initial.days.at(-1).closingStabilityDays).toBe(0);
    expect(initial.days.at(-1).stabilityDaysDelta).toBe(0);

    await stub().recordAttempt(SITE, "1", operationId(12), "correct", NOW);
    const afterGap = await stub().getHistory(SITE, 3, NOW + 2 * DAY_MS);
    expect(afterGap.days[0].closingStabilityDays).not.toBeNull();
    expect(afterGap.days[0].stabilityDaysDelta).toBeGreaterThan(0);
    expect(afterGap.days[1].closingStabilityDays).toBe(
      afterGap.days[0].closingStabilityDays
    );
    expect(afterGap.days[2].closingStabilityDays).toBe(
      afterGap.days[0].closingStabilityDays
    );
    expect(afterGap.days[1].stabilityDaysDelta).toBe(0);
    expect(afterGap.days[2].stabilityDaysDelta).toBe(0);
  });

  it("starts a new opening total at the Tokyo date boundary", async () => {
    await seedReviewCard("1", 35, NOW - 1000, NOW);
    const nextDay = NOW + DAY_MS;
    const before = (await stub().getState(SITE, nextDay)).learningMetrics
      .stabilityDays;
    await stub().recordAttempt(
      SITE,
      "1",
      operationId(13),
      "incorrect",
      nextDay
    );
    const after = await stub().getState(SITE, nextDay);
    expect(after.learningMetrics.todayStabilityDaysDelta).toBe(
      after.learningMetrics.stabilityDays - before
    );
    expect(
      (await stub().getHistory(SITE, 2, nextDay)).days.at(-1)
        .stabilityDaysDelta
    ).toBeLessThan(0);
  });

  it("serves daily attempt metrics from aggregates instead of raw attempts", async () => {
    await stub().recordAttempt(SITE, "1", operationId(14), "correct", NOW);
    await stub().recordAttempt(SITE, "2", operationId(15), "incorrect", NOW + 1);
    await runInRawDurableObject(stub(), (_instance, state) => {
      state.storage.sql.exec("DELETE FROM attempts");
    });

    await expect(stub().getHistory(SITE, 1, NOW + 1)).resolves.toMatchObject({
      days: [
        {
          date: "2026-08-10",
          dailyAttemptedQuestionCount: 2,
          dailyCorrectRatePercent: 50,
        },
      ],
    });
  });
});

describe("daily raw details", () => {
  it("returns raw table rows for one Tokyo date in stable order", async () => {
    const later = await stub().recordAttempt(
      SITE,
      "1",
      operationId(16),
      "correct",
      NOW + 2000
    );
    const earlier = await stub().recordAttempt(
      SITE,
      "2",
      operationId(17),
      "incorrect",
      NOW + 1000
    );

    await expect(stub().getDailyDetails(SITE, "2026-08-10")).resolves.toEqual({
      site: SITE,
      date: "2026-08-10",
      timeZone: "Asia/Tokyo",
      tables: {
        stability_history: [
          {
            site: SITE,
            date: "2026-08-10",
            opening_stability_days: 0,
            closing_stability_days: earlier.learningMetrics.stabilityDays,
            attempted_question_count: 2,
            new_question_count: 2,
            attempt_count: 2,
            correct_attempt_count: 1,
          },
        ],
        attempts: [
          {
            site: SITE,
            operation_id: operationId(17),
            question_id: "2",
            attempted_at_ms: NOW + 1000,
            answer_result: "incorrect",
            previous_card_stability_days: 0,
            resulting_card_stability_days: earlier.attempt.resultingCardStabilityDays,
          },
          {
            site: SITE,
            operation_id: operationId(16),
            question_id: "1",
            attempted_at_ms: NOW + 2000,
            answer_result: "correct",
            previous_card_stability_days: 0,
            resulting_card_stability_days: later.attempt.resultingCardStabilityDays,
          },
        ],
      },
    });
  });

  it("returns empty raw tables when the date has no rows", async () => {
    await expect(stub().getDailyDetails(SITE, "2026-08-09")).resolves.toEqual({
      site: SITE,
      date: "2026-08-09",
      timeZone: "Asia/Tokyo",
      tables: { stability_history: [], attempts: [] },
    });
  });

  it("uses Tokyo midnight when selecting attempts", async () => {
    const beforeMidnight = Date.parse("2026-08-10T14:59:59.999Z");
    const afterMidnight = Date.parse("2026-08-10T15:00:00.000Z");
    await stub().recordAttempt(
      SITE,
      "1",
      operationId(18),
      "correct",
      beforeMidnight
    );
    await stub().recordAttempt(
      SITE,
      "2",
      operationId(19),
      "correct",
      afterMidnight
    );

    expect(
      (await stub().getDailyDetails(SITE, "2026-08-10")).tables.attempts.map(
        (row) => row.operation_id
      )
    ).toEqual([operationId(18)]);
    expect(
      (await stub().getDailyDetails(SITE, "2026-08-11")).tables.attempts.map(
        (row) => row.operation_id
      )
    ).toEqual([operationId(19)]);
  });
});

describe("v11 HTTP contract", () => {
  it("does not expose older API versions", async () => {
    for (const version of ["v3", "v4", "v5", "v6", "v7", "v8", "v9", "v10"]) {
      const response = await SELF.fetch(
        `https://example.test/${version}/state?site=${SITE}`,
        { headers: AUTHORIZATION }
      );
      expect(response.status).toBe(404);
    }
  });

  it("requires the configured bearer token", async () => {
    for (const url of [
      "https://example.test/v11/sites",
      `https://example.test/v11/daily-details?site=${SITE}&date=2026-08-10`,
    ]) {
      const missing = await SELF.fetch(url);
      const incorrect = await SELF.fetch(url, {
        headers: { Authorization: "Bearer incorrect-token" },
      });
      expect(missing.status).toBe(401);
      expect(incorrect.status).toBe(401);
    }
  });

  it("lists sites and returns state and history", async () => {
    const sites = await SELF.fetch("https://example.test/v11/sites", {
      headers: AUTHORIZATION,
    });
    await expect(sites.json()).resolves.toEqual({ sites: [SITE] });

    const state = await SELF.fetch(`https://example.test/v11/state?site=${SITE}`, {
      headers: AUTHORIZATION,
    });
    expect(state.status).toBe(200);
    const stateBody = await state.json();
    expect(Object.keys(stateBody).sort()).toEqual([
      "catalog",
      "learningMetrics",
      "site",
      "today",
    ]);
    expect(stateBody).toMatchObject({
      site: SITE,
      learningMetrics: {
        stabilityDays: 0,
        dailyKpiCompleted: false,
        dueCardsCompleted: true,
        dueCardsRemaining: 0,
        todayNewQuestionCount: 0,
        newQuestionGoal: 50,
        newQuestionsRemaining: 50,
        todayStabilityDaysDelta: 0,
        attemptedQuestionCount: 0,
        todayAttemptedQuestionCount: 0,
        todayCorrectRatePercent: null,
      },
      catalog: { questionCount: 4, generation: 1 },
    });
    expect(stateBody.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const history = await SELF.fetch(
      `https://example.test/v11/history?site=${SITE}&days=7`,
      { headers: AUTHORIZATION }
    );
    expect(history.status).toBe(200);
    const historyBody = await history.json();
    expect(historyBody.days).toHaveLength(7);
    expect(historyBody.days.at(-1)).toEqual({
      date: expect.any(String),
      closingStabilityDays: 0,
      stabilityDaysDelta: 0,
      dailyAttemptedQuestionCount: 0,
      dailyNewQuestionCount: 0,
      dailyCorrectRatePercent: null,
    });

    const details = await SELF.fetch(
      `https://example.test/v11/daily-details?site=${SITE}&date=2026-08-10`,
      { headers: AUTHORIZATION }
    );
    expect(details.status).toBe(200);
    await expect(details.json()).resolves.toMatchObject({
      site: SITE,
      date: "2026-08-10",
      timeZone: "Asia/Tokyo",
      tables: { stability_history: [expect.any(Object)], attempts: [] },
    });
  });

  it("returns all dashboard reads through one endpoint", async () => {
    const response = await SELF.fetch(
      `https://example.test/v11/dashboard?site=${SITE}`,
      { headers: AUTHORIZATION }
    );
    expect(response.status).toBe(200);
    const dashboardBody = await response.json();
    expect(dashboardBody).toMatchObject({
      sites: [SITE],
      selectedSite: SITE,
      state: { site: SITE, learningMetrics: { stabilityDays: 0 } },
      history: { site: SITE, days: expect.any(Array) },
    });
    expect(dashboardBody.history.days).toHaveLength(31);

    const selectedDefault = await SELF.fetch(
      "https://example.test/v11/dashboard",
      { headers: AUTHORIZATION }
    );
    await expect(selectedDefault.json()).resolves.toMatchObject({
      sites: [SITE],
      selectedSite: SITE,
    });

    for (const search of ["site=invalid.example", `site=${SITE}&site=${SITE}`, "extra=true"]) {
      const invalid = await SELF.fetch(
        `https://example.test/v11/dashboard?${search}`,
        { headers: AUTHORIZATION }
      );
      expect(invalid.status).toBe(400);
    }

    await runInRawDurableObject(stub(), (_instance, state) => {
      state.storage.sql.exec("DELETE FROM catalog_metadata");
    });
    const empty = await SELF.fetch("https://example.test/v11/dashboard", {
      headers: AUTHORIZATION,
    });
    await expect(empty.json()).resolves.toEqual({
      sites: [],
      selectedSite: null,
      state: null,
      history: null,
    });
  });

  it("validates the daily details query", async () => {
    for (const search of [
      `site=${SITE}`,
      `site=${SITE}&date=2026-02-30`,
      `site=${SITE}&date=2026-08-10&date=2026-08-11`,
      `site=invalid.example&date=2026-08-10`,
      `site=${SITE}&date=2026-08-10&extra=true`,
    ]) {
      const response = await SELF.fetch(
        `https://example.test/v11/daily-details?${search}`,
        { headers: AUTHORIZATION }
      );
      expect(response.status).toBe(400);
    }
  });

  it("replaces the catalog and serves the canonical next URL", async () => {
    const replace = await SELF.fetch("https://example.test/v11/questions", {
      method: "POST",
      headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
      body: JSON.stringify({
        site: SITE,
        questionIds: ["44615", "44614"],
        expectedGeneration: 1,
      }),
    });
    expect(replace.status).toBe(200);

    const next = await SELF.fetch(`https://example.test/v11/next?site=${SITE}`, {
      headers: AUTHORIZATION,
    });
    const nextBody = await next.json();
    expect(nextBody).toMatchObject({
      question: {
        questionId: "44614",
        url: `https://${SITE}/questions/44614`,
        kind: "new",
        dueMs: null,
      },
      state: {
        site: SITE,
        catalog: {
          questionCount: 2,
          generation: 2,
        },
      },
    });
    expect(nextBody.state.learningMetrics.newQuestionGoal).toBe(50);

    const conflict = await SELF.fetch("https://example.test/v11/questions", {
      method: "POST",
      headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
      body: JSON.stringify({
        site: SITE,
        questionIds: ["44615"],
        expectedGeneration: 1,
      }),
    });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: "catalog_conflict",
      currentGeneration: 2,
      catalog: {
        site: SITE,
        questionCount: 2,
        generation: 2,
      },
      question: {
        questionId: "44614",
        url: `https://${SITE}/questions/44614`,
        kind: "new",
        dueMs: null,
      },
    });

    for (const body of [
      { site: SITE, questionIds: [], expectedGeneration: 2 },
      { site: SITE, questionIds: ["1", "1"], expectedGeneration: 2 },
      { site: SITE, questionIds: ["1"], expectedGeneration: -1 },
      { site: SITE, questionIds: ["1"] },
    ]) {
      const invalid = await SELF.fetch("https://example.test/v11/questions", {
        method: "POST",
        headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(invalid.status).toBe(400);
    }
  });

  it("rejects unknown questions and non-canonical attempt fields", async () => {
    const unknown = await SELF.fetch("https://example.test/v11/attempts", {
      method: "POST",
      headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
      body: JSON.stringify({
        site: SITE,
        questionId: "999",
        operationId: operationId(14),
        answerResult: "correct",
      }),
    });
    expect(unknown.status).toBe(409);
    await expect(unknown.json()).resolves.toEqual({ error: "unknown_question" });

    const extra = await SELF.fetch("https://example.test/v11/attempts", {
      method: "POST",
      headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
      body: JSON.stringify({
        site: SITE,
        questionId: "1",
        operationId: operationId(15),
        answerResult: "correct",
        attemptedAtMs: NOW,
      }),
    });
    expect(extra.status).toBe(400);

    const legacyKey = await SELF.fetch("https://example.test/v11/attempts", {
      method: "POST",
      headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
      body: JSON.stringify({
        site: SITE,
        questionId: "1",
        operationId: operationId(20),
        result: "correct",
      }),
    });
    expect(legacyKey.status).toBe(400);
  });

  it("returns the exact v11 attempt contract", async () => {
    const response = await SELF.fetch("https://example.test/v11/attempts", {
      method: "POST",
      headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
      body: JSON.stringify({
        site: SITE,
        questionId: "1",
        operationId: operationId(21),
        answerResult: "correct",
      }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      attempt: {
        questionId: "1",
        answerResult: "correct",
        attemptedAtMs: expect.any(Number),
        previousCardStabilityDays: 0,
        resultingCardStabilityDays: expect.any(Number),
        previousStabilityDays: 0,
        resultingStabilityDays: expect.any(Number),
      },
      learningMetrics: {
        stabilityDays: expect.any(Number),
        dailyKpiCompleted: false,
        dueCardsCompleted: true,
        dueCardsRemaining: 0,
        todayNewQuestionCount: 1,
        newQuestionGoal: 50,
        newQuestionsRemaining: 49,
        todayStabilityDaysDelta: expect.any(Number),
        attemptedQuestionCount: 1,
        todayAttemptedQuestionCount: 1,
        todayCorrectRatePercent: 100,
      },
      nextQuestion: {
        questionId: "2",
        url: `https://${SITE}/questions/2`,
        kind: "new",
        dueMs: null,
      },
    });
  });

  it("returns and replays the exact primary KPI celebration contract", async () => {
    await seedReviewCard("1", 30);
    await seedTodayNewQuestionCount(50, getTokyoDate(new Date()));

    const body = {
      site: SITE,
      questionId: "1",
      operationId: operationId(22),
      answerResult: "correct",
    };
    const response = await SELF.fetch("https://example.test/v11/attempts", {
      method: "POST",
      headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(Object.keys(result.celebration).sort()).toEqual([
      "dailyKpiCompleted",
      "date",
      "site",
    ]);
    expect(result.celebration).toEqual({
      site: SITE,
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      dailyKpiCompleted: true,
    });

    const retry = await SELF.fetch("https://example.test/v11/attempts", {
      method: "POST",
      headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toMatchObject({
      celebration: result.celebration,
    });
  });

  it("returns catalog_missing without a scheduling fallback", async () => {
    await runInRawDurableObject(stub(), (_instance, state) => {
      state.storage.sql.exec("DELETE FROM questions WHERE site = ?", SITE);
      state.storage.sql.exec("DELETE FROM catalog_metadata WHERE site = ?", SITE);
    });
    const response = await SELF.fetch(
      `https://example.test/v11/next?site=${SITE}`,
      { headers: AUTHORIZATION }
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "catalog_missing" });
  });
});
