import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalQuestionIds,
  isAttemptResponse,
  isDailyDetailsResponse,
  isHistoryResponse,
  isLearningState,
  isNextResponse,
  isQuestionId,
  scheduledQuestionId,
} from "../contracts/kakomonn.mjs";
import {
  dashboardBridgeRequestId,
  isDashboardBridgeRequest,
  isDashboardBridgeResponse,
} from "../contracts/dashboard-bridge.mjs";

const site = "chushoks.kakomonn.com";
const learningMetrics = Object.freeze({
  attemptedQuestionCount: 3,
  dailyKpiCompleted: false,
  dueCardsCompleted: true,
  dueCardsRemaining: 0,
  newQuestionGoal: 50,
  newQuestionsRemaining: 49,
  stabilityDays: 10,
  todayAttemptedQuestionCount: 1,
  todayCorrectRatePercent: 100,
  todayNewQuestionCount: 1,
  todayStabilityDaysDelta: 2,
});
const state = Object.freeze({
  site,
  today: "2026-08-10",
  learningMetrics,
  catalog: Object.freeze({
    questionCount: 100,
    updatedAtMs: 1_786_320_000_000,
    generation: 2,
  }),
});
const nextQuestion = Object.freeze({
  questionId: "45124",
  url: `https://${site}/questions/45124`,
  kind: "review",
  dueMs: 1_786_320_000_000,
});

test("question IDs use canonical arbitrary-precision numeric ordering", () => {
  assert.deepEqual(
    canonicalQuestionIds([
      "9007199254740993",
      "10",
      "2",
      "0002",
      "9007199254740992",
    ]),
    ["0002", "2", "10", "9007199254740992", "9007199254740993"],
  );
  assert.throws(() => canonicalQuestionIds(["1", "not-a-question"]));
});

test("question IDs fit SQLite signed integers", () => {
  assert.equal(isQuestionId("9223372036854775807"), true);
  assert.equal(isQuestionId("0000000000000000001"), true);
  assert.equal(isQuestionId("9223372036854775808"), false);
  assert.equal(isQuestionId("00000000000000000001"), false);
});

test("scheduled question URLs require the exact HTTPS origin and shape", () => {
  assert.equal(scheduledQuestionId(nextQuestion.url, site), "45124");
  for (const invalid of [
    `http://${site}/questions/45124`,
    `https://${site}:444/questions/45124`,
    `https://user:password@${site}/questions/45124`,
    `https://${site}/questions/45124?next=true`,
    `https://${site}/questions/next/45124`,
    `https://${site}/questions/9223372036854775808`,
  ]) {
    assert.equal(scheduledQuestionId(invalid, site), null);
  }
});

test("sync responses are exact and bound to the requested site", () => {
  assert.equal(isLearningState(state, site), true);
  assert.equal(isNextResponse({ state, question: nextQuestion }, site), true);
  assert.equal(
    isNextResponse({ state: { ...state, extra: true }, question: nextQuestion }, site),
    false,
  );
  assert.equal(
    isLearningState({
      ...state,
      learningMetrics: { ...learningMetrics, dailyKpiCompleted: true },
    }, site),
    false,
  );

  const attemptResponse = {
    attempt: {
      questionId: "45124",
      answerResult: "correct",
      attemptedAtMs: 1_786_320_000_000,
      previousCardStabilityDays: 5.5,
      resultingCardStabilityDays: 10.5,
      previousStabilityDays: 5,
      resultingStabilityDays: 10,
    },
    learningMetrics,
    nextQuestion,
    celebration: {
      site,
      date: "2026-08-10",
      dailyKpiCompleted: true,
    },
  };
  assert.equal(isAttemptResponse(attemptResponse, site), true);
  assert.equal(
    isAttemptResponse({
      ...attemptResponse,
      celebration: {
        ...attemptResponse.celebration,
        site: "shindans.kakomonn.com",
      },
    }, site),
    false,
  );
});

test("history responses require consecutive Tokyo dates and coherent rows", () => {
  const history = {
    site,
    timeZone: "Asia/Tokyo",
    today: "2026-08-10",
    days: [
      {
        date: "2026-08-08",
        closingStabilityDays: null,
        stabilityDaysDelta: null,
        dailyAttemptedQuestionCount: 0,
        dailyNewQuestionCount: 0,
        dailyCorrectRatePercent: null,
      },
      {
        date: "2026-08-09",
        closingStabilityDays: 8,
        stabilityDaysDelta: 8,
        dailyAttemptedQuestionCount: 1,
        dailyNewQuestionCount: 1,
        dailyCorrectRatePercent: 100,
      },
      {
        date: "2026-08-10",
        closingStabilityDays: 10,
        stabilityDaysDelta: 2,
        dailyAttemptedQuestionCount: 1,
        dailyNewQuestionCount: 0,
        dailyCorrectRatePercent: 0,
      },
    ],
  };
  assert.equal(isHistoryResponse(history, site, 3), true);
  assert.equal(
    isHistoryResponse({
      ...history,
      days: history.days.map((day, index) =>
        index === 1 ? { ...day, date: "2026-08-08" } : day,
      ),
    }, site, 3),
    false,
  );
});

test("daily details rows are bound to the requested Tokyo date", () => {
  const details = {
    site,
    date: "2026-08-10",
    timeZone: "Asia/Tokyo",
    tables: {
      stability_history: [{
        site,
        date: "2026-08-10",
        opening_stability_days: 8,
        closing_stability_days: 10,
        attempted_question_count: 1,
        new_question_count: 1,
        attempt_count: 1,
        correct_attempt_count: 1,
      }],
      attempts: [{
        site,
        operation_id: "00000000000000000000000000000001",
        question_id: "45124",
        attempted_at_ms: Date.parse("2026-08-09T15:00:00.000Z"),
        answer_result: "correct",
        previous_card_stability_days: 5.5,
        resulting_card_stability_days: 10.5,
      }],
    },
  };
  assert.equal(isDailyDetailsResponse(details, site, "2026-08-10"), true);
  assert.equal(
    isDailyDetailsResponse({
      ...details,
      tables: {
        ...details.tables,
        attempts: [{
          ...details.tables.attempts[0],
          attempted_at_ms: Date.parse("2026-08-10T15:00:00.000Z"),
        }],
      },
    }, site, "2026-08-10"),
    false,
  );
  assert.equal(
    isDailyDetailsResponse({
      ...details,
      tables: {
        ...details.tables,
        stability_history: [{
          ...details.tables.stability_history[0],
          attempt_count: 2,
        }],
      },
    }, site, "2026-08-10"),
    false,
  );
});

test("dashboard bridge messages use exact request and response shapes", () => {
  assert.equal(
    isDashboardBridgeRequest({ id: 1, operation: "dashboard", site: null }),
    true,
  );
  assert.equal(
    isDashboardBridgeRequest({ id: 2, operation: "dashboard", site }),
    true,
  );
  assert.equal(
    isDashboardBridgeRequest({
      date: "2026-08-10",
      id: 3,
      operation: "daily-details",
      site,
    }),
    true,
  );
  for (const invalid of [
    { id: 0, operation: "dashboard", site: null },
    { id: 1, operation: "dashboard" },
    { id: 1, operation: "state", site },
    { date: "2026-02-30", id: 1, operation: "daily-details", site },
    { date: "2026-08-10", id: 1, operation: "daily-details", site: "example.com" },
  ]) {
    assert.equal(isDashboardBridgeRequest(invalid), false);
  }
  assert.equal(dashboardBridgeRequestId({ id: 4, operation: "unknown" }), 4);
  assert.equal(dashboardBridgeRequestId({ id: -1 }), null);
  assert.equal(
    isDashboardBridgeResponse({ data: { sites: [] }, id: 5, ok: true }, 5),
    true,
  );
  assert.equal(
    isDashboardBridgeResponse(
      { code: "token_missing", id: 5, ok: false, status: 0 },
      5,
    ),
    true,
  );
  assert.equal(
    isDashboardBridgeResponse(
      { code: "token_missing", extra: true, id: 5, ok: false, status: 0 },
      5,
    ),
    false,
  );
  assert.equal(
    isDashboardBridgeResponse({ data: { sites: [] }, id: 6, ok: true }, 5),
    false,
  );
});
