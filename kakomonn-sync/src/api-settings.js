import { getLearningStateStub } from "./learning-store.js";
import { errorResponse, jsonResponse } from "./http.js";

export async function handleSettings(request, env) {
  const stub = getLearningStateStub(env);
  if (request.method === "GET") {
    return jsonResponse(await stub.getSettings());
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
    Object.keys(body).length !== 1 ||
    !Number.isSafeInteger(body.dailyMasteryGoal) ||
    body.dailyMasteryGoal < 1 ||
    body.dailyMasteryGoal > 100
  ) {
    return errorResponse("invalid_request", 400);
  }
  return jsonResponse(await stub.updateSettings(body.dailyMasteryGoal));
}
