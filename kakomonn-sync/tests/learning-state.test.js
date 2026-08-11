import {
  env,
  runInDurableObject as runInRawDurableObject,
  SELF,
} from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { masteryDelta, ratingForResult } from "../src/fsrs.js";
import { initializeLearningSchema } from "../src/storage/schema.js";
import { Rating } from "ts-fsrs";

const SITE = "chushoks.kakomonn.com";
const OTHER_SITE = "shindans.kakomonn.com";
const TOKEN = "test-sync-token";
const AUTHORIZATION = { Authorization: `Bearer ${TOKEN}` };
const NOW = Date.parse("2026-08-10T00:00:00.000Z");

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
      "mastery_history",
      "cards",
      "questions",
      "learning_metadata",
      "catalog_metadata",
    ]) {
      state.storage.sql.exec(`DELETE FROM ${table}`);
    }
  });
  await raw.replaceCatalog(SITE, ["1", "2", "3", "4"], 0, NOW);
  await raw.updateSettings(5);
}

async function seedReviewCard(
  questionId,
  stability,
  dueMs = NOW - 1000,
  lastReviewMs = NOW - 30 * 86_400_000
) {
  await runInRawDurableObject(stub(), (_instance, state) => {
    state.storage.sql.exec(
      `INSERT INTO cards (
         site, question_id, due_ms, stability, difficulty, scheduled_days,
         learning_steps, reps, lapses, state, last_review_ms
       ) VALUES (?, ?, ?, ?, 5, 30, 0, 5, 0, 2, ?)`,
      SITE,
      questionId,
      dueMs,
      stability,
      lastReviewMs
    );
  });
}

beforeEach(reset);

describe("LearningState schema", () => {
  it("installs query indexes idempotently for existing objects", async () => {
    await runInRawDurableObject(stub(), (_instance, state) => {
      initializeLearningSchema(state.storage);
      initializeLearningSchema(state.storage);
      const indexes = state.storage.sql
        .exec(
          `SELECT name FROM sqlite_master
           WHERE type = 'index' AND name IN (?, ?, ?)
           ORDER BY name`,
          "attempts_by_site",
          "cards_by_site_due",
          "cards_by_site_stability",
        )
        .toArray()
        .map((row) => row.name);
      expect(indexes).toEqual([
        "attempts_by_site",
        "cards_by_site_due",
        "cards_by_site_stability",
      ]);
    });
  });
});

describe("FSRS integration", () => {
  it("maps correct to Rating.Good and incorrect to Rating.Again", () => {
    expect(ratingForResult("correct")).toBe(Rating.Good);
    expect(ratingForResult("incorrect")).toBe(Rating.Again);
  });

  it("creates a new card and schedules correct with Good", async () => {
    const result = await stub().recordAttempt(SITE, "1", operationId(1), "correct", NOW);
    expect(result.attempt).toMatchObject({
      questionId: "1",
      result: "correct",
      previousStability: 0,
      masteryDelta: 0,
    });
    expect(result.attempt.stability).toBeGreaterThan(0);
    await runInRawDurableObject(stub(), (_instance, state) => {
      const card = state.storage.sql.exec("SELECT * FROM cards WHERE site = ? AND question_id = ?", SITE, "1").toArray()[0];
      expect(card.reps).toBe(1);
      expect(card.stability).toBe(result.attempt.stability);
    });
  });

  it("creates a new card and schedules incorrect with Again", async () => {
    const result = await stub().recordAttempt(SITE, "1", operationId(2), "incorrect", NOW);
    expect(result.attempt).toMatchObject({
      questionId: "1",
      result: "incorrect",
      previousStability: 0,
      masteryDelta: 0,
    });
    expect(result.attempt.stability).toBeGreaterThan(0);
  });

  it("uses only stability 30 as the mastery threshold", () => {
    expect(masteryDelta(29.999, 30)).toBe(1);
    expect(masteryDelta(30, 29.999)).toBe(-1);
    expect(masteryDelta(30, 31)).toBe(0);
    expect(masteryDelta(4, 29)).toBe(0);
  });

  it("increments stock when FSRS crosses from below 30 to at least 30", async () => {
    await seedReviewCard("1", 29);
    const result = await stub().recordAttempt(SITE, "1", operationId(3), "correct", NOW);
    expect(result.attempt.previousStability).toBe(29);
    expect(result.attempt.stability).toBeGreaterThanOrEqual(30);
    expect(result.attempt.masteryDelta).toBe(1);
    expect(result.totals.mastered).toBe(1);
  });

  it("decrements stock when FSRS crosses from at least 30 to below 30", async () => {
    await seedReviewCard("1", 35);
    const result = await stub().recordAttempt(SITE, "1", operationId(4), "incorrect", NOW);
    expect(result.attempt.previousStability).toBe(35);
    expect(result.attempt.stability).toBeLessThan(30);
    expect(result.attempt.masteryDelta).toBe(-1);
    expect(result.totals.mastered).toBe(0);
  });

  it("does not change stock when before and after are both mastered", async () => {
    await seedReviewCard("1", 35);
    const result = await stub().recordAttempt(SITE, "1", operationId(5), "correct", NOW);
    expect(result.attempt.stability).toBeGreaterThanOrEqual(30);
    expect(result.attempt.masteryDelta).toBe(0);
    expect(result.totals.mastered).toBe(1);
  });

  it("keeps an incorrect answer mastered when FSRS still returns stability at least 30", async () => {
    await seedReviewCard("1", 1000, NOW - 1000, NOW);
    const result = await stub().recordAttempt(SITE, "1", operationId(16), "incorrect", NOW);
    expect(result.attempt.result).toBe("incorrect");
    expect(result.attempt.stability).toBeGreaterThanOrEqual(30);
    expect(result.attempt.masteryDelta).toBe(0);
    expect(result.totals.mastered).toBe(1);
  });
});

describe("attempt idempotency", () => {
  it("returns the same result for the same operation and does not update twice", async () => {
    const first = await stub().recordAttempt(SITE, "1", operationId(6), "correct", NOW);
    const retry = await stub().recordAttempt(SITE, "1", operationId(6), "correct", NOW + 60_000);
    expect(retry).toEqual(first);
    await runInRawDurableObject(stub(), (_instance, state) => {
      const card = state.storage.sql.exec("SELECT reps FROM cards WHERE site = ? AND question_id = ?", SITE, "1").toArray()[0];
      const attempts = state.storage.sql.exec("SELECT COUNT(*) AS count FROM attempts WHERE site = ?", SITE).toArray()[0];
      expect(card.reps).toBe(1);
      expect(attempts.count).toBe(1);
    });
    await expect(stub().getState(SITE, NOW + 60_000)).resolves.toMatchObject({
      attempted: 1,
    });
  });

  it("returns current mastery stock when an old operation is retried after another device updates the site", async () => {
    await seedReviewCard("1", 29);
    await seedReviewCard("2", 29);
    const first = await stub().recordAttempt(SITE, "1", operationId(61), "correct", NOW);
    const second = await stub().recordAttempt(SITE, "2", operationId(62), "correct", NOW + 1_000);
    const retry = await stub().recordAttempt(SITE, "1", operationId(61), "correct", NOW + 2_000);

    expect(first.totals.mastered).toBe(1);
    expect(second.totals.mastered).toBe(2);
    expect(retry.attempt).toEqual(first.attempt);
    expect(retry.completedMilestone).toBe(first.completedMilestone);
    expect(retry.totals.mastered).toBe(2);
    await expect(stub().getState(SITE, NOW + 2_000)).resolves.toMatchObject({
      mastered: 2,
      attempted: 2,
    });

    await runInRawDurableObject(stub(), (_instance, state) => {
      const attempts = state.storage.sql.exec("SELECT COUNT(*) AS count FROM attempts WHERE site = ?", SITE).toArray()[0];
      expect(attempts.count).toBe(2);
    });
  });

  it("returns conflict for the same operationId with a different payload", async () => {
    await stub().recordAttempt(SITE, "1", operationId(7), "correct", NOW);
    await expect(stub().recordAttempt(SITE, "2", operationId(7), "correct", NOW)).resolves.toEqual({ error: "operation_conflict" });
    await expect(stub().recordAttempt(SITE, "1", operationId(7), "incorrect", NOW)).resolves.toEqual({ error: "operation_conflict" });
  });

  it("keeps HTTP retry totals aligned with current cross-device state", async () => {
    await seedReviewCard("1", 29);
    await seedReviewCard("2", 29);
    const firstBody = { site: SITE, questionId: "1", operationId: operationId(63), result: "correct" };
    const secondBody = { site: SITE, questionId: "2", operationId: operationId(64), result: "correct" };
    const post = (body) => SELF.fetch("https://example.test/v4/attempts", {
      method: "POST",
      headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const first = await (await post(firstBody)).json();
    const second = await (await post(secondBody)).json();
    const retry = await (await post(firstBody)).json();
    const current = await (await SELF.fetch(`https://example.test/v4/state?site=${SITE}`, {
      headers: AUTHORIZATION,
    })).json();

    expect({
      first: first.totals.mastered,
      second: second.totals.mastered,
      retry: retry.totals.mastered,
      current: current.mastered,
    }).toEqual({ first: 1, second: 2, retry: 2, current: 2 });
  });

  it("returns HTTP 409 when the same operationId is reused for another site", async () => {
    await stub().replaceCatalog(OTHER_SITE, ["1"], 0, NOW);
    const body = { site: SITE, questionId: "1", operationId: operationId(65), result: "correct" };
    const post = (payload) => SELF.fetch("https://example.test/v4/attempts", {
      method: "POST",
      headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const first = await post(body);
    expect(first.status).toBe(200);
    const conflict = await post({ ...body, site: OTHER_SITE });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toEqual({ error: "operation_conflict" });

    await runInRawDurableObject(stub(), (_instance, state) => {
      const attempts = state.storage.sql
        .exec("SELECT COUNT(*) AS count FROM attempts WHERE operation_id = ?", body.operationId)
        .toArray()[0];
      const otherCard = state.storage.sql
        .exec("SELECT question_id FROM cards WHERE site = ? AND question_id = ?", OTHER_SITE, "1")
        .toArray()[0];
      expect(attempts.count).toBe(1);
      expect(otherCard).toBeUndefined();
    });
  });

  it("returns HTTP 409 for conflicting payloads", async () => {
    const body = { site: SITE, questionId: "1", operationId: operationId(8), result: "correct" };
    const first = await SELF.fetch("https://example.test/v4/attempts", {
      method: "POST", headers: { ...AUTHORIZATION, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    expect(first.status).toBe(200);
    const conflict = await SELF.fetch("https://example.test/v4/attempts", {
      method: "POST", headers: { ...AUTHORIZATION, "Content-Type": "application/json" }, body: JSON.stringify({ ...body, result: "incorrect" }),
    });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toEqual({ error: "operation_conflict" });
  });
});

describe("next question scheduler", () => {
  it("selects the oldest due existing card", async () => {
    await seedReviewCard("1", 10, NOW - 1000);
    await seedReviewCard("2", 10, NOW - 5000);
    await expect(stub().nextQuestion(SITE, NOW)).resolves.toMatchObject({ questionId: "2", kind: "review" });
  });

  it("does not select a future card and selects an unseen question", async () => {
    await seedReviewCard("1", 10, NOW + 60_000);
    await expect(stub().nextQuestion(SITE, NOW)).resolves.toMatchObject({ questionId: "2", kind: "new" });
  });

  it("selects a new question when there are no due cards", async () => {
    await expect(stub().nextQuestion(SITE, NOW)).resolves.toEqual({ questionId: "1", kind: "new", dueMs: null });
  });

  it("excludes the current question while preserving scheduler priority", async () => {
    await expect(stub().nextQuestion(SITE, NOW, "1")).resolves.toEqual({
      questionId: "2",
      kind: "new",
      dueMs: null,
    });
    await seedReviewCard("1", 10, NOW - 5000);
    await seedReviewCard("2", 10, NOW - 1000);
    await expect(stub().nextQuestion(SITE, NOW, "1")).resolves.toMatchObject({
      questionId: "2",
      kind: "review",
    });
  });

  it("returns no question when every catalog card is future-due", async () => {
    for (const id of ["1", "2", "3", "4"]) await seedReviewCard(id, 10, NOW + Number(id) * 1000);
    await expect(stub().nextQuestion(SITE, NOW)).resolves.toEqual({ questionId: null, kind: "none", dueMs: null });
  });
});

describe("mastery history and milestones", () => {
  it("counts only current catalog cards and records catalog-driven stock changes", async () => {
    await seedReviewCard("1", 35);
    await expect(stub().getState(SITE, NOW)).resolves.toMatchObject({ mastered: 1 });

    await stub().replaceCatalog(SITE, ["2", "3", "4"], 1, NOW);
    await expect(stub().getState(SITE, NOW)).resolves.toMatchObject({
      mastered: 0,
      catalog: { questionCount: 3, generation: 2 },
    });
    await expect(stub().getHistory(SITE, 1, NOW)).resolves.toMatchObject({
      days: [{ date: "2026-08-10", mastered: 0 }],
    });

    const nextDay = NOW + 86_400_000;
    await stub().replaceCatalog(SITE, ["1", "2", "3", "4"], 2, nextDay);
    await expect(stub().getState(SITE, nextDay)).resolves.toMatchObject({
      mastered: 1,
      todayDelta: 1,
      catalog: { questionCount: 4, generation: 3 },
    });
  });

  it("stores the daily stock only when the KPI changes and fills a 7 day stock series", async () => {
    await seedReviewCard("1", 29);
    await stub().recordAttempt(SITE, "1", operationId(9), "correct", NOW);
    const history = await stub().getHistory(SITE, 7, NOW);
    expect(history.days).toHaveLength(7);
    expect(history.days.at(-1)).toEqual({ date: "2026-08-10", mastered: 1 });
  });

  it("celebrates 300 once across 300 -> 299 -> 300 and then celebrates 350", async () => {
    const ids = Array.from({ length: 350 }, (_, index) => String(index + 1));
    await stub().replaceCatalog(SITE, ids, 1, NOW);
    await runInRawDurableObject(stub(), (_instance, state) => {
      for (let id = 1; id <= 299; id += 1) {
        state.storage.sql.exec(
          `INSERT INTO cards (
             site, question_id, due_ms, stability, difficulty, scheduled_days,
             learning_steps, reps, lapses, state, last_review_ms
           ) VALUES (?, ?, ?, 35, 5, 30, 0, 5, 0, 2, ?)`,
          SITE,
          String(id),
          NOW - 1000,
          NOW - 30 * 86_400_000
        );
      }
    });
    await seedReviewCard("300", 29);

    const first300 = await stub().recordAttempt(SITE, "300", operationId(10), "correct", NOW);
    expect(first300.totals.mastered).toBe(300);
    expect(first300.completedMilestone).toBe(300);

    await runInRawDurableObject(stub(), (_instance, state) => {
      state.storage.sql.exec(
        `UPDATE cards
         SET stability = 35, difficulty = 5, state = 2, due_ms = ?, last_review_ms = ?
         WHERE site = ? AND question_id = '300'`,
        NOW - 1000,
        NOW - 30 * 86_400_000,
        SITE
      );
    });
    const down = await stub().recordAttempt(SITE, "300", operationId(11), "incorrect", NOW);
    expect(down.totals.mastered).toBe(299);
    expect(down.completedMilestone).toBeNull();

    await runInRawDurableObject(stub(), (_instance, state) => {
      state.storage.sql.exec(
        `UPDATE cards
         SET stability = 29, difficulty = 5, state = 2, due_ms = ?, last_review_ms = ?
         WHERE site = ? AND question_id = '300'`,
        NOW - 1000,
        NOW - 30 * 86_400_000,
        SITE
      );
    });
    const second300 = await stub().recordAttempt(SITE, "300", operationId(12), "correct", NOW);
    expect(second300.totals.mastered).toBe(300);
    expect(second300.completedMilestone).toBeNull();

    for (let id = 301; id <= 349; id += 1) {
      await seedReviewCard(String(id), 35);
    }
    await seedReviewCard("350", 29);
    const first350 = await stub().recordAttempt(SITE, "350", operationId(13), "correct", NOW);
    expect(first350.totals.mastered).toBe(350);
    expect(first350.completedMilestone).toBe(350);
  });

  it("does not celebrate merely because an unchanged stock is a milestone", async () => {
    const ids = Array.from({ length: 300 }, (_, index) => String(index + 1));
    await stub().replaceCatalog(SITE, ids, 1, NOW);
    await runInRawDurableObject(stub(), (_instance, state) => {
      for (const id of ids) {
        state.storage.sql.exec(
          `INSERT INTO cards (
             site, question_id, due_ms, stability, difficulty, scheduled_days,
             learning_steps, reps, lapses, state, last_review_ms
           ) VALUES (?, ?, ?, 35, 5, 30, 0, 5, 0, 2, ?)`,
          SITE,
          id,
          NOW - 1000,
          NOW - 30 * 86_400_000
        );
      }
    });

    const result = await stub().recordAttempt(SITE, "300", operationId(17), "correct", NOW);
    expect(result.totals.mastered).toBe(300);
    expect(result.attempt.masteryDelta).toBe(0);
    expect(result.completedMilestone).toBeNull();
  });
});


describe("v4 HTTP contract", () => {
  it("shares the daily mastery goal between independent clients", async () => {
    const fresh = env.LEARNING_STATE.get(
      env.LEARNING_STATE.idFromName("settings-default")
    );
    await expect(fresh.getSettings()).resolves.toEqual({ dailyMasteryGoal: 5 });

    const firstClient = await SELF.fetch("https://example.test/v4/settings", {
      headers: AUTHORIZATION,
    });
    expect(firstClient.status).toBe(200);
    await expect(firstClient.json()).resolves.toEqual({ dailyMasteryGoal: 5 });

    const update = await SELF.fetch("https://example.test/v4/settings", {
      method: "PUT",
      headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
      body: JSON.stringify({ dailyMasteryGoal: 12 }),
    });
    expect(update.status).toBe(200);
    await expect(update.json()).resolves.toEqual({ dailyMasteryGoal: 12 });

    const secondClient = await SELF.fetch("https://example.test/v4/settings", {
      headers: AUTHORIZATION,
    });
    expect(secondClient.status).toBe(200);
    await expect(secondClient.json()).resolves.toEqual({ dailyMasteryGoal: 12 });
  });

  it("rejects invalid settings requests", async () => {
    for (const body of [
      { dailyMasteryGoal: 0 },
      { dailyMasteryGoal: 101 },
      { dailyMasteryGoal: 1.5 },
      { dailyMasteryGoal: 5, extra: true },
    ]) {
      const response = await SELF.fetch("https://example.test/v4/settings", {
        method: "PUT",
        headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "invalid_request" });
    }

    const query = await SELF.fetch("https://example.test/v4/settings?extra=1", {
      headers: AUTHORIZATION,
    });
    expect(query.status).toBe(400);
    await expect(query.json()).resolves.toEqual({ error: "invalid_request" });

    const method = await SELF.fetch("https://example.test/v4/settings", {
      method: "POST",
      headers: AUTHORIZATION,
    });
    expect(method.status).toBe(405);
    expect(method.headers.get("Allow")).toBe("GET, PUT");
  });

  it("does not expose removed API versions", async () => {
    const response = await SELF.fetch(`https://example.test/v3/state?site=${SITE}`, {
      headers: AUTHORIZATION,
    });
    expect(response.status).toBe(404);
  });

  it("requires the configured bearer token", async () => {
    const url = "https://example.test/v4/sites";
    const missing = await SELF.fetch(url);
    const incorrect = await SELF.fetch(url, {
      headers: { Authorization: "Bearer incorrect-token" },
    });

    expect(missing.status).toBe(401);
    await expect(missing.json()).resolves.toEqual({ error: "unauthorized" });
    expect(incorrect.status).toBe(401);
    await expect(incorrect.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("lists catalog-backed sites and returns state and history", async () => {
    const sites = await SELF.fetch("https://example.test/v4/sites", {
      headers: AUTHORIZATION,
    });
    expect(sites.status).toBe(200);
    await expect(sites.json()).resolves.toEqual({ sites: [SITE] });

    const state = await SELF.fetch(`https://example.test/v4/state?site=${SITE}`, {
      headers: AUTHORIZATION,
    });
    expect(state.status).toBe(200);
    await expect(state.json()).resolves.toMatchObject({
      site: SITE,
      mastered: 0,
      attempted: 0,
      todayDelta: 0,
      catalog: { questionCount: 4, generation: 1 },
    });

    const history = await SELF.fetch(
      `https://example.test/v4/history?site=${SITE}&days=7`,
      { headers: AUTHORIZATION },
    );
    expect(history.status).toBe(200);
    const historyBody = await history.json();
    expect(historyBody.site).toBe(SITE);
    expect(historyBody.timeZone).toBe("Asia/Tokyo");
    expect(historyBody.days).toHaveLength(7);
  });

  it("replaces the question catalog and serves the canonical next URL", async () => {
    const replace = await SELF.fetch("https://example.test/v4/questions", {
      method: "POST",
      headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
      body: JSON.stringify({
        site: SITE,
        questionIds: ["44615", "44614"],
        expectedGeneration: 1,
      }),
    });
    expect(replace.status).toBe(200);
    await expect(replace.json()).resolves.toMatchObject({
      site: SITE,
      questionCount: 2,
      generation: 2,
    });

    const next = await SELF.fetch(`https://example.test/v4/next?site=${SITE}`, {
      headers: AUTHORIZATION,
    });
    expect(next.status).toBe(200);
    await expect(next.json()).resolves.toEqual({
      question: {
        questionId: "44614",
        url: `https://${SITE}/questions/44614`,
        kind: "new",
        dueMs: null,
      },
    });
      const excluded = await SELF.fetch(
      `https://example.test/v4/next?site=${SITE}&excludeQuestionId=44614`,
      { headers: AUTHORIZATION },
    );
    expect(excluded.status).toBe(200);
    await expect(excluded.json()).resolves.toEqual({
      question: {
        questionId: "44615",
        url: `https://${SITE}/questions/44615`,
        kind: "new",
        dueMs: null,
      },
    });
  });

  it("rejects a stale catalog generation without replacing the current catalog", async () => {
    const first = await SELF.fetch("https://example.test/v4/questions", {
      method: "POST",
      headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
      body: JSON.stringify({
        site: SITE,
        questionIds: ["10", "11"],
        expectedGeneration: 1,
      }),
    });
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({ generation: 2, questionCount: 2 });

    const stale = await SELF.fetch("https://example.test/v4/questions", {
      method: "POST",
      headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
      body: JSON.stringify({
        site: SITE,
        questionIds: ["20", "21", "22"],
        expectedGeneration: 1,
      }),
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toEqual({ error: "catalog_conflict" });

    const state = await SELF.fetch(`https://example.test/v4/state?site=${SITE}`, {
      headers: AUTHORIZATION,
    });
    await expect(state.json()).resolves.toMatchObject({
      catalog: { questionCount: 2, generation: 2 },
    });
    const next = await SELF.fetch(`https://example.test/v4/next?site=${SITE}`, {
      headers: AUTHORIZATION,
    });
    await expect(next.json()).resolves.toMatchObject({ question: { questionId: "10" } });
  });

  it("rejects attempts for questions outside the registered catalog", async () => {
    const response = await SELF.fetch("https://example.test/v4/attempts", {
      method: "POST",
      headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
      body: JSON.stringify({
        site: SITE,
        questionId: "999",
        operationId: operationId(18),
        result: "correct",
      }),
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "unknown_question" });
    await runInRawDurableObject(stub(), (_instance, state) => {
      expect(
        state.storage.sql.exec("SELECT COUNT(*) AS count FROM attempts").toArray()[0].count,
      ).toBe(0);
      expect(
        state.storage.sql.exec("SELECT COUNT(*) AS count FROM cards").toArray()[0].count,
      ).toBe(0);
    });
  });

  it("returns catalog_missing instead of falling back when no catalog is registered", async () => {
    await runInRawDurableObject(stub(), (_instance, state) => {
      state.storage.sql.exec("DELETE FROM questions WHERE site = ?", SITE);
      state.storage.sql.exec("DELETE FROM catalog_metadata WHERE site = ?", SITE);
    });
    const response = await SELF.fetch(`https://example.test/v4/next?site=${SITE}`, {
      headers: AUTHORIZATION,
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "catalog_missing" });
  });

  it("rejects client-supplied attempt timestamps and other extra fields", async () => {
    const response = await SELF.fetch("https://example.test/v4/attempts", {
      method: "POST",
      headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
      body: JSON.stringify({
        site: SITE,
        questionId: "1",
        operationId: operationId(19),
        result: "correct",
        answeredAtMs: NOW,
      }),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_request" });
  });
});

describe("server source of truth", () => {
  it("exposes one shared mastery stock to independent clients", async () => {
    const firstClient = await SELF.fetch("https://example.test/v4/attempts", {
      method: "POST",
      headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
      body: JSON.stringify({
        site: SITE,
        questionId: "1",
        operationId: operationId(14),
        result: "correct",
      }),
    });
    expect(firstClient.status).toBe(200);

    const secondClient = await SELF.fetch(`https://example.test/v4/state?site=${SITE}`, {
      headers: AUTHORIZATION,
    });
    expect(secondClient.status).toBe(200);
    await expect(secondClient.json()).resolves.toMatchObject({
      site: SITE,
      mastered: 0,
      attempted: 1,
      todayDelta: 0,
    });

    await seedReviewCard("2", 29);
    const crossing = await SELF.fetch("https://example.test/v4/attempts", {
      method: "POST",
      headers: { ...AUTHORIZATION, "Content-Type": "application/json" },
      body: JSON.stringify({
        site: SITE,
        questionId: "2",
        operationId: operationId(15),
        result: "correct",
      }),
    });
    expect(crossing.status).toBe(200);

    const refreshed = await SELF.fetch(`https://example.test/v4/state?site=${SITE}`, {
      headers: AUTHORIZATION,
    });
    expect(refreshed.status).toBe(200);
    await expect(refreshed.json()).resolves.toMatchObject({
      site: SITE,
      mastered: 1,
      attempted: 2,
      todayDelta: 1,
    });
  });
});
