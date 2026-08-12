import { isSite } from "../auth.js";
import { dateOrdinal } from "../dates.js";
import { getStabilityStateStub } from "../learning-store.js";
import { errorResponse, jsonResponse } from "../http.js";

export async function handleDailyDetails(url, env) {
  const keys = [...url.searchParams.keys()].sort();
  if (
    keys.length !== 2 ||
    keys[0] !== "date" ||
    keys[1] !== "site" ||
    url.searchParams.getAll("date").length !== 1 ||
    url.searchParams.getAll("site").length !== 1
  ) {
    return errorResponse("invalid_request", 400);
  }
  const site = url.searchParams.get("site");
  const date = url.searchParams.get("date");
  if (!isSite(site) || dateOrdinal(date) === null) {
    return errorResponse("invalid_request", 400);
  }
  return jsonResponse(
    await getStabilityStateStub(env).getDailyDetails(site, date)
  );
}
