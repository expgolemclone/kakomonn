import { getLearningStateStub } from "../learning-store.js";
import { QUESTION_HISTORY_REPAIR_ID } from "../repair-question-history.js";
import { errorResponse, jsonResponse } from "../http.js";

export async function handleMaintenanceRepair(request, url, env) {
  if (url.search !== "") {
    return errorResponse("invalid_request", 400);
  }
  const stub = getLearningStateStub(env);
  if (request.method === "GET") {
    return jsonResponse(await stub.previewQuestionHistoryRepair());
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_request", 400);
  }
  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).sort().join(",") !== "digest,repairId" ||
    body.repairId !== QUESTION_HISTORY_REPAIR_ID ||
    typeof body.digest !== "string" ||
    !/^[0-9a-f]{16}$/.test(body.digest)
  ) {
    return errorResponse("invalid_request", 400);
  }
  const result = await stub.applyQuestionHistoryRepair(body.digest);
  return jsonResponse(result, result.error === undefined ? 200 : 409);
}
