import { isQuestionId } from "../../contracts/kakomonn.mjs";

export function installNavigationController(app) {
  function currentQuestionId() {
    const questionId = app.extractQuestionIdFromURL(app.currentFrameURL);
    if (questionId !== null) {
      return questionId;
    }
    if (app.currentFrameURL !== `https://${app.SITE_ID}/questions`) {
      return null;
    }
    const randomQuestionId = app.frameDocument?.querySelector(
      'input[type="hidden"][name="StudyRandumId"]',
    )?.value;
    return isQuestionId(randomQuestionId) ? randomQuestionId : null;
  }
  
  function canSkipCurrentQuestion() {
    const unansweredQuestionReady =
      app.frameDocument?.body !== undefined &&
      app.currentQuestionControls() !== null &&
      currentQuestionId() !== null &&
      getCurrentAnswerResult() === "unknown";
    return (
      unansweredQuestionReady &&
      app.syncReady &&
      app.catalogReady &&
      !app.syncInProgress &&
      !app.nextQuestionOperationInProgress &&
      !app.navigationInProgress &&
      app.pendingAttempt === null &&
      app.pendingCelebration === null &&
      !app.syncSettings.open
    );
  }
  
  function getCurrentAnswerResult() {
    return app.answerResultFromDocument(app.frameDocument);
  }
  
  function synchronizeAnswerPresentation(
    sourceDocument = app.frameDocument
  ) {
    if (
      sourceDocument?.documentElement === undefined ||
      app.frameDocument !== sourceDocument
    ) {
      return;
    }
  
    if (app.answerResultFromDocument(sourceDocument) === "unknown") {
      sourceDocument.documentElement.dataset.kakomonnReaderPhase = "question";
      return;
    }
  
    delete sourceDocument.documentElement.dataset.kakomonnReaderPhase;
  }
  
  function createOperationId() {
    if (typeof globalThis.crypto?.getRandomValues !== "function") {
      throw new Error("secure random values are unavailable");
    }
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  
  const READER_HISTORY_OWNER = "kakomonn-reader";
  const READER_HISTORY_VERSION = 1;
  const READER_HISTORY_SESSION_KEY = "kakomonn-reader.history.v1";
  const READER_HISTORY_TIMEOUT_MS = 5000;
  let readerHistorySession = null;
  let historyPreparation = null;
  let activatingFutureHistoryState = null;
  let preparedDestinationOperationId = null;
  let incorrectAdvanceRequested = false;
  let noNextQuestionOperationId = null;
  
  function isReaderHistoryState(value) {
    return (
      value !== null &&
      typeof value === "object" &&
      value.owner === READER_HISTORY_OWNER &&
      value.version === READER_HISTORY_VERSION &&
      /^[0-9a-f]{32}$/.test(value.sessionId) &&
      Number.isSafeInteger(value.index) &&
      value.index > 0 &&
      ["current", "future-question", "future-celebration"].includes(
        value.entryType
      ) &&
      (value.entryType === "current"
        ? value.operationId === null
        : /^[0-9a-f]{32}$/.test(value.operationId))
    );
  }
  
  function isReaderHistorySession(value) {
    return (
      value !== null &&
      typeof value === "object" &&
      value.version === READER_HISTORY_VERSION &&
      /^[0-9a-f]{32}$/.test(value.sessionId) &&
      Number.isSafeInteger(value.currentIndex) &&
      value.currentIndex > 0 &&
      ["active", "celebration", "exiting", "returning"].includes(value.mode)
    );
  }
  
  function saveReaderHistorySession() {
    sessionStorage.setItem(
      READER_HISTORY_SESSION_KEY,
      JSON.stringify(readerHistorySession)
    );
  }
  
  function loadReaderHistorySession() {
    try {
      const value = JSON.parse(
        sessionStorage.getItem(READER_HISTORY_SESSION_KEY) ?? "null"
      );
      return isReaderHistorySession(value) ? value : null;
    } catch {
      return null;
    }
  }
  
  function readerHistoryState(index, entryType, operationId = null) {
    return {
      owner: READER_HISTORY_OWNER,
      version: READER_HISTORY_VERSION,
      sessionId: readerHistorySession.sessionId,
      index,
      entryType,
      operationId,
    };
  }
  
  function ensureCurrentReaderHistory() {
    const storedSession = loadReaderHistorySession();
    const state = history.state;
    if (
      storedSession !== null &&
      isReaderHistoryState(state) &&
      state.sessionId === storedSession.sessionId
    ) {
      readerHistorySession = storedSession;
      return state;
    }
  
    readerHistorySession = {
      version: READER_HISTORY_VERSION,
      sessionId: createOperationId(),
      currentIndex: 1,
      mode: "active",
    };
    const currentState = readerHistoryState(1, "current");
    history.replaceState(currentState, "", app.currentFrameURL);
    saveReaderHistorySession();
    return currentState;
  }
  
  function synchronizeCurrentHistoryURL() {
    const state = ensureCurrentReaderHistory();
    if (
      readerHistorySession.mode === "returning" &&
      state.entryType === "current" &&
      state.index < readerHistorySession.currentIndex
    ) {
      history.forward();
      return false;
    }
    if (
      readerHistorySession.mode === "celebration" &&
      state.entryType === "current" &&
      state.index < readerHistorySession.currentIndex
    ) {
      readerHistorySession.mode = "exiting";
      saveReaderHistorySession();
      history.back();
      return false;
    }
    const index =
      activatingFutureHistoryState?.index ??
      (state.entryType === "current"
        ? state.index
        : readerHistorySession.currentIndex);
    history.replaceState(
      readerHistoryState(index, "current"),
      "",
      app.currentFrameURL
    );
    readerHistorySession.currentIndex = index;
    readerHistorySession.mode = "active";
    saveReaderHistorySession();
    return true;
  }
  
  function resolveHistoryPreparation(state) {
    if (
      historyPreparation === null ||
      !isReaderHistoryState(state) ||
      state.sessionId !== readerHistorySession?.sessionId ||
      state.index !== readerHistorySession.currentIndex ||
      state.entryType !== "current"
    ) {
      return false;
    }
    const preparation = historyPreparation;
    historyPreparation = null;
    window.clearTimeout(preparation.timeout);
    preparation.resolve(true);
    return true;
  }
  
  function prepareFutureHistoryEntry(entryType, operation) {
    if (preparedDestinationOperationId === operation.operationId) {
      return Promise.resolve(true);
    }
    if (historyPreparation !== null) {
      return historyPreparation.promise;
    }
  
    const currentState = ensureCurrentReaderHistory();
    if (currentState.entryType !== "current") {
      return Promise.resolve(false);
    }
    const futureIndex = readerHistorySession.currentIndex + 1;
    const futureURL =
      entryType === "future-question" ? operation.nextURL : app.currentFrameURL;
    try {
      history.pushState(
        readerHistoryState(futureIndex, entryType, operation.operationId),
        "",
        futureURL
      );
    } catch (error) {
      app.showReaderError(
        "history-prepare",
        "Browser forwardを準備できません",
        "Readerのhistoryへ次の遷移先を保存できませんでした.",
        error
      );
      return Promise.resolve(false);
    }
  
    let resolvePreparation;
    const promise = new Promise((resolve) => {
      resolvePreparation = resolve;
    });
    const timeout = window.setTimeout(() => {
      if (historyPreparation?.promise !== promise) {
        return;
      }
      historyPreparation = null;
      app.showReaderError(
        "history-prepare",
        "Browser forwardを準備できません",
        "ページを再読み込みしてから同期を再試行してください.",
        { code: "history_prepare_timeout" }
      );
      resolvePreparation(false);
    }, READER_HISTORY_TIMEOUT_MS);
    historyPreparation = { promise, resolve: resolvePreparation, timeout };
    history.back();
    return promise.then((prepared) => {
      if (prepared) {
        preparedDestinationOperationId = operation.operationId;
      }
      return prepared;
    });
  }
  
  function navigateToScheduledQuestion(nextURL) {
    if (!app.isScheduledQuestionURL(nextURL)) {
      app.navigationInProgress = false;
      clearIncorrectAdvanceRequest();
      app.showReaderError(
        "next-question-url",
        "次の問題を開けません",
        "同期APIから受け取った次の問題URLが不正です. 再同期してください."
      );
      app.updateSyncDependentControls();
      return false;
    }
    app.navigationInProgress = true;
    if (app.correctFeedbackPromise === null) {
      app.stopSpeech();
    }
    app.updateSyncDependentControls();
    try {
      app.frame.contentWindow.location.replace(nextURL);
      return true;
    } catch (error) {
      app.navigationInProgress = false;
      clearIncorrectAdvanceRequest();
      app.showReaderError(
        "next-question-navigation",
        "次の問題へ移動できません",
        "ページを再読み込みしてから再試行してください.",
        error
      );
      app.updateSyncDependentControls();
      return false;
    }
  }
  
  async function completePendingAttemptNavigation() {
    if (
      app.pendingAttempt === null ||
      app.pendingAttempt.phase !== "recorded" ||
      app.pendingAttempt.nextURL === null ||
      !app.syncReady ||
      app.syncInProgress ||
      app.nextQuestionOperationInProgress
    ) {
      return false;
    }
    if (app.currentFrameURL !== app.pendingAttempt.nextURL) {
      return false;
    }
    if (app.pendingAttemptTransitionPromise !== null) {
      return app.pendingAttemptTransitionPromise;
    }
    const operation = app.pendingAttempt;
    app.pendingAttemptTransitionPromise = (async () => {
      synchronizeCurrentHistoryURL();
      activatingFutureHistoryState = null;
      preparedDestinationOperationId = null;
      clearIncorrectAdvanceRequest();
      await app.clearPendingAttempt();
      return true;
    })();
    try {
      return await app.pendingAttemptTransitionPromise;
    } catch (error) {
      app.showReaderError(
        "pending-navigation",
        "次の問題への遷移を完了できません",
        "解答記録は保持されています. ページを再読み込みしてください.",
        error
      );
      return false;
    } finally {
      app.pendingAttemptTransitionPromise = null;
      app.updateSyncDependentControls();
    }
  }
  
  async function resumePendingLearningFlow() {
    await completePendingAttemptNavigation();
    if (
      app.pendingAttempt?.phase === "queued" &&
      app.syncReady &&
      app.catalogReady &&
      !app.syncInProgress &&
      !app.nextQuestionOperationInProgress
    ) {
      await submitPendingAttempt();
    }
    await app.processPendingAutomaticCopy();
    await maybePreparePendingDestination();
    recordCurrentAnswerIfAvailable();
  }
  
  function congratulationsURL(celebration) {
    const url = new URL(app.CONGRATULATIONS_URL);
    url.searchParams.set("site", celebration.site);
    url.searchParams.set("date", celebration.date);
    url.searchParams.set("dailyKpiCompleted", "true");
    return url.href;
  }
  
  async function transitionToPendingCelebration(historyIndex, failureDetail) {
    const celebration = app.pendingCelebration;
    const operation = app.pendingAttempt;
    app.navigationInProgress = true;
    readerHistorySession.currentIndex = historyIndex;
    readerHistorySession.mode = "active";
    saveReaderHistorySession();
    app.updateSyncDependentControls();
    try {
      while (app.correctFeedbackPromise !== null) {
        await app.correctFeedbackPromise;
      }
      app.stopSpeech();
      await app.clearPendingAttempt();
      await app.clearPendingCelebration();
      clearIncorrectAdvanceRequest();
      readerHistorySession.mode = "celebration";
      saveReaderHistorySession();
      location.replace(congratulationsURL(celebration));
      return true;
    } catch (error) {
      if (operation !== null) {
        await GM.setValue(app.PENDING_ATTEMPT_KEY, operation);
        app.pendingAttempt = operation;
      }
      await app.savePendingCelebration(celebration);
      readerHistorySession.mode = "active";
      saveReaderHistorySession();
      app.navigationInProgress = false;
      clearIncorrectAdvanceRequest();
      app.showReaderError(
        "celebration-navigation",
        "祝福pageを開けません",
        failureDetail,
        error
      );
      app.updateSyncDependentControls();
      return false;
    }
  }
  
  async function activateFutureCelebration(state) {
    if (
      app.pendingAttempt === null ||
      app.pendingAttempt.operationId !== state.operationId ||
      app.pendingAttempt.phase !== "recorded" ||
      app.pendingCelebration === null
    ) {
      app.navigationInProgress = false;
      clearIncorrectAdvanceRequest();
      app.showReaderError(
        "celebration-history",
        "祝福pageを開けません",
        "Browser historyと保存済みの達成情報が一致しません.",
        { code: "history_state_mismatch" }
      );
      history.back();
      return false;
    }
    return transitionToPendingCelebration(
      state.index,
      "達成情報は保持されています. Browser forwardを再試行してください."
    );
  }
  
  async function activateFutureQuestion(state) {
    if (
      app.pendingAttempt === null ||
      app.pendingAttempt.operationId !== state.operationId ||
      app.pendingAttempt.phase !== "recorded" ||
      app.pendingAttempt.copy.state !== "completed" ||
      app.pendingAttempt.nextURL !== location.href
    ) {
      app.navigationInProgress = false;
      clearIncorrectAdvanceRequest();
      app.showReaderError(
        "question-history",
        "次の問題を開けません",
        "Browser historyと保存済みの次問情報が一致しません.",
        { code: "history_state_mismatch" }
      );
      history.back();
      return false;
    }
    activatingFutureHistoryState = state;
    return navigateToScheduledQuestion(app.pendingAttempt.nextURL);
  }
  
  function handleReaderPopState(event) {
    const state = event.state;
    if (resolveHistoryPreparation(state)) {
      return;
    }
    if (
      !isReaderHistoryState(state) ||
      readerHistorySession === null ||
      state.sessionId !== readerHistorySession.sessionId
    ) {
      return;
    }
    if (state.entryType === "future-question") {
      void activateFutureQuestion(state);
      return;
    }
    if (state.entryType === "future-celebration") {
      void activateFutureCelebration(state);
      return;
    }
    if (state.index < readerHistorySession.currentIndex) {
      if (readerHistorySession.mode === "returning") {
        history.forward();
        return;
      }
      readerHistorySession.mode = "exiting";
      saveReaderHistorySession();
      history.back();
      return;
    }
    if (
      readerHistorySession.mode === "returning" &&
      state.index === readerHistorySession.currentIndex &&
      app.currentFrameURL !== location.href &&
      app.isScheduledQuestionURL(location.href)
    ) {
      readerHistorySession.mode = "active";
      saveReaderHistorySession();
      navigateToScheduledQuestion(location.href);
      return;
    }
    readerHistorySession.mode = "active";
    saveReaderHistorySession();
  }
  
  function handleReaderPageShow() {
    const state = history.state;
    if (
      readerHistorySession !== null &&
      readerHistorySession.mode === "returning" &&
      isReaderHistoryState(state) &&
      state.sessionId === readerHistorySession.sessionId &&
      state.index < readerHistorySession.currentIndex
    ) {
      history.forward();
    }
  }
  
  function handleReaderPageHide() {
    if (readerHistorySession?.mode === "exiting") {
      readerHistorySession.mode = "returning";
      saveReaderHistorySession();
    }
  }
  
  function clearIncorrectAdvanceRequest() {
    incorrectAdvanceRequested = false;
  }
  
  function activateRequestedIncorrectDestination() {
    if (
      !incorrectAdvanceRequested ||
      app.navigationInProgress ||
      app.pendingAttempt === null ||
      app.pendingAttempt.answerResult !== "incorrect" ||
      app.pendingAttempt.phase !== "recorded" ||
      !["completed", "not-required"].includes(app.pendingAttempt.copy.state) ||
      !app.syncReady ||
      app.syncInProgress ||
      app.nextQuestionOperationInProgress
    ) {
      return false;
    }

    if (app.isIPhoneSafari) {
      if (app.pendingCelebration !== null) {
        const currentState = ensureCurrentReaderHistory();
        void transitionToPendingCelebration(
          currentState.index,
          "達成情報は保持されています. ページを再読み込みしてください."
        );
        return true;
      }
      if (app.pendingAttempt.nextURL === null) {
        return false;
      }
      return navigateToScheduledQuestion(app.pendingAttempt.nextURL);
    }

    if (preparedDestinationOperationId !== app.pendingAttempt.operationId) {
      return false;
    }
    app.navigationInProgress = true;
    app.updateSyncDependentControls();
    history.forward();
    return true;
  }
  
  function requestIncorrectAnswerAdvance() {
    if (getCurrentAnswerResult() !== "incorrect") {
      return false;
    }
  
    incorrectAdvanceRequested = true;
    if (!activateRequestedIncorrectDestination()) {
      void maybePreparePendingDestination();
    }
    return true;
  }
  
  async function preparePendingFutureEntry(entryType, operation) {
    const prepared = await prepareFutureHistoryEntry(entryType, operation);
    if (!prepared) {
      clearIncorrectAdvanceRequest();
      return false;
    }
    activateRequestedIncorrectDestination();
    return true;
  }
  
  async function maybePreparePendingDestination() {
    if (
      !app.syncReady ||
      app.syncInProgress ||
      app.navigationInProgress ||
      app.nextQuestionOperationInProgress
    ) {
      return false;
    }
    if (app.pendingAttempt === null) {
      if (app.pendingCelebration === null) {
        return false;
      }
      const currentState = ensureCurrentReaderHistory();
      return transitionToPendingCelebration(
        currentState.index,
        "達成情報は保持されています. ページを再読み込みしてください."
      );
    }
    if (
      app.pendingAttempt.phase !== "recorded" ||
      !["completed", "not-required"].includes(app.pendingAttempt.copy.state)
    ) {
      return false;
    }
    if (app.isIPhoneSafari && app.pendingAttempt.answerResult === "incorrect") {
      if (
        app.pendingCelebration !== null ||
        app.pendingAttempt.nextURL !== null
      ) {
        return activateRequestedIncorrectDestination();
      }
      clearIncorrectAdvanceRequest();
      if (noNextQuestionOperationId !== app.pendingAttempt.operationId) {
        noNextQuestionOperationId = app.pendingAttempt.operationId;
        app.showReaderError(
          "next-question-empty",
          "出題できる問題はありません",
          "時間を置いてから次の学習sessionを開始してください.",
          { code: "next_question_empty" }
        );
      }
      return false;
    }
    if (app.pendingCelebration !== null) {
      if (
        app.pendingAttempt.answerResult === "correct" ||
        app.pendingAttempt.copy.state === "not-required"
      ) {
        const currentState = ensureCurrentReaderHistory();
        return transitionToPendingCelebration(
          currentState.index,
          "達成情報は保持されています. ページを再読み込みしてください."
        );
      }
      return preparePendingFutureEntry("future-celebration", app.pendingAttempt);
    }
    if (
      app.pendingAttempt.answerResult === "correct" &&
      app.pendingAttempt.nextURL !== null
    ) {
      return navigateToScheduledQuestion(app.pendingAttempt.nextURL);
    }
    if (
      app.pendingAttempt.copy.state === "not-required" &&
      app.pendingAttempt.nextURL !== null
    ) {
      return navigateToScheduledQuestion(app.pendingAttempt.nextURL);
    }
    if (app.pendingAttempt.nextURL !== null) {
      return preparePendingFutureEntry("future-question", app.pendingAttempt);
    }
    clearIncorrectAdvanceRequest();
    if (noNextQuestionOperationId !== app.pendingAttempt.operationId) {
      noNextQuestionOperationId = app.pendingAttempt.operationId;
      app.showReaderError(
        "next-question-empty",
        "出題できる問題はありません",
        "時間を置いてから次の学習sessionを開始してください.",
        { code: "next_question_empty" }
      );
    }
    return false;
  }
  
  async function createPendingAttempt(
    answerResult,
    copyRequired,
    operationId = createOperationId()
  ) {
    const questionId = currentQuestionId();
    if (questionId === null) {
      throw new app.SyncRequestError("question_id_missing");
    }
    const operation = {
      operationId,
      questionId,
      phase: "queued",
      pageURL: `https://${app.SITE_ID}/questions/${questionId}`,
      answerResult,
      copy: { state: copyRequired ? "required" : "not-required" },
      site: app.SITE_ID,
    };
    if (!app.isPendingAttempt(operation)) {
      throw new Error("invalid pending attempt");
    }
    await GM.setValue(app.PENDING_ATTEMPT_KEY, operation);
    app.pendingAttempt = operation;
    return operation;
  }
  
  async function submitPendingAttempt() {
    if (app.pendingAttempt === null || app.syncPromise !== null) {
      return false;
    }
    if (app.pendingAttempt.phase === "recorded") {
      await maybePreparePendingDestination();
      return true;
    }
    if (!app.syncReady) {
      void app.refreshRemoteState();
      return false;
    }
    if (!app.catalogReady) {
      void app.refreshQuestionCatalog(app.syncToken);
      return false;
    }
  
    app.nextQuestionOperationInProgress = true;
    const operation = app.pendingAttempt;
    app.syncInProgress = true;
    app.updateSyncDependentControls();
  
    app.syncPromise = (async () => {
      let failedError = null;
      try {
        const result = await app.requestAttemptResult(app.syncToken, operation);
        if (
          result.attempt.questionId !== operation.questionId ||
          result.attempt.answerResult !== operation.answerResult
        ) {
          throw new app.SyncRequestError("invalid_response");
        }
        if (result.celebration !== undefined) {
          await app.savePendingCelebration(result.celebration);
        }
  
        const nextQuestion = result.nextQuestion;
        const kpiQuestionsRemaining =
          operation.answerResult === "correct"
            ? app.calculateKpiQuestionsRemaining(result.learningMetrics)
            : undefined;
        app.syncReady = true;
        await app.markPendingAttemptRecorded(
          operation,
          nextQuestion?.url ?? null,
          kpiQuestionsRemaining
        );
        return true;
      } catch (error) {
        if (error?.code === "unauthorized") {
          app.syncReady = false;
        }
        failedError = error;
        return false;
      } finally {
        app.nextQuestionOperationInProgress = false;
        app.syncInProgress = false;
        app.syncPromise = null;
        app.updateSyncDependentControls();
        if (failedError?.code === "unauthorized") {
          app.openSyncSettings();
        } else if (failedError !== null) {
          app.showReaderError(
            "attempt-sync",
            "解答記録を同期できません",
            `${app.syncErrorMessage(failedError)}. 解答記録は保持されています. 再試行してください.`,
            failedError,
            { label: "同期を再試行", run: submitPendingAttempt }
          );
        }
        void maybePreparePendingDestination();
      }
    })();
    return app.syncPromise;
  }
  
  async function recordCurrentAnswer(answerResult, copyRequired = true) {
    const questionId = currentQuestionId();
    if (questionId === null) {
      app.showReaderError(
        "question-id",
        "解答記録を準備できません",
        "現在の問題IDを取得できませんでした. ページを再読み込みしてください."
      );
      app.updateSyncDependentControls();
      return false;
    }
    app.nextQuestionOperationInProgress = true;
    app.updateSyncDependentControls();
    try {
      const operationId =
        copyRequired &&
        app.answerCopyOperation?.questionId === questionId
          ? app.answerCopyOperation.operationId
          : createOperationId();
      await createPendingAttempt(answerResult, copyRequired, operationId);
    } catch (error) {
      app.nextQuestionOperationInProgress = false;
      if (app.answerCopyOperation?.questionId === questionId) {
        app.discardAnswerCopyOperation();
      }
      app.showReaderError(
        "attempt-storage",
        "解答記録を準備できません",
        "Userscript storageへ未送信の解答を保存できませんでした.",
        error
      );
      app.updateSyncDependentControls();
      return false;
    }
    app.nextQuestionOperationInProgress = false;
    if (copyRequired) {
      void app.processPendingAutomaticCopy();
    }
    return submitPendingAttempt();
  }
  
  function recordCurrentAnswerIfAvailable() {
    if (
      !app.syncReady ||
      app.syncInProgress ||
      app.nextQuestionOperationInProgress ||
      app.navigationInProgress ||
      app.pendingAttempt !== null ||
      app.pendingCelebration !== null ||
      app.syncSettings.open
    ) {
      return false;
    }
    const answerResult = getCurrentAnswerResult();
    if (answerResult === "unknown" || currentQuestionId() === null) {
      return false;
    }
    void recordCurrentAnswer(answerResult);
    return true;
  }
  
  async function recordCurrentQuestionAndAdvance(answerResult) {
    const recorded = await recordCurrentAnswer(answerResult, false);
    if (!recorded || app.pendingAttempt?.phase !== "recorded") {
      return false;
    }
    if (app.isIPhoneSafari && answerResult === "incorrect") {
      incorrectAdvanceRequested = true;
    }
    return maybePreparePendingDestination();
  }
  
  async function handleSkipQuestion() {
    if (
      app.navigationInProgress ||
      app.nextQuestionOperationInProgress
    ) {
      return false;
    }
    if (app.syncInProgress) {
      const activeSync = app.syncPromise;
      if (activeSync === null) {
        return false;
      }
      await activeSync;
      if (app.syncInProgress || app.navigationInProgress || app.nextQuestionOperationInProgress) {
        return false;
      }
    }
    if (!app.syncReady) {
      await app.refreshRemoteState();
      return false;
    }
    if (!app.catalogReady) {
      await app.refreshQuestionCatalog(app.syncToken);
      return false;
    }
    if (app.pendingAttempt !== null) {
      if (app.pendingAttempt.phase === "queued") {
        await submitPendingAttempt();
      } else {
        await maybePreparePendingDestination();
      }
      return false;
    }
    if (app.pendingCelebration !== null) {
      return false;
    }
    if (getCurrentAnswerResult() !== "unknown") {
      return false;
    }
    return recordCurrentQuestionAndAdvance("incorrect");
  }
  
  function readPendingCurrentPage() {
    if (
      !app.speechEnabled ||
      !app.currentPageReadPending ||
      !app.syncReady ||
      app.syncInProgress ||
      app.correctFeedbackPromise !== null ||
      app.pendingCelebration !== null
    ) {
      return;
    }
  
    app.currentPageReadPending = false;
    app.readCurrentPage();
  }
  
  function startSpeechForCurrentPage() {
    if (
      app.speechEnabled ||
      app.speechInitializationInProgress ||
      !app.speechSupported ||
      !app.currentPageReadPending ||
      !app.syncReady ||
      app.syncInProgress ||
      app.correctFeedbackPromise !== null ||
      app.pendingCelebration !== null
    ) {
      return false;
    }
  
    app.speechInitializationInProgress = true;
    app.speechInitializationPromise = new Promise((resolve) => {
      app.speechInitializationResolve = resolve;
    });
    app.speechRunId += 1;
    const runId = app.speechRunId;
    app.cancelActiveSpeech();
    app.initializeSpeechPlayback(
      runId,
      () => {
        if (runId !== app.speechRunId) {
          return;
        }
        app.speechInitializationInProgress = false;
        app.speechEnabled = true;
        app.finishSpeechInitialization();
        readPendingCurrentPage();
      },
      () => {
        if (runId === app.speechRunId) {
          app.speechInitializationInProgress = false;
          app.speechEnabled = false;
          app.finishSpeechInitialization();
        }
      }
    );
    return true;
  }
  
  function processCurrentPageSpeech() {
    if (
      !app.currentPageReadPending ||
      !app.syncReady ||
      app.syncInProgress ||
      app.correctFeedbackPromise !== null ||
      app.pendingCelebration !== null
    ) {
      return;
    }
  
    if (
      getCurrentAnswerResult() === "unknown" &&
      app.extractQuestionText() === ""
    ) {
      return;
    }
  
    if (!app.speechSupported) {
      app.currentPageReadPending = false;
      app.showReaderError(
        "speech-runtime",
        "読み上げを利用できません",
        "このbrowserでは音声再生APIを利用できません.",
        { code: "speech_unsupported" }
      );
      return;
    }
    if (app.speechInitializationInProgress) {
      return;
    }
    if (app.speechEnabled) {
      readPendingCurrentPage();
      return;
    }
    startSpeechForCurrentPage();
  }
  
  function activateSpeechFromGesture() {
    // 自動再生が拒否された場合は,ユーザー操作内で同じ読み上げ経路を再試行します.
    if (!app.speechEnabled && app.currentPageReadPending) {
      startSpeechForCurrentPage();
    }
  }

  Object.defineProperties(app, {
    currentQuestionId: { enumerable: false, get: () => currentQuestionId },
    canSkipCurrentQuestion: { enumerable: false, get: () => canSkipCurrentQuestion },
    getCurrentAnswerResult: { enumerable: false, get: () => getCurrentAnswerResult },
    synchronizeAnswerPresentation: { enumerable: false, get: () => synchronizeAnswerPresentation },
    createOperationId: { enumerable: false, get: () => createOperationId },
    READER_HISTORY_OWNER: { enumerable: false, get: () => READER_HISTORY_OWNER },
    READER_HISTORY_VERSION: { enumerable: false, get: () => READER_HISTORY_VERSION },
    READER_HISTORY_SESSION_KEY: { enumerable: false, get: () => READER_HISTORY_SESSION_KEY },
    READER_HISTORY_TIMEOUT_MS: { enumerable: false, get: () => READER_HISTORY_TIMEOUT_MS },
    readerHistorySession: { enumerable: false, get: () => readerHistorySession, set: (value) => { readerHistorySession = value; } },
    historyPreparation: { enumerable: false, get: () => historyPreparation, set: (value) => { historyPreparation = value; } },
    activatingFutureHistoryState: { enumerable: false, get: () => activatingFutureHistoryState, set: (value) => { activatingFutureHistoryState = value; } },
    preparedDestinationOperationId: { enumerable: false, get: () => preparedDestinationOperationId, set: (value) => { preparedDestinationOperationId = value; } },
    incorrectAdvanceRequested: { enumerable: false, get: () => incorrectAdvanceRequested, set: (value) => { incorrectAdvanceRequested = value; } },
    noNextQuestionOperationId: { enumerable: false, get: () => noNextQuestionOperationId, set: (value) => { noNextQuestionOperationId = value; } },
    isReaderHistoryState: { enumerable: false, get: () => isReaderHistoryState },
    isReaderHistorySession: { enumerable: false, get: () => isReaderHistorySession },
    saveReaderHistorySession: { enumerable: false, get: () => saveReaderHistorySession },
    loadReaderHistorySession: { enumerable: false, get: () => loadReaderHistorySession },
    readerHistoryState: { enumerable: false, get: () => readerHistoryState },
    ensureCurrentReaderHistory: { enumerable: false, get: () => ensureCurrentReaderHistory },
    synchronizeCurrentHistoryURL: { enumerable: false, get: () => synchronizeCurrentHistoryURL },
    resolveHistoryPreparation: { enumerable: false, get: () => resolveHistoryPreparation },
    prepareFutureHistoryEntry: { enumerable: false, get: () => prepareFutureHistoryEntry },
    navigateToScheduledQuestion: { enumerable: false, get: () => navigateToScheduledQuestion },
    completePendingAttemptNavigation: { enumerable: false, get: () => completePendingAttemptNavigation },
    resumePendingLearningFlow: { enumerable: false, get: () => resumePendingLearningFlow },
    congratulationsURL: { enumerable: false, get: () => congratulationsURL },
    transitionToPendingCelebration: { enumerable: false, get: () => transitionToPendingCelebration },
    activateFutureCelebration: { enumerable: false, get: () => activateFutureCelebration },
    activateFutureQuestion: { enumerable: false, get: () => activateFutureQuestion },
    handleReaderPopState: { enumerable: false, get: () => handleReaderPopState },
    handleReaderPageShow: { enumerable: false, get: () => handleReaderPageShow },
    handleReaderPageHide: { enumerable: false, get: () => handleReaderPageHide },
    clearIncorrectAdvanceRequest: { enumerable: false, get: () => clearIncorrectAdvanceRequest },
    activateRequestedIncorrectDestination: { enumerable: false, get: () => activateRequestedIncorrectDestination },
    requestIncorrectAnswerAdvance: { enumerable: false, get: () => requestIncorrectAnswerAdvance },
    preparePendingFutureEntry: { enumerable: false, get: () => preparePendingFutureEntry },
    maybePreparePendingDestination: { enumerable: false, get: () => maybePreparePendingDestination },
    createPendingAttempt: { enumerable: false, get: () => createPendingAttempt },
    submitPendingAttempt: { enumerable: false, get: () => submitPendingAttempt },
    recordCurrentAnswer: { enumerable: false, get: () => recordCurrentAnswer },
    recordCurrentAnswerIfAvailable: { enumerable: false, get: () => recordCurrentAnswerIfAvailable },
    recordCurrentQuestionAndAdvance: { enumerable: false, get: () => recordCurrentQuestionAndAdvance },
    handleSkipQuestion: { enumerable: false, get: () => handleSkipQuestion },
    readPendingCurrentPage: { enumerable: false, get: () => readPendingCurrentPage },
    startSpeechForCurrentPage: { enumerable: false, get: () => startSpeechForCurrentPage },
    processCurrentPageSpeech: { enumerable: false, get: () => processCurrentPageSpeech },
    activateSpeechFromGesture: { enumerable: false, get: () => activateSpeechFromGesture },
  });
}
