import { env, runInDurableObject as runInRawDurableObject, SELF } from "cloudflare:test";
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
      "study_time_sessions",
      "study_time_daily",
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
  site = SITE,
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
      lastAttemptDate,
    );
    state.storage.sql.exec(
      `UPDATE questions SET attempted = 1
       WHERE site = ? AND question_id = ?`,
      site,
      questionId,
    );
    state.storage.sql.exec(
      `UPDATE learning_metrics SET stability_days = (
         SELECT COALESCE(SUM(c.stability), 0) FROM cards c JOIN questions q
         ON q.site = c.site AND q.question_id = c.question_id WHERE c.site = ?
       ), attempted_question_count = MAX(attempted_question_count, (
         SELECT COUNT(*) FROM cards WHERE site = ?
       ), COALESCE((SELECT attempted_question_count FROM stability_history WHERE site = ? AND date = '2026-08-10'), 0)
          + (SELECT COUNT(*) FROM cards WHERE site = ? AND last_attempt_date <> '2026-08-10'))
       WHERE site = ?`, site, site, site, site, site,
    );
  });
}

async function seedTodayNewQuestionCount(count, date = "2026-08-10", site = SITE) {
  await runInRawDurableObject(stub(), (_instance, state) => {
    state.storage.sql.exec(
      `UPDATE learning_metrics SET attempted_question_count = MAX(attempted_question_count, ? + (
         SELECT COUNT(*) FROM cards WHERE site = ? AND last_attempt_date <> ?
       )) WHERE site = ?`, count, site, date, site,
    );
    state.storage.sql.exec(
      `INSERT INTO stability_history (site, date, opening_stability_days, closing_stability_days,
         attempted_question_count, attempt_count, correct_attempt_count, new_question_count)
       VALUES (?, ?, 0, 0, ?, ?, 0, ?)
       ON CONFLICT(site, date) DO UPDATE SET
         attempted_question_count = MAX(attempted_question_count, excluded.attempted_question_count),
         attempt_count = MAX(attempt_count, excluded.attempt_count),
         new_question_count = excluded.new_question_count`,
      site, date, count, count, count,
    );
  });
}

beforeEach(reset);

describe("LearningState schema", () => {
  it("does not mutate an initialized schema", async () => {
    await runInRawDurableObject(stub(), (_instance, state) => {
      const before = state.storage.sql.exec("SELECT sql FROM sqlite_master ORDER BY name").toArray();
      initializeLearningSchema(state.storage, NOW);
      expect(state.storage.sql.exec("SELECT sql FROM sqlite_master ORDER BY name").toArray()).toEqual(before);
      expect(state.storage.sql.exec("PRAGMA table_info(learning_metrics)").toArray().map(row => row.name))
        .toEqual(["site", "stability_days", "attempted_question_count"]);
    });
  });

  it("migrates v12 without losing daily rows or cumulative metrics", async () => {
    await stub().recordAttempt(SITE, "1", operationId(1), "correct", NOW);
    await stub().recordStudyTime(SITE, [{ sessionId: operationId(99), date: "2026-08-10", activeMs: 1234 }], NOW);
    const before = await stub().getState(SITE, NOW);
    await runInRawDurableObject(stub(), (_instance, state) => {
      state.storage.sql.exec(`
        ALTER TABLE learning_metrics ADD COLUMN daily_metrics_date TEXT NOT NULL DEFAULT '2026-08-10';
        ALTER TABLE learning_metrics ADD COLUMN today_attempted_question_count INTEGER NOT NULL DEFAULT 999;
        ALTER TABLE learning_metrics ADD COLUMN today_attempt_count INTEGER NOT NULL DEFAULT 999;
        ALTER TABLE learning_metrics ADD COLUMN today_correct_attempt_count INTEGER NOT NULL DEFAULT 999;
        ALTER TABLE learning_metrics ADD COLUMN today_new_question_count INTEGER NOT NULL DEFAULT 999;
        ALTER TABLE learning_metrics ADD COLUMN today_study_time_ms INTEGER NOT NULL DEFAULT 999;
        UPDATE schema_metadata SET version = 12;
      `);
      initializeLearningSchema(state.storage, NOW);
      expect(state.storage.sql.exec("SELECT version FROM schema_metadata").toArray()[0].version).toBe(13);
      expect(state.storage.sql.exec("PRAGMA table_info(learning_metrics)").toArray().map(row => row.name))
        .toEqual(["site", "stability_days", "attempted_question_count"]);
    });
    expect(await stub().getState(SITE, NOW)).toEqual(before);
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
        todayStudyTimeMs: 0,
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

    await expect(stub().replaceCatalog(SITE, ["4", "2", "1", "3"], 1, NOW + 1000)).resolves.toEqual(
      {
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
      },
    );
    await runInRawDurableObject(stub(), (_instance, state) => {
      expect(state.storage.sql.exec("SELECT * FROM usage_audit").toArray()).toEqual([]);
    });

    await expect(
      stub().replaceCatalog(SITE, ["2", "3", "4", "5"], 1, NOW + 2000),
    ).resolves.toMatchObject({ questionCount: 4, generation: 2 });
    await runInRawDurableObject(stub(), (_instance, state) => {
      expect(
        state.storage.sql.exec("SELECT event FROM usage_audit ORDER BY event").toArray(),
      ).toEqual([{ event: "delete:1" }, { event: "insert:5" }]);
    });
  });

  it("replaces the maximum catalog size with bulk SQL", async () => {
    const firstCatalog = Array.from({ length: 10_000 }, (_, index) => String(index + 1));
    await expect(stub().replaceCatalog(SITE, firstCatalog, 1, NOW + 1000)).resolves.toEqual({
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
      stub().replaceCatalog(SITE, [...firstCatalog].reverse(), 2, NOW + 1500),
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
      expect(state.storage.sql.exec("SELECT * FROM usage_audit").toArray()).toEqual([]);
      state.storage.sql.exec(`
        DROP TRIGGER audit_questions_insert;
        DROP TRIGGER audit_questions_delete;
        DROP TABLE usage_audit;
      `);
    });

    const secondCatalog = Array.from({ length: 10_000 }, (_, index) => String(index + 5001));
    await expect(stub().replaceCatalog(SITE, secondCatalog, 2, NOW + 2000)).resolves.toEqual({
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
            SITE,
          )
          .toArray()[0],
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

  it("returns the v12 attempt contract for correct and incorrect answers", async () => {
    const correct = await stub().recordAttempt(SITE, "1", operationId(1), "correct", NOW);
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
        .exec("SELECT due_ms, stability FROM cards WHERE site = ? AND question_id = ?", SITE, "1")
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
      NOW + 1000,
    );
    expect(incorrect.attempt.answerResult).toBe("incorrect");
    expect(incorrect.attempt.previousCardStabilityDays).toBe(35);
    expect(incorrect.attempt.resultingCardStabilityDays).toBeLessThan(35);
    expect(incorrect.attempt.resultingStabilityDays).toBeLessThan(
      incorrect.attempt.previousStabilityDays,
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
        SITE,
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
      NOW + 1000,
    );
    expect(repeated.learningMetrics).toMatchObject({
      stabilityDays: 35,
      todayStabilityDaysDelta: 0,
      todayStudyTimeMs: 0,
      attemptedQuestionCount: 1,
      todayAttemptedQuestionCount: 1,
      todayCorrectRatePercent: 50,
    });
    await runInRawDurableObject(stub(), (_instance, state) => {
      expect(state.storage.sql.exec("SELECT * FROM usage_audit").toArray()).toEqual([
        { event: "learning_metrics" },
        { event: "stability_history" },
      ]);
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
          SITE,
        );
        return state.storage.sql
          .exec("SELECT * FROM cards WHERE site = ? AND question_id = '1'", SITE)
          .toArray()[0];
      }),
    );

    const correct = await stub().recordAttempt(SITE, "1", operationId(40), "correct", NOW);
    expect(correct.attempt).toMatchObject({
      previousCardStabilityDays: 35,
      resultingCardStabilityDays: 35,
      previousStabilityDays: 35,
      resultingStabilityDays: 35,
    });
    expect(correct.learningMetrics).toMatchObject({
      stabilityDays: 35,
      todayStabilityDaysDelta: 0,
      todayStudyTimeMs: 0,
      attemptedQuestionCount: 1,
      todayAttemptedQuestionCount: 1,
      todayCorrectRatePercent: 100,
    });

    const incorrect = await stub().recordAttempt(
      SITE,
      "1",
      operationId(41),
      "incorrect",
      NOW + 1000,
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
      todayStudyTimeMs: 0,
      attemptedQuestionCount: 1,
      todayAttemptedQuestionCount: 1,
      todayCorrectRatePercent: 50,
    });

    await runInRawDurableObject(stub(), (_instance, state) => {
      expect(
        state.storage.sql
          .exec("SELECT * FROM cards WHERE site = ? AND question_id = '1'", SITE)
          .toArray()[0],
      ).toEqual({ ...before, last_attempt_date: "2026-08-10" });
      expect(
        state.storage.sql
          .exec(
            `SELECT answer_result, previous_card_stability_days,
                    resulting_card_stability_days
             FROM attempts WHERE site = ? AND question_id = '1'
             ORDER BY attempted_at_ms`,
            SITE,
          )
          .toArray(),
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
    const result = await stub().recordAttempt(SITE, "1", operationId(42), "correct", NOW);
    expect(result.attempt.resultingCardStabilityDays).toBeGreaterThan(35);
    expect(result.attempt.resultingStabilityDays).toBeGreaterThan(
      result.attempt.previousStabilityDays,
    );
  });

  it("does not apply the same operation twice", async () => {
    const first = await stub().recordAttempt(SITE, "1", operationId(3), "correct", NOW);
    const retry = await stub().recordAttempt(SITE, "1", operationId(3), "correct", NOW + 60_000);
    expect(retry.attempt).toMatchObject({
      questionId: first.attempt.questionId,
      answerResult: first.attempt.answerResult,
      attemptedAtMs: first.attempt.attemptedAtMs,
      previousCardStabilityDays: first.attempt.previousCardStabilityDays,
      resultingCardStabilityDays: first.attempt.resultingCardStabilityDays,
    });
    expect(retry.attempt.previousStabilityDays).toBe(first.attempt.resultingStabilityDays);
    expect(retry.attempt.resultingStabilityDays).toBe(first.attempt.resultingStabilityDays);
    await runInRawDurableObject(stub(), (_instance, state) => {
      expect(
        state.storage.sql
          .exec("SELECT reps FROM cards WHERE site = ? AND question_id = '1'", SITE)
          .toArray()[0].reps,
      ).toBe(1);
      expect(
        state.storage.sql.exec("SELECT COUNT(*) AS count FROM attempts").toArray()[0].count,
      ).toBe(1);
    });
  });

  it("returns current totals when an older operation is retried", async () => {
    await seedReviewCard("1", 10);
    await seedReviewCard("2", 20);
    const first = await stub().recordAttempt(SITE, "1", operationId(4), "correct", NOW);
    const second = await stub().recordAttempt(SITE, "2", operationId(5), "correct", NOW + 1000);
    const retry = await stub().recordAttempt(SITE, "1", operationId(4), "correct", NOW + 2000);
    expect(retry.attempt).toMatchObject({
      questionId: first.attempt.questionId,
      answerResult: first.attempt.answerResult,
      attemptedAtMs: first.attempt.attemptedAtMs,
      previousCardStabilityDays: first.attempt.previousCardStabilityDays,
      resultingCardStabilityDays: first.attempt.resultingCardStabilityDays,
    });
    expect(retry.attempt.previousStabilityDays).toBe(second.learningMetrics.stabilityDays);
    expect(retry.attempt.resultingStabilityDays).toBe(second.learningMetrics.stabilityDays);
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
    await stub().recordAttempt(SITE, "2", operationId(8), "incorrect", afterMidnight + 1);

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
    const third = await stub().recordAttempt(SITE, "1", operationId(45), "correct", NOW + 2);

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
            SITE,
          )
          .toArray()[0],
      ).toEqual({ question_number: 1, attempted: 1 });
    });

    const repeated = await stub().recordAttempt(SITE, "1", operationId(47), "correct", NOW + 3);
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
    await expect(stub().recordAttempt(SITE, "2", operationId(9), "correct", NOW)).resolves.toEqual({
      error: "operation_conflict",
    });
    await expect(
      stub().recordAttempt(SITE, "1", operationId(9), "incorrect", NOW),
    ).resolves.toEqual({ error: "operation_conflict" });
  });
});

describe("study time", () => {
  it("keeps study time recorded before the first catalog registration", async () => {
    const sessionId = operationId(499);
    const initial = await stub().recordStudyTime(
      OTHER_SITE,
      [{ sessionId, date: "2026-08-10", activeMs: 90_000 }],
      NOW,
    );
    expect(initial.state).toMatchObject({
      site: OTHER_SITE,
      catalog: null,
      learningMetrics: { todayStudyTimeMs: 90_000 },
    });

    await stub().replaceCatalog(OTHER_SITE, ["1"], 0, NOW + 1);
    await expect(stub().getState(OTHER_SITE, NOW + 2)).resolves.toMatchObject({
      catalog: { questionCount: 1 },
      learningMetrics: { todayStudyTimeMs: 90_000 },
    });
  });

  it("applies cumulative session snapshots exactly once and isolates sites", async () => {
    const sessionId = operationId(500);
    const first = await stub().recordStudyTime(
      SITE,
      [{ sessionId, date: "2026-08-10", activeMs: 2 * 60_000 }],
      NOW,
    );
    expect(first.state.learningMetrics.todayStudyTimeMs).toBe(2 * 60_000);

    const advanced = await stub().recordStudyTime(
      SITE,
      [{ sessionId, date: "2026-08-10", activeMs: 5 * 60_000 }],
      NOW + 1,
    );
    expect(advanced.state.learningMetrics.todayStudyTimeMs).toBe(5 * 60_000);

    const stale = await stub().recordStudyTime(
      SITE,
      [{ sessionId, date: "2026-08-10", activeMs: 3 * 60_000 }],
      NOW + 2,
    );
    expect(stale.state.learningMetrics.todayStudyTimeMs).toBe(5 * 60_000);

    await stub().replaceCatalog(OTHER_SITE, ["1"], 0, NOW);
    const other = await stub().recordStudyTime(
      OTHER_SITE,
      [{ sessionId, date: "2026-08-10", activeMs: 7 * 60_000 }],
      NOW + 3,
    );
    expect(other.state.learningMetrics.todayStudyTimeMs).toBe(7 * 60_000);
    expect((await stub().getState(SITE, NOW + 3)).learningMetrics.todayStudyTimeMs).toBe(5 * 60_000);

    expect((await stub().getHistory(SITE, 1, NOW + 3)).days[0].dailyStudyTimeMs).toBe(5 * 60_000);
  });

  it("keeps delayed past-day study time out of today's metric and supports study-only days", async () => {
    await stub().recordStudyTime(
      SITE,
      [{ sessionId: operationId(501), date: "2026-08-10", activeMs: 2 * 60_000 }],
      NOW,
    );
    const result = await stub().recordStudyTime(
      SITE,
      [{ sessionId: operationId(502), date: "2026-08-09", activeMs: 10 * 60_000 }],
      NOW + 1,
    );
    expect(result.state.learningMetrics.todayStudyTimeMs).toBe(2 * 60_000);

    const history = await stub().getHistory(SITE, 2, NOW + 1);
    expect(history.days.map((day) => [day.date, day.dailyStudyTimeMs])).toEqual([
      ["2026-08-09", 10 * 60_000],
      ["2026-08-10", 2 * 60_000],
    ]);

    const details = await stub().getDailyDetails(SITE, "2026-08-09");
    expect(details.tables.study_time_daily).toEqual([
      { site: SITE, date: "2026-08-09", study_time_ms: 10 * 60_000 },
    ]);
    expect(details.tables.stability_history).toEqual([]);
    expect(details.tables.attempts).toEqual([]);
  });

  it("advances study time on an attempt retry without duplicating the attempt", async () => {
    const sessionId = operationId(503);
    const first = await stub().recordAttempt(
      SITE,
      "1",
      operationId(504),
      "correct",
      NOW,
      [{ sessionId, date: "2026-08-10", activeMs: 4 * 60_000 }],
    );
    const retry = await stub().recordAttempt(
      SITE,
      "1",
      operationId(504),
      "correct",
      NOW + 1,
      [{ sessionId, date: "2026-08-10", activeMs: 6 * 60_000 }],
    );
    expect(first.learningMetrics.todayStudyTimeMs).toBe(4 * 60_000);
    expect(retry.learningMetrics.todayStudyTimeMs).toBe(6 * 60_000);

    await runInRawDurableObject(stub(), (_instance, state) => {
      expect(state.storage.sql.exec("SELECT COUNT(*) AS count FROM attempts").toArray()[0].count).toBe(1);
      expect(
        state.storage.sql
          .exec("SELECT study_time_ms FROM study_time_daily WHERE site = ? AND date = ?", SITE, "2026-08-10")
          .toArray()[0],
      ).toEqual({ study_time_ms: 6 * 60_000 });
    });
  });
});

describe("daily KPI celebrations", () => {
  it("counts the first answer regardless of correctness and celebrates question 10", async () => {
    await seedTodayNewQuestionCount(9);

    await expect(stub().getState(SITE, NOW)).resolves.toMatchObject({
      learningMetrics: {
        dailyKpiCompleted: false,
        todayNewQuestionCount: 9,
        newQuestionGoal: 10,
        newQuestionsRemaining: 1,
      },
    });

    const result = await stub().recordAttempt(SITE, "1", operationId(28), "incorrect", NOW);

    expect(result.learningMetrics).toMatchObject({
      dailyKpiCompleted: true,
      dueCardsCompleted: true,
      dueCardsRemaining: 0,
      todayNewQuestionCount: 10,
      newQuestionGoal: 10,
      newQuestionsRemaining: 0,
    });
    expect(result.celebration).toEqual({
      site: SITE,
      date: "2026-08-10",
      dailyKpiCompleted: true,
    });

    const repeated = await stub().recordAttempt(SITE, "1", operationId(27), "correct", NOW + 1);
    expect(repeated.learningMetrics.todayNewQuestionCount).toBe(10);
    expect(repeated).not.toHaveProperty("celebration");
  });

  it("isolates the daily new-question goal by site", async () => {
    await stub().replaceCatalog(OTHER_SITE, ["1"], 0, NOW);
    await seedTodayNewQuestionCount(9, "2026-08-10", OTHER_SITE);

    const otherResult = await stub().recordAttempt(
      OTHER_SITE,
      "1",
      operationId(26),
      "correct",
      NOW,
    );

    expect(otherResult.learningMetrics.dailyKpiCompleted).toBe(true);
    await expect(stub().getState(SITE, NOW)).resolves.toMatchObject({
      learningMetrics: {
        dailyKpiCompleted: false,
        todayNewQuestionCount: 0,
        newQuestionsRemaining: 10,
      },
    });
  });

  it("does not celebrate when the daily KPI was already complete", async () => {
    await seedTodayNewQuestionCount(10);

    const result = await stub().recordAttempt(SITE, "1", operationId(25), "correct", NOW);

    expect(result.learningMetrics).toMatchObject({
      dailyKpiCompleted: true,
      todayNewQuestionCount: 11,
      newQuestionGoal: 10,
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

    const earlyAttempt = await stub().recordAttempt(SITE, "2", operationId(35), "correct", NOW);
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
    await seedTodayNewQuestionCount(10);
    await seedReviewCard("1", 30);
    await seedReviewCard("2", 30);
    const partial = await stub().recordAttempt(SITE, "1", operationId(29), "correct", NOW);
    expect(partial.learningMetrics.dueCardsCompleted).toBe(false);
    expect(partial.learningMetrics.dueCardsRemaining).toBe(1);
    expect(partial.learningMetrics.dailyKpiCompleted).toBe(false);
    expect(partial).not.toHaveProperty("celebration");

    const first = await stub().recordAttempt(SITE, "2", operationId(30), "correct", NOW);
    expect(first.learningMetrics.dueCardsCompleted).toBe(true);
    expect(first.learningMetrics.dueCardsRemaining).toBe(0);
    expect(first.learningMetrics.dailyKpiCompleted).toBe(true);
    expect(first.celebration).toEqual({
      site: SITE,
      date: "2026-08-10",
      dailyKpiCompleted: true,
    });

    const retry = await stub().recordAttempt(SITE, "2", operationId(30), "correct", NOW + 1000);
    expect(retry.celebration).toEqual(first.celebration);
    await runInRawDurableObject(stub(), (_instance, state) => {
      expect(state.storage.sql.exec("SELECT * FROM daily_kpi_achievements").toArray()).toEqual([
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
    await seedTodayNewQuestionCount(10);
    await seedReviewCard("1", 30);
    const first = await stub().recordAttempt(SITE, "1", operationId(31), "correct", NOW);
    expect(first).toHaveProperty("celebration");

    await seedReviewCard("2", 30, NOW + 500);
    await expect(stub().getState(SITE, NOW + 500)).resolves.toMatchObject({
      learningMetrics: {
        dailyKpiCompleted: true,
        dueCardsCompleted: false,
        dueCardsRemaining: 1,
      },
    });

    const repeated = await stub().recordAttempt(SITE, "2", operationId(32), "correct", NOW + 1000);
    expect(repeated.learningMetrics.dailyKpiCompleted).toBe(true);
    expect(repeated.learningMetrics.dueCardsCompleted).toBe(true);
    expect(repeated).not.toHaveProperty("celebration");
  });

  it("allows another celebration on the next Tokyo date", async () => {
    await seedTodayNewQuestionCount(10);
    await seedReviewCard("1", 30);
    const first = await stub().recordAttempt(SITE, "1", operationId(33), "correct", NOW);
    await seedReviewCard("2", 30, NOW + DAY_MS);
    await seedTodayNewQuestionCount(10, "2026-08-11");
    const nextDay = await stub().recordAttempt(SITE, "2", operationId(34), "correct", NOW + DAY_MS);

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
        state.storage.sql.exec("SELECT COUNT(*) AS count FROM daily_kpi_achievements").toArray()[0]
          .count,
      ).toBe(0);
    });
  });
});

describe("stability history", () => {
  it("uses opening and closing totals for the daily delta", async () => {
    const first = await stub().recordAttempt(SITE, "1", operationId(10), "correct", NOW);
    const second = await stub().recordAttempt(SITE, "2", operationId(11), "correct", NOW + 1000);
    const state = await stub().getState(SITE, NOW + 1000);
    expect(state.learningMetrics.stabilityDays).toBe(second.learningMetrics.stabilityDays);
    expect(state.learningMetrics.todayStabilityDaysDelta).toBe(
      second.learningMetrics.stabilityDays,
    );
    expect(state.learningMetrics.stabilityDays).toBeGreaterThanOrEqual(
      first.learningMetrics.stabilityDays,
    );
  });

  it("returns null before tracking starts and carries known totals forward", async () => {
    const initial = await stub().getHistory(SITE, 7, NOW);
    expect(initial.days.slice(0, 6).every((day) => day.closingStabilityDays === null)).toBe(true);
    expect(initial.days.slice(0, 6).every((day) => day.stabilityDaysDelta === null)).toBe(true);
    expect(initial.days.at(-1).closingStabilityDays).toBe(0);
    expect(initial.days.at(-1).stabilityDaysDelta).toBe(0);

    await stub().recordAttempt(SITE, "1", operationId(12), "correct", NOW);
    const afterGap = await stub().getHistory(SITE, 3, NOW + 2 * DAY_MS);
    expect(afterGap.days[0].closingStabilityDays).not.toBeNull();
    expect(afterGap.days[0].stabilityDaysDelta).toBeGreaterThan(0);
    expect(afterGap.days[1].closingStabilityDays).toBe(afterGap.days[0].closingStabilityDays);
    expect(afterGap.days[2].closingStabilityDays).toBe(afterGap.days[0].closingStabilityDays);
    expect(afterGap.days[1].stabilityDaysDelta).toBe(0);
    expect(afterGap.days[2].stabilityDaysDelta).toBe(0);
  });

  it("starts a new opening total at the Tokyo date boundary", async () => {
    await seedReviewCard("1", 35, NOW - 1000, NOW);
    const nextDay = NOW + DAY_MS;
    const before = (await stub().getState(SITE, nextDay)).learningMetrics.stabilityDays;
    await stub().recordAttempt(SITE, "1", operationId(13), "incorrect", nextDay);
    const after = await stub().getState(SITE, nextDay);
    expect(after.learningMetrics.todayStabilityDaysDelta).toBe(
      after.learningMetrics.stabilityDays - before,
    );
    expect((await stub().getHistory(SITE, 2, nextDay)).days.at(-1).stabilityDaysDelta).toBeLessThan(
      0,
    );
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
    const later = await stub().recordAttempt(SITE, "1", operationId(16), "correct", NOW + 2000);
    const earlier = await stub().recordAttempt(SITE, "2", operationId(17), "incorrect", NOW + 1000);

    await expect(stub().getDailyDetails(SITE, "2026-08-10")).resolves.toEqual({
      site: SITE,
      date: "2026-08-10",
      timeZone: "Asia/Tokyo",
      tables: {
        study_time_daily: [],
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
      tables: { study_time_daily: [], stability_history: [], attempts: [] },
    });
  });

  it("uses Tokyo midnight when selecting attempts", async () => {
    const beforeMidnight = Date.parse("2026-08-10T14:59:59.999Z");
    const afterMidnight = Date.parse("2026-08-10T15:00:00.000Z");
    await stub().recordAttempt(SITE, "1", operationId(18), "correct", beforeMidnight);
    await stub().recordAttempt(SITE, "2", operationId(19), "correct", afterMidnight);

    expect(
      (await stub().getDailyDetails(SITE, "2026-08-10")).tables.attempts.map(
        (row) => row.operation_id,
      ),
    ).toEqual([operationId(18)]);
    expect(
      (await stub().getDailyDetails(SITE, "2026-08-11")).tables.attempts.map(
        (row) => row.operation_id,
      ),
    ).toEqual([operationId(19)]);
  });
});

describe("v12 HTTP contract", () => {
  it("does not expose older API versions", async () => {
    for (const version of ["v3", "v4", "v5", "v6", "v7", "v8", "v9", "v10"]) {
      const response = await SELF.fetch(`https://example.test/${version}/state?site=${SITE}`, {
        headers: AUTHORIZATION,
      });
      expect(response.status).toBe(404);
    }
  });

  it("requires the configured bearer token", async () => {
    for (const url of [
      "https://example.test/v12/sites",
      `https://example.test/v12/daily-details?site=${SITE}&date=2026-08-10`,
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
    const sites = await SELF.fetch("https://example.test/v12/sites", {
      headers: AUTHORIZATION,
    });
    await expect(sites.json()).resolves.toEqual({ sites: [SITE] });

    const state = await SELF.fetch(`https://example.test/v12/state?site=${SITE}`, {
      headers: AUTHORIZATION,
    });
    expect(state.status).toBe(200);
    const stateBody = await state.json();
    expect(Object.keys(stateBody).sort()).toEqual(["catalog", "learningMetrics", "site", "today"]);
    expect(stateBody).toMatchObject({
      site: SITE,
      learningMetrics: {
        stabilityDays: 0,
        dailyKpiCompleted: false,
        dueCardsCompleted: true,
        dueCardsRemaining: 0,
        todayNewQuestionCount: 0,
        newQuestionGoal: 10,
        newQuestionsRemaining: 10,
        todayStabilityDaysDelta: 0,
        todayStudyTimeMs: 0,
        attemptedQuestionCount: 0,
        todayAttemptedQuestionCount: 0,
        todayCorrectRatePercent: null,
      },
      catalog: { questionCount: 4, generation: 1 },
    });
    expect(stateBody.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const history = await SELF.fetch(`https://example.test/v12/history?site=${SITE}&days=7`, {
      headers: AUTHORIZATION,
    });
    expect(history.status).toBe(200);
    const historyBody = await history.json();
    expect(historyBody.days).toHaveLength(7);
    expect(historyBody.days.at(-1)).toEqual({
      date: expect.any(String),
      closingStabilityDays: 0,
      stabilityDaysDelta: 0,
      dailyAttemptedQuestionCount: 0,
      dailyNewQuestionCount: 0,
      dailyStudyTimeMs: 0,
      dailyCorrectRatePercent: null,
    });

    const details = await SELF.fetch(
      `https://example.test/v12/daily-details?site=${SITE}&date=2026-08-10`,
      { headers: AUTHORIZATION },
    );
    expect(details.status).toBe(200);
    await expect(details.json()).resolves.toMatchObject({
      site: SITE,
      date: "2026-08-10",
      timeZone: "Asia/Tokyo",
      tables: { study_time_daily: [], stability_history: [expect.any(Object)], attempts: [] },
    });
  });

  it("returns all dashboard reads through one endpoint", async () => {
    const response = await SELF.fetch(`https://example.test/v12/dashboard?site=${SITE}`, {
      headers: AUTHORIZATION,
    });
    expect(response.status).toBe(200);
    const dashboardBody = await response.json();
    expect(dashboardBody).toMatchObject({
      sites: [SITE],
      selectedSite: SITE,
      state: { site: SITE, learningMetrics: { stabilityDays: 0 } },
      history: { site: SITE, days: expect.any(Array) },
    });
    expect(dashboardBody.history.days).toHaveLength(31);

    const selectedDefault = await SELF.fetch("https://example.test/v12/dashboard", {
      headers: AUTHORIZATION,
    });
    await expect(selectedDefault.json()).resolves.toMatchObject({
      sites: [SITE],
      selectedSite: SITE,
    });

    for (const search of ["site=invalid.example", `site=${SITE}&site=${SITE}`, "extra=true"]) {
      const invalid = await SELF.fetch(`https://example.test/v12/dashboard?${search}`, {
        headers: AUTHORIZATION,
      });
      expect(invalid.status).toBe(400);
    }

    await runInRawDurableObject(stub(), (_instance, state) => {
      state.storage.sql.exec("DELETE FROM catalog_metadata");
    });
    const empty = await SELF.fetch("https://example.test/v12/dashboard", {
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
      const response = await SELF.fetch(`https://example.test/v12/daily-details?${search}`, {
        headers: AUTHORIZATION,
      });
      expect(response.status).toBe(400);
    }
  });

  it("replaces the catalog and serves the canonical next URL", async () => {
    const replace = await SELF.fetch("https://example.test/v12/questions", {
      method: "POST",
      headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
      body: JSON.stringify({
        site: SITE,
        questionIds: ["44615", "44614"],
        expectedGeneration: 1,
      }),
    });
    expect(replace.status).toBe(200);

    const next = await SELF.fetch(`https://example.test/v12/next?site=${SITE}`, {
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
    expect(nextBody.state.learningMetrics.newQuestionGoal).toBe(10);

    const conflict = await SELF.fetch("https://example.test/v12/questions", {
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
      { site: SITE, questionIds: ["9223372036854775808"], expectedGeneration: 2 },
      { site: SITE, questionIds: ["1"], expectedGeneration: -1 },
      { site: SITE, questionIds: ["1"] },
    ]) {
      const invalid = await SELF.fetch("https://example.test/v12/questions", {
        method: "POST",
        headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(invalid.status).toBe(400);
    }
  });

  it("rejects unknown questions and non-canonical attempt fields", async () => {
    const unknown = await SELF.fetch("https://example.test/v12/attempts", {
      method: "POST",
      headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
      body: JSON.stringify({
        site: SITE,
        questionId: "999",
        operationId: operationId(14),
        answerResult: "correct",
        studyTimeSnapshots: [],
      }),
    });
    expect(unknown.status).toBe(409);
    await expect(unknown.json()).resolves.toEqual({ error: "unknown_question" });

    const extra = await SELF.fetch("https://example.test/v12/attempts", {
      method: "POST",
      headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
      body: JSON.stringify({
        site: SITE,
        questionId: "1",
        operationId: operationId(15),
        answerResult: "correct",
        studyTimeSnapshots: [],
        attemptedAtMs: NOW,
      }),
    });
    expect(extra.status).toBe(400);

    const legacyKey = await SELF.fetch("https://example.test/v12/attempts", {
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

  it("records study time through the exact v12 endpoint", async () => {
    const body = {
      site: SITE,
      studyTimeSnapshots: [
        { sessionId: operationId(600), date: getTokyoDate(new Date()), activeMs: 90_000 },
      ],
    };
    const response = await SELF.fetch("https://example.test/v12/study-time", {
      method: "POST",
      headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      state: {
        site: SITE,
        learningMetrics: { todayStudyTimeMs: 90_000 },
      },
    });

    const replay = await SELF.fetch("https://example.test/v12/study-time", {
      method: "POST",
      headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await expect(replay.json()).resolves.toMatchObject({
      state: { learningMetrics: { todayStudyTimeMs: 90_000 } },
    });

    for (const invalidBody of [
      { site: SITE, studyTimeSnapshots: [] },
      { site: SITE, studyTimeSnapshots: [{ ...body.studyTimeSnapshots[0], extra: true }] },
      { site: SITE, studyTimeSnapshots: [{ ...body.studyTimeSnapshots[0], activeMs: -1 }] },
    ]) {
      const invalid = await SELF.fetch("https://example.test/v12/study-time", {
        method: "POST",
        headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
        body: JSON.stringify(invalidBody),
      });
      expect(invalid.status).toBe(400);
    }
  });

  it("returns the exact v12 attempt contract", async () => {
    const response = await SELF.fetch("https://example.test/v12/attempts", {
      method: "POST",
      headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
      body: JSON.stringify({
        site: SITE,
        questionId: "1",
        operationId: operationId(21),
        answerResult: "correct",
        studyTimeSnapshots: [],
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
        newQuestionGoal: 10,
        newQuestionsRemaining: 9,
        todayStabilityDaysDelta: expect.any(Number),
        todayStudyTimeMs: 0,
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
    await seedTodayNewQuestionCount(10, getTokyoDate(new Date()));

    const body = {
      site: SITE,
      questionId: "1",
      operationId: operationId(22),
      answerResult: "correct",
      studyTimeSnapshots: [],
    };
    const response = await SELF.fetch("https://example.test/v12/attempts", {
      method: "POST",
      headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(Object.keys(result.celebration).sort()).toEqual(["dailyKpiCompleted", "date", "site"]);
    expect(result.celebration).toEqual({
      site: SITE,
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      dailyKpiCompleted: true,
    });

    const retry = await SELF.fetch("https://example.test/v12/attempts", {
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
    const response = await SELF.fetch(`https://example.test/v12/next?site=${SITE}`, {
      headers: AUTHORIZATION,
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "catalog_missing" });
  });
});
