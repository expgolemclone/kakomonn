import { LearningState, getLearningStateStub } from "./learning-store.js";
import { isAuthorized } from "./auth.js";
import { errorResponse, jsonResponse } from "./http.js";
import { handleAttempts } from "./api-attempts.js";
import { handleState } from "./api-state.js";
import { handleHistory } from "./api-history.js";
import { handleNext } from "./api-next.js";
import { handleQuestions } from "./api-questions.js";
import { handleSettings } from "./api-settings.js";
import { issueSpeechToken } from "./speech.js";

export { LearningState, issueSpeechToken };
export * from "./fsrs.js";
export { initializeLearningSchema } from "./learning-store.js";

export async function handleRequest(request, env, fetcher = fetch) {
  const url = new URL(request.url);
  const routes = new Map([
    ["/v4/sites", ["GET"]],
    ["/v4/state", ["GET"]],
    ["/v4/history", ["GET"]],
    ["/v4/attempts", ["POST"]],
    ["/v4/next", ["GET"]],
    ["/v4/questions", ["POST"]],
    ["/v4/settings", ["GET", "PUT"]],
    ["/v4/speech-token", ["POST"]],
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

  if (url.pathname === "/v4/sites") {
    if (url.search !== "") {
      return errorResponse("invalid_request", 400);
    }
    return jsonResponse({ sites: await getLearningStateStub(env).listSites() });
  }
  if (url.pathname === "/v4/state") {
    return handleState(url, env);
  }
  if (url.pathname === "/v4/history") {
    return handleHistory(url, env);
  }
  if (url.pathname === "/v4/next") {
    return handleNext(url, env);
  }
  if (url.pathname === "/v4/settings") {
    if (url.search !== "") {
      return errorResponse("invalid_request", 400);
    }
    return handleSettings(request, env);
  }
  if (url.pathname === "/v4/speech-token") {
    if (url.search !== "") {
      return errorResponse("invalid_request", 400);
    }
    return issueSpeechToken(env, fetcher);
  }
  if (url.search !== "") {
    return errorResponse("invalid_request", 400);
  }
  if (url.pathname === "/v4/attempts") {
    return handleAttempts(request, env);
  }
  return handleQuestions(request, env);
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
