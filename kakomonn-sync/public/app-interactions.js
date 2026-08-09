let mouseDrag = null;
let touchDrag = null;
let touchPinch = null;
let suppressClick = false;
let edgeWheelDirection = 0;
let edgeWheelDistance = 0;
let wheelNavigationLocked = false;
let wheelNavigationUnlockTimer = 0;

const EDGE_WHEEL_THRESHOLD = 80;
const WHEEL_NAVIGATION_IDLE_MS = 300;

function beginTouchDrag(touch) {
  touchDrag = {
    identifier: touch.identifier,
    startX: touch.clientX,
    startY: touch.clientY,
    startScrollLeft: elements.chartScroller.scrollLeft,
    horizontal: false,
    moved: false,
  };
}

function touchDistance(first, second) {
  return Math.hypot(
    second.clientX - first.clientX,
    second.clientY - first.clientY
  );
}

function touchCenterX(first, second) {
  return (first.clientX + second.clientX) / 2;
}

elements.chartScroller.addEventListener("pointerdown", (event) => {
  if (event.pointerType !== "mouse" || event.button !== 0) {
    return;
  }
  mouseDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startScrollLeft: elements.chartScroller.scrollLeft,
    moved: false,
  };
  elements.chartScroller.setPointerCapture(event.pointerId);
  elements.chartScroller.classList.add("is-dragging");
});

elements.chartScroller.addEventListener("pointermove", (event) => {
  if (mouseDrag === null || event.pointerId !== mouseDrag.pointerId) {
    return;
  }
  const deltaX = event.clientX - mouseDrag.startX;
  mouseDrag.moved ||= Math.abs(deltaX) > 4;
  if (!mouseDrag.moved) {
    return;
  }
  elements.chartScroller.scrollLeft = mouseDrag.startScrollLeft - deltaX;
  event.preventDefault();
});

function finishMouseDrag(event) {
  if (mouseDrag === null || event.pointerId !== mouseDrag.pointerId) {
    return;
  }
  suppressClick = mouseDrag.moved;
  elements.chartScroller.classList.remove("is-dragging");
  if (elements.chartScroller.hasPointerCapture(event.pointerId)) {
    elements.chartScroller.releasePointerCapture(event.pointerId);
  }
  mouseDrag = null;
}

elements.chartScroller.addEventListener("pointerup", finishMouseDrag);
elements.chartScroller.addEventListener("pointercancel", finishMouseDrag);

elements.chartScroller.addEventListener(
  "touchstart",
  (event) => {
    if (event.touches.length >= 2) {
      const [first, second] = event.touches;
      const distance = touchDistance(first, second);
      if (distance <= 0) {
        return;
      }
      touchDrag = null;
      touchPinch = {
        startDistance: distance,
        startZoom: chartZoom,
      };
      elements.chartScroller.classList.add("is-dragging");
      event.preventDefault();
      return;
    }
    touchPinch = null;
    if (event.touches.length !== 1) {
      touchDrag = null;
      return;
    }
    beginTouchDrag(event.touches[0]);
  },
  { passive: false }
);

elements.chartScroller.addEventListener(
  "touchmove",
  (event) => {
    if (touchPinch !== null) {
      if (event.touches.length < 2) {
        return;
      }
      const [first, second] = event.touches;
      const distance = touchDistance(first, second);
      if (distance <= 0) {
        return;
      }
      setChartZoom(
        touchPinch.startZoom * (distance / touchPinch.startDistance),
        touchCenterX(first, second)
      );
      suppressClick = true;
      event.preventDefault();
      return;
    }
    if (touchDrag === null) {
      return;
    }
    const touch = Array.from(event.touches).find(
      (candidate) => candidate.identifier === touchDrag.identifier
    );
    if (touch === undefined) {
      return;
    }
    const deltaX = touch.clientX - touchDrag.startX;
    const deltaY = touch.clientY - touchDrag.startY;
    if (!touchDrag.horizontal) {
      if (Math.abs(deltaX) < 6 && Math.abs(deltaY) < 6) {
        return;
      }
      if (Math.abs(deltaY) >= Math.abs(deltaX)) {
        touchDrag = null;
        return;
      }
      touchDrag.horizontal = true;
      elements.chartScroller.classList.add("is-dragging");
    }
    touchDrag.moved ||= Math.abs(deltaX) > 4;
    elements.chartScroller.scrollLeft = touchDrag.startScrollLeft - deltaX;
    event.preventDefault();
  },
  { passive: false }
);

function finishTouchDrag(event) {
  if (touchPinch !== null) {
    if (event.touches.length >= 2) {
      return;
    }
    touchPinch = null;
    suppressClick = true;
    elements.chartScroller.classList.remove("is-dragging");
    if (event.touches.length === 1) {
      beginTouchDrag(event.touches[0]);
    } else {
      touchDrag = null;
    }
    return;
  }
  if (touchDrag === null) {
    return;
  }
  suppressClick = touchDrag.moved;
  touchDrag = null;
  elements.chartScroller.classList.remove("is-dragging");
}

elements.chartScroller.addEventListener("touchend", finishTouchDrag, { passive: true });
elements.chartScroller.addEventListener(
  "touchcancel",
  (event) => {
    touchPinch = null;
    touchDrag = null;
    suppressClick = true;
    elements.chartScroller.classList.remove("is-dragging");
    finishTouchDrag(event);
  },
  { passive: true }
);

elements.chartScroller.addEventListener(
  "click",
  (event) => {
    if (!suppressClick) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    suppressClick = false;
  },
  true
);

function wheelUnit(event) {
  return event.deltaMode === 1
    ? 18
    : event.deltaMode === 2
      ? elements.chartScroller.clientWidth
      : 1;
}

function wheelDeltaInPixels(event) {
  const horizontal = event.deltaX * wheelUnit(event);
  const vertical = event.deltaY * wheelUnit(event);
  if (!Number.isFinite(horizontal) || !Number.isFinite(vertical)) {
    return 0;
  }
  if (horizontal === 0) {
    return vertical;
  }
  if (vertical === 0) {
    return horizontal;
  }
  return Math.abs(horizontal) >= Math.abs(vertical) ? horizontal : vertical;
}

function zoomDeltaInPixels(event) {
  const unit = wheelUnit(event);
  const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX;
  return Number.isFinite(delta) ? delta * unit : 0;
}

function resetEdgeWheel() {
  edgeWheelDirection = 0;
  edgeWheelDistance = 0;
}

function holdWheelNavigationLock() {
  wheelNavigationLocked = true;
  window.clearTimeout(wheelNavigationUnlockTimer);
  wheelNavigationUnlockTimer = window.setTimeout(() => {
    wheelNavigationLocked = false;
  }, WHEEL_NAVIGATION_IDLE_MS);
}

function navigatePeriodWithWheel(event, direction) {
  const navigationButton =
    direction < 0 ? elements.previousPeriod : elements.nextPeriod;
  if (state.view !== "month" || state.loading || navigationButton.disabled) {
    resetEdgeWheel();
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  if (wheelNavigationLocked) {
    holdWheelNavigationLock();
    return true;
  }
  if (edgeWheelDirection !== direction) {
    edgeWheelDirection = direction;
    edgeWheelDistance = 0;
  }
  edgeWheelDistance += Math.abs(wheelDeltaInPixels(event));
  if (edgeWheelDistance < EDGE_WHEEL_THRESHOLD) {
    return true;
  }

  resetEdgeWheel();
  holdWheelNavigationLock();
  void loadRange(
    state.view,
    shiftAnchor(state.view, state.anchorDate, direction)
  );
  return true;
}

function scrollChartWithWheel(event) {
  const delta = wheelDeltaInPixels(event);
  if (delta === 0) {
    return;
  }

  const maxScrollLeft = Math.max(
    0,
    elements.chartScroller.scrollWidth - elements.chartScroller.clientWidth
  );
  const before = elements.chartScroller.scrollLeft;
  const target = Math.min(maxScrollLeft, Math.max(0, before + delta));
  if (Math.abs(target - before) < 0.01) {
    navigatePeriodWithWheel(event, Math.sign(delta));
    return;
  }

  resetEdgeWheel();
  event.preventDefault();
  event.stopPropagation();
  elements.chartScroller.scrollLeft = target;
}

function handleChartWheel(event) {
  if (event.ctrlKey) {
    const delta = zoomDeltaInPixels(event);
    if (delta === 0) {
      return;
    }
    resetEdgeWheel();
    event.preventDefault();
    event.stopPropagation();
    setChartZoom(chartZoom * Math.exp(-delta * 0.0025), event.clientX);
    return;
  }
  scrollChartWithWheel(event);
}

elements.chartScroller.addEventListener("wheel", handleChartWheel, {
  capture: true,
  passive: false,
});

elements.chartScroller.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
    return;
  }
  event.preventDefault();
  const direction = event.key === "ArrowLeft" ? -1 : 1;
  elements.chartScroller.scrollBy({
    left: direction * Math.max(180, elements.chartScroller.clientWidth * 0.7),
  });
});

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

function anchorForViewChange() {
  const range = displayedRange();
  return range.from <= state.today && range.to >= state.today
    ? "today"
    : state.anchorDate;
}

elements.allView.addEventListener("click", () => {
  if (state.view !== "all") {
    void loadRange("all", "today");
  }
});

elements.weekView.addEventListener("click", () => {
  if (state.view !== "week") {
    void loadRange("week", anchorForViewChange());
  }
});

elements.monthView.addEventListener("click", () => {
  if (state.view !== "month") {
    void loadRange("month", anchorForViewChange());
  }
});

elements.previousPeriod.addEventListener("click", () => {
  void loadRange(state.view, shiftAnchor(state.view, state.anchorDate, -1));
});

elements.nextPeriod.addEventListener("click", () => {
  void loadRange(state.view, shiftAnchor(state.view, state.anchorDate, 1));
});

elements.todayButton.addEventListener("click", () => {
  void loadRange(state.view, "today");
});

elements.refreshButton.addEventListener("click", () => {
  void refreshDashboard();
});

elements.siteSelect.addEventListener("change", async () => {
  if (state.loading || elements.siteSelect.value === state.site) {
    return;
  }
  setDashboardBusy(true);
  try {
    const snapshot = await loadSession(
      state.token,
      true,
      elements.siteSelect.value
    );
    applySnapshot(snapshot);
  } catch (error) {
    showLoadError(error, state.token);
  } finally {
    setDashboardBusy(false);
  }
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

elements.settingsClose.addEventListener("click", () => elements.settingsDialog.close());

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
    removeStoredSite();
  } catch (error) {
    elements.settingsMessage.textContent = messageFor(error);
    return;
  }
  state.token = "";
  state.recoveryToken = "";
  state.sites = [];
  state.site = "";
  state.today = "";
  state.availableFrom = { correct: "", answered: "" };
  state.anchorDate = "";
  state.selectedDate = "";
  state.history = null;
  state.view = "all";
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

window.addEventListener("resize", () => {
  if (state.history !== null) {
    resizeChartForViewport();
  }
});

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
