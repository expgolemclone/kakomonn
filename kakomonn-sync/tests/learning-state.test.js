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

function operationId(value) {
  return value.toString(16).padStart(32, "0");
}

function stub() {
  return env.LEARNING_STATE.get(env.LEARNING_STATE.idFromName("primary"));
}

async function reset() {
  const raw = stub();
  await runInRawDurableObject(raw, (_instance, state) => {
    for (const table of [
      "attempts",
      "stability_history",
      "cards",
      "questions",
      "site_settings",
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
  });
}

beforeEach(reset);

describe("LearningState schema", () => {
  it("installs query indexes idempotently", async () => {
    await runInRawDurableObject(stub(), (_instance, state) => {
      initializeLearningSchema(state.storage, NOW);
      state.storage.sql.exec(
        "CREATE INDEX IF NOT EXISTS attempts_by_site ON attempts (site)"
      );
      initializeLearningSchema(state.storage, NOW);
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
        "cards_by_site_stability",
      ]);
    });
  });

  it("migrates legacy v4 data to schema v3 without retaining threshold-based fields", async () => {
    await runInRawDurableObject(stub(), (_instance, state) => {
      state.storage.sql.exec(`
        DROP TABLE attempts;
        DROP TABLE stability_history;
        DROP TABLE cards;
        DROP TABLE questions;
        DROP TABLE site_settings;
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
      ).toEqual({ version: 3 });
      expect(
        state.storage.sql.exec("SELECT * FROM stability_history").toArray()[0]
      ).toEqual({
        site: SITE,
        date: "2026-08-10",
        opening_stability_days: 12,
        closing_stability_days: 12,
      });
      expect(
        state.storage.sql.exec("SELECT * FROM site_settings").toArray()[0]
      ).toEqual({ site: SITE, daily_stability_days_delta_goal: 30 });
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

  it("migrates schema v2 data to v3 without losing rows", async () => {
    await runInRawDurableObject(stub(), (_instance, state) => {
      state.storage.sql.exec(`
        DROP TABLE attempts;
        DROP TABLE stability_history;
        DROP TABLE cards;
        DROP TABLE questions;
        DROP TABLE site_settings;
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
      ).toEqual({ version: 3 });
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
        state.storage.sql.exec("SELECT * FROM site_settings").toArray()[0]
      ).toEqual({ site: SITE, daily_stability_days_delta_goal: 45 });
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
});

describe("learning metrics", () => {
  it("maps answer results to FSRS ratings", () => {
    expect(ratingForResult("correct")).toBe(Rating.Good);
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
      learningMetrics: { stabilityDays: 16 },
      catalog: { questionCount: 4 },
    });

    await stub().replaceCatalog(SITE, ["2", "3", "4"], 1, NOW);
    await expect(stub().getState(SITE, NOW)).resolves.toMatchObject({
      learningMetrics: { stabilityDays: 3, todayStabilityDaysDelta: 3 },
      catalog: { questionCount: 3, generation: 2 },
    });
  });

  it("returns the v7 attempt contract for correct and incorrect answers", async () => {
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
    });
    expect(correct.learningMetrics).toHaveProperty("stabilityDays");
    expect(correct.learningMetrics).toHaveProperty("todayStabilityDaysDelta");

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
  });
});

describe("attempt idempotency and attempted question totals", () => {
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
      },
    });
    await expect(stub().getHistory(SITE, 2, afterMidnight + 1)).resolves.toMatchObject({
      days: [
        { date: "2026-08-10", dailyAttemptedQuestionCount: 1 },
        { date: "2026-08-11", dailyAttemptedQuestionCount: 2 },
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

describe("site settings", () => {
  it("stores an independent goal for each site", async () => {
    await stub().replaceCatalog(OTHER_SITE, ["1"], 0, NOW);
    await expect(stub().getSettings(SITE)).resolves.toEqual({
      site: SITE,
      dailyStabilityDaysDeltaGoal: 30,
    });
    await expect(stub().getSettings(OTHER_SITE)).resolves.toEqual({
      site: OTHER_SITE,
      dailyStabilityDaysDeltaGoal: 30,
    });
    await expect(stub().updateSettings(SITE, 250)).resolves.toEqual({
      site: SITE,
      dailyStabilityDaysDeltaGoal: 250,
    });
    await expect(stub().getSettings(OTHER_SITE)).resolves.toEqual({
      site: OTHER_SITE,
      dailyStabilityDaysDeltaGoal: 30,
    });
  });

  it("serves and validates the v7 settings contract", async () => {
    const first = await SELF.fetch(`https://example.test/v7/settings?site=${SITE}`, {
      headers: AUTHORIZATION,
    });
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toEqual({
      site: SITE,
      dailyStabilityDaysDeltaGoal: 30,
    });

    const updated = await SELF.fetch("https://example.test/v7/settings", {
      method: "PUT",
      headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
      body: JSON.stringify({ site: SITE, dailyStabilityDaysDeltaGoal: 1000 }),
    });
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toEqual({
      site: SITE,
      dailyStabilityDaysDeltaGoal: 1000,
    });

    for (const body of [
      { site: SITE, dailyStabilityDaysDeltaGoal: 0 },
      { site: SITE, dailyStabilityDaysDeltaGoal: 1.5 },
      { site: SITE, dailyStabilityDaysDeltaGoal: 5, extra: true },
      { site: "invalid.example", dailyStabilityDaysDeltaGoal: 5 },
      { site: SITE, dailyStabilityDaysGoal: 5 },
    ]) {
      const response = await SELF.fetch("https://example.test/v7/settings", {
        method: "PUT",
        headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
  });
});

describe("v7 HTTP contract", () => {
  it("does not expose older API versions", async () => {
    for (const version of ["v3", "v4", "v5", "v6"]) {
      const response = await SELF.fetch(
        `https://example.test/${version}/state?site=${SITE}`,
        { headers: AUTHORIZATION }
      );
      expect(response.status).toBe(404);
    }
  });

  it("requires the configured bearer token", async () => {
    for (const url of [
      "https://example.test/v7/sites",
      `https://example.test/v7/daily-details?site=${SITE}&date=2026-08-10`,
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
    const sites = await SELF.fetch("https://example.test/v7/sites", {
      headers: AUTHORIZATION,
    });
    await expect(sites.json()).resolves.toEqual({ sites: [SITE] });

    const state = await SELF.fetch(`https://example.test/v7/state?site=${SITE}`, {
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
        todayStabilityDaysDelta: 0,
        attemptedQuestionCount: 0,
        todayAttemptedQuestionCount: 0,
      },
      catalog: { questionCount: 4, generation: 1 },
    });
    expect(stateBody.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const history = await SELF.fetch(
      `https://example.test/v7/history?site=${SITE}&days=7`,
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
    });

    const details = await SELF.fetch(
      `https://example.test/v7/daily-details?site=${SITE}&date=2026-08-10`,
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

  it("validates the daily details query", async () => {
    for (const search of [
      `site=${SITE}`,
      `site=${SITE}&date=2026-02-30`,
      `site=${SITE}&date=2026-08-10&date=2026-08-11`,
      `site=invalid.example&date=2026-08-10`,
      `site=${SITE}&date=2026-08-10&extra=true`,
    ]) {
      const response = await SELF.fetch(
        `https://example.test/v7/daily-details?${search}`,
        { headers: AUTHORIZATION }
      );
      expect(response.status).toBe(400);
    }
  });

  it("replaces the catalog and serves the canonical next URL", async () => {
    const replace = await SELF.fetch("https://example.test/v7/questions", {
      method: "POST",
      headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
      body: JSON.stringify({
        site: SITE,
        questionIds: ["44615", "44614"],
        expectedGeneration: 1,
      }),
    });
    expect(replace.status).toBe(200);

    const next = await SELF.fetch(`https://example.test/v7/next?site=${SITE}`, {
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

    const conflict = await SELF.fetch("https://example.test/v7/questions", {
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
      const invalid = await SELF.fetch("https://example.test/v7/questions", {
        method: "POST",
        headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(invalid.status).toBe(400);
    }
  });

  it("rejects unknown questions and non-canonical attempt fields", async () => {
    const unknown = await SELF.fetch("https://example.test/v7/attempts", {
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

    const extra = await SELF.fetch("https://example.test/v7/attempts", {
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

    const legacyKey = await SELF.fetch("https://example.test/v7/attempts", {
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

  it("returns the exact v7 attempt contract", async () => {
    const response = await SELF.fetch("https://example.test/v7/attempts", {
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
        todayStabilityDaysDelta: expect.any(Number),
        attemptedQuestionCount: 1,
        todayAttemptedQuestionCount: 1,
      },
    });
  });

  it("returns catalog_missing without a scheduling fallback", async () => {
    await runInRawDurableObject(stub(), (_instance, state) => {
      state.storage.sql.exec("DELETE FROM questions WHERE site = ?", SITE);
      state.storage.sql.exec("DELETE FROM catalog_metadata WHERE site = ?", SITE);
    });
    const response = await SELF.fetch(
      `https://example.test/v7/next?site=${SITE}`,
      { headers: AUTHORIZATION }
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "catalog_missing" });
  });
});
