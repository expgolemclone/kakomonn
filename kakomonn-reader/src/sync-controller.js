import {
  isAttemptResponse as isAttemptResponseContract,
  isCatalogConflictResponse as isCatalogConflictResponseContract,
  isCatalogResponse as isCatalogResponseContract,
  isCelebration,
  isLearningState,
  isNextQuestion as isNextQuestionContract,
  isNextResponse as isNextResponseContract,
  isQuestionId,
  isSpeechTokenResponse as isSpeechTokenResponseContract,
  scheduledQuestionId,
} from "../../contracts/kakomonn.mjs";

export function installSyncController(app) {
  const isSyncState = (value) => isLearningState(value, app.SITE_ID);
  
  const isAttemptResponse = (value) =>
    isAttemptResponseContract(value, app.SITE_ID);
  
  const isNextQuestion = (value) =>
    isNextQuestionContract(value, app.SITE_ID);
  
  const isNextResponse = (value) =>
    isNextResponseContract(value, app.SITE_ID);
  
  const isCatalogResponse = (value) =>
    isCatalogResponseContract(value, app.SITE_ID);
  
  const isCatalogConflictResponse = (value) =>
    isCatalogConflictResponseContract(value, app.SITE_ID);
  
  function isLaunchHandoff(value) {
    if (
      value === null ||
      typeof value !== "object" ||
      !Number.isSafeInteger(value.createdAtMs) ||
      value.questionURL !== location.href ||
      !isSyncState(value.state)
    ) {
      return false;
    }
    const ageMs = Date.now() - value.createdAtMs;
    return ageMs >= 0 && ageMs <= app.LAUNCH_HANDOFF_MAX_AGE_MS;
  }
  
  const isSpeechTokenResponse = isSpeechTokenResponseContract;
  
  function isSitePageURL(value) {
    try {
      const url = new URL(value);
      return (
        url.origin === `https://${app.SITE_ID}` &&
        url.username === "" &&
        url.password === ""
      );
    } catch {
      return false;
    }
  }
  
  function extractQuestionIdFromURL(value) {
    try {
      const url = new URL(value);
      if (
        url.origin !== `https://${app.SITE_ID}` ||
        url.search !== "" ||
        url.hash !== ""
      ) {
        return null;
      }
      const match = url.pathname.match(/^\/questions\/(?:next\/)?(\d+)$/);
      return match?.[1] ?? null;
    } catch {
      return null;
    }
  }
  
  function isAttemptCopyState(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const keys = Object.keys(value).sort().join(",");
    if (value.state === "ready") {
      return (
        keys === "markdown,state" &&
        typeof value.markdown === "string" &&
        value.markdown.length > 0
      );
    }
    return (
      keys === "state" &&
      ["required", "completed", "not-required"].includes(value.state)
    );
  }
  
  function isPendingAttempt(value) {
    if (
      value === null ||
      typeof value !== "object" ||
      value.site !== app.SITE_ID ||
      !/^[0-9a-f]{32}$/.test(value.operationId) ||
      !isQuestionId(value.questionId) ||
      (value.answerResult !== "correct" && value.answerResult !== "incorrect") ||
      !isSitePageURL(value.pageURL) ||
      extractQuestionIdFromURL(value.pageURL) !== value.questionId ||
      (value.phase !== "queued" && value.phase !== "recorded") ||
      !isAttemptCopyState(value.copy)
    ) {
      return false;
    }
    if (value.phase === "queued") {
      return (
        value.nextURL === undefined &&
        value.kpiQuestionsRemaining === undefined
      );
    }
    const validNextURL =
      value.nextURL === null ||
      (typeof value.nextURL === "string" &&
        isScheduledQuestionURL(value.nextURL));
    const validKpiQuestionsRemaining =
      value.answerResult === "correct"
        ? Number.isSafeInteger(value.kpiQuestionsRemaining) &&
          value.kpiQuestionsRemaining >= 0
        : value.kpiQuestionsRemaining === undefined;
    return validNextURL && validKpiQuestionsRemaining;
  }
  
  function isPendingCelebration(value) {
    return isCelebration(value, app.SITE_ID);
  }
  
  function isScheduledQuestionURL(value) {
    return scheduledQuestionId(value, app.SITE_ID) !== null;
  }
  
  function requestSyncState(token) {
    const parameters = new URLSearchParams({ site: app.SITE_ID });
    return app.requestSyncResponse("GET", `/v11/state?${parameters}`, token, isSyncState);
  }
  
  function requestAttemptResult(token, operation) {
    return app.requestSyncResponse(
      "POST",
      "/v11/attempts",
      token,
      (value) =>
        isAttemptResponse(value) &&
        value.attempt.questionId === operation.questionId &&
        value.attempt.answerResult === operation.answerResult,
      {
        site: operation.site,
        questionId: operation.questionId,
        operationId: operation.operationId,
        answerResult: operation.answerResult,
      }
    );
  }
  
  function requestNextQuestion(token, excludeQuestionId = null) {
    const parameters = new URLSearchParams({ site: app.SITE_ID });
    if (excludeQuestionId !== null) {
      parameters.set("excludeQuestionId", excludeQuestionId);
    }
    return app.requestSyncResponse("GET", `/v11/next?${parameters}`, token, isNextResponse);
  }
  
  function requestCatalogUpdate(token, questionIds, expectedGeneration) {
    return app.requestSyncResponse("POST", "/v11/questions", token, isCatalogResponse, {
      site: app.SITE_ID,
      questionIds,
      expectedGeneration,
    });
  }
  
  function requestSpeechTokenResult(token) {
    return app.requestSyncResponse("POST", "/v11/speech-token", token, isSpeechTokenResponse);
  }
  
  function clearAzureSpeechToken() {
    app.azureSpeechToken = "";
    app.azureSpeechTokenExpiresAt = 0;
  }
  
  function getAzureSpeechToken() {
    if (
      app.azureSpeechToken &&
      Date.now() + app.SPEECH_TOKEN_RENEWAL_SKEW_MS < app.azureSpeechTokenExpiresAt
    ) {
      return Promise.resolve(app.azureSpeechToken);
    }
    if (app.azureSpeechTokenPromise !== null) {
      return app.azureSpeechTokenPromise;
    }
    clearAzureSpeechToken();
    app.azureSpeechTokenPromise = requestSpeechTokenResult(app.syncToken)
      .then((result) => {
        app.azureSpeechToken = result.token;
        app.azureSpeechTokenExpiresAt = Date.now() + result.expiresInSeconds * 1000;
        return app.azureSpeechToken;
      })
      .finally(() => {
        app.azureSpeechTokenPromise = null;
      });
    return app.azureSpeechTokenPromise;
  }
  
  function syncErrorMessage(error) {
    if (error?.code === "unauthorized") {
      return "同期トークンが正しくありません";
    }
    if (error?.code === "request_timeout") {
      return "学習記録の同期がタイムアウトしました";
    }
    if (error?.code === "catalog_timeout") {
      return "問題一覧の同期がタイムアウトしました";
    }
    if (error?.code === "invalid_response") {
      return "同期APIの応答が不正です";
    }
    if (error?.code === "server_misconfigured") {
      return "同期APIが設定されていません";
    }
    if (error?.code === "catalog_missing" || error?.code === "catalog_error") {
      return "問題一覧を同期できません";
    }
    if (error?.code === "unknown_question") {
      return "現在の問題が問題一覧にありません";
    }
    if (error?.code === "operation_conflict") {
      return "解答記録のoperationIdが競合しました";
    }
    return "学習記録を同期できません";
  }
  
  function updateSyncDependentControls() {
    app.shell.setAttribute(
      "aria-busy",
      String(app.syncInProgress || app.nextQuestionOperationInProgress)
    );
    app.synchronizeTimeLimitPhase();
  }
  
  let pendingAttemptStoragePromise = Promise.resolve();
  
  function updatePendingAttempt(operationId, update) {
    const task = pendingAttemptStoragePromise.then(async () => {
      if (
        app.pendingAttempt === null ||
        app.pendingAttempt.operationId !== operationId
      ) {
        throw new Error("pending attempt changed");
      }
      const updated = update(app.pendingAttempt);
      if (!isPendingAttempt(updated)) {
        throw new Error("invalid pending attempt");
      }
      await GM.setValue(app.PENDING_ATTEMPT_KEY, updated);
      app.pendingAttempt = updated;
      return updated;
    });
    pendingAttemptStoragePromise = task.catch(() => {});
    return task;
  }
  
  async function clearPendingAttempt() {
    const task = pendingAttemptStoragePromise.then(async () => {
      await GM.deleteValue(app.PENDING_ATTEMPT_KEY);
      app.pendingAttempt = null;
    });
    pendingAttemptStoragePromise = task.catch(() => {});
    return task;
  }
  
  async function savePendingCelebration(celebration) {
    if (!isPendingCelebration(celebration)) {
      throw new Error("invalid pending celebration");
    }
    await GM.setValue(app.PENDING_CELEBRATION_KEY, celebration);
    app.pendingCelebration = celebration;
  }
  
  async function clearPendingCelebration() {
    await GM.deleteValue(app.PENDING_CELEBRATION_KEY);
    app.pendingCelebration = null;
  }
  
  async function markPendingAttemptRecorded(
    operation,
    nextURL,
    kpiQuestionsRemaining
  ) {
    if (
      app.pendingAttempt === null ||
      app.pendingAttempt.operationId !== operation.operationId ||
      (nextURL !== null && !isScheduledQuestionURL(nextURL)) ||
      (operation.answerResult === "correct" &&
        (!Number.isSafeInteger(kpiQuestionsRemaining) ||
          kpiQuestionsRemaining < 0)) ||
      (operation.answerResult === "incorrect" &&
        kpiQuestionsRemaining !== undefined)
    ) {
      throw new Error("pending attempt changed");
    }
    const updated = await updatePendingAttempt(
      operation.operationId,
      (current) => ({
        ...current,
        phase: "recorded",
        nextURL,
        ...(operation.answerResult === "correct"
          ? { kpiQuestionsRemaining }
          : {}),
      })
    );
    if (updated.answerResult === "correct") {
      app.resolveCorrectFeedbackKpi(
        updated.questionId,
        updated.kpiQuestionsRemaining
      );
    }
  }
  
  function openSyncSettings() {
    if (app.syncInProgress || app.catalogInProgress || app.nextQuestionOperationInProgress) {
      return;
    }
    app.clearShortcutSequence();
    app.syncTokenInput.value = "";
    app.syncSettingsError.textContent = "";
    if (app.errorDialog.open) {
      app.errorDialog.close();
    }
    if (!app.syncSettings.open) {
      app.syncSettings.showModal();
    }
    window.setTimeout(() => app.syncTokenInput.focus(), 0);
  }
  
  function isCatalogFresh(catalog) {
    const ageMs = Date.now() - (catalog?.updatedAtMs ?? 0);
    return catalog !== null && ageMs >= 0 && ageMs < 24 * 60 * 60 * 1000;
  }
  
  function applySyncState(state) {
    app.currentSyncState = state;
    app.syncReady = true;
    app.catalogReady = isCatalogFresh(state.catalog);
  }
  
  function applyCatalogResult(catalog) {
    if (app.currentSyncState !== null) {
      app.currentSyncState = {
        ...app.currentSyncState,
        catalog: {
          questionCount: catalog.questionCount,
          updatedAtMs: catalog.updatedAtMs,
          generation: catalog.generation,
        },
      };
    }
    app.catalogReady = true;
  }
  
  async function refreshQuestionCatalog(token, state = app.currentSyncState) {
    if (state === null || token !== app.syncToken) {
      return false;
    }
    if (isCatalogFresh(state.catalog)) {
      app.catalogReady = true;
      return true;
    }
    if (app.catalogPromise !== null) {
      return app.catalogPromise;
    }
    app.catalogReady = false;
    app.catalogInProgress = true;
    updateSyncDependentControls();
    app.catalogPromise = (async () => {
      let failedError = null;
      try {
        const questionIds = await app.loadCompleteQuestionCatalog();
        const catalog = await requestCatalogUpdate(
          token,
          questionIds,
          state.catalog?.generation ?? 0
        );
        if (token !== app.syncToken) {
          return false;
        }
        applyCatalogResult(catalog);
        return true;
      } catch (error) {
        if (
          error?.code === "catalog_conflict" &&
          isCatalogConflictResponse(error.responseBody) &&
          isCatalogFresh(error.responseBody.catalog) &&
          token === app.syncToken
        ) {
          applyCatalogResult(error.responseBody.catalog);
          return true;
        }
        if (token === app.syncToken) {
          app.catalogReady = false;
          failedError = error;
        }
        return false;
      } finally {
        app.catalogInProgress = false;
        app.catalogPromise = null;
        updateSyncDependentControls();
        if (failedError !== null) {
          app.showReaderError(
            "catalog-refresh",
            "問題一覧を同期できません",
            `${syncErrorMessage(failedError)}. 解答記録は端末に保持されます.`,
            failedError,
            {
              label: "問題一覧を再同期",
              run: () => refreshQuestionCatalog(app.syncToken),
            }
          );
        }
        void app.resumePendingLearningFlow();
      }
    })();
    return app.catalogPromise;
  }
  
  async function refreshRemoteState() {
    if (app.syncPromise !== null) {
      return app.syncPromise;
    }
    if (app.nextQuestionOperationInProgress) {
      return false;
    }
    if (!app.syncToken) {
      app.syncReady = false;
      app.catalogReady = false;
      app.currentSyncState = null;
      openSyncSettings();
      updateSyncDependentControls();
      return false;
    }
    app.syncPromise = (async () => {
      let failedError = null;
      app.syncInProgress = true;
      updateSyncDependentControls();
      try {
        const state = await requestSyncState(app.syncToken);
        applySyncState(state);
        void refreshQuestionCatalog(app.syncToken, state);
        return true;
      } catch (error) {
        app.syncReady = false;
        app.catalogReady = false;
        app.currentSyncState = null;
        failedError = error;
        return false;
      } finally {
        app.syncInProgress = false;
        app.syncPromise = null;
        updateSyncDependentControls();
        if (failedError?.code === "unauthorized") {
          openSyncSettings();
        } else if (failedError !== null) {
          app.showReaderError(
            "sync-refresh",
            "学習記録を同期できません",
            `${syncErrorMessage(failedError)}. 通信状態を確認して再試行してください.`,
            failedError,
            {
              label: "同期を再試行",
              run: refreshRemoteState,
            }
          );
        }
        void app.resumePendingLearningFlow();
        app.processCurrentPageSpeech();
      }
    })();
    return app.syncPromise;
  }
  
  async function saveSyncSettings() {
    const candidateToken = app.syncTokenInput.value.trim();
    if (!candidateToken) {
      app.syncSettingsError.textContent = "同期トークンを入力してください.";
      return;
    }
    if (app.syncPromise !== null || app.catalogPromise !== null || app.nextQuestionOperationInProgress) {
      app.syncSettingsError.textContent = "同期処理の完了を待ってください.";
      return;
    }
    app.syncInProgress = true;
    app.syncSettingsSaveButton.disabled = true;
    app.syncTokenInput.disabled = true;
    app.syncSettingsError.textContent = "同期APIを確認中です.";
    updateSyncDependentControls();
    app.syncPromise = (async () => {
      try {
        const nextQuestionResult = app.shouldLaunchNextQuestionAfterSync
          ? await requestNextQuestion(candidateToken)
          : null;
        const state = nextQuestionResult?.state ??
          await requestSyncState(candidateToken);
        await GM.setValue(app.SYNC_TOKEN_KEY, candidateToken);
        app.syncToken = candidateToken;
        clearAzureSpeechToken();
        applySyncState(state);
        void refreshQuestionCatalog(candidateToken, state);
        app.syncSettings.close();
        app.syncTokenInput.value = "";
        if (nextQuestionResult?.question === null) {
          app.showNoNextQuestionLauncher();
        } else if (nextQuestionResult?.question !== undefined) {
          app.openScheduledQuestionInReader(
            nextQuestionResult.question.url,
            nextQuestionResult.state
          );
        }
        return true;
      } catch (error) {
        app.syncReady = false;
        app.catalogReady = false;
        app.currentSyncState = null;
        app.syncSettingsError.textContent =
          `${syncErrorMessage(error)}. ${app.readerErrorDetail(error, "sync-token")}`;
        return false;
      } finally {
        app.syncInProgress = false;
        app.syncPromise = null;
        app.syncSettingsSaveButton.disabled = false;
        app.syncTokenInput.disabled = false;
        updateSyncDependentControls();
        void app.resumePendingLearningFlow();
        app.processCurrentPageSpeech();
      }
    })();
    return app.syncPromise;
  }
  
  async function restorePendingState(storedAttempt, storedCelebration) {
    if (storedAttempt !== null && !isPendingAttempt(storedAttempt)) {
      await GM.deleteValue(app.PENDING_ATTEMPT_KEY);
      app.pendingAttempt = null;
    } else {
      app.pendingAttempt = storedAttempt;
      if (
        app.pendingAttempt?.phase === "recorded" &&
        app.pendingAttempt.answerResult === "correct"
      ) {
        app.resolveCorrectFeedbackKpi(
          app.pendingAttempt.questionId,
          app.pendingAttempt.kpiQuestionsRemaining
        );
      }
    }
    if (storedCelebration !== null && !isPendingCelebration(storedCelebration)) {
      await GM.deleteValue(app.PENDING_CELEBRATION_KEY);
      app.pendingCelebration = null;
    } else {
      app.pendingCelebration = storedCelebration;
    }
  }
  
  async function initializeSync() {
    updateSyncDependentControls();
    try {
      const [storedToken, storedPendingAttempt, storedCelebration, storedHandoff] =
        await Promise.all([
          GM.getValue(app.SYNC_TOKEN_KEY, ""),
          GM.getValue(app.PENDING_ATTEMPT_KEY, null),
          GM.getValue(app.PENDING_CELEBRATION_KEY, null),
          GM.getValue(app.LAUNCH_HANDOFF_KEY, null),
        ]);
      if (storedHandoff !== null) {
        await GM.deleteValue(app.LAUNCH_HANDOFF_KEY);
      }
      if (typeof storedToken !== "string") {
        await GM.deleteValue(app.SYNC_TOKEN_KEY);
        app.syncToken = "";
      } else {
        app.syncToken = storedToken.trim();
      }
      clearAzureSpeechToken();
      await restorePendingState(storedPendingAttempt, storedCelebration);
      if (!app.syncToken) {
        app.syncReady = false;
        app.catalogReady = false;
        app.currentSyncState = null;
        openSyncSettings();
        updateSyncDependentControls();
        return;
      }
      const initialState =
        app.launcherSyncState !== null && isSyncState(app.launcherSyncState)
          ? app.launcherSyncState
          : isLaunchHandoff(storedHandoff)
            ? storedHandoff.state
            : null;
      app.launcherSyncState = null;
      if (initialState !== null) {
        applySyncState(initialState);
        updateSyncDependentControls();
        void refreshQuestionCatalog(app.syncToken, initialState);
        void app.resumePendingLearningFlow();
        app.processCurrentPageSpeech();
        return;
      }
      await refreshRemoteState();
    } catch (error) {
      app.syncReady = false;
      app.catalogReady = false;
      app.currentSyncState = null;
      app.showReaderError(
        "sync-storage",
        "同期設定を読み込めません",
        "Userscript storageを確認できませんでした. ページを再読み込みしてください.",
        error
      );
      updateSyncDependentControls();
    }
  }
  
  function handlePageResume() {
    app.synchronizeTimeLimitPhase();
    if (
      document.visibilityState === "visible" &&
      app.syncToken &&
      app.syncReady &&
      app.pendingAttempt === null &&
      app.pendingCelebration === null &&
      !app.nextQuestionOperationInProgress &&
      !app.syncSettings.open &&
      app.getCurrentAnswerResult() !== "unknown"
    ) {
      app.recordCurrentAnswerIfAvailable();
    }
  }
  
  function stopSpeech() {
    if (app.speechInitializationInProgress) {
      app.speechInitializationInProgress = false;
      app.speechEnabled = false;
      app.finishSpeechInitialization();
    }
    app.speechRunId += 1;
    app.cancelActiveSpeech();
  
  }

  Object.defineProperties(app, {
    isSyncState: { enumerable: false, get: () => isSyncState },
    isAttemptResponse: { enumerable: false, get: () => isAttemptResponse },
    isNextQuestion: { enumerable: false, get: () => isNextQuestion },
    isNextResponse: { enumerable: false, get: () => isNextResponse },
    isCatalogResponse: { enumerable: false, get: () => isCatalogResponse },
    isCatalogConflictResponse: { enumerable: false, get: () => isCatalogConflictResponse },
    isLaunchHandoff: { enumerable: false, get: () => isLaunchHandoff },
    isSpeechTokenResponse: { enumerable: false, get: () => isSpeechTokenResponse },
    isSitePageURL: { enumerable: false, get: () => isSitePageURL },
    extractQuestionIdFromURL: { enumerable: false, get: () => extractQuestionIdFromURL },
    isAttemptCopyState: { enumerable: false, get: () => isAttemptCopyState },
    isPendingAttempt: { enumerable: false, get: () => isPendingAttempt },
    isPendingCelebration: { enumerable: false, get: () => isPendingCelebration },
    isScheduledQuestionURL: { enumerable: false, get: () => isScheduledQuestionURL },
    requestSyncState: { enumerable: false, get: () => requestSyncState },
    requestAttemptResult: { enumerable: false, get: () => requestAttemptResult },
    requestNextQuestion: { enumerable: false, get: () => requestNextQuestion },
    requestCatalogUpdate: { enumerable: false, get: () => requestCatalogUpdate },
    requestSpeechTokenResult: { enumerable: false, get: () => requestSpeechTokenResult },
    clearAzureSpeechToken: { enumerable: false, get: () => clearAzureSpeechToken },
    getAzureSpeechToken: { enumerable: false, get: () => getAzureSpeechToken },
    syncErrorMessage: { enumerable: false, get: () => syncErrorMessage },
    updateSyncDependentControls: { enumerable: false, get: () => updateSyncDependentControls },
    pendingAttemptStoragePromise: { enumerable: false, get: () => pendingAttemptStoragePromise, set: (value) => { pendingAttemptStoragePromise = value; } },
    updatePendingAttempt: { enumerable: false, get: () => updatePendingAttempt },
    clearPendingAttempt: { enumerable: false, get: () => clearPendingAttempt },
    savePendingCelebration: { enumerable: false, get: () => savePendingCelebration },
    clearPendingCelebration: { enumerable: false, get: () => clearPendingCelebration },
    markPendingAttemptRecorded: { enumerable: false, get: () => markPendingAttemptRecorded },
    openSyncSettings: { enumerable: false, get: () => openSyncSettings },
    isCatalogFresh: { enumerable: false, get: () => isCatalogFresh },
    applySyncState: { enumerable: false, get: () => applySyncState },
    applyCatalogResult: { enumerable: false, get: () => applyCatalogResult },
    refreshQuestionCatalog: { enumerable: false, get: () => refreshQuestionCatalog },
    refreshRemoteState: { enumerable: false, get: () => refreshRemoteState },
    saveSyncSettings: { enumerable: false, get: () => saveSyncSettings },
    restorePendingState: { enumerable: false, get: () => restorePendingState },
    initializeSync: { enumerable: false, get: () => initializeSync },
    handlePageResume: { enumerable: false, get: () => handlePageResume },
    stopSpeech: { enumerable: false, get: () => stopSpeech },
  });
}
