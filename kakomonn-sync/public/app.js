const TOKEN_KEY = "kakomonn-dashboard.sync-token";
const SITE_KEY = "kakomonn-dashboard.site";
const API_TIMEOUT_MS = 15000;
const SVG_NS = "http://www.w3.org/2000/svg";

const byId = (id) => {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`missing element: ${id}`);
  return element;
};

const el = {
  authPanel: byId("auth-panel"), authForm: byId("auth-form"), authToken: byId("auth-token"), authMessage: byId("auth-message"),
  dashboard: byId("dashboard"), siteEmpty: byId("site-empty"), loadError: byId("load-error"), errorMessage: byId("error-message"), retryButton: byId("retry-button"),
  settingsButton: byId("settings-button"), settingsDialog: byId("settings-dialog"), settingsForm: byId("settings-form"), settingsToken: byId("settings-token"), settingsMessage: byId("settings-message"), settingsClose: byId("settings-close"), forgetToken: byId("forget-token"),
  siteSelect: byId("site-select"), refreshButton: byId("refresh-button"), stabilityDaysElement: byId("stability-days"), todayStabilityDaysDeltaElement: byId("today-delta"), goalLabel: byId("goal-label"), dailyStabilityDaysGoalInput: byId("daily-goal"), saveGoal: byId("save-goal"), goalProgress: byId("goal-progress"), stabilityChart: byId("stability-chart"), historyEmpty: byId("history-empty"), dashboardStatus: byId("dashboard-status"),
  dailyDetails: byId("daily-details"), dailyDetailsDate: byId("daily-details-date"), dailyDetailsInstruction: byId("daily-details-instruction"), dailyDetailsStatus: byId("daily-details-status"), dailyDetailsTables: byId("daily-details-tables"), stabilityHistoryTable: byId("stability-history-table"), attemptsTable: byId("attempts-table"),
};

const state = { token: "", site: "", sites: [], learning: null, history: null, settings: null, selectedDate: "", dailyDetails: null };
let loadGeneration = 0;
let detailGeneration = 0;
const RAW_TABLE_COLUMNS = {
  stability_history: ["site", "date", "opening_stability_days", "closing_stability_days"],
  attempts: ["site", "operation_id", "question_id", "answered_at_ms", "result", "previous_stability", "resulting_stability"],
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
function validState(value, site) {
  return value && value.site === site && /^\d{4}-\d{2}-\d{2}$/.test(value.today) && Number.isSafeInteger(value.stabilityDays) && value.stabilityDays >= 0 && Number.isSafeInteger(value.attemptedQuestionCount) && value.attemptedQuestionCount >= 0 && Number.isSafeInteger(value.todayAttemptedQuestionCount) && value.todayAttemptedQuestionCount >= 0 && Number.isSafeInteger(value.todayStabilityDaysDelta);
}
function validHistory(value, site) {
  return value && value.site === site && Array.isArray(value.days) && value.days.length === 7 && value.days.every((day) => /^\d{4}-\d{2}-\d{2}$/.test(day.date) && (day.stabilityDays === null || (Number.isSafeInteger(day.stabilityDays) && day.stabilityDays >= 0)) && (day.stabilityDaysDelta === null || Number.isSafeInteger(day.stabilityDaysDelta)) && Number.isSafeInteger(day.attemptedQuestionCount) && day.attemptedQuestionCount >= 0);
}
function validSettings(value, site) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 2 && value.site === site && Number.isSafeInteger(value.dailyStabilityDaysGoal) && value.dailyStabilityDaysGoal >= 1;
}
function hasExactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}
function validDailyDetails(value, site, date) {
  if (!hasExactKeys(value, ["site", "date", "timeZone", "tables"]) || value.site !== site || value.date !== date || value.timeZone !== "Asia/Tokyo" || !hasExactKeys(value.tables, ["stability_history", "attempts"]) || !Array.isArray(value.tables.stability_history) || value.tables.stability_history.length > 1 || !Array.isArray(value.tables.attempts)) return false;
  const validStabilityHistory = value.tables.stability_history.every((row) => hasExactKeys(row, RAW_TABLE_COLUMNS.stability_history) && row.site === site && row.date === date && Number.isSafeInteger(row.opening_stability_days) && row.opening_stability_days >= 0 && Number.isSafeInteger(row.closing_stability_days) && row.closing_stability_days >= 0);
  const validAttempts = value.tables.attempts.every((row) => hasExactKeys(row, RAW_TABLE_COLUMNS.attempts) && row.site === site && /^[0-9a-f]{32}$/.test(row.operation_id) && /^\d+$/.test(row.question_id) && Number.isSafeInteger(row.answered_at_ms) && row.answered_at_ms > 0 && (row.result === "correct" || row.result === "incorrect") && Number.isFinite(row.previous_stability) && row.previous_stability >= 0 && Number.isFinite(row.resulting_stability) && row.resulting_stability >= 0);
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
function renderGoal() {
  const dailyStabilityDaysGoal = state.settings.dailyStabilityDaysGoal;
  const todayStabilityDaysDelta = state.learning?.todayStabilityDaysDelta ?? 0;
  el.dailyStabilityDaysGoalInput.value = String(dailyStabilityDaysGoal);
  el.goalLabel.textContent = `dailyStabilityDaysGoal +${formatted(dailyStabilityDaysGoal)}日`;
  el.goalProgress.textContent = `todayStabilityDaysDelta ${signed(todayStabilityDaysDelta)}日 / dailyStabilityDaysGoal +${formatted(dailyStabilityDaysGoal)}日`;
}

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

function renderAxis(axis, left, right, top, bottom) {
  const divisions = Math.round((axis.maximum - axis.minimum) / axis.step);
  for (let index = 0; index <= divisions; index += 1) {
    const value = axis.minimum + axis.step * index;
    const yy = chartY(axis, value, top, bottom);
    el.stabilityChart.append(
      svgNode("line", { x1: left, y1: yy, x2: right, y2: yy, class: value === 0 ? "zero-line" : "grid-line" }),
      svgNode("text", { x: left - 10, y: yy + 4, class: "axis-label delta-axis-label", "text-anchor": "end" }, signed(value))
    );
  }
}

function renderChart(days) {
  el.stabilityChart.replaceChildren();
  const values = days.map((day) => day.stabilityDaysDelta).filter((value) => value !== null);
  const axis = signedAxis(values);
  const left = 62, right = 676, top = 26, bottom = 218;
  const bandWidth = (right - left) / days.length;
  const zeroY = chartY(axis, 0, top, bottom);
  el.stabilityChart.append(
    svgNode("title", { id: "history-chart-title" }, "stabilityDaysDeltaの7日推移"),
    svgNode(
      "desc",
      { id: "history-chart-description" },
      days.map((day) => `${day.date}, stabilityDaysDelta ${day.stabilityDaysDelta === null ? "記録なし" : `${signed(day.stabilityDaysDelta)}日`}`).join(". ")
    )
  );
  renderAxis(axis, left, right, top, bottom);
  const barWidth = Math.min(50, bandWidth * 0.56);
  days.forEach((day, index) => {
    const xx = left + bandWidth * (index + 0.5);
    const value = day.stabilityDaysDelta;
    const selected = day.date === state.selectedDate;
    const group = svgNode("g", {
      class: "chart-day",
      role: "button",
      tabindex: "0",
      focusable: "true",
      "aria-controls": "daily-details",
      "aria-pressed": selected ? "true" : "false",
      "aria-label": `${day.date}, stabilityDaysDelta ${value === null ? "記録なし" : `${signed(value)}日`}. 日別詳細を表示`,
      "data-chart-date": day.date,
    });
    group.append(svgNode("rect", { x: left + bandWidth * index, y: top - 8, width: bandWidth, height: 244, class: "chart-hit-area" }));
    if (value !== null) {
      const valueY = chartY(axis, value, top, bottom);
      let barY = Math.min(valueY, zeroY);
      let barHeight = Math.abs(valueY - zeroY);
      if (barHeight < 2) {
        barY = zeroY - 1;
        barHeight = 2;
      }
      group.append(
        svgNode("rect", { x: xx - barWidth / 2, y: barY, width: barWidth, height: barHeight, rx: 5, class: `delta-bar ${value < 0 ? "negative" : value === 0 ? "zero" : "positive"}` }),
        svgNode("text", { x: xx, y: value >= 0 ? Math.max(top + 12, barY - 8) : Math.min(bottom + 16, barY + barHeight + 16), class: "delta-value-label", "text-anchor": "middle" }, signed(value))
      );
    }
    const [, month, date] = day.date.split("-");
    group.append(svgNode("text", { x: xx, y: 252, class: "date-label", "text-anchor": "middle" }, `${Number(month)}/${Number(date)}`));
    el.stabilityChart.append(group);
  });
  el.historyEmpty.hidden = values.some((value) => value !== 0);
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
    details = await requestJSON(`/v6/daily-details?${new URLSearchParams({ site, date })}`, token);
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
  el.stabilityDaysElement.textContent = formatted(learning.stabilityDays);
  el.todayStabilityDaysDeltaElement.textContent = `todayStabilityDaysDelta ${signed(learning.todayStabilityDaysDelta)}日`;
  renderGoal();
  renderChart(state.history.days);
  el.dashboard.hidden = false;
  el.authPanel.hidden = true;
  el.siteEmpty.hidden = true;
  el.loadError.hidden = true;
  el.settingsButton.hidden = false;
  el.dashboardStatus.textContent = `更新日 ${learning.today}`;
}

function showError(error) {
  const messages = {
    unauthorized: "同期tokenが正しくありません.", timeout: "読み込みがタイムアウトしました.", network_error: "networkへ接続できません.", storage_unavailable: "browser storageを利用できません.", invalid_response: "API応答が不正です.", server_misconfigured: "同期APIが設定されていません.",
  };
  el.errorMessage.textContent = messages[error?.code] ?? "学習記録を読み込めませんでした.";
  el.loadError.hidden = false;
  el.dashboard.hidden = true;
  el.siteEmpty.hidden = true;
}

async function loadSites(token) {
  const body = await requestJSON("/v6/sites", token);
  if (body === null || typeof body !== "object" || !Array.isArray(body.sites) || body.sites.some((site) => !validSite(site))) throw new DashboardError("invalid_response");
  return body.sites;
}

async function fetchSiteData(site, token) {
  const parameters = new URLSearchParams({ site });
  const [learning, history, settings] = await Promise.all([
    requestJSON(`/v6/state?${parameters}`, token),
    requestJSON(`/v6/history?${new URLSearchParams({ site, days: "7" })}`, token),
    requestJSON(`/v6/settings?${parameters}`, token),
  ]);
  if (!validState(learning, site) || !validHistory(history, site) || !validSettings(settings, site)) throw new DashboardError("invalid_response");
  return { learning, history, settings };
}

function applySiteData({ learning, history, settings }) {
  state.learning = learning; state.history = history; state.settings = settings;
  if (state.selectedDate !== "" && !history.days.some((day) => day.date === state.selectedDate)) resetDailyDetails();
  renderDashboard();
}

async function loadSelectedSite() {
  const generation = ++loadGeneration;
  const site = state.site;
  const token = state.token;
  let data;
  try {
    data = await fetchSiteData(site, token);
  } catch (error) {
    if (generation !== loadGeneration || site !== state.site || token !== state.token) return false;
    throw error;
  }
  if (generation !== loadGeneration || site !== state.site || token !== state.token) return false;
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
  let sites;
  try {
    sites = await loadSites(token);
  } catch (error) {
    if (generation !== loadGeneration) return false;
    throw error;
  }
  if (generation !== loadGeneration) return false;
  const saved = storageGet(SITE_KEY);
  const site = sites.includes(saved) ? saved : (sites[0] ?? "");
  let data = null;
  if (site !== "") {
    try {
      data = await fetchSiteData(site, token);
    } catch (error) {
      if (generation !== loadGeneration) return false;
      throw error;
    }
  }
  if (generation !== loadGeneration) return false;
  if (persist) storageSet(TOKEN_KEY, token);
  if (site === "") storageRemove(SITE_KEY); else storageSet(SITE_KEY, site);
  state.token = token; state.sites = sites; state.site = site;
  state.learning = null; state.history = null; state.settings = null;
  resetDailyDetails();
  if (sites.length === 0) {
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
el.saveGoal.addEventListener("click", async () => {
  const dailyStabilityDaysGoal = Number(el.dailyStabilityDaysGoalInput.value);
  if (!Number.isSafeInteger(dailyStabilityDaysGoal) || dailyStabilityDaysGoal < 1) { el.dashboardStatus.textContent = "目標は1以上の整数で入力してください."; return; }
  loadGeneration += 1;
  const token = state.token;
  const site = state.site;
  el.saveGoal.disabled = true;
  el.siteSelect.disabled = true;
  el.refreshButton.disabled = true;
  el.settingsButton.disabled = true;
  el.dashboardStatus.textContent = "目標を同期中";
  try {
    const settings = await requestJSON("/v6/settings", token, { method: "PUT", body: { site, dailyStabilityDaysGoal } });
    if (!validSettings(settings, site)) throw new DashboardError("invalid_response");
    if (token === state.token && site === state.site) { state.settings = settings; renderGoal(); el.dashboardStatus.textContent = "dailyStabilityDaysGoalを同期しました."; }
  } catch (error) {
    if (token === state.token && site === state.site) el.dashboardStatus.textContent = error?.code === "unauthorized" ? "同期tokenを確認してください." : "目標を同期できませんでした.";
  } finally {
    el.saveGoal.disabled = false;
    el.siteSelect.disabled = false;
    el.refreshButton.disabled = false;
    el.settingsButton.disabled = false;
  }
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
  storageRemove(TOKEN_KEY); storageRemove(SITE_KEY); state.token = ""; state.site = ""; state.sites = []; state.learning = null; state.history = null; state.settings = null;
  resetDailyDetails();
  el.settingsDialog.close(); el.settingsButton.hidden = true; el.dashboard.hidden = true; el.siteEmpty.hidden = true; el.loadError.hidden = true; el.authPanel.hidden = false;
});

renderDailyDetailsInitial();
(async () => {
  try {
    const token = storageGet(TOKEN_KEY) ?? "";
    if (!token) return;
    await connect(token, { persist: false });
  } catch (error) {
    if (error?.code === "unauthorized") { storageRemove(TOKEN_KEY); el.authMessage.textContent = "保存済みtokenを確認してください."; return; }
    showError(error);
  }
})();
