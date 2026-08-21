import { isSite } from "../auth.js";
import { getLearningStateStub } from "../learning-store.js";
import { errorResponse, jsonResponse } from "../http.js";

export async function handleDashboard(url, env) {
  const keys = [...url.searchParams.keys()];
  if (
    keys.length > 1 ||
    keys.some((key) => key !== "site") ||
    url.searchParams.getAll("site").length > 1
  ) {
    return errorResponse("invalid_request", 400);
  }
  const site = url.searchParams.get("site");
  if (site !== null && !isSite(site)) {
    return errorResponse("invalid_request", 400);
  }
  return jsonResponse(await getLearningStateStub(env).getDashboard(site));
}
