import {
  DASHBOARD_BRIDGE_REQUEST_EVENT,
  DASHBOARD_BRIDGE_RESPONSE_EVENT,
  DASHBOARD_BRIDGE_STATE_ATTRIBUTE,
  dashboardBridgeRequestId,
  isDashboardBridgeRequest,
} from "../../contracts/dashboard-bridge.mjs";
import {
  isDailyDetailsResponse,
  isDashboardResponse,
} from "../../contracts/kakomonn.mjs";

export function installDashboardBridge({
  gm,
  requestSyncResponse,
  syncTokenKey,
}) {
  function respond(response) {
    document.dispatchEvent(
      new CustomEvent(DASHBOARD_BRIDGE_RESPONSE_EVENT, {
        detail: JSON.stringify(response),
      }),
    );
  }

  function respondWithError(id, code, status = 0) {
    respond({ code, id, ok: false, status });
  }

  async function handleRequest(event) {
    let request;
    try {
      request = JSON.parse(event.detail);
    } catch {
      return;
    }
    const id = dashboardBridgeRequestId(request);
    if (id === null) {
      return;
    }
    if (!isDashboardBridgeRequest(request)) {
      respondWithError(id, "invalid_request");
      return;
    }

    let storedToken;
    try {
      storedToken = await gm.getValue(syncTokenKey, "");
    } catch {
      respondWithError(id, "storage_unavailable");
      return;
    }
    const token = typeof storedToken === "string" ? storedToken.trim() : "";
    if (token === "") {
      respondWithError(id, "token_missing");
      return;
    }

    try {
      let data;
      if (request.operation === "dashboard") {
        const parameters = new URLSearchParams();
        if (request.site !== null) {
          parameters.set("site", request.site);
        }
        const suffix = parameters.size === 0 ? "" : `?${parameters}`;
        data = await requestSyncResponse(
          "GET",
          `/v11/dashboard${suffix}`,
          token,
          isDashboardResponse,
        );
      } else {
        const parameters = new URLSearchParams({
          date: request.date,
          site: request.site,
        });
        data = await requestSyncResponse(
          "GET",
          `/v11/daily-details?${parameters}`,
          token,
          (value) =>
            isDailyDetailsResponse(value, request.site, request.date),
        );
      }
      respond({ data, id, ok: true });
    } catch (error) {
      respondWithError(
        id,
        typeof error?.code === "string" ? error.code : "request_failed",
        Number.isSafeInteger(error?.status) ? error.status : 0,
      );
    }
  }

  document.addEventListener(DASHBOARD_BRIDGE_REQUEST_EVENT, (event) => {
    void handleRequest(event);
  });
  document.documentElement.setAttribute(
    DASHBOARD_BRIDGE_STATE_ATTRIBUTE,
    "ready",
  );
}
