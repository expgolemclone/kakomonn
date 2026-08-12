import { isSite } from "../auth.js";
import { getStabilityStateStub } from "../learning-store.js";
import { errorResponse, jsonResponse } from "../http.js";

export async function handleHistory(url, env) {
  const keys = [...url.searchParams.keys()].sort();
  if (
    keys.length !== 2 ||
    keys[0] !== "days" ||
    keys[1] !== "site" ||
    url.searchParams.getAll("days").length !== 1 ||
    url.searchParams.getAll("site").length !== 1
  ) {
    return errorResponse("invalid_request", 400);
  }
  const site = url.searchParams.get("site");
  const daysText = url.searchParams.get("days");
  if (!isSite(site) || !/^\d+$/.test(daysText)) {
    return errorResponse("invalid_request", 400);
  }
  const days = Number(daysText);
  if (!Number.isSafeInteger(days) || days < 1 || days > 31) {
    return errorResponse("invalid_request", 400);
  }
  return jsonResponse(await getStabilityStateStub(env).getHistory(site, days));
}
