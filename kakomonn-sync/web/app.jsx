import React, { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  Box, Button, Code, Container, Group, MantineProvider, Select,
  Paper, ScrollArea, Stack, Table, Text, Title,
} from "@mantine/core";
import { BarChart, LineChart } from "@mantine/charts";
import "@mantine/core/styles.css";
import "@mantine/charts/styles.css";
import "./styles.css";
import {
  RAW_TABLE_COLUMNS,
  isDailyDetailsResponse as validDailyDetails,
  isDashboardResponse as validDashboard,
  isSite as validSite,
} from "../../contracts/kakomonn.mjs";
import {
  DASHBOARD_BRIDGE_REQUEST_EVENT,
  DASHBOARD_BRIDGE_RESPONSE_EVENT,
  DASHBOARD_BRIDGE_STATE_ATTRIBUTE,
  DASHBOARD_BRIDGE_TIMEOUT_MS,
  isDashboardBridgeResponse,
} from "../../contracts/dashboard-bridge.mjs";

const LEGACY_TOKEN_KEY = "kakomonn-dashboard.sync-token";
const SITE_KEY = "kakomonn-dashboard.site";
const root = createRoot(document.getElementById("root"));
const state = {
  view: "connecting",
  error: null,
  site: "",
  sites: [],
  learning: null,
  history: null,
  selectedDate: "",
  dailyDetails: null,
  detailStatus: "",
};
let loadGeneration = 0;
let detailGeneration = 0;
let bridgeRequestId = 0;
let bridgeReadyPromise = null;

class DashboardError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function storageGet(key) {
  try { return localStorage.getItem(key); }
  catch { throw new DashboardError("storage_unavailable"); }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); }
  catch { throw new DashboardError("storage_unavailable"); }
}
function storageRemove(key) {
  try { localStorage.removeItem(key); }
  catch { throw new DashboardError("storage_unavailable"); }
}

function waitForDashboardBridge() {
  const currentState = document.documentElement.getAttribute(DASHBOARD_BRIDGE_STATE_ATTRIBUTE);
  if (currentState === "ready") return Promise.resolve();
  if (currentState === "error") return Promise.reject(new DashboardError("reader_unavailable"));
  if (bridgeReadyPromise !== null) return bridgeReadyPromise;
  bridgeReadyPromise = new Promise((resolve, reject) => {
    let timer = null;
    const observer = new MutationObserver(() => {
      const bridgeState = document.documentElement.getAttribute(DASHBOARD_BRIDGE_STATE_ATTRIBUTE);
      if (bridgeState !== "ready" && bridgeState !== "error") return;
      observer.disconnect();
      if (timer !== null) clearTimeout(timer);
      if (bridgeState === "ready") resolve();
      else reject(new DashboardError("reader_unavailable"));
    });
    observer.observe(document.documentElement, {
      attributeFilter: [DASHBOARD_BRIDGE_STATE_ATTRIBUTE],
      attributes: true,
    });
    timer = setTimeout(() => {
      observer.disconnect();
      reject(new DashboardError("reader_ready_timeout"));
    }, DASHBOARD_BRIDGE_TIMEOUT_MS);
  }).finally(() => { bridgeReadyPromise = null; });
  return bridgeReadyPromise;
}

async function requestJSON(request) {
  await waitForDashboardBridge();
  const id = ++bridgeRequestId;
  return new Promise((resolve, reject) => {
    let timer = null;
    const cleanup = () => {
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener(DASHBOARD_BRIDGE_RESPONSE_EVENT, handleResponse);
    };
    const handleResponse = (event) => {
      let response;
      try { response = JSON.parse(event.detail); }
      catch { return; }
      if (response?.id !== id) return;
      if (!isDashboardBridgeResponse(response, id)) {
        cleanup();
        reject(new DashboardError("invalid_response"));
        return;
      }
      cleanup();
      if (response.ok) resolve(response.data);
      else reject(new DashboardError(response.code, response.status));
    };
    timer = setTimeout(() => {
      cleanup();
      reject(new DashboardError("timeout"));
    }, DASHBOARD_BRIDGE_TIMEOUT_MS);
    document.addEventListener(DASHBOARD_BRIDGE_RESPONSE_EVENT, handleResponse);
    document.dispatchEvent(new CustomEvent(DASHBOARD_BRIDGE_REQUEST_EVENT, {
      detail: JSON.stringify({ id, ...request }),
    }));
  });
}

function formatted(value) { return value.toLocaleString("ja-JP"); }
function signed(value) { return `${value >= 0 ? "+" : ""}${formatted(value)}`; }
function studyTimeText(ms) {
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}分`;
  return minutes === 0 ? `${hours}時間` : `${hours}時間 ${minutes}分`;
}

function showError(error) {
  state.error = error;
  if (error?.code === "token_missing" || error?.code === "unauthorized") {
    loadGeneration += 1;
    detailGeneration += 1;
    state.view = "setup";
  } else {
    state.view = "error";
  }
  render();
}

async function fetchDashboardData(site) {
  const data = await requestJSON({ operation: "dashboard", site });
  if (!validDashboard(data)) throw new DashboardError("invalid_response");
  return data;
}

function resetDailyDetails() {
  detailGeneration += 1;
  state.selectedDate = "";
  state.dailyDetails = null;
  state.detailStatus = "";
}

function applySiteData(data) {
  state.sites = data.sites;
  state.site = data.selectedSite ?? "";
  state.learning = data.state;
  state.history = data.history;
  if (state.selectedDate && !data.history.days.some((day) => day.date === state.selectedDate)) {
    resetDailyDetails();
  }
  state.view = "dashboard";
  render();
}

async function initializeDashboard() {
  const generation = ++loadGeneration;
  resetDailyDetails();
  state.view = "connecting";
  render();
  try {
    storageRemove(LEGACY_TOKEN_KEY);
    const saved = storageGet(SITE_KEY);
    const data = await fetchDashboardData(validSite(saved) ? saved : null);
    if (generation !== loadGeneration) return;
    const site = data.selectedSite ?? "";
    if (site) storageSet(SITE_KEY, site);
    else storageRemove(SITE_KEY);
    state.site = site;
    state.sites = data.sites;
    if (data.sites.length === 0) {
      state.view = "empty";
      render();
      return;
    }
    applySiteData(data);
  } catch (error) {
    if (generation === loadGeneration) showError(error);
  }
}

async function loadSelectedSite() {
  const generation = ++loadGeneration;
  const site = state.site;
  let data;
  try { data = await fetchDashboardData(site); }
  catch (error) {
    if (generation !== loadGeneration || site !== state.site) return false;
    throw error;
  }
  if (generation !== loadGeneration || site !== state.site || data.selectedSite !== site) return false;
  applySiteData(data);
  return true;
}

async function selectSite(site) {
  if (!state.sites.includes(site)) return;
  resetDailyDetails();
  state.site = site;
  render();
  try {
    storageSet(SITE_KEY, site);
    await loadSelectedSite();
  } catch (error) { showError(error); }
}

async function refreshDashboard() {
  const selectedDate = state.selectedDate;
  try {
    if (await loadSelectedSite() && selectedDate && state.selectedDate === selectedDate) {
      await loadDailyDetails(selectedDate);
    }
  } catch (error) { showError(error); }
}

async function loadDailyDetails(date) {
  if (!state.history.days.some((day) => day.date === date)) return;
  const generation = ++detailGeneration;
  const site = state.site;
  state.selectedDate = date;
  state.dailyDetails = null;
  state.detailStatus = "raw dataを読み込み中";
  render();
  try {
    const details = await requestJSON({ date, operation: "daily-details", site });
    if (!validDailyDetails(details, site, date)) throw new DashboardError("invalid_response");
    if (generation !== detailGeneration || site !== state.site || date !== state.selectedDate) return;
    state.dailyDetails = details;
    state.detailStatus = `${details.tables.study_time_daily.length + details.tables.stability_history.length + details.tables.attempts.length} rows`;
    render();
  } catch (error) {
    if (generation !== detailGeneration || site !== state.site || date !== state.selectedDate) return;
    if (error?.code === "token_missing" || error?.code === "unauthorized") {
      showError(error);
      return;
    }
    const messages = {
      timeout: "日別詳細の読み込みがタイムアウトしました.",
      network_error: "日別詳細を読み込めませんでした.",
      invalid_response: "日別詳細のAPI応答が不正です.",
    };
    state.detailStatus = messages[error?.code] ?? "日別詳細を読み込めませんでした.";
    render();
  }
}

function StatusPanel() {
  if (state.view === "connecting" || state.view === "setup") {
    const setup = state.view === "setup";
    return <Paper component="section" id="auth-panel" p="xl" radius="lg" withBorder>
      <Stack>
        <Text size="xs" c="dimmed" fw={700}>DEVICE LINK</Text>
        <Title order={2} id="auth-title">{setup ? "Readerの同期設定が必要です" : "Readerと接続しています"}</Title>
        <Text id="auth-description">{setup
          ? "同じbrowser profileの問題画面で同期tokenを設定してから, このdashboardを再読み込みしてください."
          : "同じbrowser profileの過去問readerから学習記録を読み込みます."}</Text>
        {setup && <Group id="auth-actions">
          <Button component="a" href="https://chushoks.kakomonn.com/createques#kakomonn-next">Readerで設定する</Button>
          <Button id="auth-retry" variant="subtle" onClick={initializeDashboard}>再読み込み</Button>
        </Group>}
        <Text id="auth-message" role="status" aria-live="polite">{setup
          ? state.error?.code === "unauthorized"
            ? "保存済みの同期tokenが認証されませんでした."
            : "同期tokenがまだ保存されていません."
          : "接続を確認中です."}</Text>
      </Stack>
    </Paper>;
  }
  if (state.view === "empty") return <Paper component="section" id="site-empty" p="xl" withBorder>
    <Stack>
      <Text size="xs" c="dimmed" fw={700}>NO STUDY SITES</Text>
      <Title order={2}>学習記録はまだありません</Title>
      <Text>過去問readerで問題catalogを同期すると, ここにサイトが表示されます.</Text>
    </Stack>
  </Paper>;
  if (state.view === "error") {
    const messages = {
      reader_unavailable: "対応する過去問readerを利用できません. Tampermonkeyで最新のreaderを有効にしてください.",
      reader_ready_timeout: "過去問readerを確認できませんでした. Tampermonkeyで最新のreaderを有効にして再読み込みしてください.",
      timeout: "読み込みがタイムアウトしました.",
      network_error: "networkへ接続できません.",
      storage_unavailable: "browser storageを利用できません.",
      invalid_response: "API応答が不正です.",
      server_misconfigured: "同期APIが設定されていません.",
    };
    return <Paper component="section" id="load-error" p="xl" withBorder>
      <Stack>
        <Text size="xs" c="dimmed" fw={700}>LOAD ERROR</Text>
        <Title order={2}>学習記録を表示できません</Title>
        <Text id="error-message">{messages[state.error?.code] ?? "学習記録を読み込めませんでした."}</Text>
        <Button id="retry-button" onClick={initializeDashboard}>再読み込み</Button>
      </Stack>
    </Paper>;
  }
  return null;
}

function RawTable({ name, rows }) {
  const columns = RAW_TABLE_COLUMNS[name];
  return <Box component="section" mt="lg" aria-labelledby={`${name}-title`}>
    <Title order={4} id={`${name}-title`}><Code>{name}</Code></Title>
    <Table.ScrollContainer minWidth={800} mt="sm">
      <Table id={name.replaceAll("_", "-") + "-table"} striped withTableBorder>
        <Table.Thead><Table.Tr>{columns.map((column) =>
          <Table.Th scope="col" key={column}>{column}</Table.Th>)}</Table.Tr></Table.Thead>
        <Table.Tbody>{rows.length === 0
          ? <Table.Tr><Table.Td colSpan={columns.length}>0 rows</Table.Td></Table.Tr>
          : rows.map((row, index) => <Table.Tr key={index}>{columns.map((column) =>
            <Table.Td key={column}>{String(row[column])}</Table.Td>)}</Table.Tr>)}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  </Box>;
}

function History() {
  const viewport = useRef(null);
  const days = state.history.days;
  const chartData = days.map((day) => ({ ...day, studyMinutes: day.dailyStudyTimeMs / 60_000 }));
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (viewport.current) viewport.current.scrollLeft = viewport.current.scrollWidth;
    });
    return () => cancelAnimationFrame(frame);
  }, [state.site]);
  const chartClick = (entry) => {
    if (typeof entry?.activeLabel === "string") void loadDailyDetails(entry.activeLabel);
  };
  const barClick = (entry, _index, event) => {
    event.stopPropagation();
    if (typeof entry?.payload?.date === "string") void loadDailyDetails(entry.payload.date);
  };
  return <Paper component="section" className="history-card" p="lg" withBorder aria-labelledby="history-title">
    <Stack>
      <Title order={2} id="history-title">stabilityDaysDelta, dailyCorrectRatePercent, 勉強時間の31日推移</Title>
      <Select
        id="history-date" label="日別詳細の日付" placeholder="日付を選択" value={state.selectedDate || null}
        allowDeselect={false}
        data={days.map((day) => ({
          value: day.date,
          label: `${day.date}, stabilityDaysDelta ${day.stabilityDaysDelta === null ? "記録なし" : signed(day.stabilityDaysDelta)}, dailyCorrectRatePercent ${day.dailyCorrectRatePercent === null ? "記録なし" : day.dailyCorrectRatePercent + "%"}, 勉強時間 ${studyTimeText(day.dailyStudyTimeMs)}`,
        }))}
        onChange={(date) => { if (date) void loadDailyDetails(date); }}
      />
      <Text c="dimmed" size="sm">横にスワイプ/スクロールして過去31日を表示できます.</Text>
      <ScrollArea id="history-scroll" viewportRef={viewport} type="auto" tabIndex={0} aria-label="31日履歴. 左右にスワイプまたはスクロールして過去の日付を表示できます.">
        <Stack className="history-charts">
          <Text>stabilityDaysDelta</Text>
          <BarChart h={180} data={chartData} dataKey="date" series={[{name: "stabilityDaysDelta", color: "blue.5"}]}
            barChartProps={{ onClick: chartClick }} barProps={{ onClick: barClick }} withBarValueLabel valueLabelProps={{ formatter: signed }} minBarSize={2} />
          <Text>dailyCorrectRatePercent</Text>
          <LineChart h={160} data={chartData} dataKey="date" series={[{name: "dailyCorrectRatePercent", color: "yellow.5"}]}
            lineChartProps={{ onClick: chartClick }} yAxisProps={{ domain: [0, 100] }} curveType="linear" connectNulls={false} />
          <Text>勉強時間</Text>
          <BarChart h={160} data={chartData} dataKey="date" series={[{name: "studyMinutes", color: "cyan.5"}]}
            barChartProps={{ onClick: chartClick }} barProps={{ onClick: barClick }} minBarSize={2} />
        </Stack>
      </ScrollArea>
      {days.every((day) => day.stabilityDaysDelta === null || day.stabilityDaysDelta === 0) &&
        <Text id="history-empty" c="dimmed">stabilityDaysDeltaの変化はありません.</Text>}
      <Box component="section" id="daily-details" aria-labelledby="daily-details-title"
        aria-busy={state.detailStatus === "raw dataを読み込み中"}>
        <Title order={3} id="daily-details-title">日別詳細 <Code id="daily-details-date">{state.selectedDate}</Code></Title>
        {!state.selectedDate && <Text id="daily-details-instruction" c="dimmed">graphの日付を選択すると, DBのraw dataを表示します.</Text>}
        <Text id="daily-details-status" role="status" aria-live="polite">{state.detailStatus}</Text>
        {state.dailyDetails && <Box id="daily-details-tables">
          {Object.keys(RAW_TABLE_COLUMNS).map((name) =>
            <RawTable key={name} name={name} rows={state.dailyDetails.tables[name]} />)}
        </Box>}
      </Box>
    </Stack>
  </Paper>;
}

function Dashboard() {
  const metrics = state.learning.learningMetrics;
  const values = [
    ["todayStabilityDaysDelta", "today-stability-days-delta", signed(metrics.todayStabilityDaysDelta), "日"],
    ["stabilityDays", "stability-days", formatted(metrics.stabilityDays), "日"],
    ["attemptedQuestionCount", "attempted-question-count", formatted(metrics.attemptedQuestionCount), "問"],
    ["todayAttemptedQuestionCount", "today-attempted-question-count", formatted(metrics.todayAttemptedQuestionCount), "問"],
    ["todayCorrectRatePercent", "today-correct-rate-percent", metrics.todayCorrectRatePercent === null ? "--" : formatted(metrics.todayCorrectRatePercent), metrics.todayCorrectRatePercent === null ? "" : "%"],
    ["todayStudyTimeMs", "today-study-time", studyTimeText(metrics.todayStudyTimeMs), ""],
  ];
  return <Stack component="section" id="dashboard">
    <Group align="end">
      <Select id="site-select" label="サイト" data={state.sites} value={state.site} allowDeselect={false}
        onChange={(site) => { if (site) void selectSite(site); }} />
      <Button id="refresh-button" variant="subtle" onClick={() => void refreshDashboard()}>再読み込み</Button>
    </Group>
    <Paper component="section" className="primary-kpi-card" p="xl" withBorder aria-labelledby="primary-kpi-title">
      <Stack>
        <Text size="xs" c="dimmed" fw={700}>PRIMARY KPI</Text>
        <Title order={2} id="primary-kpi-title">dailyKpiCompleted</Title>
        <Text id="daily-kpi-completed" data-completed={String(metrics.dailyKpiCompleted)} size="xl" fw={700}>
          {metrics.dailyKpiCompleted ? "達成" : "未達成"}
        </Text>
        <Group>
          <Box className="primary-kpi-remaining"><Text span>dueCardsRemaining</Text> <Text component="strong" fw={700}>あと<Text span id="due-cards-remaining">{formatted(metrics.dueCardsRemaining)}</Text>問</Text></Box>
          <Box className="primary-kpi-remaining"><Text span>newQuestionsRemaining</Text> <Text component="strong" fw={700}>あと<Text span id="new-questions-remaining">{formatted(metrics.newQuestionsRemaining)}</Text>問</Text></Box>
        </Group>
      </Stack>
    </Paper>
    <Paper component="section" p="lg" withBorder aria-label="DISPLAY ONLY">
      <Text size="xs" c="dimmed" fw={700}>DISPLAY ONLY</Text>
      <Stack component="dl" className="metric-list">
        {values.map(([label, id, value, unit]) => <Box key={id} className="metric-item">
          <Text component="dt" c="dimmed">{label}</Text>
          <Text component="dd"><Text span fw={700} id={id}>{value}</Text>
            <Text span id={id === "today-correct-rate-percent" ? "today-correct-rate-percent-unit" : undefined} hidden={!unit}>{unit}</Text>
          </Text>
        </Box>)}
      </Stack>
    </Paper>
    <History />
    <Text id="dashboard-status" role="status" aria-live="polite">更新日 {state.learning.today}</Text>
  </Stack>;
}

function App() {
  return <MantineProvider forceColorScheme="dark" withCssVariables={false} withGlobalClasses={false}>
    <Container size="xl" className="page-shell">
      <Group component="header" justify="space-between" py="xl">
        <Box>
          <Text size="xs" c="dimmed" fw={700}>KAKOMONN / LEARNING SYNC</Text>
          <Title order={1}>過去問 定着dashboard</Title>
        </Box>
        <Text c="dimmed">Asia/Tokyo</Text>
      </Group>
      <Box component="main" py="xl">{state.view === "dashboard" ? <Dashboard /> : <StatusPanel />}</Box>
      <Box component="footer" py="xl">
        <Text size="xs" c="dimmed">stabilityDays = 現在の問題catalogに含まれる全問題のFSRS stability合計を切り捨てた日数.</Text>
        <Text size="xs" c="dimmed">stabilityDaysDelta = closing_stability_days - opening_stability_days.</Text>
      </Box>
    </Container>
  </MantineProvider>;
}

function render() { root.render(<App />); }
window.addEventListener("pageshow", (event) => {
  if (event.persisted) void initializeDashboard();
});
void initializeDashboard();
