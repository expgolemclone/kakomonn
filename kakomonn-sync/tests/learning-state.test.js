import {
  env,
  runInDurableObject as runInRawDurableObject,
  SELF,
} from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { ratingForResult } from "../src/fsrs.js";
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
      "daily_due_card_achievements",
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

async function seedReviewCard(
  questionId,
  stability,
  dueMs = NOW - 1000,
  lastReviewMs = NOW - 30 * DAY_MS,
  site = SITE
) {
  await runInRawDurableObject(stub(), (_instance, state) => {
    state.storage.sql.exec(
      `INSERT INTO cards (
         site, question_id, due_ms, stability, difficulty, scheduled_days,
         learning_steps, reps, lapses, state, last_review_ms
       ) VALUES (?, ?, ?, ?, 5, 30, 0, 5, 0, 2, ?)
       ON CONFLICT(site, question_id) DO UPDATE SET
         due_ms = excluded.due_ms,
         stability = excluded.stability,
         difficulty = excluded.difficulty,
         scheduled_days = excluded.scheduled_days,
         learning_steps = excluded.learning_steps,
         reps = excluded.reps,
         lapses = excluded.lapses,
         state = excluded.state,
         last_review_ms = excluded.last_review_ms`,
      site,
      questionId,
      dueMs,
      stability,
      lastReviewMs
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

beforeEach(reset);

describe("LearningState schema", () => {
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

  it("migrates schema v5 and removes retired KPI storage", async () => {
    await runInRawDurableObject(stub(), (_instance, state) => {
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
      ).toEqual({ version: 8 });
      expect(
        state.storage.sql
          .exec(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('site_settings', 'daily_stability_days_delta_achievements')"
          )
          .toArray()
      ).toEqual([]);
      expect(
        state.storage.sql
          .exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'daily_due_card_achievements'")
          .toArray()
      ).toEqual([{ name: "daily_due_card_achievements" }]);
      const indexes = state.storage.sql
        .exec(
          `SELECT name FROM sqlite_master
           WHERE type = 'index' AND name IN (?, ?, ?, ?)
           ORDER BY name`,
          "attempts_by_site",
          "attempts_by_site_attempted_at_question",
          "cards_by_site_due",
          "cards_by_site_stability"
        )
        .toArray()
        .map((row) => row.name);
      expect(indexes).toEqual([
        "attempts_by_site_attempted_at_question",
        "cards_by_site_due",
      ]);
    });
  });

  it("migrates legacy data to schema v8 without retaining threshold-based fields", async () => {
    await runInRawDurableObject(stub(), (_instance, state) => {
      state.storage.sql.exec(`
        DROP TABLE daily_due_card_achievements;
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
      ).toEqual({ version: 8 });
      expect(
        state.storage.sql
          .exec("SELECT * FROM daily_due_card_achievements")
          .toArray()
      ).toEqual([]);
      expect(
        state.storage.sql.exec("SELECT * FROM stability_history").toArray()[0]
      ).toEqual({
        site: SITE,
        date: "2026-08-10",
        opening_stability_days: 12,
        closing_stability_days: 12,
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

  it("migrates schema v2 data to v8 without losing rows", async () => {
    await runInRawDurableObject(stub(), (_instance, state) => {
      state.storage.sql.exec(`
        DROP TABLE daily_due_card_achievements;
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
      ).toEqual({ version: 8 });
      expect(
        state.storage.sql
          .exec("SELECT * FROM daily_due_card_achievements")
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
      });
      expect(
        state.storage.sql.exec("SELECT * FROM stability_history").toArray()[0]
      ).toEqual({
        site: SITE,
        date: "2026-08-10",
        opening_stability_days: 0,
        closing_stability_days: 2,
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
      ).toEqual({ version: 8 });
      const cursor = state.storage.sql.exec(
        `SELECT stability_days, attempted_question_count,
                daily_metrics_date, today_attempted_question_count,
                today_attempt_count, today_correct_attempt_count
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
      stub().replaceCatalog(SITE, ["1", "2", "3", "4"], 1, NOW + 1000)
    ).resolves.toEqual({
      site: SITE,
      questionCount: 4,
      updatedAtMs: NOW + 1000,
      generation: 1,
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

  it("returns the v8 attempt contract for correct and incorrect answers", async () => {
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
        [{ event: "learning_metrics" }]
      );
    });
  });

  it("records early practice without changing the card or stability metrics", async () => {
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
      ).toEqual(before);
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

describe("daily due card celebrations", () => {
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
    expect(first.celebration).toEqual({
      site: SITE,
      date: "2026-08-10",
      dueCardsCompleted: true,
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
          .exec("SELECT * FROM daily_due_card_achievements")
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

    const repeated = await stub().recordAttempt(
      SITE,
      "2",
      operationId(32),
      "correct",
      NOW + 1000
    );
    expect(repeated.learningMetrics.dueCardsCompleted).toBe(true);
    expect(repeated).not.toHaveProperty("celebration");
  });

  it("allows another celebration on the next Tokyo date", async () => {
    await seedReviewCard("1", 30);
    const first = await stub().recordAttempt(
      SITE,
      "1",
      operationId(33),
      "correct",
      NOW
    );
    await seedReviewCard("2", 30, NOW + DAY_MS);
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
      dueCardsCompleted: true,
    });
  });

  it("does not create celebrations from catalog changes", async () => {
    await seedReviewCard("1", 100);
    await stub().replaceCatalog(SITE, ["1", "2", "3"], 1, NOW + 1000);

    await runInRawDurableObject(stub(), (_instance, state) => {
      expect(
        state.storage.sql
          .exec("SELECT COUNT(*) AS count FROM daily_due_card_achievements")
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

describe("v8 HTTP contract", () => {
  it("does not expose older API versions", async () => {
    for (const version of ["v3", "v4", "v5", "v6", "v7"]) {
      const response = await SELF.fetch(
        `https://example.test/${version}/state?site=${SITE}`,
        { headers: AUTHORIZATION }
      );
      expect(response.status).toBe(404);
    }
  });

  it("requires the configured bearer token", async () => {
    for (const url of [
      "https://example.test/v8/sites",
      `https://example.test/v8/daily-details?site=${SITE}&date=2026-08-10`,
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
    const sites = await SELF.fetch("https://example.test/v8/sites", {
      headers: AUTHORIZATION,
    });
    await expect(sites.json()).resolves.toEqual({ sites: [SITE] });

    const state = await SELF.fetch(`https://example.test/v8/state?site=${SITE}`, {
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
        dueCardsCompleted: true,
        dueCardsRemaining: 0,
        todayStabilityDaysDelta: 0,
        attemptedQuestionCount: 0,
        todayAttemptedQuestionCount: 0,
        todayCorrectRatePercent: null,
      },
      catalog: { questionCount: 4, generation: 1 },
    });
    expect(stateBody.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const history = await SELF.fetch(
      `https://example.test/v8/history?site=${SITE}&days=7`,
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
      dailyCorrectRatePercent: null,
    });

    const details = await SELF.fetch(
      `https://example.test/v8/daily-details?site=${SITE}&date=2026-08-10`,
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
      `https://example.test/v8/dashboard?site=${SITE}`,
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
      "https://example.test/v8/dashboard",
      { headers: AUTHORIZATION }
    );
    await expect(selectedDefault.json()).resolves.toMatchObject({
      sites: [SITE],
      selectedSite: SITE,
    });

    for (const search of ["site=invalid.example", `site=${SITE}&site=${SITE}`, "extra=true"]) {
      const invalid = await SELF.fetch(
        `https://example.test/v8/dashboard?${search}`,
        { headers: AUTHORIZATION }
      );
      expect(invalid.status).toBe(400);
    }

    await runInRawDurableObject(stub(), (_instance, state) => {
      state.storage.sql.exec("DELETE FROM catalog_metadata");
    });
    const empty = await SELF.fetch("https://example.test/v8/dashboard", {
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
        `https://example.test/v8/daily-details?${search}`,
        { headers: AUTHORIZATION }
      );
      expect(response.status).toBe(400);
    }
  });

  it("replaces the catalog and serves the canonical next URL", async () => {
    const replace = await SELF.fetch("https://example.test/v8/questions", {
      method: "POST",
      headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
      body: JSON.stringify({
        site: SITE,
        questionIds: ["44615", "44614"],
        expectedGeneration: 1,
      }),
    });
    expect(replace.status).toBe(200);

    const next = await SELF.fetch(`https://example.test/v8/next?site=${SITE}`, {
      headers: AUTHORIZATION,
    });
    await expect(next.json()).resolves.toEqual({
      question: {
        questionId: "44614",
        url: `https://${SITE}/questions/44614`,
        kind: "new",
        dueMs: null,
      },
    });

    const conflict = await SELF.fetch("https://example.test/v8/questions", {
      method: "POST",
      headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
      body: JSON.stringify({
        site: SITE,
        questionIds: ["44615"],
        expectedGeneration: 1,
      }),
    });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toEqual({ error: "catalog_conflict" });

    for (const body of [
      { site: SITE, questionIds: [], expectedGeneration: 2 },
      { site: SITE, questionIds: ["1", "1"], expectedGeneration: 2 },
      { site: SITE, questionIds: ["1"], expectedGeneration: -1 },
      { site: SITE, questionIds: ["1"] },
    ]) {
      const invalid = await SELF.fetch("https://example.test/v8/questions", {
        method: "POST",
        headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(invalid.status).toBe(400);
    }
  });

  it("rejects unknown questions and non-canonical attempt fields", async () => {
    const unknown = await SELF.fetch("https://example.test/v8/attempts", {
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

    const extra = await SELF.fetch("https://example.test/v8/attempts", {
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

    const legacyKey = await SELF.fetch("https://example.test/v8/attempts", {
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

  it("returns the exact v8 attempt contract", async () => {
    const response = await SELF.fetch("https://example.test/v8/attempts", {
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
        dueCardsCompleted: true,
        dueCardsRemaining: 0,
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

    const body = {
      site: SITE,
      questionId: "1",
      operationId: operationId(22),
      answerResult: "correct",
    };
    const response = await SELF.fetch("https://example.test/v8/attempts", {
      method: "POST",
      headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(Object.keys(result.celebration).sort()).toEqual([
      "date",
      "dueCardsCompleted",
      "site",
    ]);
    expect(result.celebration).toEqual({
      site: SITE,
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      dueCardsCompleted: true,
    });

    const retry = await SELF.fetch("https://example.test/v8/attempts", {
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
      `https://example.test/v8/next?site=${SITE}`,
      { headers: AUTHORIZATION }
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "catalog_missing" });
  });
});
