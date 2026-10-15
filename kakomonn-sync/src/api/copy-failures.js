import { isCopyFailure } from "../../../contracts/kakomonn.mjs";
import { getCopyFailureReportsStub } from "../copy-failure-reports.js";
import { errorResponse, jsonResponse } from "../http.js";

export async function handleCopyFailures(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_request", 400);
  }
  if (!isCopyFailure(body)) return errorResponse("invalid_request", 400);
  await getCopyFailureReportsStub(env).accept(body);
  return jsonResponse({ accepted: true });
}
