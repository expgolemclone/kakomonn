import { StabilityState, getStabilityStateStub } from "./learning-store.js";
import { isAuthorized } from "./auth.js";
import { errorResponse, jsonResponse } from "./http.js";
import { handleAttempts } from "./api/attempts.js";
import { handleState } from "./api/state.js";
import { handleHistory } from "./api/history.js";
import { handleDailyDetails } from "./api/daily-details.js";
import { handleNext } from "./api/next.js";
import { handleQuestions } from "./api/questions.js";
import { handleSettings } from "./api/settings.js";
import { issueSpeechToken } from "./speech.js";

export { StabilityState, issueSpeechToken };
export * from "./fsrs.js";
export { initializeLearningSchema } from "./learning-store.js";

export async function handleRequest(request, env, fetcher = fetch) {
  const url = new URL(request.url);
  const routes = new Map([
    ["/v5/sites", ["GET"]],
    ["/v5/state", ["GET"]],
    ["/v5/history", ["GET"]],
    ["/v5/daily-details", ["GET"]],
    ["/v5/attempts", ["POST"]],
    ["/v5/next", ["GET"]],
    ["/v5/questions", ["POST"]],
    ["/v5/settings", ["GET", "PUT"]],
    ["/v5/speech-token", ["POST"]],
  ]);
  const expectedMethods = routes.get(url.pathname);
  if (expectedMethods === undefined) {
    return errorResponse("not_found", 404);
  }
  if (!expectedMethods.includes(request.method)) {
    return errorResponse("method_not_allowed", 405, {
      Allow: expectedMethods.join(", "),
    });
  }
  const authorized = await isAuthorized(request, env);
  if (authorized === null) {
    return errorResponse("server_misconfigured", 500);
  }
  if (!authorized) {
    return errorResponse("unauthorized", 401);
  }

  if (url.pathname === "/v5/sites") {
    if (url.search !== "") {
      return errorResponse("invalid_request", 400);
    }
    return jsonResponse({ sites: await getStabilityStateStub(env).listSites() });
  }
  if (url.pathname === "/v5/state") {
    return handleState(url, env);
  }
  if (url.pathname === "/v5/history") {
    return handleHistory(url, env);
  }
  if (url.pathname === "/v5/daily-details") {
    return handleDailyDetails(url, env);
  }
  if (url.pathname === "/v5/next") {
    return handleNext(url, env);
  }
  if (url.pathname === "/v5/settings") {
    return handleSettings(request, url, env);
  }
  if (url.pathname === "/v5/speech-token") {
    if (url.search !== "") {
      return errorResponse("invalid_request", 400);
    }
    return issueSpeechToken(env, fetcher);
  }
  if (url.search !== "") {
    return errorResponse("invalid_request", 400);
  }
  if (url.pathname === "/v5/attempts") {
    return handleAttempts(request, env);
  }
  return handleQuestions(request, env);
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
