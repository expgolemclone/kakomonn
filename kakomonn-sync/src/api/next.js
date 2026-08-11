import { isSite } from "../auth.js";
import { QUESTION_ID_PATTERN } from "../contracts.js";
import { getLearningStateStub } from "../learning-store.js";
import { errorResponse, jsonResponse } from "../http.js";

export async function handleNext(url, env) {
  const keys = [...url.searchParams.keys()];
  if (
    keys.length < 1 ||
    keys.length > 2 ||
    keys.some((key) => key !== "site" && key !== "excludeQuestionId") ||
    url.searchParams.getAll("site").length !== 1 ||
    url.searchParams.getAll("excludeQuestionId").length > 1
  ) {
    return errorResponse("invalid_request", 400);
  }
  const site = url.searchParams.get("site");
  const excludeQuestionId = url.searchParams.get("excludeQuestionId");
  if (
    !isSite(site) ||
    (excludeQuestionId !== null && !QUESTION_ID_PATTERN.test(excludeQuestionId))
  ) {
    return errorResponse("invalid_request", 400);
  }
  const next = await getLearningStateStub(env).nextQuestion(
    site,
    Date.now(),
    excludeQuestionId
  );
  if (next?.error === "catalog_missing") {
    return errorResponse("catalog_missing", 409);
  }
  return jsonResponse({
    question:
      next.questionId === null
        ? null
        : {
            questionId: next.questionId,
            url: `https://${site}/questions/${next.questionId}`,
            kind: next.kind,
            dueMs: next.dueMs,
          },
  });
}
