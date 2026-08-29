export const OPERATION_ID_PATTERN = /^[0-9a-f]{32}$/;
export const QUESTION_ID_PATTERN = /^\d+$/;
export const ANSWER_RESULTS = new Set(["correct", "incorrect"]);

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
  return [...questionIds].sort(compareQuestionIds);
}
