const { isLearningMetrics, isLearningState, isAttemptResponse } = require('../../../contracts/kakomonn.mjs');
const assert = require('node:assert/strict');

const emptyMetrics = Object.freeze({
  stabilityDays: 0, dailyKpiCompleted: false, dueCardsCompleted: false, dueCardsRemaining: 12,
  todayNewQuestionCount: 0, newQuestionGoal: 10, newQuestionsRemaining: 10,
  todayStabilityDaysDelta: 0, todayStudyTimeMs: 0, attemptedQuestionCount: 0,
  todayAttemptedQuestionCount: 0, todayCorrectRatePercent: null,
});
const firstAnswerMetrics = Object.freeze({
  stabilityDays: 0, dailyKpiCompleted: false, dueCardsCompleted: false, dueCardsRemaining: 12,
  todayNewQuestionCount: 1, newQuestionGoal: 10, newQuestionsRemaining: 9,
  todayStabilityDaysDelta: 0, todayStudyTimeMs: 0, attemptedQuestionCount: 1,
  todayAttemptedQuestionCount: 1, todayCorrectRatePercent: 100,
});
const secondAnswerMetrics = Object.freeze({
  stabilityDays: 0, dailyKpiCompleted: false, dueCardsCompleted: false, dueCardsRemaining: 12,
  todayNewQuestionCount: 2, newQuestionGoal: 10, newQuestionsRemaining: 8,
  todayStabilityDaysDelta: 0, todayStudyTimeMs: 0, attemptedQuestionCount: 2,
  todayAttemptedQuestionCount: 2, todayCorrectRatePercent: 100,
});
const beforeCompletionMetrics = Object.freeze({
  stabilityDays: 0, dailyKpiCompleted: false, dueCardsCompleted: true, dueCardsRemaining: 0,
  todayNewQuestionCount: 9, newQuestionGoal: 10, newQuestionsRemaining: 1,
  todayStabilityDaysDelta: 0, todayStudyTimeMs: 0, attemptedQuestionCount: 9,
  todayAttemptedQuestionCount: 9, todayCorrectRatePercent: 100,
});
const completedMetrics = Object.freeze({
  stabilityDays: 0, dailyKpiCompleted: true, dueCardsCompleted: true, dueCardsRemaining: 0,
  todayNewQuestionCount: 10, newQuestionGoal: 10, newQuestionsRemaining: 0,
  todayStabilityDaysDelta: 0, todayStudyTimeMs: 0, attemptedQuestionCount: 10,
  todayAttemptedQuestionCount: 10, todayCorrectRatePercent: 100,
});
for (const metrics of [emptyMetrics, firstAnswerMetrics, secondAnswerMetrics, beforeCompletionMetrics, completedMetrics]) {
  assert.equal(isLearningMetrics(metrics), true);
}

function validateSyncFixtures(configuration) {
  const { expectedSite: site, state, attempts } = configuration;
  assert.equal(isLearningState(state, site), true);
  for (const response of attempts) {
    assert.equal(isAttemptResponse(response, site), true);
  }
  return configuration;
}

module.exports = { emptyMetrics, firstAnswerMetrics, secondAnswerMetrics, beforeCompletionMetrics,
  completedMetrics, validateSyncFixtures };
