import { isStudyTimeSnapshots } from "../../../contracts/kakomonn.mjs";
import { getLearningStateStub } from "../learning-store.js";
import { isSite } from "../auth.js";
import { errorResponse, jsonResponse } from "../http.js";

export async function handleStudyTime(request, env) {
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
    Object.keys(body).sort().join(",") !== "site,studyTimeSnapshots" ||
    !isSite(body.site) ||
    !isStudyTimeSnapshots(body.studyTimeSnapshots) ||
    body.studyTimeSnapshots.length === 0
  ) {
    return errorResponse("invalid_request", 400);
  }
  return jsonResponse(
    await getLearningStateStub(env).recordStudyTime(
      body.site,
      body.studyTimeSnapshots,
    ),
  );
}
