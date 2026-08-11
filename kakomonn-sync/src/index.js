import {
  DailyCount,
  getTokyoDate,
  handleRequest as handleV3Request,
  historyRangeFor,
  initializeSchema,
  issueSpeechToken as issueV3SpeechToken,
} from "./legacy-v3.js";
import { LearningState, getLearningStateStub } from "./learning-store.js";
import { isAuthorized } from "./auth.js";
import { errorResponse, jsonResponse } from "./http.js";
import { handleAttempts } from "./api-attempts.js";
import { handleState } from "./api-state.js";
import { handleHistory } from "./api-history.js";
import { handleNext } from "./api-next.js";
import { handleQuestions } from "./api-questions.js";
import { issueSpeechToken as issueV4SpeechToken } from "./speech.js";

export {
  DailyCount,
  LearningState,
  getTokyoDate,
  historyRangeFor,
  initializeSchema,
  issueV3SpeechToken,
};
export const issueSpeechToken = issueV3SpeechToken;
export * from "./fsrs.js";
export { initializeLearningSchema } from "./learning-store.js";

async function handleV4Request(request, env, fetcher = fetch) {
  const url = new URL(request.url);
  const routes = new Map([
    ["/v4/sites", "GET"],
    ["/v4/state", "GET"],
    ["/v4/history", "GET"],
    ["/v4/attempts", "POST"],
    ["/v4/next", "GET"],
    ["/v4/questions", "POST"],
    ["/v4/speech-token", "POST"],
  ]);
  const expectedMethod = routes.get(url.pathname);
  if (expectedMethod === undefined) {
    return errorResponse("not_found", 404);
  }
  if (request.method !== expectedMethod) {
    return errorResponse("method_not_allowed", 405, { Allow: expectedMethod });
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
  if (url.pathname === "/v4/speech-token") {
    if (url.search !== "") {
      return errorResponse("invalid_request", 400);
    }
    return issueV4SpeechToken(env, fetcher);
  }
  if (url.search !== "") {
    return errorResponse("invalid_request", 400);
  }
  if (url.pathname === "/v4/attempts") {
    return handleAttempts(request, env);
  }
  return handleQuestions(request, env);
}

export async function handleRequest(request, env, fetcher = fetch) {
  const pathname = new URL(request.url).pathname;
  if (pathname.startsWith("/v4/")) {
    return handleV4Request(request, env, fetcher);
  }
  return handleV3Request(request, env, fetcher);
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
