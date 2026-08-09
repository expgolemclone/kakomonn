let chartZoom = 1;
let chartViewportKey = "";

const CHART_MAX_ZOOM = 8;
const CHART_SCALE_WIDTH = 42;
const MONTH_DAY_WIDTH = 42;

function messageFor(error) {
  switch (error?.code) {
    case "unauthorized":
      return "同期tokenが正しくありません.";
    case "storage_unavailable":
      return "このbrowserへ同期tokenを保存できません. browserの保存設定を確認してください.";
    case "request_timeout":
      return "学習記録の読込みが時間内に完了しませんでした.";
    case "network_error":
      return "学習記録へ接続できません. 通信状態を確認してください.";
    case "server_misconfigured":
      return "同期APIにtokenが設定されていません.";
    case "invalid_response":
      return "同期APIから不正な応答を受け取りました.";
    case "invalid_request":
      return "表示期間が正しくありません.";
    default:
      return "学習記録を読み込めませんでした.";
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
  elements.siteEmpty.hidden = true;
  elements.loadError.hidden = true;
  elements.settingsButton.hidden = true;
  elements.authMessage.textContent = message;
}

function showDashboard() {
  elements.authPanel.hidden = true;
  elements.dashboard.hidden = false;
  elements.siteEmpty.hidden = true;
  elements.loadError.hidden = true;
  elements.settingsButton.hidden = false;
}

function showSiteEmpty() {
  elements.authPanel.hidden = true;
  elements.dashboard.hidden = true;
  elements.siteEmpty.hidden = false;
  elements.loadError.hidden = true;
  elements.settingsButton.hidden = false;
}

function showLoadError(error, recoveryToken) {
  state.recoveryToken = recoveryToken;
  elements.authPanel.hidden = true;
  elements.dashboard.hidden = true;
  elements.siteEmpty.hidden = true;
  elements.settingsButton.hidden = true;
  elements.loadError.hidden = false;
  elements.errorMessage.textContent = messageFor(error);
}

function setDashboardBusy(busy) {
  state.loading = busy;
  elements.dashboard.setAttribute("aria-busy", String(busy));
  elements.siteSelect.disabled = busy;
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

function chartKey(days) {
  return `${state.view}:${state.history.from}:${state.history.to}:${days.length}`;
}

function chartBaseWidth(days) {
  const viewportWidth = elements.chartScroller.clientWidth;
  if (viewportWidth <= 0) {
    return 0;
  }
  if (state.view === "month") {
    return Math.max(1360, viewportWidth, CHART_SCALE_WIDTH + days.length * MONTH_DAY_WIDTH);
  }
  return viewportWidth;
}

function chartMinimumZoom(days) {
  const viewportWidth = elements.chartScroller.clientWidth;
  const baseWidth = chartBaseWidth(days);
  if (viewportWidth <= 0 || baseWidth <= 0) {
    return 1;
  }
  return Math.min(1, viewportWidth / baseWidth);
}

function chartFrameWidth(days) {
  const viewportWidth = elements.chartScroller.clientWidth;
  const baseWidth = chartBaseWidth(days);
  return Math.max(viewportWidth, Math.round(baseWidth * chartZoom));
}

function clampChartScroll(value) {
  const maximum = Math.max(
    0,
    elements.chartScroller.scrollWidth - elements.chartScroller.clientWidth
  );
  return Math.min(maximum, Math.max(0, value));
}

function updateChartDensity(days) {
  const dayWidth = elements.barChart.clientWidth / Math.max(1, days.length);
  const labelStride = Math.max(1, Math.ceil(28 / Math.max(1, dayWidth)));
  const showValues = dayWidth >= 24;
  const showTodayMarker = dayWidth >= 26;
  const slots = elements.barChart.querySelectorAll(".bar-slot");
  slots.forEach((slot, index) => {
    const day = days[index];
    const label = slot.querySelector(".day-label");
    const showLabel =
      dayWidth >= 20 ||
      index % labelStride === 0 ||
      index === days.length - 1 ||
      day?.date === state.today;
    if (label !== null) {
      label.style.visibility = showLabel ? "" : "hidden";
    }
    const value = slot.querySelector(".bar-value");
    if (value !== null) {
      value.style.visibility = showValues ? "" : "hidden";
    }
    const marker = slot.querySelector(".today-marker");
    if (marker !== null) {
      marker.style.visibility = showTodayMarker ? "" : "hidden";
    }
  });
  elements.accuracyPoints.style.display = dayWidth >= 8 ? "" : "none";
}

function applyChartLayout(days) {
  const frameWidth = chartFrameWidth(days);
  if (frameWidth <= 0) {
    return;
  }
  const plotWidth = Math.max(1, frameWidth - CHART_SCALE_WIDTH);
  const dayWidth = plotWidth / Math.max(1, days.length);
  const gap =
    state.view === "week"
      ? ""
      : dayWidth >= 16
        ? "2px"
        : dayWidth >= 8
          ? "1px"
          : "0px";

  elements.chartFrame.classList.remove("is-expanded");
  elements.barChart.classList.remove("is-expanded");
  elements.chartFrame.style.width = `${frameWidth}px`;
  elements.chartFrame.style.minWidth = `${frameWidth}px`;
  elements.chartFrame.style.overflow = "hidden";
  elements.barChart.style.gridTemplateColumns = `repeat(${days.length}, minmax(0, 1fr))`;
  elements.barChart.style.gap = gap;

  window.requestAnimationFrame(() => {
    updateChartDensity(days);
    renderAccuracyLine(days);
  });
}

function setChartZoom(nextZoom, clientX = null) {
  const days = state.history?.days;
  if (!Array.isArray(days) || days.length === 0) {
    return;
  }
  const minimum = chartMinimumZoom(days);
  const clamped = Math.min(CHART_MAX_ZOOM, Math.max(minimum, nextZoom));
  if (Math.abs(clamped - chartZoom) < 0.001) {
    return;
  }

  const scroller = elements.chartScroller;
  const rect = scroller.getBoundingClientRect();
  const anchorOffset = Math.min(
    rect.width,
    Math.max(0, clientX === null ? rect.width / 2 : clientX - rect.left)
  );
  const oldWidth = Math.max(1, scroller.scrollWidth);
  const anchorRatio = (scroller.scrollLeft + anchorOffset) / oldWidth;

  chartZoom = clamped;
  applyChartLayout(days);
  window.requestAnimationFrame(() => {
    scroller.scrollLeft = clampChartScroll(
      anchorRatio * scroller.scrollWidth - anchorOffset
    );
  });
}

function resizeChartForViewport() {
  const days = state.history?.days;
  if (!Array.isArray(days) || days.length === 0) {
    return;
  }
  const scroller = elements.chartScroller;
  const oldWidth = Math.max(1, scroller.scrollWidth);
  const centerRatio =
    (scroller.scrollLeft + scroller.clientWidth / 2) / oldWidth;
  chartZoom = Math.min(
    CHART_MAX_ZOOM,
    Math.max(chartMinimumZoom(days), chartZoom)
  );
  applyChartLayout(days);
  window.requestAnimationFrame(() => {
    scroller.scrollLeft = clampChartScroll(
      centerRatio * scroller.scrollWidth - scroller.clientWidth / 2
    );
  });
}

function accuracyFor(day) {
  const { correct, answered } = day.counts;
  if (correct === null || answered === null || answered <= 0) {
    return null;
  }
  return (correct / answered) * 100;
}

function formatAccuracy(day) {
  const accuracy = accuracyFor(day);
  return accuracy === null ? "--" : `${accuracy.toFixed(1)}%`;
}

function chooseSelectedDate(days) {
  const current = days.find(
    (day) => day.date === state.selectedDate && day.counts.correct !== null
  );
  if (current !== undefined) {
    return current.date;
  }
  const today = days.find(
    (day) => day.date === state.today && day.counts.correct !== null
  );
  if (today !== undefined) {
    return today.date;
  }
  return days.filter((day) => day.counts.correct !== null).at(-1)?.date ?? "";
}

function renderDayDetail() {
  const day = state.history?.days.find((entry) => entry.date === state.selectedDate);
  if (day === undefined || day.counts.correct === null) {
    elements.dayDetail.textContent = "";
    return;
  }
  const answered =
    day.counts.answered === null
      ? "解答数は記録開始前"
      : `解答${day.counts.answered}問`;
  const accuracy = accuracyFor(day);
  const accuracyText = accuracy === null ? "正答率は算出対象外" : `正答率${accuracy.toFixed(1)}%`;
  elements.dayDetail.textContent = `${formatFullDate(day.date)} ${WEEKDAY_LABELS[weekday(day.date)]}曜日, 正解${day.counts.correct}問, ${answered}, ${accuracyText}.`;
}

function selectDay(date) {
  state.selectedDate = date;
  for (const button of elements.barChart.querySelectorAll(".bar-button")) {
    button.setAttribute("aria-pressed", String(button.dataset.date === date));
  }
  renderDayDetail();
}

function positionSelectedDate() {
  if (state.view === "week" || state.selectedDate === "") {
    elements.chartScroller.scrollLeft = 0;
    return;
  }
  if (state.view === "all" && chartZoom <= 1) {
    elements.chartScroller.scrollLeft = 0;
    return;
  }
  window.requestAnimationFrame(() => {
    const selected = elements.barChart.querySelector(`[data-date="${state.selectedDate}"]`);
    if (selected === null) {
      return;
    }
    const slot = selected.closest(".bar-slot");
    const target = slot.offsetLeft - elements.chartScroller.clientWidth / 2 + slot.clientWidth / 2;
    elements.chartScroller.scrollLeft = Math.max(0, target);
  });
}

function renderAccuracyLine(days) {
  window.requestAnimationFrame(() => {
    const height = elements.accuracyLine.clientHeight;
    const width = elements.accuracyLine.clientWidth;
    if (height <= 0 || width <= 0) {
      return;
    }
    elements.accuracyLine.setAttribute("viewBox", `0 0 ${width} ${height}`);
    for (const path of elements.accuracyLine.querySelectorAll("path")) {
      path.remove();
    }
    elements.accuracyPoints.replaceChildren();

    const segments = [];
    let segment = [];
    days.forEach((day) => {
      const accuracy = accuracyFor(day);
      const slot = elements.barChart.querySelector(`[data-day-slot="${day.date}"]`);
      if (accuracy === null || slot === null) {
        if (segment.length > 0) {
          segments.push(segment);
          segment = [];
        }
        return;
      }
      const x = slot.offsetLeft + slot.offsetWidth / 2;
      const y = Math.max(2, Math.min(height - 2, height * (1 - accuracy / 100)));
      segment.push({ x, y });
      const point = document.createElementNS(SVG_NAMESPACE, "circle");
      point.setAttribute("cx", String(x));
      point.setAttribute("cy", String(y));
      point.setAttribute("r", "3.6");
      elements.accuracyPoints.append(point);
    });
    if (segment.length > 0) {
      segments.push(segment);
    }
    for (const points of segments) {
      if (points.length < 2) {
        continue;
      }
      const path = document.createElementNS(SVG_NAMESPACE, "path");
      path.setAttribute(
        "d",
        points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ")
      );
      elements.accuracyLine.insertBefore(path, elements.accuracyPoints);
    }
  });
}

function renderChart() {
  const days = state.history.days;
  const nextChartKey = chartKey(days);
  if (nextChartKey !== chartViewportKey) {
    chartViewportKey = nextChartKey;
    chartZoom = 1;
  }
  const correctAvailableDays = days.filter((day) => day.counts.correct !== null);
  const recordedTotal = correctAvailableDays.reduce(
    (sum, day) => sum + (day.counts.answered ?? day.counts.correct),
    0
  );
  const maximum = niceMaximum(
    days.reduce(
      (result, day) => Math.max(result, day.counts.correct ?? 0, day.counts.answered ?? 0),
      0
    )
  );
  state.selectedDate = chooseSelectedDate(days);
  elements.scaleMaximum.textContent = formatScale(maximum);
  elements.scaleMiddle.textContent = formatScale(maximum / 2);
  elements.chartFrame.style.setProperty("--day-count", String(days.length));
  elements.barChart.replaceChildren();

  for (const day of days) {
    const item = document.createElement("li");
    item.className = "bar-slot";
    item.dataset.daySlot = day.date;

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

    if (day.counts.correct === null) {
      const empty = document.createElement("div");
      empty.className = "empty-bar";
      empty.setAttribute("aria-hidden", "true");
      item.setAttribute(
        "aria-label",
        day.date < state.availableFrom.correct
          ? `${formatFullDate(day.date)}, 記録開始前.`
          : `${formatFullDate(day.date)}, 未来日.`
      );
      item.append(empty, dayLabel);
      elements.barChart.append(item);
      continue;
    }

    const button = document.createElement("button");
    button.className = "bar-button";
    button.type = "button";
    button.dataset.date = day.date;
    button.setAttribute("aria-pressed", String(day.date === state.selectedDate));
    const answeredText =
      day.counts.answered === null ? "解答数は記録開始前" : `解答${day.counts.answered}問`;
    const accuracyText = accuracyFor(day) === null ? "正答率は算出対象外" : `正答率${formatAccuracy(day)}`;
    button.setAttribute(
      "aria-label",
      `${formatFullDate(day.date)} ${WEEKDAY_LABELS[weekday(day.date)]}曜日, 正解${day.counts.correct}問, ${answeredText}, ${accuracyText}.`
    );
    button.style.setProperty("--correct-percent", `${(day.counts.correct / maximum) * 100}%`);
    const labelCount = day.counts.answered ?? day.counts.correct;
    button.style.setProperty("--bar-label-percent", `${(labelCount / maximum) * 100}%`);

    const value = document.createElement("span");
    value.className = "bar-value";
    value.textContent =
      day.counts.answered === null
        ? String(day.counts.correct)
        : `${day.counts.correct}/${day.counts.answered}`;
    value.setAttribute("aria-hidden", "true");

    if (day.counts.answered !== null) {
      button.classList.add("has-answered-count");
      button.style.setProperty("--answered-percent", `${(day.counts.answered / maximum) * 100}%`);
      const answeredFill = document.createElement("span");
      answeredFill.className = "bar-fill bar-fill-answered";
      answeredFill.setAttribute("aria-hidden", "true");
      button.append(answeredFill);
    }
    const correctFill = document.createElement("span");
    correctFill.className = "bar-fill bar-fill-correct";
    correctFill.setAttribute("aria-hidden", "true");
    button.append(value, correctFill);
    button.addEventListener("click", () => selectDay(day.date));
    item.append(button, dayLabel);
    elements.barChart.append(item);
  }

  elements.emptyMessage.hidden = correctAvailableDays.length === 0 || recordedTotal !== 0;
  renderDayDetail();
  applyChartLayout(days);
  positionSelectedDate();
}
