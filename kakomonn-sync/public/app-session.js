function renderNavigation() {
  if (state.today === "" || state.anchorDate === "") {
    return;
  }
  const currentRange = rangeFor(state.view, state.anchorDate);
  const previousRange = rangeFor(state.view, shiftAnchor(state.view, state.anchorDate, -1));
  elements.weekView.setAttribute("aria-pressed", String(state.view === "week"));
  elements.monthView.setAttribute("aria-pressed", String(state.view === "month"));
  elements.periodTitle.textContent = formatPeriod(state.view, currentRange);
  elements.previousPeriod.disabled =
    state.loading ||
    state.availableFrom.correct === "" ||
    previousRange.to < state.availableFrom.correct;
  elements.nextPeriod.disabled = state.loading || currentRange.to >= state.today;
  elements.todayButton.disabled =
    state.loading || (currentRange.from <= state.today && currentRange.to >= state.today);
  elements.refreshButton.disabled = state.loading;
  elements.weekView.disabled = state.loading;
  elements.monthView.disabled = state.loading;
}

function formatAverage(value) {
  return value === null
    ? "--"
    : new Intl.NumberFormat("ja-JP", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }).format(value);
}

function renderDashboard() {
  const range = rangeFor(state.view, state.anchorDate);
  const correctDays = state.history.days.filter((day) => day.counts.correct !== null);
  const answeredDays = state.history.days.filter((day) => day.counts.answered !== null);
  const correctTotal = correctDays.reduce((sum, day) => sum + day.counts.correct, 0);
  const answeredTotal = answeredDays.reduce((sum, day) => sum + day.counts.answered, 0);
  const correctAverage = correctDays.length === 0 ? null : correctTotal / correctDays.length;
  const answeredAverage = answeredDays.length === 0 ? null : answeredTotal / answeredDays.length;
  elements.totalCount.textContent = correctDays.length === 0 ? "--" : String(correctTotal);
  elements.totalAnswered.textContent = answeredDays.length === 0 ? "--" : String(answeredTotal);
  elements.averageCount.textContent = formatAverage(correctAverage);
  elements.averageAnswered.textContent = formatAverage(answeredAverage);

  const trackingParts = [`正解${correctDays.length}日間`, `解答${answeredDays.length}日間`];
  if (range.from < state.availableFrom.correct) {
    trackingParts.push(`正解記録は${formatShortDate(state.availableFrom.correct)}から`);
  }
  if (range.from < state.availableFrom.answered || state.availableFrom.answered > state.today) {
    trackingParts.push(`解答記録は${formatShortDate(state.availableFrom.answered)}から`);
  }
  elements.trackingNote.textContent = `${trackingParts.join(", ")}.`;
  renderNavigation();
  renderChart();
  showDashboard();
  elements.dashboardStatus.textContent = `${new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date())}に更新しました.`;
}

async function loadSession(token, resetAnchor) {
  const syncState = await fetchState(token);
  const anchorDate = resetAnchor || state.anchorDate === "" ? syncState.date : state.anchorDate;
  const range = rangeFor(state.view, anchorDate);
  const history = await fetchHistory(token, range);
  if (history.today !== syncState.date) {
    throw new DashboardError("invalid_response");
  }
  return { token, today: syncState.date, anchorDate, history };
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
      snapshot.history = await fetchHistory(state.token, rangeFor(state.view, snapshot.anchorDate));
    }
    applySnapshot(snapshot);
  } catch (error) {
    showLoadError(error, state.token);
  } finally {
    setDashboardBusy(false);
  }
}
