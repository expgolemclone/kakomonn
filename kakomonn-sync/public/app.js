const TOKEN_STORAGE_KEY = "kakomonn-dashboard.sync-token";
const REQUEST_TIMEOUT_MS = 15_000;
const DAY_MILLISECONDS = 86_400_000;
const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

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
  settingsButton: required("settings-button"),
  weekView: required("week-view"),
  monthView: required("month-view"),
  previousPeriod: required("previous-period"),
  nextPeriod: required("next-period"),
  todayButton: required("today-button"),
  refreshButton: required("refresh-button"),
  periodTitle: required("period-title"),
  totalCount: required("total-count"),
  averageCount: required("average-count"),
  trackingNote: required("tracking-note"),
  chartScroller: required("chart-scroller"),
  chartFrame: required("chart-frame"),
  barChart: required("bar-chart"),
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
  today: "",
  availableFrom: "",
  anchorDate: "",
  view: "week",
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
  const monthIndex = year * 12 + (month - 1) + amount;
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
  if (view === "week") {
    return dateFromOrdinal(dateOrdinal(anchorDate) + amount * 7);
  }
  return shiftMonth(anchorDate, amount);
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

function isCountState(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    dateOrdinal(value.date) !== null &&
    Number.isSafeInteger(value.count) &&
    value.count >= 0 &&
    value.milestoneInterval === 50
  );
}

function isHistory(value, expectedRange) {
  if (
    value === null ||
    typeof value !== "object" ||
    value.timeZone !== "Asia/Tokyo" ||
    dateOrdinal(value.today) === null ||
    dateOrdinal(value.availableFrom) === null ||
    value.availableFrom > value.today ||
    value.from !== expectedRange.from ||
    value.to !== expectedRange.to ||
    !Array.isArray(value.days)
  ) {
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
      (entry.count === null ||
        (Number.isSafeInteger(entry.count) && entry.count >= 0))
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

async function fetchCount(token) {
  const value = await requestJSON("/v1/count", token);
  if (!isCountState(value)) {
    throw new DashboardError("invalid_response");
  }
  return value;
}

async function fetchHistory(token, range) {
  const query = new URLSearchParams({ from: range.from, to: range.to });
  const value = await requestJSON(`/v1/history?${query}`, token);
  if (!isHistory(value, range)) {
    throw new DashboardError("invalid_response");
  }
  return value;
}

function messageFor(error) {
  switch (error?.code) {
    case "unauthorized":
      return "同期tokenが正しくありません.";
    case "storage_unavailable":
      return "このbrowserへ同期tokenを保存できません. browserの保存設定を確認してください.";
    case "request_timeout":
      return "正解記録の読込みが時間内に完了しませんでした.";
    case "network_error":
      return "正解記録へ接続できません. 通信状態を確認してください.";
    case "server_misconfigured":
      return "同期APIにtokenが設定されていません.";
    case "invalid_response":
      return "同期APIから不正な応答を受け取りました.";
    case "invalid_request":
      return "表示期間が正しくありません.";
    default:
      return "正解記録を読み込めませんでした.";
  }
}

function setAuthBusy(busy) {
  elements.authToken.disabled = busy;
  elements.authSubmit.disabled = busy;
  elements.authSubmit.textContent = busy ? "確認中" : "記録を開く";
}

function setSettingsBusy(busy) {
  elements.settingsToken.disabled = busy;
  elements.saveToken.disabled = busy;
  elements.forgetToken.disabled = busy;
  elements.settingsClose.disabled = busy;
  elements.saveToken.textContent = busy ? "確認中" : "tokenを変更";
}

function showAuth(message = "") {
  elements.authPanel.hidden = false;
  elements.dashboard.hidden = true;
  elements.loadError.hidden = true;
  elements.settingsButton.hidden = true;
  elements.authMessage.textContent = message;
}

function showDashboard() {
  elements.authPanel.hidden = true;
  elements.dashboard.hidden = false;
  elements.loadError.hidden = true;
  elements.settingsButton.hidden = false;
}

function showLoadError(error, recoveryToken) {
  state.recoveryToken = recoveryToken;
  elements.authPanel.hidden = true;
  elements.dashboard.hidden = true;
  elements.settingsButton.hidden = true;
  elements.loadError.hidden = false;
  elements.errorMessage.textContent = messageFor(error);
}

function setDashboardBusy(busy) {
  state.loading = busy;
  elements.dashboard.setAttribute("aria-busy", String(busy));
  renderNavigation();
}

function niceMaximum(value) {
  if (value <= 0) {
    return 5;
  }
  const target = value * 1.12;
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const normalized = target / magnitude;
  const factor = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(
    (candidate) => candidate >= normalized
  );
  return factor * magnitude;
}

function formatScale(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function chooseSelectedDate(days) {
  const current = days.find(
    (day) => day.date === state.selectedDate && day.count !== null
  );
  if (current !== undefined) {
    return current.date;
  }
  const today = days.find(
    (day) => day.date === state.today && day.count !== null
  );
  if (today !== undefined) {
    return today.date;
  }
  const available = days.filter((day) => day.count !== null);
  return available.at(-1)?.date ?? "";
}

function renderDayDetail() {
  const day = state.history?.days.find(
    (entry) => entry.date === state.selectedDate
  );
  if (day === undefined || day.count === null) {
    elements.dayDetail.textContent = "";
    return;
  }
  elements.dayDetail.textContent = `${formatFullDate(day.date)} ${WEEKDAY_LABELS[weekday(day.date)]}曜日, ${day.count}問.`;
}

function selectDay(date) {
  state.selectedDate = date;
  for (const button of elements.barChart.querySelectorAll(".bar-button")) {
    button.setAttribute("aria-pressed", String(button.dataset.date === date));
  }
  renderDayDetail();
}

function positionSelectedDate() {
  if (state.view !== "month" || state.selectedDate === "") {
    elements.chartScroller.scrollLeft = 0;
    return;
  }
  window.requestAnimationFrame(() => {
    const selected = elements.barChart.querySelector(
      `[data-date="${state.selectedDate}"]`
    );
    if (selected === null) {
      return;
    }
    const target =
      selected.closest(".bar-slot").offsetLeft -
      elements.chartScroller.clientWidth / 2 +
      selected.clientWidth / 2;
    elements.chartScroller.scrollLeft = Math.max(0, target);
  });
}

function renderChart() {
  const days = state.history.days;
  const availableDays = days.filter((day) => day.count !== null);
  const total = availableDays.reduce((sum, day) => sum + day.count, 0);
  const maximum = niceMaximum(
    availableDays.reduce((result, day) => Math.max(result, day.count), 0)
  );
  state.selectedDate = chooseSelectedDate(days);

  elements.scaleMaximum.textContent = formatScale(maximum);
  elements.scaleMiddle.textContent = formatScale(maximum / 2);
  elements.chartFrame.classList.toggle("is-month", state.view === "month");
  elements.barChart.classList.toggle("is-month", state.view === "month");
  elements.barChart.style.setProperty("--day-count", String(days.length));
  elements.barChart.replaceChildren();

  for (const day of days) {
    const item = document.createElement("li");
    item.className = "bar-slot";
    const dayLabel = document.createElement("span");
    dayLabel.className = "day-label";
    const { day: dayNumber } = dateParts(day.date);
    dayLabel.append(String(dayNumber));
    const weekdayLabel = document.createElement("small");
    weekdayLabel.textContent = WEEKDAY_LABELS[weekday(day.date)];
    dayLabel.append(weekdayLabel);

    if (day.date === state.today) {
      const todayMarker = document.createElement("span");
      todayMarker.className = "today-marker";
      todayMarker.textContent = "今日";
      item.append(todayMarker);
    }

    if (day.count === null) {
      const empty = document.createElement("div");
      empty.className = "empty-bar";
      empty.setAttribute("aria-hidden", "true");
      item.setAttribute(
        "aria-label",
        day.date < state.availableFrom
          ? `${formatFullDate(day.date)}, 記録開始前.`
          : `${formatFullDate(day.date)}, 未来日.`
      );
      item.append(empty, dayLabel);
    } else {
      const button = document.createElement("button");
      button.className = "bar-button";
      button.type = "button";
      button.dataset.date = day.date;
      button.setAttribute("aria-pressed", String(day.date === state.selectedDate));
      button.setAttribute(
        "aria-label",
        `${formatFullDate(day.date)} ${WEEKDAY_LABELS[weekday(day.date)]}曜日, ${day.count}問.`
      );
      button.style.setProperty(
        "--bar-percent",
        `${(day.count / maximum) * 100}%`
      );
      const value = document.createElement("span");
      value.className = "bar-value";
      value.textContent = String(day.count);
      const fill = document.createElement("span");
      fill.className = "bar-fill";
      fill.setAttribute("aria-hidden", "true");
      button.append(value, fill);
      button.addEventListener("click", () => selectDay(day.date));
      item.append(button, dayLabel);
    }
    elements.barChart.append(item);
  }

  elements.emptyMessage.hidden = availableDays.length === 0 || total !== 0;
  renderDayDetail();
  positionSelectedDate();
}

function renderNavigation() {
  if (state.today === "" || state.anchorDate === "") {
    return;
  }
  const currentRange = rangeFor(state.view, state.anchorDate);
  const previousRange = rangeFor(
    state.view,
    shiftAnchor(state.view, state.anchorDate, -1)
  );
  elements.weekView.setAttribute("aria-pressed", String(state.view === "week"));
  elements.monthView.setAttribute("aria-pressed", String(state.view === "month"));
  elements.periodTitle.textContent = formatPeriod(state.view, currentRange);
  elements.previousPeriod.disabled =
    state.loading ||
    state.availableFrom === "" ||
    previousRange.to < state.availableFrom;
  elements.nextPeriod.disabled = state.loading || currentRange.to >= state.today;
  elements.todayButton.disabled =
    state.loading ||
    (currentRange.from <= state.today && currentRange.to >= state.today);
  elements.refreshButton.disabled = state.loading;
  elements.weekView.disabled = state.loading;
  elements.monthView.disabled = state.loading;
}

function renderDashboard() {
  const range = rangeFor(state.view, state.anchorDate);
  const availableDays = state.history.days.filter((day) => day.count !== null);
  const total = availableDays.reduce((sum, day) => sum + day.count, 0);
  const average = availableDays.length === 0 ? null : total / availableDays.length;
  elements.totalCount.textContent = availableDays.length === 0 ? "--" : String(total);
  elements.averageCount.textContent =
    average === null
      ? "--"
      : new Intl.NumberFormat("ja-JP", {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }).format(average);
  elements.trackingNote.textContent =
    range.from < state.availableFrom
      ? `記録は${formatShortDate(state.availableFrom)}から.`
      : `0問の日を含む${availableDays.length}日間.`;
  renderNavigation();
  renderChart();
  showDashboard();
  elements.dashboardStatus.textContent = `${new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date())}に更新しました.`;
}

async function loadSession(token, resetAnchor) {
  const count = await fetchCount(token);
  const anchorDate = resetAnchor || state.anchorDate === "" ? count.date : state.anchorDate;
  const range = rangeFor(state.view, anchorDate);
  const history = await fetchHistory(token, range);
  if (history.today !== count.date) {
    throw new DashboardError("invalid_response");
  }
  return { token, today: count.date, anchorDate, history };
}

function applySnapshot(snapshot) {
  state.token = snapshot.token;
  state.recoveryToken = snapshot.token;
  state.today = snapshot.today;
  state.anchorDate = snapshot.anchorDate;
  state.history = snapshot.history;
  state.availableFrom = snapshot.history.availableFrom;
  renderDashboard();
}

async function openWithToken(candidate, { persist, resetAnchor }) {
  const snapshot = await loadSession(candidate, resetAnchor);
  if (persist) {
    writeStoredToken(candidate);
  }
  applySnapshot(snapshot);
}

async function loadRange(view, anchorDate) {
  if (state.loading) {
    return;
  }
  setDashboardBusy(true);
  try {
    const range = rangeFor(view, anchorDate);
    const history = await fetchHistory(state.token, range);
    state.view = view;
    state.anchorDate = anchorDate;
    state.today = history.today;
    state.availableFrom = history.availableFrom;
    state.history = history;
    state.selectedDate = "";
    renderDashboard();
  } catch (error) {
    showLoadError(error, state.token);
  } finally {
    setDashboardBusy(false);
  }
}

async function refreshDashboard() {
  if (state.loading || state.token === "") {
    return;
  }
  const currentRange = rangeFor(state.view, state.anchorDate);
  const wasCurrent = currentRange.from <= state.today && currentRange.to >= state.today;
  setDashboardBusy(true);
  try {
    const snapshot = await loadSession(state.token, false);
    if (wasCurrent && snapshot.today !== state.today) {
      snapshot.anchorDate = snapshot.today;
      snapshot.history = await fetchHistory(
        state.token,
        rangeFor(state.view, snapshot.anchorDate)
      );
    }
    applySnapshot(snapshot);
  } catch (error) {
    showLoadError(error, state.token);
  } finally {
    setDashboardBusy(false);
  }
}

elements.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const candidate = elements.authToken.value.trim();
  if (candidate === "") {
    elements.authMessage.textContent = "同期tokenを入力してください.";
    return;
  }

  elements.authMessage.textContent = "";
  setAuthBusy(true);
  try {
    await openWithToken(candidate, { persist: true, resetAnchor: true });
    elements.authToken.value = "";
  } catch (error) {
    elements.authMessage.textContent = messageFor(error);
  } finally {
    setAuthBusy(false);
  }
});

elements.weekView.addEventListener("click", () => {
  if (state.view !== "week") {
    void loadRange("week", state.anchorDate);
  }
});

elements.monthView.addEventListener("click", () => {
  if (state.view !== "month") {
    void loadRange("month", state.anchorDate);
  }
});

elements.previousPeriod.addEventListener("click", () => {
  void loadRange(
    state.view,
    shiftAnchor(state.view, state.anchorDate, -1)
  );
});

elements.nextPeriod.addEventListener("click", () => {
  void loadRange(state.view, shiftAnchor(state.view, state.anchorDate, 1));
});

elements.todayButton.addEventListener("click", () => {
  void loadRange(state.view, state.today);
});

elements.refreshButton.addEventListener("click", () => {
  void refreshDashboard();
});

elements.retryButton.addEventListener("click", async () => {
  if (state.recoveryToken === "") {
    showAuth();
    return;
  }
  elements.retryButton.disabled = true;
  try {
    await openWithToken(state.recoveryToken, {
      persist: false,
      resetAnchor: state.anchorDate === "",
    });
  } catch (error) {
    if (error?.code === "unauthorized") {
      showAuth(messageFor(error));
    } else {
      showLoadError(error, state.recoveryToken);
    }
  } finally {
    elements.retryButton.disabled = false;
  }
});

elements.settingsButton.addEventListener("click", () => {
  elements.settingsToken.value = "";
  elements.settingsMessage.textContent = "";
  elements.settingsDialog.showModal();
  elements.settingsToken.focus();
});

elements.settingsClose.addEventListener("click", () => {
  elements.settingsDialog.close();
});

elements.settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const candidate = elements.settingsToken.value.trim();
  if (candidate === "") {
    elements.settingsMessage.textContent = "新しい同期tokenを入力してください.";
    return;
  }

  elements.settingsMessage.textContent = "";
  setSettingsBusy(true);
  try {
    const snapshot = await loadSession(candidate, false);
    writeStoredToken(candidate);
    applySnapshot(snapshot);
    elements.settingsDialog.close();
  } catch (error) {
    elements.settingsMessage.textContent = messageFor(error);
  } finally {
    setSettingsBusy(false);
  }
});

elements.forgetToken.addEventListener("click", () => {
  try {
    removeStoredToken();
  } catch (error) {
    elements.settingsMessage.textContent = messageFor(error);
    return;
  }
  state.token = "";
  state.recoveryToken = "";
  state.today = "";
  state.availableFrom = "";
  state.anchorDate = "";
  state.selectedDate = "";
  state.history = null;
  elements.settingsDialog.close();
  showAuth("この端末から同期tokenを削除しました.");
});

document.addEventListener("visibilitychange", () => {
  if (
    document.visibilityState === "visible" &&
    state.token !== "" &&
    !state.loading &&
    !elements.settingsDialog.open
  ) {
    void refreshDashboard();
  }
});

window.addEventListener("resize", positionSelectedDate);

async function start() {
  let storedToken;
  try {
    storedToken = readStoredToken();
  } catch (error) {
    showAuth(messageFor(error));
    setAuthBusy(true);
    return;
  }

  if (storedToken === "") {
    showAuth();
    return;
  }

  state.recoveryToken = storedToken;
  setAuthBusy(true);
  try {
    await openWithToken(storedToken, { persist: false, resetAnchor: true });
  } catch (error) {
    if (error?.code === "unauthorized") {
      showAuth(messageFor(error));
    } else {
      showLoadError(error, storedToken);
    }
  } finally {
    setAuthBusy(false);
  }
}

void start();
