const TOKEN_KEY = "kakomonn-dashboard.sync-token";
const SITE_KEY = "kakomonn-dashboard.site";
const API_TIMEOUT_MS = 15000;
const SVG_NS = "http://www.w3.org/2000/svg";
const DASHBOARD_HISTORY_DAYS = 31;
const CHART_DAY_WIDTH = 88;
const CHART_RIGHT_PADDING = 24;
const STABILITY_CHART_TOP = 26;
const STABILITY_CHART_BOTTOM = 218;
const CORRECT_RATE_CHART_TOP = 276;
const CORRECT_RATE_CHART_BOTTOM = 400;
const CHART_DATE_Y = 440;
const CHART_HEIGHT = 456;

const byId = (id) => {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`missing element: ${id}`);
  return element;
};

const el = {
  authPanel: byId("auth-panel"), authForm: byId("auth-form"), authToken: byId("auth-token"), authMessage: byId("auth-message"),
  dashboard: byId("dashboard"), siteEmpty: byId("site-empty"), loadError: byId("load-error"), errorMessage: byId("error-message"), retryButton: byId("retry-button"),
  settingsButton: byId("settings-button"), settingsDialog: byId("settings-dialog"), settingsForm: byId("settings-form"), settingsToken: byId("settings-token"), settingsMessage: byId("settings-message"), settingsClose: byId("settings-close"), forgetToken: byId("forget-token"),
  siteSelect: byId("site-select"), refreshButton: byId("refresh-button"), dailyKpiCompletedElement: byId("daily-kpi-completed"), dueCardsRemainingElement: byId("due-cards-remaining"), newQuestionsRemainingElement: byId("new-questions-remaining"), todayStabilityDaysDeltaElement: byId("today-stability-days-delta"), stabilityDaysElement: byId("stability-days"), attemptedQuestionCountElement: byId("attempted-question-count"), todayAttemptedQuestionCountElement: byId("today-attempted-question-count"), todayCorrectRatePercentElement: byId("today-correct-rate-percent"), todayCorrectRatePercentUnit: byId("today-correct-rate-percent-unit"), stabilityChartAxis: byId("stability-chart-axis"), historyScroll: byId("history-scroll"), stabilityChart: byId("stability-chart"), historyEmpty: byId("history-empty"), dashboardStatus: byId("dashboard-status"),
  dailyDetails: byId("daily-details"), dailyDetailsDate: byId("daily-details-date"), dailyDetailsInstruction: byId("daily-details-instruction"), dailyDetailsStatus: byId("daily-details-status"), dailyDetailsTables: byId("daily-details-tables"), stabilityHistoryTable: byId("stability-history-table"), attemptsTable: byId("attempts-table"),
};

const state = { token: "", site: "", sites: [], learning: null, history: null, selectedDate: "", dailyDetails: null };
let loadGeneration = 0;
let detailGeneration = 0;
const RAW_TABLE_COLUMNS = {
  stability_history: ["site", "date", "opening_stability_days", "closing_stability_days", "attempted_question_count", "new_question_count", "attempt_count", "correct_attempt_count"],
  attempts: ["site", "operation_id", "question_id", "attempted_at_ms", "answer_result", "previous_card_stability_days", "resulting_card_stability_days"],
};

class DashboardError extends Error {
  constructor(code, status = 0) { super(code); this.code = code; this.status = status; }
}

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { throw new DashboardError("storage_unavailable"); }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { throw new DashboardError("storage_unavailable"); }
}
function storageRemove(key) {
  try { localStorage.removeItem(key); } catch { throw new DashboardError("storage_unavailable"); }
}

function validSite(value) {
  return typeof value === "string" && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.kakomonn\.com$/.test(value);
}
function validCorrectRatePercent(value) {
  return value === null || (Number.isSafeInteger(value) && value >= 0 && value <= 100);
}
function validLearningMetrics(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Number.isSafeInteger(value.stabilityDays) && value.stabilityDays >= 0 && typeof value.dailyKpiCompleted === "boolean" && typeof value.dueCardsCompleted === "boolean" && Number.isSafeInteger(value.dueCardsRemaining) && value.dueCardsRemaining >= 0 && value.dueCardsCompleted === (value.dueCardsRemaining === 0) && Number.isSafeInteger(value.todayNewQuestionCount) && value.todayNewQuestionCount >= 0 && value.newQuestionGoal === 100 && Number.isSafeInteger(value.newQuestionsRemaining) && value.newQuestionsRemaining === Math.max(0, value.newQuestionGoal - value.todayNewQuestionCount) && value.dailyKpiCompleted === (value.dueCardsCompleted && value.newQuestionsRemaining === 0) && Number.isSafeInteger(value.todayStabilityDaysDelta) && Number.isSafeInteger(value.attemptedQuestionCount) && value.attemptedQuestionCount >= 0 && Number.isSafeInteger(value.todayAttemptedQuestionCount) && value.todayAttemptedQuestionCount >= 0 && validCorrectRatePercent(value.todayCorrectRatePercent);
}
function validState(value, site) {
  return value && value.site === site && /^\d{4}-\d{2}-\d{2}$/.test(value.today) && validLearningMetrics(value.learningMetrics);
}
function validHistory(value, site) {
  return value && value.site === site && Array.isArray(value.days) && value.days.length === DASHBOARD_HISTORY_DAYS && value.days.every((day) => /^\d{4}-\d{2}-\d{2}$/.test(day.date) && (day.closingStabilityDays === null || (Number.isSafeInteger(day.closingStabilityDays) && day.closingStabilityDays >= 0)) && (day.stabilityDaysDelta === null || Number.isSafeInteger(day.stabilityDaysDelta)) && Number.isSafeInteger(day.dailyAttemptedQuestionCount) && day.dailyAttemptedQuestionCount >= 0 && Number.isSafeInteger(day.dailyNewQuestionCount) && day.dailyNewQuestionCount >= 0 && validCorrectRatePercent(day.dailyCorrectRatePercent));
}
function validDashboard(value) {
  if (!hasExactKeys(value, ["sites", "selectedSite", "state", "history"]) || !Array.isArray(value.sites) || value.sites.some((site) => !validSite(site)) || new Set(value.sites).size !== value.sites.length) return false;
  if (value.sites.length === 0) return value.selectedSite === null && value.state === null && value.history === null;
  return validSite(value.selectedSite) && value.sites.includes(value.selectedSite) && validState(value.state, value.selectedSite) && validHistory(value.history, value.selectedSite);
}
function hasExactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}
function validDailyDetails(value, site, date) {
  if (!hasExactKeys(value, ["site", "date", "timeZone", "tables"]) || value.site !== site || value.date !== date || value.timeZone !== "Asia/Tokyo" || !hasExactKeys(value.tables, ["stability_history", "attempts"]) || !Array.isArray(value.tables.stability_history) || value.tables.stability_history.length > 1 || !Array.isArray(value.tables.attempts)) return false;
  const validStabilityHistory = value.tables.stability_history.every((row) => hasExactKeys(row, RAW_TABLE_COLUMNS.stability_history) && row.site === site && row.date === date && Number.isSafeInteger(row.opening_stability_days) && row.opening_stability_days >= 0 && Number.isSafeInteger(row.closing_stability_days) && row.closing_stability_days >= 0 && Number.isSafeInteger(row.attempted_question_count) && row.attempted_question_count >= 0 && Number.isSafeInteger(row.new_question_count) && row.new_question_count >= 0 && Number.isSafeInteger(row.attempt_count) && row.attempt_count >= 0 && Number.isSafeInteger(row.correct_attempt_count) && row.correct_attempt_count >= 0 && row.correct_attempt_count <= row.attempt_count);
  const validAttempts = value.tables.attempts.every((row) => hasExactKeys(row, RAW_TABLE_COLUMNS.attempts) && row.site === site && /^[0-9a-f]{32}$/.test(row.operation_id) && /^\d+$/.test(row.question_id) && Number.isSafeInteger(row.attempted_at_ms) && row.attempted_at_ms > 0 && (row.answer_result === "correct" || row.answer_result === "incorrect") && Number.isFinite(row.previous_card_stability_days) && row.previous_card_stability_days >= 0 && Number.isFinite(row.resulting_card_stability_days) && row.resulting_card_stability_days >= 0);
  return validStabilityHistory && validAttempts;
}

async function requestJSON(path, token, { method = "GET", body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  let response;
  try {
    const headers = { Authorization: `Bearer ${token}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", signal: controller.signal });
  } catch (error) {
    throw new DashboardError(error?.name === "AbortError" ? "timeout" : "network_error");
  } finally {
    clearTimeout(timer);
  }
  let responseBody;
  try { responseBody = await response.json(); } catch { throw new DashboardError("invalid_response", response.status); }
  if (!response.ok) throw new DashboardError(typeof responseBody?.error === "string" ? responseBody.error : "request_failed", response.status);
  return responseBody;
}

function formatted(value) { return value.toLocaleString("ja-JP"); }
function signed(value) { return `${value >= 0 ? "+" : ""}${formatted(value)}`; }
function svgNode(name, attrs = {}, text = "") {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (text) node.textContent = text;
  return node;
}

function niceStep(range) {
  const targetStep = Math.max(1, range / 4);
  const power = 10 ** Math.floor(Math.log10(targetStep));
  const fraction = targetStep / power;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
}

function signedAxis(values) {
  const rawMinimum = Math.min(0, ...values);
  const rawMaximum = Math.max(0, ...values);
  const step = niceStep(rawMaximum - rawMinimum);
  const minimum = Math.floor(rawMinimum / step) * step;
  let maximum = Math.ceil(rawMaximum / step) * step;
  if (minimum === maximum) maximum += step;
  return { minimum, maximum, step };
}

function chartY(axis, value, top, bottom) {
  return bottom - ((value - axis.minimum) / (axis.maximum - axis.minimum)) * (bottom - top);
}

function renderAxis(axis, top, bottom) {
  el.stabilityChartAxis.replaceChildren();
  const divisions = Math.round((axis.maximum - axis.minimum) / axis.step);
  for (let index = 0; index <= divisions; index += 1) {
    const value = axis.minimum + axis.step * index;
    const yy = chartY(axis, value, top, bottom);
    el.stabilityChartAxis.append(
      svgNode("line", { x1: 52, y1: yy, x2: 62, y2: yy, class: value === 0 ? "zero-line" : "grid-line" }),
      svgNode("text", { x: 48, y: yy + 4, class: "axis-label delta-axis-label", "text-anchor": "end" }, signed(value))
    );
  }
}

function correctRateY(value) {
  return CORRECT_RATE_CHART_BOTTOM -
    (value / 100) * (CORRECT_RATE_CHART_BOTTOM - CORRECT_RATE_CHART_TOP);
}

function renderCorrectRateAxis() {
  for (const value of [0, 25, 50, 75, 100]) {
    const yy = correctRateY(value);
    el.stabilityChartAxis.append(
      svgNode("line", { x1: 52, y1: yy, x2: 62, y2: yy, class: "correct-rate-grid-line" }),
      svgNode("text", { x: 48, y: yy + 4, class: "axis-label correct-rate-axis-label", "text-anchor": "end" }, `${value}%`)
    );
  }
}

function renderGrid(axis, right, top, bottom) {
  const divisions = Math.round((axis.maximum - axis.minimum) / axis.step);
  for (let index = 0; index <= divisions; index += 1) {
    const value = axis.minimum + axis.step * index;
    const yy = chartY(axis, value, top, bottom);
    el.stabilityChart.append(svgNode("line", { x1: 0, y1: yy, x2: right, y2: yy, class: value === 0 ? "zero-line" : "grid-line" }));
  }
}

function renderCorrectRateGrid(right) {
  for (const value of [0, 25, 50, 75, 100]) {
    el.stabilityChart.append(
      svgNode("line", { x1: 0, y1: correctRateY(value), x2: right, y2: correctRateY(value), class: "correct-rate-grid-line" })
    );
  }
}

function correctRateLinePath(days, left, bandWidth) {
  let segmentOpen = false;
  return days.map((day, index) => {
    if (day.dailyCorrectRatePercent === null) {
      segmentOpen = false;
      return "";
    }
    const xx = left + bandWidth * (index + 0.5);
    const command = segmentOpen ? "L" : "M";
    segmentOpen = true;
    return `${command}${xx} ${correctRateY(day.dailyCorrectRatePercent)}`;
  }).filter(Boolean).join(" ");
}

function renderChart(days) {
  el.stabilityChart.replaceChildren();
  const values = days.map((day) => day.stabilityDaysDelta).filter((value) => value !== null);
  const axis = signedAxis(values);
  const left = 0, right = CHART_DAY_WIDTH * days.length;
  const chartWidth = right + CHART_RIGHT_PADDING;
  const bandWidth = CHART_DAY_WIDTH;
  const zeroY = chartY(axis, 0, STABILITY_CHART_TOP, STABILITY_CHART_BOTTOM);
  el.stabilityChart.setAttribute("viewBox", `0 0 ${chartWidth} ${CHART_HEIGHT}`);
  el.stabilityChart.style.width = `${chartWidth}px`;
  el.stabilityChart.append(
    svgNode("title", { id: "history-chart-title" }, `stabilityDaysDeltaとdailyCorrectRatePercentの${DASHBOARD_HISTORY_DAYS}日推移`),
    svgNode(
      "desc",
      { id: "history-chart-description" },
      days.map((day) => `${day.date}, stabilityDaysDelta ${day.stabilityDaysDelta === null ? "記録なし" : `${signed(day.stabilityDaysDelta)}日`}, dailyCorrectRatePercent ${day.dailyCorrectRatePercent === null ? "記録なし" : `${formatted(day.dailyCorrectRatePercent)}%`}`).join(". ")
    )
  );
  renderAxis(axis, STABILITY_CHART_TOP, STABILITY_CHART_BOTTOM);
  renderCorrectRateAxis();
  renderGrid(axis, right, STABILITY_CHART_TOP, STABILITY_CHART_BOTTOM);
  renderCorrectRateGrid(right);
  const correctRatePath = correctRateLinePath(days, left, bandWidth);
  if (correctRatePath !== "") {
    el.stabilityChart.append(
      svgNode("path", { d: correctRatePath, class: "correct-rate-line" })
    );
  }
  const barWidth = Math.min(50, bandWidth * 0.56);
  days.forEach((day, index) => {
    const xx = left + bandWidth * (index + 0.5);
    const value = day.stabilityDaysDelta;
    const correctRate = day.dailyCorrectRatePercent;
    const selected = day.date === state.selectedDate;
    const group = svgNode("g", {
      class: "chart-day",
      role: "button",
      tabindex: "0",
      focusable: "true",
      "aria-controls": "daily-details",
      "aria-pressed": selected ? "true" : "false",
      "aria-label": `${day.date}, stabilityDaysDelta ${value === null ? "記録なし" : `${signed(value)}日`}, dailyCorrectRatePercent ${correctRate === null ? "記録なし" : `${formatted(correctRate)}%`}. 日別詳細を表示`,
      "data-chart-date": day.date,
    });
    group.append(svgNode("rect", { x: left + bandWidth * index, y: STABILITY_CHART_TOP - 8, width: bandWidth, height: CHART_DATE_Y - STABILITY_CHART_TOP + 18, class: "chart-hit-area" }));
    if (value !== null) {
      const valueY = chartY(axis, value, STABILITY_CHART_TOP, STABILITY_CHART_BOTTOM);
      let barY = Math.min(valueY, zeroY);
      let barHeight = Math.abs(valueY - zeroY);
      if (barHeight < 2) {
        barY = zeroY - 1;
        barHeight = 2;
      }
      group.append(svgNode("rect", { x: xx - barWidth / 2, y: barY, width: barWidth, height: barHeight, rx: 5, class: `delta-bar ${value < 0 ? "negative" : value === 0 ? "zero" : "positive"}` }));
      group.append(svgNode("text", { x: xx, y: value >= 0 ? Math.max(STABILITY_CHART_TOP + 12, barY - 8) : Math.min(STABILITY_CHART_BOTTOM + 16, barY + barHeight + 16), class: "delta-value-label", "text-anchor": "middle" }, signed(value)));
    }
    if (correctRate === null) {
      group.append(svgNode("text", { x: xx, y: (CORRECT_RATE_CHART_TOP + CORRECT_RATE_CHART_BOTTOM) / 2 + 4, class: "correct-rate-value-label missing", "text-anchor": "middle" }, "--"));
    } else {
      const pointY = correctRateY(correctRate);
      const labelY = correctRate >= 90 ? pointY + 18 : pointY - 10;
      group.append(
        svgNode("circle", { cx: xx, cy: pointY, r: 5, class: "correct-rate-point" }),
        svgNode("text", { x: xx, y: labelY, class: "correct-rate-value-label", "text-anchor": "middle" }, `${formatted(correctRate)}%`)
      );
    }
    const [, month, date] = day.date.split("-");
    group.append(svgNode("text", { x: xx, y: CHART_DATE_Y, class: "date-label", "text-anchor": "middle" }, `${Number(month)}/${Number(date)}`));
    el.stabilityChart.append(group);
  });
  el.historyEmpty.hidden = values.some((value) => value !== 0);
}

function scrollHistoryToLatest() {
  requestAnimationFrame(() => {
    el.historyScroll.scrollLeft = el.historyScroll.scrollWidth - el.historyScroll.clientWidth;
  });
}

function renderRawTable(container, columns, rows) {
  const table = document.createElement("table");
  table.className = "raw-table";
  const headerRow = document.createElement("tr");
  for (const column of columns) {
    const header = document.createElement("th");
    header.scope = "col";
    header.textContent = column;
    headerRow.append(header);
  }
  const head = document.createElement("thead");
  head.append(headerRow);
  const body = document.createElement("tbody");
  if (rows.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = columns.length;
    cell.className = "raw-table-empty";
    cell.textContent = "0 rows";
    row.append(cell);
    body.append(row);
  } else {
    for (const rawRow of rows) {
      const row = document.createElement("tr");
      for (const column of columns) {
        const cell = document.createElement("td");
        cell.textContent = String(rawRow[column]);
        row.append(cell);
      }
      body.append(row);
    }
  }
  table.append(head, body);
  container.replaceChildren(table);
}

function renderDailyDetailsInitial() {
  el.dailyDetails.removeAttribute("aria-busy");
  el.dailyDetailsDate.textContent = "";
  el.dailyDetailsInstruction.hidden = false;
  el.dailyDetailsStatus.textContent = "";
  el.dailyDetailsTables.hidden = true;
  el.stabilityHistoryTable.replaceChildren();
  el.attemptsTable.replaceChildren();
}

function resetDailyDetails() {
  detailGeneration += 1;
  state.selectedDate = "";
  state.dailyDetails = null;
  renderDailyDetailsInitial();
}

function renderDailyDetailsLoading(date) {
  el.dailyDetails.setAttribute("aria-busy", "true");
  el.dailyDetailsDate.textContent = date;
  el.dailyDetailsInstruction.hidden = true;
  el.dailyDetailsStatus.textContent = "raw dataを読み込み中";
  el.dailyDetailsTables.hidden = true;
}

function renderDailyDetailsResult(details) {
  el.dailyDetails.removeAttribute("aria-busy");
  el.dailyDetailsStatus.textContent = `${details.tables.stability_history.length + details.tables.attempts.length} rows`;
  renderRawTable(el.stabilityHistoryTable, RAW_TABLE_COLUMNS.stability_history, details.tables.stability_history);
  renderRawTable(el.attemptsTable, RAW_TABLE_COLUMNS.attempts, details.tables.attempts);
  el.dailyDetailsTables.hidden = false;
}

function renderDailyDetailsError(error) {
  const messages = {
    unauthorized: "同期tokenを確認してください.", timeout: "日別詳細の読み込みがタイムアウトしました.", network_error: "日別詳細を読み込めませんでした.", invalid_response: "日別詳細のAPI応答が不正です.",
  };
  el.dailyDetails.removeAttribute("aria-busy");
  el.dailyDetailsStatus.textContent = messages[error?.code] ?? "日別詳細を読み込めませんでした.";
  el.dailyDetailsTables.hidden = true;
}

async function loadDailyDetails(date, { focusChart = false } = {}) {
  const generation = ++detailGeneration;
  const site = state.site;
  const token = state.token;
  state.selectedDate = date;
  state.dailyDetails = null;
  renderChart(state.history.days);
  renderDailyDetailsLoading(date);
  if (focusChart) el.stabilityChart.querySelector(`[data-chart-date="${date}"]`)?.focus();
  let details;
  try {
    details = await requestJSON(`/v9/daily-details?${new URLSearchParams({ site, date })}`, token);
    if (!validDailyDetails(details, site, date)) throw new DashboardError("invalid_response");
  } catch (error) {
    if (generation !== detailGeneration || site !== state.site || token !== state.token || date !== state.selectedDate) return false;
    renderDailyDetailsError(error);
    return false;
  }
  if (generation !== detailGeneration || site !== state.site || token !== state.token || date !== state.selectedDate) return false;
  state.dailyDetails = details;
  renderDailyDetailsResult(details);
  return true;
}

function renderDashboard() {
  const learning = state.learning;
  const metrics = learning.learningMetrics;
  el.dailyKpiCompletedElement.textContent = metrics.dailyKpiCompleted ? "達成" : "未達成";
  el.dailyKpiCompletedElement.dataset.completed = String(metrics.dailyKpiCompleted);
  el.dueCardsRemainingElement.textContent = formatted(metrics.dueCardsRemaining);
  el.newQuestionsRemainingElement.textContent = formatted(metrics.newQuestionsRemaining);
  el.todayStabilityDaysDeltaElement.textContent = signed(metrics.todayStabilityDaysDelta);
  el.stabilityDaysElement.textContent = formatted(metrics.stabilityDays);
  el.attemptedQuestionCountElement.textContent = formatted(metrics.attemptedQuestionCount);
  el.todayAttemptedQuestionCountElement.textContent = formatted(metrics.todayAttemptedQuestionCount);
  el.todayCorrectRatePercentElement.textContent = metrics.todayCorrectRatePercent === null
    ? "--"
    : formatted(metrics.todayCorrectRatePercent);
  el.todayCorrectRatePercentUnit.hidden = metrics.todayCorrectRatePercent === null;
  renderChart(state.history.days);
  el.dashboard.hidden = false;
  el.authPanel.hidden = true;
  el.siteEmpty.hidden = true;
  el.loadError.hidden = true;
  el.settingsButton.hidden = false;
  el.dashboardStatus.textContent = `更新日 ${learning.today}`;
  scrollHistoryToLatest();
}

function showError(error) {
  const messages = {
    unauthorized: "同期tokenが正しくありません.", timeout: "読み込みがタイムアウトしました.", network_error: "networkへ接続できません.", storage_unavailable: "browser storageを利用できません.", invalid_response: "API応答が不正です.", server_misconfigured: "同期APIが設定されていません.", open_bridge_misconfigured: "次の問題への接続先が設定されていません.",
  };
  el.errorMessage.textContent = messages[error?.code] ?? "学習記録を読み込めませんでした.";
  el.loadError.hidden = false;
  el.dashboard.hidden = true;
  el.siteEmpty.hidden = true;
}

async function fetchDashboardData(site, token) {
  const parameters = new URLSearchParams();
  if (site !== null) parameters.set("site", site);
  const suffix = parameters.size === 0 ? "" : `?${parameters}`;
  const data = await requestJSON(`/v9/dashboard${suffix}`, token);
  if (!validDashboard(data)) throw new DashboardError("invalid_response");
  return data;
}

function applySiteData(data) {
  state.sites = data.sites; state.site = data.selectedSite ?? "";
  state.learning = data.state; state.history = data.history;
  if (state.selectedDate !== "" && !data.history.days.some((day) => day.date === state.selectedDate)) resetDailyDetails();
  renderDashboard();
}

async function loadSelectedSite() {
  const generation = ++loadGeneration;
  const site = state.site;
  const token = state.token;
  let data;
  try {
    data = await fetchDashboardData(site, token);
  } catch (error) {
    if (generation !== loadGeneration || site !== state.site || token !== state.token) return false;
    throw error;
  }
  if (generation !== loadGeneration || site !== state.site || token !== state.token || data.selectedSite !== site) return false;
  applySiteData(data);
  return true;
}

function renderSiteOptions() {
  el.siteSelect.replaceChildren(...state.sites.map((site) => {
    const option = document.createElement("option"); option.value = site; option.textContent = site; return option;
  }));
  el.siteSelect.value = state.site;
}

async function connect(token, { persist = true } = {}) {
  const generation = ++loadGeneration;
  const saved = storageGet(SITE_KEY);
  let data;
  try {
    data = await fetchDashboardData(validSite(saved) ? saved : null, token);
  } catch (error) {
    if (generation !== loadGeneration) return false;
    throw error;
  }
  if (generation !== loadGeneration) return false;
  const site = data.selectedSite ?? "";
  if (persist) storageSet(TOKEN_KEY, token);
  if (site === "") storageRemove(SITE_KEY); else storageSet(SITE_KEY, site);
  state.token = token; state.sites = data.sites; state.site = site;
  state.learning = null; state.history = null;
  resetDailyDetails();
  if (data.sites.length === 0) {
    el.authPanel.hidden = true; el.dashboard.hidden = true; el.loadError.hidden = true; el.siteEmpty.hidden = false; el.settingsButton.hidden = false; return true;
  }
  renderSiteOptions();
  applySiteData(data);
  return true;
}

el.authForm.addEventListener("submit", async (event) => {
  event.preventDefault(); const token = el.authToken.value.trim();
  if (!token) { el.authMessage.textContent = "同期tokenを入力してください."; return; }
  el.authMessage.textContent = "接続中";
  try { if (await connect(token)) { el.authToken.value = ""; el.authMessage.textContent = ""; } } catch (error) { el.authMessage.textContent = error?.code === "unauthorized" ? "同期tokenが正しくありません." : "接続できませんでした."; }
});

el.siteSelect.addEventListener("change", async () => {
  if (!state.sites.includes(el.siteSelect.value)) return;
  resetDailyDetails(); state.site = el.siteSelect.value; storageSet(SITE_KEY, state.site);
  try { await loadSelectedSite(); } catch (error) { showError(error); }
});
el.refreshButton.addEventListener("click", async () => {
  const selectedDate = state.selectedDate;
  try {
    if (await loadSelectedSite() && selectedDate !== "" && state.selectedDate === selectedDate) await loadDailyDetails(selectedDate);
  } catch (error) { showError(error); }
});
el.retryButton.addEventListener("click", async () => { try { await connect(state.token, { persist: false }); } catch (error) { showError(error); } });
el.stabilityChart.addEventListener("click", (event) => {
  const target = event.target.closest?.("[data-chart-date]");
  if (target) void loadDailyDetails(target.getAttribute("data-chart-date"), { focusChart: true });
});
el.stabilityChart.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const target = event.target.closest?.("[data-chart-date]");
  if (!target) return;
  event.preventDefault();
  void loadDailyDetails(target.getAttribute("data-chart-date"), { focusChart: true });
});
el.settingsButton.addEventListener("click", () => { el.settingsMessage.textContent = ""; el.settingsToken.value = ""; el.settingsDialog.showModal(); });
el.settingsClose.addEventListener("click", () => el.settingsDialog.close());
el.settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault(); const token = el.settingsToken.value.trim();
  if (!token) { el.settingsMessage.textContent = "同期tokenを入力してください."; return; }
  try { if (await connect(token)) el.settingsDialog.close(); } catch (error) { el.settingsMessage.textContent = error?.code === "unauthorized" ? "同期tokenが正しくありません." : "tokenを変更できませんでした."; }
});
el.forgetToken.addEventListener("click", () => {
  loadGeneration += 1;
  storageRemove(TOKEN_KEY); storageRemove(SITE_KEY); state.token = ""; state.site = ""; state.sites = []; state.learning = null; state.history = null;
  resetDailyDetails();
  el.settingsDialog.close(); el.settingsButton.hidden = true; el.dashboard.hidden = true; el.siteEmpty.hidden = true; el.loadError.hidden = true; el.authPanel.hidden = false;
});

function nextQuestionURL() {
  const content = document.querySelector('meta[name="kakomonn-next-question-url"]')?.content ?? "";
  let url;
  try { url = new URL(content); } catch { throw new DashboardError("open_bridge_misconfigured"); }
  if (
    url.protocol !== "https:" ||
    !validSite(url.hostname) ||
    url.pathname !== "/createques" ||
    url.search !== "" ||
    url.hash !== "#kakomonn-next"
  ) throw new DashboardError("open_bridge_misconfigured");
  return url.href;
}

async function initializeDashboard() {
  try {
    const token = storageGet(TOKEN_KEY) ?? "";
    if (!token) return;
    await connect(token, { persist: false });
  } catch (error) {
    if (error?.code === "unauthorized") { storageRemove(TOKEN_KEY); el.authMessage.textContent = "保存済みtokenを確認してください."; return; }
    showError(error);
  }
}

function showDashboardFromOpenBridge() {
  history.replaceState(null, "", "/");
  void initializeDashboard();
}

renderDailyDetailsInitial();
const isOpenBridge = location.pathname === "/open" && location.search === "" && location.hash === "";
const openBridgeWasLaunched = history.state?.kakomonnOpenBridge === true;
let openBridgePhase = isOpenBridge && !openBridgeWasLaunched ? "launch" : "dashboard";

window.addEventListener("pageshow", (event) => {
  if (openBridgePhase === "launch") {
    openBridgePhase = "away";
    try {
      const target = nextQuestionURL();
      history.replaceState(null, "", "/");
      history.pushState({ kakomonnOpenBridge: true }, "", "/open");
      location.replace(target);
    } catch (error) {
      openBridgePhase = "dashboard";
      showDashboardFromOpenBridge();
      showError(error);
    }
    return;
  }
  if (isOpenBridge && openBridgePhase === "away" && event.persisted) {
    openBridgePhase = "dashboard";
    showDashboardFromOpenBridge();
    return;
  }
  if (event.persisted) void initializeDashboard();
});

if (isOpenBridge) {
  if (openBridgePhase === "dashboard") showDashboardFromOpenBridge();
} else {
  void initializeDashboard();
}
