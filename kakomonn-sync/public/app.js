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
  siteSelect: byId("site-select"), refreshButton: byId("refresh-button"), stabilityDays: byId("stability-days"), solvedCount: byId("solved-count"), todayDelta: byId("today-delta"), goalLabel: byId("goal-label"), dailyGoal: byId("daily-goal"), saveGoal: byId("save-goal"), goalProgress: byId("goal-progress"), stabilityChart: byId("stability-chart"), historyEmpty: byId("history-empty"), dashboardStatus: byId("dashboard-status"),
};

const state = { token: "", site: "", sites: [], learning: null, history: null, settings: null };
let loadGeneration = 0;

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
  return value && value.site === site && /^\d{4}-\d{2}-\d{2}$/.test(value.today) && Number.isSafeInteger(value.stabilityDays) && value.stabilityDays >= 0 && Number.isSafeInteger(value.solved) && value.solved >= 0 && Number.isSafeInteger(value.todaySolved) && value.todaySolved >= 0 && Number.isSafeInteger(value.todayStabilityDaysDelta);
}
function validHistory(value, site) {
  return value && value.site === site && Array.isArray(value.days) && value.days.length === 7 && value.days.every((day) => /^\d{4}-\d{2}-\d{2}$/.test(day.date) && (day.stabilityDays === null || (Number.isSafeInteger(day.stabilityDays) && day.stabilityDays >= 0)) && Number.isSafeInteger(day.solved) && day.solved >= 0);
}
function validSettings(value, site) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 2 && value.site === site && Number.isSafeInteger(value.dailyStabilityDaysGoal) && value.dailyStabilityDaysGoal >= 1;
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
  const goal = state.settings.dailyStabilityDaysGoal;
  const delta = state.learning?.todayStabilityDaysDelta ?? 0;
  el.dailyGoal.value = String(goal);
  el.goalLabel.textContent = `目標 +${formatted(goal)}日`;
  el.goalProgress.textContent = `今日 ${signed(delta)}日 / +${formatted(goal)}日`;
}

function svgNode(name, attrs = {}, text = "") {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (text) node.textContent = text;
  return node;
}

function niceAxis(value) {
  if (value <= 4) {
    const maximum = Math.max(1, value);
    return { maximum, divisions: maximum };
  }
  const targetStep = value / 4;
  const power = 10 ** Math.floor(Math.log10(targetStep));
  const fraction = targetStep / power;
  const step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
  return { maximum: step * 4, divisions: 4 };
}

function renderAxisLabels(axis, x, className, anchor, top, bottom) {
  for (let i = 0; i <= axis.divisions; i += 1) {
    const yy = bottom - ((bottom - top) * i) / axis.divisions;
    const value = (axis.maximum * i) / axis.divisions;
    el.stabilityChart.append(
      svgNode(
        "text",
        { x, y: yy + 4, class: `axis-label ${className}`, "text-anchor": anchor },
        formatted(value)
      )
    );
  }
}

function renderChart(days) {
  el.stabilityChart.replaceChildren();
  const stabilityValues = days.map((day) => day.stabilityDays);
  const availableStabilityValues = stabilityValues.filter((value) => value !== null);
  const solvedValues = days.map((day) => day.solved);
  const stabilityAxis = niceAxis(Math.max(0, ...availableStabilityValues));
  const solvedAxis = niceAxis(Math.max(...solvedValues));
  const left = 58, right = 642, top = 28, bottom = 218;
  const x = (index) => left + ((right - left) * index) / Math.max(1, days.length - 1);
  const stabilityY = (value) => bottom - (value / stabilityAxis.maximum) * (bottom - top);
  const solvedY = (value) => bottom - (value / solvedAxis.maximum) * (bottom - top);
  el.stabilityChart.append(
    svgNode("title", { id: "history-chart-title" }, "定着日数と解いた問題数の7日推移"),
    svgNode(
      "desc",
      { id: "history-chart-description" },
      days.map((day) => `${day.date}, 定着日数${day.stabilityDays === null ? "記録なし" : `${formatted(day.stabilityDays)}日`}, 解いた問題${formatted(day.solved)}問`).join(". ")
    )
  );
  for (let i = 0; i <= 4; i += 1) {
    const yy = top + ((bottom - top) * i) / 4;
    el.stabilityChart.append(svgNode("line", { x1: left, y1: yy, x2: right, y2: yy, class: "grid-line" }));
  }
  renderAxisLabels(stabilityAxis, left - 10, "stability-axis-label", "end", top, bottom);
  renderAxisLabels(solvedAxis, right + 10, "solved-axis-label", "start", top, bottom);
  const barWidth = Math.min(50, ((right - left) / Math.max(1, days.length - 1)) * 0.56);
  days.forEach((day, index) => {
    if (day.stabilityDays === null) return;
    const xx = x(index), yy = stabilityY(day.stabilityDays);
    el.stabilityChart.append(svgNode("rect", { x: xx - barWidth / 2, y: yy, width: barWidth, height: bottom - yy, rx: 5, class: "stability-bar" }));
    el.stabilityChart.append(svgNode("text", { x: xx, y: bottom - yy >= 30 ? yy + 18 : yy - 8, class: "stability-value-label", "text-anchor": "middle" }, formatted(day.stabilityDays)));
  });
  const solvedPoints = days.map((day, index) => `${x(index)},${solvedY(day.solved)}`).join(" ");
  el.stabilityChart.append(svgNode("polyline", { points: solvedPoints, class: "solved-line", fill: "none" }));
  days.forEach((day, index) => {
    const xx = x(index), yy = solvedY(day.solved);
    el.stabilityChart.append(svgNode("circle", { cx: xx, cy: yy, r: 5, class: "solved-point" }));
    el.stabilityChart.append(svgNode("text", { x: xx, y: yy - 12, class: "solved-value-label", "text-anchor": "middle" }, formatted(day.solved)));
    const [, month, date] = day.date.split("-");
    el.stabilityChart.append(svgNode("text", { x: xx, y: 252, class: "date-label", "text-anchor": "middle" }, `${Number(month)}/${Number(date)}`));
  });
  el.historyEmpty.hidden = [...availableStabilityValues, ...solvedValues].some((value) => value !== 0);
}

function renderDashboard() {
  const learning = state.learning;
  el.stabilityDays.textContent = formatted(learning.stabilityDays);
  el.solvedCount.textContent = formatted(learning.solved);
  el.todayDelta.textContent = `今日 ${signed(learning.todayStabilityDaysDelta)}日`;
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
  const body = await requestJSON("/v5/sites", token);
  if (body === null || typeof body !== "object" || !Array.isArray(body.sites) || body.sites.some((site) => !validSite(site))) throw new DashboardError("invalid_response");
  return body.sites;
}

async function fetchSiteData(site, token) {
  const parameters = new URLSearchParams({ site });
  const [learning, history, settings] = await Promise.all([
    requestJSON(`/v5/state?${parameters}`, token),
    requestJSON(`/v5/history?${new URLSearchParams({ site, days: "7" })}`, token),
    requestJSON(`/v5/settings?${parameters}`, token),
  ]);
  if (!validState(learning, site) || !validHistory(history, site) || !validSettings(settings, site)) throw new DashboardError("invalid_response");
  return { learning, history, settings };
}

function applySiteData({ learning, history, settings }) {
  state.learning = learning; state.history = history; state.settings = settings;
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
  state.site = el.siteSelect.value; storageSet(SITE_KEY, state.site);
  try { await loadSelectedSite(); } catch (error) { showError(error); }
});
el.refreshButton.addEventListener("click", async () => { try { await loadSelectedSite(); } catch (error) { showError(error); } });
el.retryButton.addEventListener("click", async () => { try { await connect(state.token, { persist: false }); } catch (error) { showError(error); } });
el.saveGoal.addEventListener("click", async () => {
  const goal = Number(el.dailyGoal.value);
  if (!Number.isSafeInteger(goal) || goal < 1) { el.dashboardStatus.textContent = "目標は1以上の整数で入力してください."; return; }
  loadGeneration += 1;
  const token = state.token;
  const site = state.site;
  el.saveGoal.disabled = true;
  el.siteSelect.disabled = true;
  el.refreshButton.disabled = true;
  el.settingsButton.disabled = true;
  el.dashboardStatus.textContent = "目標を同期中";
  try {
    const settings = await requestJSON("/v5/settings", token, { method: "PUT", body: { site, dailyStabilityDaysGoal: goal } });
    if (!validSettings(settings, site)) throw new DashboardError("invalid_response");
    if (token === state.token && site === state.site) { state.settings = settings; renderGoal(); el.dashboardStatus.textContent = "今日の定着日数純増目標を同期しました."; }
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
  el.settingsDialog.close(); el.settingsButton.hidden = true; el.dashboard.hidden = true; el.siteEmpty.hidden = true; el.loadError.hidden = true; el.authPanel.hidden = false;
});

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
