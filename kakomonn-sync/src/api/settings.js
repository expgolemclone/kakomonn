import { isSite } from "../auth.js";
import { isDailyStabilitySettings } from "../contracts.js";
import { getStabilityStateStub } from "../learning-store.js";
import { errorResponse, jsonResponse } from "../http.js";

function singleSite(url) {
  const keys = [...url.searchParams.keys()];
  if (
    keys.length !== 1 ||
    keys[0] !== "site" ||
    url.searchParams.getAll("site").length !== 1
  ) {
    return null;
  }
  const site = url.searchParams.get("site");
  return isSite(site) ? site : null;
}

export async function handleSettings(request, url, env) {
  const stub = getStabilityStateStub(env);
  if (request.method === "GET") {
    const site = singleSite(url);
    if (site === null) {
      return errorResponse("invalid_request", 400);
    }
    return jsonResponse(await stub.getSettings(site));
  }

  if (url.search !== "") {
    return errorResponse("invalid_request", 400);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_request", 400);
  }
  if (!isDailyStabilitySettings(body) || !isSite(body.site)) {
    return errorResponse("invalid_request", 400);
  }
  return jsonResponse(
    await stub.updateSettings(body.site, body.dailyStabilityDaysGoal)
  );
}
