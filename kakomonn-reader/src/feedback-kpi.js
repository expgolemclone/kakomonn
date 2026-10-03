const correctFeedbackKpiResolvers = new Map();

export function calculateKpiQuestionsRemaining(metrics) {
  const remaining = metrics.dueCardsRemaining + metrics.newQuestionsRemaining;
  if (!Number.isSafeInteger(remaining) || remaining < 0) {
    throw new TypeError("KPI questions remaining is invalid.");
  }
  return remaining;
}

export function waitForCorrectFeedbackKpi(questionId, pendingAttempt) {
  if (!/^\d+$/.test(questionId ?? "")) {
    return Promise.reject(new TypeError("Correct feedback question ID is invalid."));
  }
  if (
    pendingAttempt?.phase === "recorded" &&
    pendingAttempt.answerResult === "correct" &&
    pendingAttempt.questionId === questionId
  ) {
    return Promise.resolve(pendingAttempt.kpiQuestionsRemaining);
  }
  return new Promise((resolve) => {
    const resolvers = correctFeedbackKpiResolvers.get(questionId) ?? [];
    resolvers.push(resolve);
    correctFeedbackKpiResolvers.set(questionId, resolvers);
  });
}

export function resolveCorrectFeedbackKpi(questionId, remaining) {
  if (!/^\d+$/.test(questionId ?? "") || !Number.isSafeInteger(remaining) || remaining < 0) {
    throw new TypeError("Correct feedback KPI result is invalid.");
  }
  const resolvers = correctFeedbackKpiResolvers.get(questionId);
  if (resolvers === undefined || resolvers.length === 0) {
    return false;
  }
  const resolve = resolvers.shift();
  if (resolvers.length === 0) {
    correctFeedbackKpiResolvers.delete(questionId);
  }
  resolve(remaining);
  return true;
}

