export {
  OPERATION_ID_PATTERN,
  QUESTION_ID_PATTERN,
  isAnswerResult,
} from "../../contracts/kakomonn.mjs";

import { QUESTION_ID_PATTERN } from "../../contracts/kakomonn.mjs";

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
