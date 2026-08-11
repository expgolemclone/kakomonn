import { ANSWER_RESULTS, OPERATION_ID_PATTERN, QUESTION_ID_PATTERN } from "../contracts.js";
import { getLearningStateStub } from "../learning-store.js";
import { isSite } from "../auth.js";
import { errorResponse, jsonResponse } from "../http.js";

export async function handleAttempts(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_request", 400);
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return errorResponse("invalid_request", 400);
  }
  const keys = Object.keys(body).sort();
  if (
    keys.length !== 4 ||
    keys[0] !== "operationId" ||
    keys[1] !== "questionId" ||
    keys[2] !== "result" ||
    keys[3] !== "site" ||
    !isSite(body.site) ||
    typeof body.questionId !== "string" ||
    !QUESTION_ID_PATTERN.test(body.questionId) ||
    typeof body.operationId !== "string" ||
    !OPERATION_ID_PATTERN.test(body.operationId) ||
    !ANSWER_RESULTS.has(body.result)
  ) {
    return errorResponse("invalid_request", 400);
  }
  const result = await getLearningStateStub(env).recordAttempt(
    body.site,
    body.questionId,
    body.operationId,
    body.result
  );
  if (result?.error === "operation_conflict") {
    return errorResponse("operation_conflict", 409);
  }
  if (result?.error === "unknown_question") {
    return errorResponse("unknown_question", 409);
  }
  return jsonResponse(result);
}
