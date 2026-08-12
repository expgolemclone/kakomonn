export function v6StateResponse(state) {
  return {
    site: state.site,
    today: state.today,
    stabilityDays: state.stabilityDays,
    attemptedQuestionCount: state.solved,
    todayAttemptedQuestionCount: state.todaySolved,
    todayStabilityDaysDelta: state.todayStabilityDaysDelta,
    catalog: state.catalog,
  };
}

export function v6HistoryResponse(history) {
  return {
    ...history,
    days: history.days.map((day) => ({
      date: day.date,
      stabilityDays: day.stabilityDays,
      stabilityDaysDelta: day.stabilityDaysDelta,
      attemptedQuestionCount: day.solved,
    })),
  };
}

export function v6AttemptResponse(response) {
  return {
    attempt: {
      questionId: response.attempt.questionId,
      result: response.attempt.result,
      previousStability: response.attempt.previousStability,
      resultingStability: response.attempt.stability,
    },
    totals: {
      stabilityDays: response.totals.stabilityDays,
      attemptedQuestionCount: response.totals.solved,
      todayAttemptedQuestionCount: response.totals.todaySolved,
    },
  };
}
