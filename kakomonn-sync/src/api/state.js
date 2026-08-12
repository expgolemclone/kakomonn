import { isSite } from "../auth.js";
import { getStabilityStateStub } from "../learning-store.js";
import { errorResponse, jsonResponse } from "../http.js";

function singleSite(url) {
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== "site" || url.searchParams.getAll("site").length !== 1) {
    return null;
  }
  const site = url.searchParams.get("site");
  return isSite(site) ? site : null;
}

export async function handleState(url, env) {
  const site = singleSite(url);
  if (site === null) {
    return errorResponse("invalid_request", 400);
  }
  return jsonResponse(await getStabilityStateStub(env).getState(site));
}
