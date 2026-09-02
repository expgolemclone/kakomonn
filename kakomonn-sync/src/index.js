import { LearningState, getLearningStateStub } from "./learning-store.js";
import { isAuthorized } from "./auth.js";
import { errorResponse, jsonResponse } from "./http.js";
import { handleAttempts } from "./api/attempts.js";
import { handleState } from "./api/state.js";
import { handleHistory } from "./api/history.js";
import { handleDailyDetails } from "./api/daily-details.js";
import { handleDashboard } from "./api/dashboard.js";
import { handleNext } from "./api/next.js";
import { handleQuestions } from "./api/questions.js";
import { issueSpeechToken } from "./speech.js";

export { LearningState, issueSpeechToken };
export * from "./fsrs.js";
export { initializeLearningSchema } from "./learning-store.js";

const API_PREFIX = "/v10";

export async function handleRequest(request, env, fetcher = fetch) {
  const url = new URL(request.url);
  const routes = new Map([
    ["/sites", ["GET"]],
    ["/state", ["GET"]],
    ["/history", ["GET"]],
    ["/daily-details", ["GET"]],
    ["/dashboard", ["GET"]],
    ["/attempts", ["POST"]],
    ["/next", ["GET"]],
    ["/questions", ["POST"]],
    ["/speech-token", ["POST"]],
  ]);
  if (!url.pathname.startsWith(`${API_PREFIX}/`)) {
    return errorResponse("not_found", 404);
  }
  const route = url.pathname.slice(API_PREFIX.length);
  const expectedMethods = routes.get(route);
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

  if (route === "/sites") {
    if (url.search !== "") {
      return errorResponse("invalid_request", 400);
    }
    return jsonResponse({ sites: await getLearningStateStub(env).listSites() });
  }
  if (route === "/state") {
    return handleState(url, env);
  }
  if (route === "/history") {
    return handleHistory(url, env);
  }
  if (route === "/daily-details") {
    return handleDailyDetails(url, env);
  }
  if (route === "/dashboard") {
    return handleDashboard(url, env);
  }
  if (route === "/next") {
    return handleNext(url, env);
  }
  if (route === "/speech-token") {
    if (url.search !== "") {
      return errorResponse("invalid_request", 400);
    }
    return issueSpeechToken(env, fetcher);
  }
  if (url.search !== "") {
    return errorResponse("invalid_request", 400);
  }
  if (route === "/attempts") {
    return handleAttempts(request, env);
  }
  return handleQuestions(request, env);
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
