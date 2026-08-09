const TOKEN_STORAGE_KEY = "kakomonn-dashboard.sync-token";
const SITE_STORAGE_KEY = "kakomonn-dashboard.site";
const REQUEST_TIMEOUT_MS = 15_000;
const DAY_MILLISECONDS = 86_400_000;
const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

class DashboardError extends Error {
  constructor(code, status = null) {
    super(code);
    this.name = "DashboardError";
    this.code = code;
    this.status = status;
  }
}

function required(id) {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Required element is missing: ${id}`);
  }
  return element;
}

const elements = {
  authPanel: required("auth-panel"),
  authForm: required("auth-form"),
  authToken: required("auth-token"),
  authSubmit: required("auth-submit"),
  authMessage: required("auth-message"),
  dashboard: required("dashboard"),
  siteEmpty: required("site-empty"),
  siteSelect: required("site-select"),
  settingsButton: required("settings-button"),
  weekView: required("week-view"),
  monthView: required("month-view"),
  previousPeriod: required("previous-period"),
  nextPeriod: required("next-period"),
  todayButton: required("today-button"),
  refreshButton: required("refresh-button"),
  periodTitle: required("period-title"),
  totalCount: required("total-count"),
  totalAnswered: required("total-answered"),
  averageCount: required("average-count"),
  averageAnswered: required("average-answered"),
  trackingNote: required("tracking-note"),
  chartScroller: required("chart-scroller"),
  chartFrame: required("chart-frame"),
  barChart: required("bar-chart"),
  accuracyLine: required("accuracy-line"),
  accuracyPoints: required("accuracy-points"),
  scaleMaximum: required("scale-maximum"),
  scaleMiddle: required("scale-middle"),
  dayDetail: required("day-detail"),
  emptyMessage: required("empty-message"),
  dashboardStatus: required("dashboard-status"),
  loadError: required("load-error"),
  errorMessage: required("error-message"),
  retryButton: required("retry-button"),
  settingsDialog: required("settings-dialog"),
  settingsForm: required("settings-form"),
  settingsToken: required("settings-token"),
  settingsMessage: required("settings-message"),
  settingsClose: required("settings-close"),
  forgetToken: required("forget-token"),
  saveToken: required("save-token"),
};

const state = {
  token: "",
  recoveryToken: "",
  sites: [],
  site: "",
  today: "",
  availableFrom: { correct: "", answered: "" },
  anchorDate: "",
  view: "month",
  selectedDate: "",
  history: null,
  loading: false,
};

function dateOrdinal(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return null;
  }
  return Math.floor(date.getTime() / DAY_MILLISECONDS);
}

function dateFromOrdinal(ordinal) {
  return new Date(ordinal * DAY_MILLISECONDS).toISOString().slice(0, 10);
}

function dateParts(value) {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

function weekday(value) {
  return new Date(`${value}T00:00:00.000Z`).getUTCDay();
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function shiftMonth(value, amount) {
  const { year, month, day } = dateParts(value);
  const monthIndex = year * 12 + month - 1 + amount;
  const nextYear = Math.floor(monthIndex / 12);
  const nextMonth = ((monthIndex % 12) + 12) % 12 + 1;
  const nextDay = Math.min(day, daysInMonth(nextYear, nextMonth));
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-${String(nextDay).padStart(2, "0")}`;
}

function rangeFor(view, anchorDate) {
  if (view === "week") {
    const anchorOrdinal = dateOrdinal(anchorDate);
    const mondayOffset = (weekday(anchorDate) + 6) % 7;
    const fromOrdinal = anchorOrdinal - mondayOffset;
    return {
      from: dateFromOrdinal(fromOrdinal),
      to: dateFromOrdinal(fromOrdinal + 6),
    };
  }
  const { year, month } = dateParts(anchorDate);
  const prefix = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
  return {
    from: `${prefix}-01`,
    to: `${prefix}-${String(daysInMonth(year, month)).padStart(2, "0")}`,
  };
}

function shiftAnchor(view, anchorDate, amount) {
  return view === "week"
    ? dateFromOrdinal(dateOrdinal(anchorDate) + amount * 7)
    : shiftMonth(anchorDate, amount);
}

function formatFullDate(value) {
  const { year, month, day } = dateParts(value);
  return `${year}年${month}月${day}日`;
}

function formatShortDate(value) {
  const { month, day } = dateParts(value);
  return `${month}月${day}日`;
}

function formatPeriod(view, range) {
  if (view === "month") {
    const { year, month } = dateParts(range.from);
    return `${year}年${month}月`;
  }
  const from = dateParts(range.from);
  const to = dateParts(range.to);
  if (from.year === to.year && from.month === to.month) {
    return `${from.year}年${from.month}月${from.day}日 - ${to.day}日`;
  }
  if (from.year === to.year) {
    return `${from.year}年${from.month}月${from.day}日 - ${to.month}月${to.day}日`;
  }
  return `${formatFullDate(range.from)} - ${formatFullDate(range.to)}`;
}

function readStoredToken() {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY) ?? "";
  } catch {
    throw new DashboardError("storage_unavailable");
  }
}

function writeStoredToken(token) {
  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    throw new DashboardError("storage_unavailable");
  }
}

function removeStoredToken() {
  try {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    throw new DashboardError("storage_unavailable");
  }
}

function readStoredSite() {
  try {
    return window.localStorage.getItem(SITE_STORAGE_KEY) ?? "";
  } catch {
    throw new DashboardError("storage_unavailable");
  }
}

function writeStoredSite(site) {
  try {
    window.localStorage.setItem(SITE_STORAGE_KEY, site);
  } catch {
    throw new DashboardError("storage_unavailable");
  }
}

function removeStoredSite() {
  try {
    window.localStorage.removeItem(SITE_STORAGE_KEY);
  } catch {
    throw new DashboardError("storage_unavailable");
  }
}

function isSite(value) {
  return (
    typeof value === "string" &&
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.kakomonn\.com$/.test(value)
  );
}

function isCountPair(value, { nullable }) {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const validCount = (count) =>
    (nullable && count === null) ||
    (Number.isSafeInteger(count) && count >= 0);
  return (
    validCount(value.correct) &&
    validCount(value.answered) &&
    (value.correct === null || value.answered === null || value.answered >= value.correct)
  );
}

function isHistory(value, expectedSite, expectedView, requestedAnchor) {
  if (
    value === null ||
    typeof value !== "object" ||
    value.site !== expectedSite ||
    value.timeZone !== "Asia/Tokyo" ||
    dateOrdinal(value.today) === null ||
    value.availableFrom === null ||
    typeof value.availableFrom !== "object" ||
    dateOrdinal(value.availableFrom.correct) === null ||
    dateOrdinal(value.availableFrom.answered) === null ||
    value.availableFrom.correct > value.today ||
    value.availableFrom.answered < value.availableFrom.correct ||
    dateOrdinal(value.availableFrom.answered) > dateOrdinal(value.today) + 1 ||
    !Array.isArray(value.days)
  ) {
    return false;
  }
  const anchorDate = requestedAnchor === "today" ? value.today : requestedAnchor;
  const expectedRange = rangeFor(expectedView, anchorDate);
  if (value.from !== expectedRange.from || value.to !== expectedRange.to) {
    return false;
  }
  const fromOrdinal = dateOrdinal(expectedRange.from);
  const toOrdinal = dateOrdinal(expectedRange.to);
  if (value.days.length !== toOrdinal - fromOrdinal + 1) {
    return false;
  }
  return value.days.every((entry, index) => {
    const expectedDate = dateFromOrdinal(fromOrdinal + index);
    return (
      entry !== null &&
      typeof entry === "object" &&
      entry.date === expectedDate &&
      isCountPair(entry.counts, { nullable: true }) &&
      (entry.counts.correct === null) ===
        (entry.date < value.availableFrom.correct || entry.date > value.today) &&
      (entry.counts.answered === null) ===
        (entry.date < value.availableFrom.answered || entry.date > value.today)
    );
  });
}

async function requestJSON(path, token) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(path, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new DashboardError("request_timeout");
    }
    throw new DashboardError("network_error");
  } finally {
    window.clearTimeout(timeout);
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new DashboardError("invalid_response", response.status);
  }
  if (!response.ok) {
    throw new DashboardError(
      typeof body?.error === "string" ? body.error : "request_failed",
      response.status
    );
  }
  return body;
}

async function fetchSites(token) {
  const value = await requestJSON("/v3/sites", token);
  if (
    value === null ||
    typeof value !== "object" ||
    !Array.isArray(value.sites) ||
    value.sites.some((site) => !isSite(site)) ||
    new Set(value.sites).size !== value.sites.length ||
    value.sites.some((site, index) => index > 0 && value.sites[index - 1] >= site)
  ) {
    throw new DashboardError("invalid_response");
  }
  return value.sites;
}

async function fetchHistory(token, site, view, anchor) {
  const query = new URLSearchParams({ site, view, anchor });
  const value = await requestJSON(`/v3/history?${query}`, token);
  if (!isHistory(value, site, view, anchor)) {
    throw new DashboardError("invalid_response");
  }
  return value;
}
