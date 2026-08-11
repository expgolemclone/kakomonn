const TOKEN_KEY = "kakomonn-dashboard.sync-token";
const SITE_KEY = "kakomonn-dashboard.site";
const GOAL_KEY = "今日の定着純増目標";
const DEFAULT_GOAL = 5;
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
  siteSelect: byId("site-select"), refreshButton: byId("refresh-button"), masteredCount: byId("mastered-count"), todayDelta: byId("today-delta"), goalLabel: byId("goal-label"), dailyGoal: byId("daily-goal"), saveGoal: byId("save-goal"), goalProgress: byId("goal-progress"), masteryChart: byId("mastery-chart"), historyEmpty: byId("history-empty"), dashboardStatus: byId("dashboard-status"),
};

const state = { token: "", site: "", sites: [], mastery: null, history: null };

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
  return value && value.site === site && /^\d{4}-\d{2}-\d{2}$/.test(value.today) && Number.isSafeInteger(value.mastered) && value.mastered >= 0 && Number.isSafeInteger(value.todayDelta);
}
function validHistory(value, site) {
  return value && value.site === site && Array.isArray(value.days) && value.days.length === 7 && value.days.every((day) => /^\d{4}-\d{2}-\d{2}$/.test(day.date) && Number.isSafeInteger(day.mastered) && day.mastered >= 0);
}

async function requestJSON(path, token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(path, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal });
  } catch (error) {
    throw new DashboardError(error?.name === "AbortError" ? "timeout" : "network_error");
  } finally {
    clearTimeout(timer);
  }
  let body;
  try { body = await response.json(); } catch { throw new DashboardError("invalid_response", response.status); }
  if (!response.ok) throw new DashboardError(typeof body?.error === "string" ? body.error : "request_failed", response.status);
  return body;
}

function signed(value) { return `${value >= 0 ? "+" : ""}${value}`; }
function readGoal() {
  const raw = storageGet(GOAL_KEY);
  if (raw === null) return DEFAULT_GOAL;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 1 && value <= 100 ? value : DEFAULT_GOAL;
}
function renderGoal() {
  const goal = readGoal();
  const delta = state.mastery?.todayDelta ?? 0;
  el.dailyGoal.value = String(goal);
  el.goalLabel.textContent = `目標 +${goal}`;
  el.goalProgress.textContent = `今日 ${signed(delta)} / +${goal}`;
}

function svgNode(name, attrs = {}, text = "") {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (text) node.textContent = text;
  return node;
}

function renderChart(days) {
  el.masteryChart.replaceChildren();
  const values = days.map((day) => day.mastered);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const left = 50, right = 670, top = 24, bottom = 210;
  const x = (index) => left + ((right - left) * index) / Math.max(1, days.length - 1);
  const y = (value) => bottom - ((value - min) / span) * (bottom - top);
  for (let i = 0; i < 3; i += 1) {
    const yy = top + ((bottom - top) * i) / 2;
    el.masteryChart.append(svgNode("line", { x1: left, y1: yy, x2: right, y2: yy, class: "grid-line" }));
  }
  const points = days.map((day, index) => `${x(index)},${y(day.mastered)}`).join(" ");
  el.masteryChart.append(svgNode("polyline", { points, class: "stock-line", fill: "none" }));
  days.forEach((day, index) => {
    const xx = x(index), yy = y(day.mastered);
    el.masteryChart.append(svgNode("circle", { cx: xx, cy: yy, r: 5, class: "stock-point" }));
    el.masteryChart.append(svgNode("text", { x: xx, y: yy - 12, class: "value-label", "text-anchor": "middle" }, String(day.mastered)));
    const [, month, date] = day.date.split("-");
    el.masteryChart.append(svgNode("text", { x: xx, y: 240, class: "date-label", "text-anchor": "middle" }, `${Number(month)}/${Number(date)}`));
  });
  el.historyEmpty.hidden = values.some((value) => value !== 0);
}

function renderDashboard() {
  const mastery = state.mastery;
  el.masteredCount.textContent = String(mastery.mastered);
  el.todayDelta.textContent = `今日 ${signed(mastery.todayDelta)}`;
  renderGoal();
  renderChart(state.history.days);
  el.dashboard.hidden = false;
  el.authPanel.hidden = true;
  el.siteEmpty.hidden = true;
  el.loadError.hidden = true;
  el.settingsButton.hidden = false;
  el.dashboardStatus.textContent = `更新日 ${mastery.today}`;
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
  const body = await requestJSON("/v4/sites", token);
  if (!Array.isArray(body.sites) || body.sites.some((site) => !validSite(site))) throw new DashboardError("invalid_response");
  return body.sites;
}

async function loadSelectedSite() {
  const parameters = new URLSearchParams({ site: state.site });
  const [mastery, history] = await Promise.all([
    requestJSON(`/v4/state?${parameters}`, state.token),
    requestJSON(`/v4/history?${new URLSearchParams({ site: state.site, days: "7" })}`, state.token),
  ]);
  if (!validState(mastery, state.site) || !validHistory(history, state.site)) throw new DashboardError("invalid_response");
  state.mastery = mastery; state.history = history;
  renderDashboard();
}

function renderSiteOptions() {
  el.siteSelect.replaceChildren(...state.sites.map((site) => {
    const option = document.createElement("option"); option.value = site; option.textContent = site; return option;
  }));
  el.siteSelect.value = state.site;
}

async function connect(token, { persist = true } = {}) {
  state.token = token;
  state.sites = await loadSites(token);
  if (persist) storageSet(TOKEN_KEY, token);
  if (state.sites.length === 0) {
    el.authPanel.hidden = true; el.dashboard.hidden = true; el.loadError.hidden = true; el.siteEmpty.hidden = false; el.settingsButton.hidden = false; return;
  }
  const saved = storageGet(SITE_KEY);
  state.site = state.sites.includes(saved) ? saved : state.sites[0];
  storageSet(SITE_KEY, state.site);
  renderSiteOptions();
  await loadSelectedSite();
}

el.authForm.addEventListener("submit", async (event) => {
  event.preventDefault(); const token = el.authToken.value.trim();
  if (!token) { el.authMessage.textContent = "同期tokenを入力してください."; return; }
  el.authMessage.textContent = "接続中";
  try { await connect(token); el.authToken.value = ""; el.authMessage.textContent = ""; } catch (error) { el.authMessage.textContent = error?.code === "unauthorized" ? "同期tokenが正しくありません." : "接続できませんでした."; }
});

el.siteSelect.addEventListener("change", async () => {
  if (!state.sites.includes(el.siteSelect.value)) return;
  state.site = el.siteSelect.value; storageSet(SITE_KEY, state.site);
  try { await loadSelectedSite(); } catch (error) { showError(error); }
});
el.refreshButton.addEventListener("click", async () => { try { await loadSelectedSite(); } catch (error) { showError(error); } });
el.retryButton.addEventListener("click", async () => { try { await connect(state.token, { persist: false }); } catch (error) { showError(error); } });
el.saveGoal.addEventListener("click", () => {
  const goal = Number(el.dailyGoal.value);
  if (!Number.isSafeInteger(goal) || goal < 1 || goal > 100) { el.dashboardStatus.textContent = "目標は1から100の整数で入力してください."; return; }
  storageSet(GOAL_KEY, String(goal)); renderGoal(); el.dashboardStatus.textContent = "今日の定着純増目標を保存しました.";
});

el.settingsButton.addEventListener("click", () => { el.settingsMessage.textContent = ""; el.settingsToken.value = ""; el.settingsDialog.showModal(); });
el.settingsClose.addEventListener("click", () => el.settingsDialog.close());
el.settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault(); const token = el.settingsToken.value.trim();
  if (!token) { el.settingsMessage.textContent = "同期tokenを入力してください."; return; }
  try { await connect(token); el.settingsDialog.close(); } catch (error) { el.settingsMessage.textContent = error?.code === "unauthorized" ? "同期tokenが正しくありません." : "tokenを変更できませんでした."; }
});
el.forgetToken.addEventListener("click", () => {
  storageRemove(TOKEN_KEY); storageRemove(SITE_KEY); state.token = ""; state.site = ""; state.sites = []; state.mastery = null; state.history = null;
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
