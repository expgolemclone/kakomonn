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
          "attempts_by_site_answered_at_question",
          "cards_by_site_due",
          "cards_by_site_stability"
        )
        .toArray()
        .map((row) => row.name);
      expect(indexes).toEqual([
        "attempts_by_site_answered_at_question",
        "cards_by_site_due",
        "cards_by_site_stability",
      ]);
    });
  });

  it("migrates v4 data without retaining threshold-based fields", async () => {
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
      ).toEqual({ version: 2 });
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
      ).toEqual({ site: SITE, daily_stability_days_goal: 30 });
      expect(
        state.storage.sql.exec("SELECT * FROM attempts").toArray()[0]
      ).toEqual({
        site: SITE,
        operation_id: operationId(900),
        question_id: "1",
        answered_at_ms: NOW,
        result: "correct",
        previous_stability: 10,
        resulting_stability: 12.9,
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
});

describe("FSRS stability days", () => {
  it("maps answer results to FSRS ratings", () => {
    expect(ratingForResult("correct")).toBe(Rating.Good);
    expect(ratingForResult("incorrect")).toBe(Rating.Again);
  });

  it("sums raw stability before flooring once", async () => {
    await seedReviewCard("1", 1.9);
    await seedReviewCard("2", 2.8);
    await expect(stub().getState(SITE, NOW)).resolves.toMatchObject({
      stabilityDays: 4,
    });
  });

  it("counts only current catalog cards and treats unseen questions as zero", async () => {
    await seedReviewCard("1", 12.9);
    await seedReviewCard("2", 3.2);
    await expect(stub().getState(SITE, NOW)).resolves.toMatchObject({
      stabilityDays: 16,
      catalog: { questionCount: 4 },
    });

    await stub().replaceCatalog(SITE, ["2", "3", "4"], 1, NOW);
    await expect(stub().getState(SITE, NOW)).resolves.toMatchObject({
      stabilityDays: 3,
      todayStabilityDaysDelta: 3,
      catalog: { questionCount: 3, generation: 2 },
    });
  });

  it("returns the new attempt contract for correct and incorrect answers", async () => {
    const correct = await stub().recordAttempt(
      SITE,
      "1",
      operationId(1),
      "correct",
      NOW
    );
    expect(correct.attempt).toMatchObject({
      questionId: "1",
      result: "correct",
      previousStability: 0,
    });
    expect(correct.attempt.stability).toBeGreaterThan(0);
    expect(correct.attempt).not.toHaveProperty("masteryDelta");
    expect(correct).not.toHaveProperty("completedMilestone");
    expect(correct.totals).toMatchObject({ solved: 1, todaySolved: 1 });
    expect(correct.totals).toHaveProperty("stabilityDays");

    await seedReviewCard("2", 35, NOW - 1000, NOW);
    const incorrect = await stub().recordAttempt(
      SITE,
      "2",
      operationId(2),
      "incorrect",
      NOW + 1000
    );
    expect(incorrect.attempt.result).toBe("incorrect");
    expect(incorrect.attempt.stability).toBeLessThan(35);
  });
});

describe("attempt idempotency and solved totals", () => {
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
    expect(retry).toEqual(first);
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
    expect(retry.attempt).toEqual(first.attempt);
    expect(retry.totals).toEqual(second.totals);
  });

  it("counts distinct solved questions by lifetime and Tokyo date", async () => {
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
      solved: 2,
      todaySolved: 2,
    });
    await expect(stub().getHistory(SITE, 2, afterMidnight + 1)).resolves.toMatchObject({
      days: [
        { date: "2026-08-10", solved: 1 },
        { date: "2026-08-11", solved: 2 },
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
    expect(state.stabilityDays).toBe(second.totals.stabilityDays);
    expect(state.todayStabilityDaysDelta).toBe(second.totals.stabilityDays);
    expect(state.stabilityDays).toBeGreaterThanOrEqual(first.totals.stabilityDays);
  });

  it("returns null before tracking starts and carries known totals forward", async () => {
    const initial = await stub().getHistory(SITE, 7, NOW);
    expect(initial.days.slice(0, 6).every((day) => day.stabilityDays === null)).toBe(
      true
    );
    expect(initial.days.at(-1).stabilityDays).toBe(0);

    await stub().recordAttempt(SITE, "1", operationId(12), "correct", NOW);
    const afterGap = await stub().getHistory(SITE, 3, NOW + 2 * DAY_MS);
    expect(afterGap.days[0].stabilityDays).not.toBeNull();
    expect(afterGap.days[1].stabilityDays).toBe(afterGap.days[0].stabilityDays);
    expect(afterGap.days[2].stabilityDays).toBe(afterGap.days[0].stabilityDays);
  });

  it("starts a new opening total at the Tokyo date boundary", async () => {
    await seedReviewCard("1", 35, NOW - 1000, NOW);
    const nextDay = NOW + DAY_MS;
    const before = (await stub().getState(SITE, nextDay)).stabilityDays;
    await stub().recordAttempt(
      SITE,
      "1",
      operationId(13),
      "incorrect",
      nextDay
    );
    const after = await stub().getState(SITE, nextDay);
    expect(after.todayStabilityDaysDelta).toBe(after.stabilityDays - before);
  });
});

describe("site settings", () => {
  it("stores an independent goal for each site", async () => {
    await stub().replaceCatalog(OTHER_SITE, ["1"], 0, NOW);
    await expect(stub().getSettings(SITE)).resolves.toEqual({
      site: SITE,
      dailyStabilityDaysGoal: 30,
    });
    await expect(stub().getSettings(OTHER_SITE)).resolves.toEqual({
      site: OTHER_SITE,
      dailyStabilityDaysGoal: 30,
    });
    await expect(stub().updateSettings(SITE, 250)).resolves.toEqual({
      site: SITE,
      dailyStabilityDaysGoal: 250,
    });
    await expect(stub().getSettings(OTHER_SITE)).resolves.toEqual({
      site: OTHER_SITE,
      dailyStabilityDaysGoal: 30,
    });
  });

  it("serves and validates the v5 settings contract", async () => {
    const first = await SELF.fetch(`https://example.test/v5/settings?site=${SITE}`, {
      headers: AUTHORIZATION,
    });
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toEqual({
      site: SITE,
      dailyStabilityDaysGoal: 30,
    });

    const updated = await SELF.fetch("https://example.test/v5/settings", {
      method: "PUT",
      headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
      body: JSON.stringify({ site: SITE, dailyStabilityDaysGoal: 1000 }),
    });
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toEqual({
      site: SITE,
      dailyStabilityDaysGoal: 1000,
    });

    for (const body of [
      { site: SITE, dailyStabilityDaysGoal: 0 },
      { site: SITE, dailyStabilityDaysGoal: 1.5 },
      { site: SITE, dailyStabilityDaysGoal: 5, extra: true },
      { site: "invalid.example", dailyStabilityDaysGoal: 5 },
    ]) {
      const response = await SELF.fetch("https://example.test/v5/settings", {
        method: "PUT",
        headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
  });
});

describe("v5 HTTP contract", () => {
  it("does not expose older API versions", async () => {
    for (const version of ["v3", "v4"]) {
      const response = await SELF.fetch(
        `https://example.test/${version}/state?site=${SITE}`,
        { headers: AUTHORIZATION }
      );
      expect(response.status).toBe(404);
    }
  });

  it("requires the configured bearer token", async () => {
    const url = "https://example.test/v5/sites";
    const missing = await SELF.fetch(url);
    const incorrect = await SELF.fetch(url, {
      headers: { Authorization: "Bearer incorrect-token" },
    });
    expect(missing.status).toBe(401);
    expect(incorrect.status).toBe(401);
  });

  it("lists sites and returns state and history", async () => {
    const sites = await SELF.fetch("https://example.test/v5/sites", {
      headers: AUTHORIZATION,
    });
    await expect(sites.json()).resolves.toEqual({ sites: [SITE] });

    const state = await SELF.fetch(`https://example.test/v5/state?site=${SITE}`, {
      headers: AUTHORIZATION,
    });
    expect(state.status).toBe(200);
    await expect(state.json()).resolves.toMatchObject({
      site: SITE,
      stabilityDays: 0,
      solved: 0,
      todaySolved: 0,
      todayStabilityDaysDelta: 0,
      catalog: { questionCount: 4, generation: 1 },
    });

    const history = await SELF.fetch(
      `https://example.test/v5/history?site=${SITE}&days=7`,
      { headers: AUTHORIZATION }
    );
    expect(history.status).toBe(200);
    expect((await history.json()).days).toHaveLength(7);
  });

  it("replaces the catalog and serves the canonical next URL", async () => {
    const replace = await SELF.fetch("https://example.test/v5/questions", {
      method: "POST",
      headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
      body: JSON.stringify({
        site: SITE,
        questionIds: ["44615", "44614"],
        expectedGeneration: 1,
      }),
    });
    expect(replace.status).toBe(200);

    const next = await SELF.fetch(`https://example.test/v5/next?site=${SITE}`, {
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
  });

  it("rejects unknown questions and extra attempt fields", async () => {
    const unknown = await SELF.fetch("https://example.test/v5/attempts", {
      method: "POST",
      headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
      body: JSON.stringify({
        site: SITE,
        questionId: "999",
        operationId: operationId(14),
        result: "correct",
      }),
    });
    expect(unknown.status).toBe(409);
    await expect(unknown.json()).resolves.toEqual({ error: "unknown_question" });

    const extra = await SELF.fetch("https://example.test/v5/attempts", {
      method: "POST",
      headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
      body: JSON.stringify({
        site: SITE,
        questionId: "1",
        operationId: operationId(15),
        result: "correct",
        answeredAtMs: NOW,
      }),
    });
    expect(extra.status).toBe(400);
  });

  it("returns catalog_missing without a scheduling fallback", async () => {
    await runInRawDurableObject(stub(), (_instance, state) => {
      state.storage.sql.exec("DELETE FROM questions WHERE site = ?", SITE);
      state.storage.sql.exec("DELETE FROM catalog_metadata WHERE site = ?", SITE);
    });
    const response = await SELF.fetch(
      `https://example.test/v5/next?site=${SITE}`,
      { headers: AUTHORIZATION }
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "catalog_missing" });
  });
});
