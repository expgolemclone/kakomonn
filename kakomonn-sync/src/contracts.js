export const OPERATION_ID_PATTERN = /^[0-9a-f]{32}$/;
export const QUESTION_ID_PATTERN = /^\d+$/;
export const ANSWER_RESULTS = new Set(["correct", "incorrect"]);

export function isDailyMasterySettings(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    Number.isSafeInteger(value.dailyMasteryGoal) &&
    value.dailyMasteryGoal >= 1 &&
    value.dailyMasteryGoal <= 100
  );
}
