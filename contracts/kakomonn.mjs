export const SITE_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.kakomonn\.com$/;
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const OPERATION_ID_PATTERN = /^[0-9a-f]{32}$/;
const QUESTION_ID_PATTERN = /^\d+$/;
const QUESTION_ID_MAX = "9223372036854775807";
const DAY_MS = 86_400_000;
const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1000;

export const LEARNING_METRIC_KEYS = Object.freeze([
  "attemptedQuestionCount",
  "dailyKpiCompleted",
  "dueCardsCompleted",
  "dueCardsRemaining",
  "newQuestionGoal",
  "newQuestionsRemaining",
  "stabilityDays",
  "todayAttemptedQuestionCount",
  "todayCorrectRatePercent",
  "todayNewQuestionCount",
  "todayStabilityDaysDelta",
]);

export const CELEBRATION_KEYS = Object.freeze([
  "dailyKpiCompleted",
  "date",
  "site",
]);

export const CATALOG_SUMMARY_KEYS = Object.freeze([
  "generation",
  "questionCount",
  "updatedAtMs",
]);

export const LEARNING_STATE_KEYS = Object.freeze([
  "catalog",
  "learningMetrics",
  "site",
  "today",
]);

export const NEXT_QUESTION_KEYS = Object.freeze([
  "dueMs",
  "kind",
  "questionId",
  "url",
]);

export const HISTORY_DAY_KEYS = Object.freeze([
  "closingStabilityDays",
  "dailyAttemptedQuestionCount",
  "dailyCorrectRatePercent",
  "dailyNewQuestionCount",
  "date",
  "stabilityDaysDelta",
]);

export const RAW_TABLE_COLUMNS = Object.freeze({
  stability_history: Object.freeze([
    "site",
    "date",
    "opening_stability_days",
    "closing_stability_days",
    "attempted_question_count",
    "new_question_count",
    "attempt_count",
    "correct_attempt_count",
  ]),
  attempts: Object.freeze([
    "site",
    "operation_id",
    "question_id",
    "attempted_at_ms",
    "answer_result",
    "previous_card_stability_days",
    "resulting_card_stability_days",
  ]),
});

export function hasExactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0")
  );
}

export function isSite(value) {
  return typeof value === "string" && SITE_PATTERN.test(value);
}

export function isCalendarDate(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function calendarDateOrdinal(value) {
  if (!isCalendarDate(value)) {
    return null;
  }
  return Math.floor(Date.parse(`${value}T00:00:00.000Z`) / DAY_MS);
}

export function isCorrectRatePercent(value) {
  return (
    value === null ||
    (Number.isSafeInteger(value) && value >= 0 && value <= 100)
  );
}

export function isQuestionId(value) {
  if (
    typeof value !== "string" ||
    value.length > QUESTION_ID_MAX.length ||
    !QUESTION_ID_PATTERN.test(value)
  ) {
    return false;
  }
  const normalized = normalizedQuestionNumber(value);
  return (
    normalized.length < QUESTION_ID_MAX.length ||
    (normalized.length === QUESTION_ID_MAX.length &&
      normalized <= QUESTION_ID_MAX)
  );
}

function normalizedQuestionNumber(questionId) {
  const normalized = questionId.replace(/^0+/, "");
  return normalized === "" ? "0" : normalized;
}

function compareQuestionIds(left, right) {
  const leftNumber = normalizedQuestionNumber(left);
  const rightNumber = normalizedQuestionNumber(right);
  if (leftNumber.length !== rightNumber.length) {
    return leftNumber.length - rightNumber.length;
  }
  if (leftNumber !== rightNumber) {
    return leftNumber < rightNumber ? -1 : 1;
  }
  return left === right ? 0 : left < right ? -1 : 1;
}

export function canonicalQuestionIds(questionIds) {
  if (!Array.isArray(questionIds) || questionIds.some((id) => !isQuestionId(id))) {
    throw new TypeError("Question IDs are invalid.");
  }
  return [...questionIds].sort(compareQuestionIds);
}

export function scheduledQuestionId(value, expectedSite) {
  if (typeof value !== "string" || !isSite(expectedSite)) {
    return null;
  }
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/questions\/(\d+)$/);
    if (
      url.origin !== `https://${expectedSite}` ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== "" ||
      match === null ||
      !isQuestionId(match[1])
    ) {
      return null;
    }
    return match[1];
  } catch {
    return null;
  }
}

export function isCatalogSummary(value) {
  return (
    hasExactKeys(value, CATALOG_SUMMARY_KEYS) &&
    Number.isSafeInteger(value.questionCount) &&
    value.questionCount > 0 &&
    Number.isSafeInteger(value.updatedAtMs) &&
    value.updatedAtMs > 0 &&
    Number.isSafeInteger(value.generation) &&
    value.generation > 0
  );
}

export function isLearningMetrics(value) {
  return (
    hasExactKeys(value, LEARNING_METRIC_KEYS) &&
    Number.isSafeInteger(value.stabilityDays) &&
    value.stabilityDays >= 0 &&
    typeof value.dailyKpiCompleted === "boolean" &&
    typeof value.dueCardsCompleted === "boolean" &&
    Number.isSafeInteger(value.dueCardsRemaining) &&
    value.dueCardsRemaining >= 0 &&
    value.dueCardsCompleted === (value.dueCardsRemaining === 0) &&
    Number.isSafeInteger(value.todayNewQuestionCount) &&
    value.todayNewQuestionCount >= 0 &&
    Number.isSafeInteger(value.newQuestionGoal) &&
    value.newQuestionGoal > 0 &&
    Number.isSafeInteger(value.newQuestionsRemaining) &&
    value.newQuestionsRemaining ===
      Math.max(0, value.newQuestionGoal - value.todayNewQuestionCount) &&
    (!value.dailyKpiCompleted || value.newQuestionsRemaining === 0) &&
    (value.dailyKpiCompleted ||
      value.newQuestionsRemaining > 0 ||
      value.dueCardsRemaining > 0) &&
    Number.isSafeInteger(value.todayStabilityDaysDelta) &&
    Number.isSafeInteger(value.attemptedQuestionCount) &&
    value.attemptedQuestionCount >= 0 &&
    Number.isSafeInteger(value.todayAttemptedQuestionCount) &&
    value.todayAttemptedQuestionCount >= 0 &&
    value.todayAttemptedQuestionCount <= value.attemptedQuestionCount &&
    value.todayNewQuestionCount <= value.todayAttemptedQuestionCount &&
    isCorrectRatePercent(value.todayCorrectRatePercent) &&
    (value.todayAttemptedQuestionCount === 0) ===
      (value.todayCorrectRatePercent === null)
  );
}

export function isCelebration(value, expectedSite = null) {
  return (
    hasExactKeys(value, CELEBRATION_KEYS) &&
    isSite(value.site) &&
    (expectedSite === null || value.site === expectedSite) &&
    isCalendarDate(value.date) &&
    value.dailyKpiCompleted === true
  );
}

export function isLearningState(value, expectedSite) {
  return (
    hasExactKeys(value, LEARNING_STATE_KEYS) &&
    value.site === expectedSite &&
    isSite(expectedSite) &&
    isCalendarDate(value.today) &&
    isLearningMetrics(value.learningMetrics) &&
    (value.catalog === null || isCatalogSummary(value.catalog))
  );
}

export function isNextQuestion(value, expectedSite) {
  if (value === null) {
    return true;
  }
  if (
    !hasExactKeys(value, NEXT_QUESTION_KEYS) ||
    scheduledQuestionId(value.url, expectedSite) !== value.questionId
  ) {
    return false;
  }
  if (value.kind === "new") {
    return value.dueMs === null;
  }
  return (
    value.kind === "review" &&
    Number.isSafeInteger(value.dueMs) &&
    value.dueMs > 0
  );
}

export function isNextResponse(value, expectedSite) {
  return (
    hasExactKeys(value, ["question", "state"]) &&
    isLearningState(value.state, expectedSite) &&
    isNextQuestion(value.question, expectedSite)
  );
}

export function isAttemptResponse(value, expectedSite) {
  const keys = value?.celebration === undefined
    ? ["attempt", "learningMetrics", "nextQuestion"]
    : ["attempt", "celebration", "learningMetrics", "nextQuestion"];
  const attempt = value?.attempt;
  return (
    hasExactKeys(value, keys) &&
    hasExactKeys(attempt, [
      "answerResult",
      "attemptedAtMs",
      "previousCardStabilityDays",
      "previousStabilityDays",
      "questionId",
      "resultingCardStabilityDays",
      "resultingStabilityDays",
    ]) &&
    isQuestionId(attempt.questionId) &&
    isAnswerResult(attempt.answerResult) &&
    Number.isSafeInteger(attempt.attemptedAtMs) &&
    attempt.attemptedAtMs > 0 &&
    Number.isFinite(attempt.previousCardStabilityDays) &&
    attempt.previousCardStabilityDays >= 0 &&
    Number.isFinite(attempt.resultingCardStabilityDays) &&
    attempt.resultingCardStabilityDays >= 0 &&
    Number.isSafeInteger(attempt.previousStabilityDays) &&
    attempt.previousStabilityDays >= 0 &&
    Number.isSafeInteger(attempt.resultingStabilityDays) &&
    attempt.resultingStabilityDays >= 0 &&
    isLearningMetrics(value.learningMetrics) &&
    isNextQuestion(value.nextQuestion, expectedSite) &&
    (value.celebration === undefined ||
      isCelebration(value.celebration, expectedSite))
  );
}

export function isCatalogResponse(value, expectedSite) {
  return (
    hasExactKeys(value, [
      "generation",
      "question",
      "questionCount",
      "site",
      "updatedAtMs",
    ]) &&
    value.site === expectedSite &&
    isCatalogSummary({
      generation: value.generation,
      questionCount: value.questionCount,
      updatedAtMs: value.updatedAtMs,
    }) &&
    isNextQuestion(value.question, expectedSite)
  );
}

export function isCatalogConflictResponse(value, expectedSite) {
  if (
    !hasExactKeys(value, [
      "catalog",
      "currentGeneration",
      "error",
      "question",
    ]) ||
    value.error !== "catalog_conflict" ||
    !Number.isSafeInteger(value.currentGeneration) ||
    value.currentGeneration < 0
  ) {
    return false;
  }
  if (value.currentGeneration === 0) {
    return value.catalog === null && value.question === null;
  }
  return (
    hasExactKeys(value.catalog, [
      "generation",
      "questionCount",
      "site",
      "updatedAtMs",
    ]) &&
    value.catalog.site === expectedSite &&
    value.catalog.generation === value.currentGeneration &&
    isCatalogSummary({
      generation: value.catalog.generation,
      questionCount: value.catalog.questionCount,
      updatedAtMs: value.catalog.updatedAtMs,
    }) &&
    isNextQuestion(value.question, expectedSite)
  );
}

export function isHistoryResponse(value, expectedSite, expectedDayCount) {
  if (
    !hasExactKeys(value, ["days", "site", "timeZone", "today"]) ||
    value.site !== expectedSite ||
    !isSite(expectedSite) ||
    value.timeZone !== "Asia/Tokyo" ||
    !isCalendarDate(value.today) ||
    !Number.isSafeInteger(expectedDayCount) ||
    expectedDayCount < 1 ||
    expectedDayCount > 31 ||
    !Array.isArray(value.days) ||
    value.days.length !== expectedDayCount
  ) {
    return false;
  }
  const todayOrdinal = calendarDateOrdinal(value.today);
  let trackingStarted = false;
  return value.days.every((day, index) => {
    if (
      !hasExactKeys(day, HISTORY_DAY_KEYS) ||
      calendarDateOrdinal(day.date) !==
        todayOrdinal - expectedDayCount + index + 1 ||
      (day.closingStabilityDays !== null &&
        (!Number.isSafeInteger(day.closingStabilityDays) ||
          day.closingStabilityDays < 0)) ||
      (day.stabilityDaysDelta !== null &&
        !Number.isSafeInteger(day.stabilityDaysDelta)) ||
      !Number.isSafeInteger(day.dailyAttemptedQuestionCount) ||
      day.dailyAttemptedQuestionCount < 0 ||
      !Number.isSafeInteger(day.dailyNewQuestionCount) ||
      day.dailyNewQuestionCount < 0 ||
      day.dailyNewQuestionCount > day.dailyAttemptedQuestionCount ||
      !isCorrectRatePercent(day.dailyCorrectRatePercent) ||
      (day.dailyAttemptedQuestionCount === 0) !==
        (day.dailyCorrectRatePercent === null)
    ) {
      return false;
    }
    if (day.closingStabilityDays === null) {
      return !trackingStarted && day.stabilityDaysDelta === null;
    }
    if (day.stabilityDaysDelta === null) {
      return false;
    }
    trackingStarted = true;
    return true;
  });
}

export function isDashboardResponse(value) {
  if (
    !hasExactKeys(value, ["history", "selectedSite", "sites", "state"]) ||
    !isSitesResponse({ sites: value.sites })
  ) {
    return false;
  }
  if (value.sites.length === 0) {
    return (
      value.selectedSite === null && value.state === null && value.history === null
    );
  }
  if (
    !value.sites.includes(value.selectedSite) ||
    !isLearningState(value.state, value.selectedSite) ||
    value.state.catalog === null ||
    !isHistoryResponse(value.history, value.selectedSite, 31) ||
    value.history.today !== value.state.today
  ) {
    return false;
  }
  const metrics = value.state.learningMetrics;
  const today = value.history.days.at(-1);
  return (
    today.dailyAttemptedQuestionCount === metrics.todayAttemptedQuestionCount &&
    today.dailyNewQuestionCount === metrics.todayNewQuestionCount &&
    today.dailyCorrectRatePercent === metrics.todayCorrectRatePercent &&
    (today.closingStabilityDays === null
      ? metrics.stabilityDays === 0 &&
        metrics.todayStabilityDaysDelta === 0 &&
        today.stabilityDaysDelta === null
      : today.closingStabilityDays === metrics.stabilityDays &&
        today.stabilityDaysDelta === metrics.todayStabilityDaysDelta)
  );
}

export function isSitesResponse(value) {
  return (
    hasExactKeys(value, ["sites"]) &&
    Array.isArray(value.sites) &&
    value.sites.every(
      (site, index) =>
        isSite(site) && (index === 0 || value.sites[index - 1] < site),
    )
  );
}

export function isDailyDetailsResponse(value, expectedSite, expectedDate) {
  if (
    !hasExactKeys(value, ["date", "site", "tables", "timeZone"]) ||
    value.site !== expectedSite ||
    value.date !== expectedDate ||
    !isSite(expectedSite) ||
    !isCalendarDate(expectedDate) ||
    value.timeZone !== "Asia/Tokyo" ||
    !hasExactKeys(value.tables, ["attempts", "stability_history"]) ||
    !Array.isArray(value.tables.stability_history) ||
    value.tables.stability_history.length > 1 ||
    !Array.isArray(value.tables.attempts)
  ) {
    return false;
  }
  const validStabilityHistory = value.tables.stability_history.every(
    (row) =>
      hasExactKeys(row, RAW_TABLE_COLUMNS.stability_history) &&
      row.site === expectedSite &&
      row.date === expectedDate &&
      Number.isSafeInteger(row.opening_stability_days) &&
      row.opening_stability_days >= 0 &&
      Number.isSafeInteger(row.closing_stability_days) &&
      row.closing_stability_days >= 0 &&
      Number.isSafeInteger(row.attempted_question_count) &&
      row.attempted_question_count >= 0 &&
      Number.isSafeInteger(row.new_question_count) &&
      row.new_question_count >= 0 &&
      row.new_question_count <= row.attempted_question_count &&
      Number.isSafeInteger(row.attempt_count) &&
      row.attempt_count >= 0 &&
      Number.isSafeInteger(row.correct_attempt_count) &&
      row.correct_attempt_count >= 0 &&
      row.correct_attempt_count <= row.attempt_count,
  );
  const dateOrdinal = calendarDateOrdinal(expectedDate);
  const startMs = dateOrdinal * DAY_MS - TOKYO_OFFSET_MS;
  const endMs = startMs + DAY_MS;
  const validAttempts = value.tables.attempts.every(
    (row) =>
      hasExactKeys(row, RAW_TABLE_COLUMNS.attempts) &&
      row.site === expectedSite &&
      OPERATION_ID_PATTERN.test(row.operation_id) &&
      isQuestionId(row.question_id) &&
      Number.isSafeInteger(row.attempted_at_ms) &&
      row.attempted_at_ms >= startMs &&
      row.attempted_at_ms < endMs &&
      isAnswerResult(row.answer_result) &&
      Number.isFinite(row.previous_card_stability_days) &&
      row.previous_card_stability_days >= 0 &&
      Number.isFinite(row.resulting_card_stability_days) &&
      row.resulting_card_stability_days >= 0,
  );
  if (!validStabilityHistory || !validAttempts) {
    return false;
  }
  const history = value.tables.stability_history[0];
  if (history === undefined) {
    return value.tables.attempts.length === 0;
  }
  return (
    history.attempt_count === value.tables.attempts.length &&
    history.attempted_question_count ===
      new Set(value.tables.attempts.map((row) => row.question_id)).size &&
    history.correct_attempt_count ===
      value.tables.attempts.filter((row) => row.answer_result === "correct").length
  );
}

export function isSpeechTokenResponse(value) {
  return (
    hasExactKeys(value, ["expiresInSeconds", "token"]) &&
    typeof value.token === "string" &&
    value.token.length > 0 &&
    value.token.length <= 8192 &&
    !/\s/.test(value.token) &&
    value.expiresInSeconds === 600
  );
}

export function parseCelebration(search) {
  const parameters = new URLSearchParams(search);
  const keys = Array.from(parameters.keys()).sort();
  if (
    keys.length !== CELEBRATION_KEYS.length ||
    keys.some((key, index) => key !== CELEBRATION_KEYS[index])
  ) {
    throw new TypeError("Celebration parameters are invalid.");
  }
  const celebration = {
    dailyKpiCompleted: parameters.get("dailyKpiCompleted") === "true",
    date: parameters.get("date"),
    site: parameters.get("site"),
  };
  if (!isCelebration(celebration)) {
    throw new TypeError("Celebration identity or metrics are invalid.");
  }
  return celebration;
}

export function celebrationSearch(celebration) {
  if (!isCelebration(celebration)) {
    throw new TypeError("Celebration is invalid.");
  }
  const parameters = new URLSearchParams();
  for (const key of CELEBRATION_KEYS) {
    parameters.set(key, String(celebration[key]));
  }
  return parameters.toString();
}

export function isAnswerResult(value) {
  return value === "correct" || value === "incorrect";
}
