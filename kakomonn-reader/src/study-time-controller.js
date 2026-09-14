import {
  isStudyTimeResponse,
  isStudyTimeSnapshot,
} from "../../contracts/kakomonn.mjs";

const DAY_MS = 86_400_000;
const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1000;
const STUDY_IDLE_MS = 5 * 60 * 1000;
const STUDY_CHECKPOINT_MS = 30 * 1000;
const STUDY_RECORD_VERSION = 1;

function tokyoDateFromMs(ms) {
  return new Date(ms + TOKYO_OFFSET_MS).toISOString().slice(0, 10);
}

function tokyoDateStartMs(ms) {
  const shifted = ms + TOKYO_OFFSET_MS;
  return Math.floor(shifted / DAY_MS) * DAY_MS - TOKYO_OFFSET_MS;
}

function createSessionId() {
  if (typeof globalThis.crypto?.getRandomValues !== "function") {
    throw new Error("secure random values are unavailable");
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function compactDuration(ms) {
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 10) {
    return `${hours}h`;
  }
  return `${hours}h${String(minutes).padStart(2, "0")}`;
}

function accessibleDuration(ms) {
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return `${minutes}分`;
  }
  return minutes === 0 ? `${hours}時間` : `${hours}時間${minutes}分`;
}

function isStoredStudyRecord(value, expectedSite) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.version !== STUDY_RECORD_VERSION ||
    value.site !== expectedSite ||
    !/^[0-9a-f]{32}$/.test(value.sessionId) ||
    value.days === null ||
    typeof value.days !== "object" ||
    Array.isArray(value.days)
  ) {
    return false;
  }
  return Object.entries(value.days).every(([date, day]) =>
    isStudyTimeSnapshot({
      sessionId: value.sessionId,
      date,
      activeMs: day?.activeMs,
    }) &&
    Number.isSafeInteger(day?.acknowledgedMs) &&
    day.acknowledgedMs >= 0 &&
    day.acknowledgedMs <= day.activeMs,
  );
}

export function installStudyTimeController(app) {
  const storagePrefix = `kakomonn-reader.${app.SITE_ID}.v12.study-session.`;
  const records = new Map();
  let currentRecord = null;
  let initializationPromise = null;
  let checkpointPromise = Promise.resolve();
  let activeStartPerf = null;
  let activeStartWallMs = 0;
  let engagedUntilMs = 0;
  let idleTimer = null;
  let checkpointTimer = null;
  let boundStudyDocument = null;
  let studySyncPromise = null;
  let serverToday = "";
  let serverTodayStudyTimeMs = 0;
  let previousDialogOpen = false;

  function storageKey(sessionId) {
    return `${storagePrefix}${sessionId}`;
  }

  function clearIdleTimer() {
    if (idleTimer !== null) {
      window.clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function splitDuration(startMs, durationMs) {
    let cursor = startMs;
    let remaining = Math.max(0, Math.trunc(durationMs));
    while (remaining > 0) {
      const shifted = cursor + TOKYO_OFFSET_MS;
      const nextBoundary = (Math.floor(shifted / DAY_MS) + 1) * DAY_MS - TOKYO_OFFSET_MS;
      const chunk = Math.min(remaining, Math.max(1, nextBoundary - cursor));
      const date = tokyoDateFromMs(cursor);
      const day = currentRecord.days[date] ?? { activeMs: 0, acknowledgedMs: 0 };
      day.activeMs += chunk;
      currentRecord.days[date] = day;
      cursor += chunk;
      remaining -= chunk;
    }
  }

  function stopActive(cutoffWallMs = Date.now()) {
    if (activeStartPerf === null || currentRecord === null) {
      return false;
    }
    const elapsedPerf = Math.max(0, performance.now() - activeStartPerf);
    const elapsedWall = Math.max(0, cutoffWallMs - activeStartWallMs);
    const duration = Math.min(elapsedPerf, elapsedWall);
    activeStartPerf = null;
    const start = activeStartWallMs;
    activeStartWallMs = 0;
    splitDuration(start, duration);
    renderStudyTime();
    return duration > 0;
  }

  function canTrackStudyTime() {
    if (
      currentRecord === null ||
      document.visibilityState !== "visible" ||
      (!app.isIPhoneSafari && !document.hasFocus()) ||
      app.syncSettings.open ||
      app.errorDialog.open ||
      app.navigationInProgress ||
      app.frameDocument?.body === undefined
    ) {
      return false;
    }
    try {
      return app.currentQuestionControls() !== null;
    } catch {
      return false;
    }
  }

  function scheduleIdleStop() {
    clearIdleTimer();
    const delay = Math.max(0, engagedUntilMs - Date.now());
    idleTimer = window.setTimeout(() => {
      idleTimer = null;
      if (Date.now() < engagedUntilMs) {
        scheduleIdleStop();
        return;
      }
      stopActive(engagedUntilMs);
      void checkpointStudyTime();
    }, delay);
  }

  function startActive() {
    if (activeStartPerf !== null || !canTrackStudyTime() || Date.now() >= engagedUntilMs) {
      return false;
    }
    activeStartPerf = performance.now();
    activeStartWallMs = Date.now();
    scheduleIdleStop();
    return true;
  }

  function refreshStudyTracking({ engage = false } = {}) {
    if (engage) {
      engagedUntilMs = Date.now() + STUDY_IDLE_MS;
    }
    if (!canTrackStudyTime() || Date.now() >= engagedUntilMs) {
      stopActive(Math.min(Date.now(), engagedUntilMs || Date.now()));
      clearIdleTimer();
      return false;
    }
    return startActive();
  }

  function handleDirectActivity(event) {
    if (!event.isTrusted) {
      return;
    }
    refreshStudyTracking({ engage: true });
  }

  function unbindStudyFrame() {
    if (boundStudyDocument === null) {
      return;
    }
    boundStudyDocument.removeEventListener("pointerdown", handleDirectActivity, true);
    boundStudyDocument.removeEventListener("keydown", handleDirectActivity, true);
    boundStudyDocument.removeEventListener("wheel", handleDirectActivity, true);
    boundStudyDocument.removeEventListener("touchstart", handleDirectActivity, true);
    boundStudyDocument = null;
  }

  function bindStudyFrame(sourceDocument = app.frameDocument) {
    if (!sourceDocument?.body || sourceDocument === boundStudyDocument) {
      refreshStudyTracking({ engage: true });
      return;
    }
    unbindStudyFrame();
    boundStudyDocument = sourceDocument;
    boundStudyDocument.addEventListener("pointerdown", handleDirectActivity, {
      capture: true,
      passive: true,
    });
    boundStudyDocument.addEventListener("keydown", handleDirectActivity, true);
    boundStudyDocument.addEventListener("wheel", handleDirectActivity, {
      capture: true,
      passive: true,
    });
    boundStudyDocument.addEventListener("touchstart", handleDirectActivity, {
      capture: true,
      passive: true,
    });
    refreshStudyTracking({ engage: true });
  }

  function localUnacknowledgedTodayMs(today) {
    let total = 0;
    for (const record of records.values()) {
      const day = record.days[today];
      if (day !== undefined) {
        total += Math.max(0, day.activeMs - day.acknowledgedMs);
      }
    }
    return total;
  }

  function renderStudyTime() {
    if (app.studyTimeBadge === undefined) {
      return;
    }
    const today = tokyoDateFromMs(Date.now());
    const serverMs = serverToday === today ? serverTodayStudyTimeMs : 0;
    const localMs = localUnacknowledgedTodayMs(today);
    let liveMs = 0;
    if (activeStartPerf !== null && currentRecord !== null) {
      const nowMs = Date.now();
      const effectiveEndMs = Math.min(nowMs, engagedUntilMs);
      const effectiveStartMs = Math.max(activeStartWallMs, tokyoDateStartMs(nowMs));
      const wallDuration = Math.max(0, effectiveEndMs - effectiveStartMs);
      const totalWallDuration = Math.max(0, effectiveEndMs - activeStartWallMs);
      const performanceDuration = Math.max(0, performance.now() - activeStartPerf);
      liveMs = Math.min(wallDuration, performanceDuration, totalWallDuration);
    }
    const total = Math.max(0, Math.trunc(serverMs + localMs + liveMs));
    app.studyTimeBadge.textContent = compactDuration(total);
    app.studyTimeBadge.setAttribute(
      "aria-label",
      `今日の勉強時間 ${accessibleDuration(total)}`,
    );
    app.studyTimeBadge.title = `今日の勉強時間 ${accessibleDuration(total)}`;
  }

  function queueRecordWrite(record) {
    const snapshot = structuredClone(record);
    const task = checkpointPromise.then(() => GM.setValue(storageKey(record.sessionId), snapshot));
    checkpointPromise = task.catch(() => {});
    return task;
  }

  async function checkpointStudyTime() {
    if (currentRecord === null) {
      return false;
    }
    const wasActive = activeStartPerf !== null;
    if (wasActive) {
      stopActive(Date.now());
    }
    await queueRecordWrite(currentRecord);
    renderStudyTime();
    if (wasActive) {
      refreshStudyTracking();
    }
    return true;
  }

  async function initializeStudyTime() {
    if (initializationPromise !== null) {
      return initializationPromise;
    }
    initializationPromise = (async () => {
      const keys = await GM.listValues();
      const studyKeys = keys.filter((key) => key.startsWith(storagePrefix));
      for (const key of studyKeys) {
        const value = await GM.getValue(key, null);
        if (!isStoredStudyRecord(value, app.SITE_ID)) {
          await GM.deleteValue(key);
          continue;
        }
        if (Object.values(value.days).every((day) => day.acknowledgedMs >= day.activeMs)) {
          await GM.deleteValue(key);
          continue;
        }
        records.set(value.sessionId, value);
      }
      const sessionId = createSessionId();
      currentRecord = {
        version: STUDY_RECORD_VERSION,
        site: app.SITE_ID,
        sessionId,
        days: {},
      };
      records.set(sessionId, currentRecord);
      await queueRecordWrite(currentRecord);
      checkpointTimer = window.setInterval(() => {
        void checkpointStudyTime();
      }, STUDY_CHECKPOINT_MS);
      refreshStudyTracking({ engage: true });
      renderStudyTime();
      return true;
    })();
    return initializationPromise;
  }

  async function prepareStudyTimeSnapshots() {
    await initializeStudyTime();
    await checkpointStudyTime();
    const snapshots = [];
    for (const record of records.values()) {
      for (const [date, day] of Object.entries(record.days)) {
        if (day.activeMs > day.acknowledgedMs) {
          snapshots.push({
            sessionId: record.sessionId,
            date,
            activeMs: day.activeMs,
          });
        }
      }
    }
    snapshots.sort((left, right) =>
      left.date === right.date
        ? left.sessionId.localeCompare(right.sessionId)
        : left.date.localeCompare(right.date),
    );
    return snapshots.slice(0, 128);
  }

  async function acknowledgeStudyTimeSnapshots(snapshots, state = null) {
    await initializeStudyTime();
    const touched = new Set();
    for (const snapshot of snapshots) {
      const record = records.get(snapshot.sessionId);
      const day = record?.days[snapshot.date];
      if (day === undefined) {
        continue;
      }
      day.acknowledgedMs = Math.max(day.acknowledgedMs, Math.min(day.activeMs, snapshot.activeMs));
      touched.add(record.sessionId);
    }
    for (const sessionId of touched) {
      const record = records.get(sessionId);
      if (record === undefined) {
        continue;
      }
      const complete = Object.values(record.days).every(
        (day) => day.acknowledgedMs >= day.activeMs,
      );
      if (record !== currentRecord && complete) {
        await GM.deleteValue(storageKey(sessionId));
        records.delete(sessionId);
      } else {
        await queueRecordWrite(record);
      }
    }
    if (state !== null) {
      applyStudyServerState(state);
    }
    renderStudyTime();
  }

  function applyStudyServerState(state) {
    if (state?.site !== app.SITE_ID || !state.learningMetrics) {
      return;
    }
    serverToday = state.today;
    serverTodayStudyTimeMs = state.learningMetrics.todayStudyTimeMs;
    renderStudyTime();
    void flushStudyTime();
  }

  function reconcileStudyLearningMetrics(metrics, today = tokyoDateFromMs(Date.now())) {
    if (!Number.isSafeInteger(metrics?.todayStudyTimeMs) || metrics.todayStudyTimeMs < 0) {
      return;
    }
    serverToday = today;
    serverTodayStudyTimeMs = metrics.todayStudyTimeMs;
    renderStudyTime();
  }

  async function flushStudyTime() {
    await initializeStudyTime();
    if (
      studySyncPromise !== null ||
      !app.syncToken ||
      app.syncInProgress ||
      app.nextQuestionOperationInProgress
    ) {
      return false;
    }
    const snapshots = await prepareStudyTimeSnapshots();
    if (snapshots.length === 0) {
      return true;
    }
    studySyncPromise = (async () => {
      try {
        const response = await app.requestSyncResponse(
          "POST",
          "/v12/study-time",
          app.syncToken,
          (value) => isStudyTimeResponse(value, app.SITE_ID),
          { site: app.SITE_ID, studyTimeSnapshots: snapshots },
        );
        await acknowledgeStudyTimeSnapshots(snapshots, response.state);
        return true;
      } catch {
        return false;
      } finally {
        studySyncPromise = null;
      }
    })();
    return studySyncPromise;
  }

  function handleStudyVisibilityChange() {
    if (document.visibilityState === "visible") {
      refreshStudyTracking({ engage: true });
      void flushStudyTime();
      return;
    }
    stopActive(Date.now());
    clearIdleTimer();
    void checkpointStudyTime();
  }

  function handleStudyFocus() {
    refreshStudyTracking({ engage: true });
    void flushStudyTime();
  }

  function handleStudyBlur() {
    stopActive(Date.now());
    clearIdleTimer();
    void checkpointStudyTime();
  }

  function handleStudyPageHide() {
    stopActive(Date.now());
    clearIdleTimer();
    void checkpointStudyTime();
    void flushStudyTime();
  }

  const dialogObserver = new MutationObserver(() => {
    const dialogOpen = app.syncSettings.open || app.errorDialog.open;
    if (previousDialogOpen && !dialogOpen) {
      refreshStudyTracking({ engage: true });
    } else {
      refreshStudyTracking();
    }
    previousDialogOpen = dialogOpen;
  });
  dialogObserver.observe(app.syncSettings, { attributes: true, attributeFilter: ["open"] });
  dialogObserver.observe(app.errorDialog, { attributes: true, attributeFilter: ["open"] });

  window.addEventListener("focus", handleStudyFocus);
  window.addEventListener("blur", handleStudyBlur);
  window.addEventListener("pagehide", handleStudyPageHide);
  document.addEventListener("visibilitychange", handleStudyVisibilityChange);

  Object.defineProperties(app, {
    initializeStudyTime: { enumerable: false, get: () => initializeStudyTime },
    prepareStudyTimeSnapshots: { enumerable: false, get: () => prepareStudyTimeSnapshots },
    acknowledgeStudyTimeSnapshots: {
      enumerable: false,
      get: () => acknowledgeStudyTimeSnapshots,
    },
    applyStudyServerState: { enumerable: false, get: () => applyStudyServerState },
    reconcileStudyLearningMetrics: {
      enumerable: false,
      get: () => reconcileStudyLearningMetrics,
    },
    flushStudyTime: { enumerable: false, get: () => flushStudyTime },
    bindStudyFrame: { enumerable: false, get: () => bindStudyFrame },
    refreshStudyTracking: { enumerable: false, get: () => refreshStudyTracking },
    renderStudyTime: { enumerable: false, get: () => renderStudyTime },
    STUDY_IDLE_MS: { enumerable: false, get: () => STUDY_IDLE_MS },
    STUDY_CHECKPOINT_MS: { enumerable: false, get: () => STUDY_CHECKPOINT_MS },
  });
}
