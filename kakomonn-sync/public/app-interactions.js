let mouseDrag = null;
let touchDrag = null;
let suppressClick = false;

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
    if (event.touches.length !== 1) {
      touchDrag = null;
      return;
    }
    const touch = event.touches[0];
    touchDrag = {
      identifier: touch.identifier,
      startX: touch.clientX,
      startY: touch.clientY,
      startScrollLeft: elements.chartScroller.scrollLeft,
      horizontal: false,
      moved: false,
    };
  },
  { passive: true }
);

elements.chartScroller.addEventListener(
  "touchmove",
  (event) => {
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

function finishTouchDrag() {
  if (touchDrag === null) {
    return;
  }
  suppressClick = touchDrag.moved;
  touchDrag = null;
  elements.chartScroller.classList.remove("is-dragging");
}

elements.chartScroller.addEventListener("touchend", finishTouchDrag, { passive: true });
elements.chartScroller.addEventListener("touchcancel", finishTouchDrag, { passive: true });

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

function wheelDeltaInPixels(event) {
  const dominantDelta =
    Math.abs(event.deltaY) >= Math.abs(event.deltaX)
      ? event.deltaY
      : event.deltaX;
  if (!Number.isFinite(dominantDelta) || dominantDelta === 0) {
    return 0;
  }

  const unit =
    event.deltaMode === 1
      ? 18
      : event.deltaMode === 2
        ? elements.chartScroller.clientWidth
        : 1;
  const pixelDelta = dominantDelta * unit;
  const minimumStep = event.deltaMode === 0 ? 42 : 0;
  return Math.sign(pixelDelta) * Math.max(Math.abs(pixelDelta), minimumStep);
}

function scrollChartWithWheel(event) {
  const maxScrollLeft =
    elements.chartScroller.scrollWidth - elements.chartScroller.clientWidth;
  if (maxScrollLeft <= 0) {
    return;
  }

  const delta = wheelDeltaInPixels(event);
  if (delta === 0) {
    return;
  }

  const before = elements.chartScroller.scrollLeft;
  const target = Math.min(maxScrollLeft, Math.max(0, before + delta));
  if (target === before) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  elements.chartScroller.scrollLeft = target;
}

elements.chartScroller.addEventListener("wheel", scrollChartWithWheel, {
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
  void loadRange(state.view, shiftAnchor(state.view, state.anchorDate, -1));
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
  } catch (error) {
    elements.settingsMessage.textContent = messageFor(error);
    return;
  }
  state.token = "";
  state.recoveryToken = "";
  state.today = "";
  state.availableFrom = { correct: "", answered: "" };
  state.anchorDate = "";
  state.selectedDate = "";
  state.history = null;
  state.view = "month";
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
    renderAccuracyLine(state.history.days);
  }
  positionSelectedDate();
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
