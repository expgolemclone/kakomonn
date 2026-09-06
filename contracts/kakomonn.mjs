export const SITE_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.kakomonn\.com$/;
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const OPERATION_ID_PATTERN = /^[0-9a-f]{32}$/;
export const QUESTION_ID_PATTERN = /^\d+$/;

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

function isCorrectRatePercent(value) {
  return (
    value === null ||
    (Number.isSafeInteger(value) && value >= 0 && value <= 100)
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
    Number.isSafeInteger(value.todayStabilityDaysDelta) &&
    Number.isSafeInteger(value.attemptedQuestionCount) &&
    value.attemptedQuestionCount >= 0 &&
    Number.isSafeInteger(value.todayAttemptedQuestionCount) &&
    value.todayAttemptedQuestionCount >= 0 &&
    isCorrectRatePercent(value.todayCorrectRatePercent)
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
