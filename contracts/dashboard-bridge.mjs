import { hasExactKeys, isCalendarDate, isSite } from "./kakomonn.mjs";

export const DASHBOARD_BRIDGE_STATE_ATTRIBUTE =
  "data-kakomonn-dashboard-bridge-state";
export const DASHBOARD_BRIDGE_REQUEST_EVENT =
  "kakomonn-dashboard:request";
export const DASHBOARD_BRIDGE_RESPONSE_EVENT =
  "kakomonn-dashboard:response";
export const DASHBOARD_BRIDGE_TIMEOUT_MS = 15_000;

function isRequestId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export function isDashboardBridgeRequest(value) {
  if (!isRequestId(value?.id)) {
    return false;
  }
  if (value.operation === "dashboard") {
    return (
      hasExactKeys(value, ["id", "operation", "site"]) &&
      (value.site === null || isSite(value.site))
    );
  }
  if (value.operation === "daily-details") {
    return (
      hasExactKeys(value, ["date", "id", "operation", "site"]) &&
      isSite(value.site) &&
      isCalendarDate(value.date)
    );
  }
  return false;
}

export function dashboardBridgeRequestId(value) {
  return isRequestId(value?.id) ? value.id : null;
}

export function isDashboardBridgeResponse(value, expectedId) {
  if (!isRequestId(expectedId) || value?.id !== expectedId) {
    return false;
  }
  if (value.ok === true) {
    return (
      hasExactKeys(value, ["data", "id", "ok"]) &&
      value.data !== null &&
      typeof value.data === "object" &&
      !Array.isArray(value.data)
    );
  }
  return (
    value.ok === false &&
    hasExactKeys(value, ["code", "id", "ok", "status"]) &&
    typeof value.code === "string" &&
    /^[a-z][a-z0-9_]*$/.test(value.code) &&
    Number.isSafeInteger(value.status) &&
    value.status >= 0 &&
    value.status <= 599
  );
}
