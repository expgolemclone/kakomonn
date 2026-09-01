  function currentQuestionId() {
    const questionId = extractQuestionIdFromURL(currentFrameURL);
    if (questionId !== null) {
      return questionId;
    }
    if (currentFrameURL !== `https://${SITE_ID}/questions`) {
      return null;
    }
    const randomQuestionId = frameDocument?.querySelector(
      'input[type="hidden"][name="StudyRandumId"]',
    )?.value;
    return /^\d+$/.test(randomQuestionId ?? "") ? randomQuestionId : null;
  }

  function canSkipCurrentQuestion() {
    const unansweredQuestionReady =
      frameDocument?.body !== undefined &&
      currentQuestionControls() !== null &&
      currentQuestionId() !== null &&
      getCurrentAnswerResult() === "unknown";
    return (
      unansweredQuestionReady &&
      syncReady &&
      !syncInProgress &&
      !nextQuestionOperationInProgress &&
      !navigationInProgress &&
      pendingAttempt === null &&
      pendingCelebration === null &&
      !syncSettings.open
    );
  }

  function answerResultFromDocument(documentNode) {
    const resultBox = documentNode?.querySelector("#js-answer-result-box");
    if (resultBox === null || resultBox === undefined) {
      return "unknown";
    }
    const correctResult = resultBox.classList.contains("is-correct");
    const incorrectResult = resultBox.classList.contains("is-wrong");
    if (correctResult === incorrectResult) {
      return "unknown";
    }
    return correctResult ? "correct" : "incorrect";
  }

  function getCurrentAnswerResult() {
    return answerResultFromDocument(frameDocument);
  }

  function synchronizeAnswerPresentation(
    sourceDocument = frameDocument
  ) {
    if (
      sourceDocument?.documentElement === undefined ||
      frameDocument !== sourceDocument
    ) {
      return;
    }

    if (answerResultFromDocument(sourceDocument) === "unknown") {
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
    history.replaceState(currentState, "", currentFrameURL);
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
      currentFrameURL
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
      entryType === "future-question" ? operation.nextURL : currentFrameURL;
    try {
      history.pushState(
        readerHistoryState(futureIndex, entryType, operation.operationId),
        "",
        futureURL
      );
    } catch (error) {
      showReaderError(
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
      showReaderError(
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
    if (!isScheduledQuestionURL(nextURL)) {
      navigationInProgress = false;
      clearIncorrectAdvanceRequest();
      showReaderError(
        "next-question-url",
        "次の問題を開けません",
        "同期APIから受け取った次の問題URLが不正です. 再同期してください."
      );
      updateSyncDependentControls();
      return false;
    }
    navigationInProgress = true;
    if (correctFeedbackPromise === null) {
      stopSpeech();
    }
    updateSyncDependentControls();
    try {
      frame.contentWindow.location.replace(nextURL);
      return true;
    } catch (error) {
      navigationInProgress = false;
      clearIncorrectAdvanceRequest();
      showReaderError(
        "next-question-navigation",
        "次の問題へ移動できません",
        "ページを再読み込みしてから再試行してください.",
        error
      );
      updateSyncDependentControls();
      return false;
    }
  }

  async function completePendingAttemptNavigation() {
    if (
      pendingAttempt === null ||
      pendingAttempt.phase !== "recorded" ||
      pendingAttempt.nextURL === null ||
      !syncReady ||
      syncInProgress ||
      nextQuestionOperationInProgress
    ) {
      return false;
    }
    if (currentFrameURL !== pendingAttempt.nextURL) {
      return false;
    }
    if (pendingAttemptTransitionPromise !== null) {
      return pendingAttemptTransitionPromise;
    }
    const operation = pendingAttempt;
    pendingAttemptTransitionPromise = (async () => {
      synchronizeCurrentHistoryURL();
      activatingFutureHistoryState = null;
      preparedDestinationOperationId = null;
      clearIncorrectAdvanceRequest();
      await clearPendingAttempt();
      return true;
    })();
    try {
      return await pendingAttemptTransitionPromise;
    } catch (error) {
      showReaderError(
        "pending-navigation",
        "次の問題への遷移を完了できません",
        "解答記録は保持されています. ページを再読み込みしてください.",
        error
      );
      return false;
    } finally {
      pendingAttemptTransitionPromise = null;
      updateSyncDependentControls();
    }
  }

  async function resumePendingLearningFlow() {
    await completePendingAttemptNavigation();
    if (pendingAttempt?.phase === "queued") {
      showReaderError(
        "attempt-sync",
        "解答記録を同期できません",
        "解答記録は保持されています. 通信状態を確認して再試行してください.",
        { code: "attempt_pending" },
        { label: "同期を再試行", run: submitPendingAttempt }
      );
    }
    await processPendingAutomaticCopy();
    await maybePreparePendingDestination();
    recordCurrentAnswerIfAvailable();
  }

  function congratulationsURL(celebration) {
    const url = new URL(CONGRATULATIONS_URL);
    url.searchParams.set("site", celebration.site);
    url.searchParams.set("date", celebration.date);
    url.searchParams.set("dailyKpiCompleted", "true");
    return url.href;
  }

  async function transitionToPendingCelebration(historyIndex, failureDetail) {
    const celebration = pendingCelebration;
    const operation = pendingAttempt;
    navigationInProgress = true;
    readerHistorySession.currentIndex = historyIndex;
    readerHistorySession.mode = "active";
    saveReaderHistorySession();
    updateSyncDependentControls();
    try {
      while (correctFeedbackPromise !== null) {
        await correctFeedbackPromise;
      }
      stopSpeech();
      await clearPendingAttempt();
      await clearPendingCelebration();
      clearIncorrectAdvanceRequest();
      readerHistorySession.mode = "celebration";
      saveReaderHistorySession();
      location.replace(congratulationsURL(celebration));
      return true;
    } catch (error) {
      await GM.setValue(PENDING_ATTEMPT_KEY, operation);
      pendingAttempt = operation;
      await savePendingCelebration(celebration);
      readerHistorySession.mode = "active";
      saveReaderHistorySession();
      navigationInProgress = false;
      clearIncorrectAdvanceRequest();
      showReaderError(
        "celebration-navigation",
        "祝福pageを開けません",
        failureDetail,
        error
      );
      updateSyncDependentControls();
      return false;
    }
  }

  async function activateFutureCelebration(state) {
    if (
      pendingAttempt === null ||
      pendingAttempt.operationId !== state.operationId ||
      pendingAttempt.phase !== "recorded" ||
      pendingCelebration === null
    ) {
      navigationInProgress = false;
      clearIncorrectAdvanceRequest();
      showReaderError(
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
      pendingAttempt === null ||
      pendingAttempt.operationId !== state.operationId ||
      pendingAttempt.phase !== "recorded" ||
      pendingAttempt.copy.state !== "completed" ||
      pendingAttempt.nextURL !== location.href
    ) {
      navigationInProgress = false;
      clearIncorrectAdvanceRequest();
      showReaderError(
        "question-history",
        "次の問題を開けません",
        "Browser historyと保存済みの次問情報が一致しません.",
        { code: "history_state_mismatch" }
      );
      history.back();
      return false;
    }
    activatingFutureHistoryState = state;
    return navigateToScheduledQuestion(pendingAttempt.nextURL);
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
      currentFrameURL !== location.href &&
      isScheduledQuestionURL(location.href)
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
      navigationInProgress ||
      pendingAttempt === null ||
      pendingAttempt.answerResult !== "incorrect" ||
      pendingAttempt.phase !== "recorded" ||
      preparedDestinationOperationId !== pendingAttempt.operationId
    ) {
      return false;
    }

    navigationInProgress = true;
    updateSyncDependentControls();
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
      pendingAttempt === null ||
      pendingAttempt.phase !== "recorded" ||
      !syncReady ||
      syncInProgress ||
      navigationInProgress ||
      nextQuestionOperationInProgress ||
      !["completed", "not-required"].includes(pendingAttempt.copy.state)
    ) {
      return false;
    }
    if (
      pendingAttempt.answerResult === "correct" &&
      pendingAttempt.nextURL !== null
    ) {
      return navigateToScheduledQuestion(pendingAttempt.nextURL);
    }
    if (
      pendingAttempt.copy.state === "not-required" &&
      pendingAttempt.nextURL !== null
    ) {
      return navigateToScheduledQuestion(pendingAttempt.nextURL);
    }
    if (pendingAttempt.nextURL !== null) {
      return preparePendingFutureEntry("future-question", pendingAttempt);
    }
    if (pendingCelebration !== null) {
      if (pendingAttempt.answerResult === "correct") {
        const currentState = ensureCurrentReaderHistory();
        return transitionToPendingCelebration(
          currentState.index,
          "達成情報は保持されています. ページを再読み込みしてください."
        );
      }
      return preparePendingFutureEntry("future-celebration", pendingAttempt);
    }
    clearIncorrectAdvanceRequest();
    if (noNextQuestionOperationId !== pendingAttempt.operationId) {
      noNextQuestionOperationId = pendingAttempt.operationId;
      showReaderError(
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
      throw new SyncRequestError("question_id_missing");
    }
    const operation = {
      operationId,
      questionId,
      phase: "queued",
      pageURL: `https://${SITE_ID}/questions/${questionId}`,
      answerResult,
      copy: { state: copyRequired ? "required" : "not-required" },
      site: SITE_ID,
    };
    if (!isPendingAttempt(operation)) {
      throw new Error("invalid pending attempt");
    }
    await GM.setValue(PENDING_ATTEMPT_KEY, operation);
    pendingAttempt = operation;
    return operation;
  }

  async function submitPendingAttempt() {
    if (pendingAttempt === null || syncPromise !== null) {
      return false;
    }
    if (pendingAttempt.phase === "recorded") {
      await maybePreparePendingDestination();
      return true;
    }

    nextQuestionOperationInProgress = true;
    const operation = pendingAttempt;
    syncInProgress = true;
    updateSyncDependentControls();

    syncPromise = (async () => {
      let failedError = null;
      try {
        const result = await requestAttemptResult(syncToken, operation);
        if (
          result.attempt.questionId !== operation.questionId ||
          result.attempt.answerResult !== operation.answerResult
        ) {
          throw new SyncRequestError("invalid_response");
        }
        if (result.celebration !== undefined) {
          await savePendingCelebration(result.celebration);
        }

        const nextQuestion = result.nextQuestion;
        syncReady = true;
        await markPendingAttemptRecorded(operation, nextQuestion?.url ?? null);
        return true;
      } catch (error) {
        if (error?.code === "unauthorized") {
          syncReady = false;
        }
        failedError = error;
        return false;
      } finally {
        nextQuestionOperationInProgress = false;
        syncInProgress = false;
        syncPromise = null;
        updateSyncDependentControls();
        if (failedError?.code === "unauthorized") {
          openSyncSettings();
        } else if (failedError !== null) {
          showReaderError(
            "attempt-sync",
            "解答記録を同期できません",
            `${syncErrorMessage(failedError)}. 解答記録は保持されています. 再試行してください.`,
            failedError,
            { label: "同期を再試行", run: submitPendingAttempt }
          );
        }
        void maybePreparePendingDestination();
      }
    })();
    return syncPromise;
  }

  async function recordCurrentAnswer(answerResult, copyRequired = true) {
    const questionId = currentQuestionId();
    if (questionId === null) {
      showReaderError(
        "question-id",
        "解答記録を準備できません",
        "現在の問題IDを取得できませんでした. ページを再読み込みしてください."
      );
      updateSyncDependentControls();
      return false;
    }
    nextQuestionOperationInProgress = true;
    updateSyncDependentControls();
    try {
      const operationId =
        copyRequired &&
        answerCopyOperation?.questionId === questionId
          ? answerCopyOperation.operationId
          : createOperationId();
      await createPendingAttempt(answerResult, copyRequired, operationId);
    } catch (error) {
      nextQuestionOperationInProgress = false;
      if (answerCopyOperation?.questionId === questionId) {
        discardAnswerCopyOperation();
      }
      showReaderError(
        "attempt-storage",
        "解答記録を準備できません",
        "Userscript storageへ未送信の解答を保存できませんでした.",
        error
      );
      updateSyncDependentControls();
      return false;
    }
    nextQuestionOperationInProgress = false;
    if (copyRequired) {
      void processPendingAutomaticCopy();
    }
    return submitPendingAttempt();
  }

  function recordCurrentAnswerIfAvailable() {
    if (
      !syncReady ||
      syncInProgress ||
      nextQuestionOperationInProgress ||
      navigationInProgress ||
      pendingAttempt !== null ||
      pendingCelebration !== null ||
      syncSettings.open
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
    if (!recorded || pendingAttempt?.phase !== "recorded") {
      return false;
    }
    return maybePreparePendingDestination();
  }

  async function handleSkipQuestion() {
    if (
      navigationInProgress ||
      nextQuestionOperationInProgress
    ) {
      return false;
    }
    if (syncInProgress) {
      const activeSync = syncPromise;
      if (activeSync === null) {
        return false;
      }
      await activeSync;
      if (syncInProgress || navigationInProgress || nextQuestionOperationInProgress) {
        return false;
      }
    }
    if (!syncReady) {
      await refreshRemoteState();
      return false;
    }
    if (pendingAttempt !== null) {
      if (pendingAttempt.phase === "queued") {
        await submitPendingAttempt();
      } else {
        await maybePreparePendingDestination();
      }
      return false;
    }
    if (pendingCelebration !== null) {
      return false;
    }
    if (getCurrentAnswerResult() !== "unknown") {
      return false;
    }
    return recordCurrentQuestionAndAdvance("incorrect");
  }

  function readPendingCurrentPage() {
    if (
      !speechEnabled ||
      !currentPageReadPending ||
      !syncReady ||
      syncInProgress ||
      correctFeedbackPromise !== null ||
      pendingCelebration !== null
    ) {
      return;
    }

    currentPageReadPending = false;
    readCurrentPage();
  }

  function startSpeechForCurrentPage() {
    if (
      speechEnabled ||
      speechInitializationInProgress ||
      !speechSupported ||
      !currentPageReadPending ||
      !syncReady ||
      syncInProgress ||
      correctFeedbackPromise !== null ||
      pendingCelebration !== null
    ) {
      return false;
    }

    speechInitializationInProgress = true;
    speechInitializationPromise = new Promise((resolve) => {
      speechInitializationResolve = resolve;
    });
    speechRunId += 1;
    const runId = speechRunId;
    cancelActiveSpeech();
    initializeSpeechPlayback(
      runId,
      () => {
        if (runId !== speechRunId) {
          return;
        }
        speechInitializationInProgress = false;
        speechEnabled = true;
        finishSpeechInitialization();
        readPendingCurrentPage();
      },
      () => {
        if (runId === speechRunId) {
          speechInitializationInProgress = false;
          speechEnabled = false;
          finishSpeechInitialization();
        }
      }
    );
    return true;
  }

  function processCurrentPageSpeech() {
    if (
      !currentPageReadPending ||
      !syncReady ||
      syncInProgress ||
      correctFeedbackPromise !== null ||
      pendingCelebration !== null
    ) {
      return;
    }

    if (!speechSupported) {
      currentPageReadPending = false;
      showReaderError(
        "speech-runtime",
        "読み上げを利用できません",
        "このbrowserでは音声再生APIを利用できません.",
        { code: "speech_unsupported" }
      );
      return;
    }
    if (speechInitializationInProgress) {
      return;
    }
    if (speechEnabled) {
      readPendingCurrentPage();
      return;
    }
    startSpeechForCurrentPage();
  }

  function activateSpeechFromGesture() {
    // 自動再生が拒否された場合は,ユーザー操作内で同じ読み上げ経路を再試行します.
    if (
      !speechEnabled &&
      !speechInitializationInProgress &&
      !currentPageReadPending &&
      loadTimer !== null
    ) {
      window.clearTimeout(loadTimer);
      loadTimer = null;
      currentPageReadPending = true;
    }
    if (!speechEnabled && currentPageReadPending) {
      startSpeechForCurrentPage();
    }
  }
