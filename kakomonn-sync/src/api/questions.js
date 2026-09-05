import { isSite } from "../auth.js";
import { QUESTION_ID_PATTERN } from "../contracts.js";
import { getLearningStateStub } from "../learning-store.js";
import { errorResponse, jsonResponse } from "../http.js";

export async function handleQuestions(request, env) {
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
    keys.length !== 3 ||
    keys[0] !== "expectedGeneration" ||
    keys[1] !== "questionIds" ||
    keys[2] !== "site" ||
    !isSite(body.site) ||
    !Number.isSafeInteger(body.expectedGeneration) ||
    body.expectedGeneration < 0 ||
    !Array.isArray(body.questionIds) ||
    body.questionIds.length === 0 ||
    body.questionIds.length > 10000 ||
    body.questionIds.some((value) => typeof value !== "string" || !QUESTION_ID_PATTERN.test(value)) ||
    new Set(body.questionIds).size !== body.questionIds.length
  ) {
    return errorResponse("invalid_request", 400);
  }
  const result = await getLearningStateStub(env).replaceCatalog(
    body.site,
    body.questionIds,
    body.expectedGeneration
  );
  if (result?.error === "catalog_conflict") {
    return jsonResponse(result, 409);
  }
  return jsonResponse(result);
}
