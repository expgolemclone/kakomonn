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

  function answeredQuestionCanSync() {
    return getCurrentAnswerResult() !== "unknown" && currentQuestionId() !== null;
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
      syncSettings.hidden
    );
  }

  function updateNextQuestionButton() {
    if (syncInProgress) {
      nextQuestionButton.textContent = "学習記録を同期中";
      nextQuestionButton.disabled = true;
      return;
    }
    if (nextQuestionOperationInProgress) {
      nextQuestionButton.textContent = "解答記録を処理中";
      nextQuestionButton.disabled = true;
      return;
    }
    if (!syncReady) {
      nextQuestionButton.textContent = "同期を再試行";
      nextQuestionButton.disabled = !syncToken;
      return;
    }
    if (pendingAttempt !== null) {
      if (pendingAttempt.phase === "queued") {
        nextQuestionButton.textContent = "同期を再試行";
        nextQuestionButton.disabled = navigationInProgress;
        return;
      }
      if (pendingAttempt.nextURL !== null) {
        nextQuestionButton.textContent = "次の問題へ";
        nextQuestionButton.disabled = navigationInProgress;
        return;
      }
      nextQuestionButton.textContent =
        pendingCelebration === null ? "出題できる問題はありません" : "祝福を表示";
      nextQuestionButton.disabled = pendingCelebration === null;
      return;
    }
    if (pendingCelebration !== null) {
      nextQuestionButton.textContent = "祝福を表示";
      nextQuestionButton.disabled = celebrationTransitionPromise !== null;
      return;
    }
    if (navigationInProgress) {
      nextQuestionButton.textContent = "移動中…";
      nextQuestionButton.disabled = true;
      return;
    }
    if (currentQuestionId() === null) {
      nextQuestionButton.textContent = "問題IDを取得できません";
      nextQuestionButton.disabled = true;
      return;
    }
    nextQuestionButton.textContent = "次の問題へ";
    nextQuestionButton.disabled = !answeredQuestionCanSync();
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

  function navigateToScheduledQuestion(nextURL) {
    if (!isScheduledQuestionURL(nextURL)) {
      navigationInProgress = false;
      setStatus("次の問題URLが不正です");
      updateSyncDependentControls();
      return false;
    }
    navigationInProgress = true;
    handoffCorrectFeedbackVisual();
    if (correctFeedbackPromise === null) {
      stopSpeech();
    }
    setStatus("次の問題を反映中");
    updateSyncDependentControls();
    try {
      frame.src = nextURL;
      return true;
    } catch {
      navigationInProgress = false;
      setStatus("次の問題へ移動できません");
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
    if (pendingAttemptTransitionPromise !== null) {
      return pendingAttemptTransitionPromise;
    }
    const operation = pendingAttempt;
    pendingAttemptTransitionPromise = (async () => {
      if (currentFrameURL === operation.nextURL) {
        await clearPendingAttempt();
        setStatus(
          pendingCelebration === null
            ? "解答記録を同期しました"
            : "dueCardsCompleted達成.祝福を準備中"
        );
        return true;
      }
      return false;
    })();
    try {
      return await pendingAttemptTransitionPromise;
    } catch {
      setStatus("次の問題への遷移を完了できません.再試行してください");
      return false;
    } finally {
      pendingAttemptTransitionPromise = null;
      updateSyncDependentControls();
      void maybeContinuePendingCelebration();
    }
  }

  async function advancePendingAttempt() {
    if (
      pendingAttempt === null ||
      pendingAttempt.phase !== "recorded" ||
      navigationInProgress ||
      nextQuestionOperationInProgress
    ) {
      return false;
    }
    if (pendingAttempt.nextURL !== null) {
      return navigateToScheduledQuestion(pendingAttempt.nextURL);
    }
    if (pendingCelebration !== null) {
      await clearPendingAttempt();
      updateSyncDependentControls();
      return maybeContinuePendingCelebration();
    }
    setStatus("出題できる問題はありません");
    updateSyncDependentControls();
    return false;
  }

  async function continueCorrectPendingAttempt() {
    if (pendingAttempt?.answerResult !== "correct") {
      return false;
    }
    if (pendingAttempt.phase === "queued") {
      const recorded = await submitPendingAttempt();
      if (!recorded) {
        return false;
      }
    }
    if (pendingAttempt?.phase !== "recorded") {
      return false;
    }
    return advancePendingAttempt();
  }

  async function resumePendingLearningFlow() {
    await completePendingAttemptNavigation();
    await continueCorrectPendingAttempt();
    await maybeContinuePendingCelebration();
    recordCurrentAnswerIfAvailable();
  }

  function congratulationsURL(celebration) {
    const url = new URL(CONGRATULATIONS_URL);
    url.searchParams.set("site", celebration.site);
    url.searchParams.set("date", celebration.date);
    url.searchParams.set("dueCardsCompleted", "true");
    return url.href;
  }

  async function maybeContinuePendingCelebration() {
    if (
      pendingCelebration === null ||
      !syncReady ||
      pendingAttempt !== null ||
      syncInProgress ||
      nextQuestionOperationInProgress ||
      celebrationTransitionPromise !== null
    ) {
      return false;
    }
    const celebration = pendingCelebration;
    celebrationTransitionPromise = (async () => {
      navigationInProgress = true;
      updateSyncDependentControls();
      try {
        while (correctFeedbackPromise !== null) {
          await correctFeedbackPromise;
        }
        stopSpeech();
        setStatus("dueCardsCompleted達成");
        await clearPendingCelebration();
        location.assign(congratulationsURL(celebration));
        return true;
      } catch {
        await savePendingCelebration(celebration);
        navigationInProgress = false;
        setStatus("祝福pageを開けません.再試行してください");
        return false;
      } finally {
        celebrationTransitionPromise = null;
        updateSyncDependentControls();
      }
    })();
    return celebrationTransitionPromise;
  }

  async function createPendingAttempt(answerResult) {
    const questionId = currentQuestionId();
    if (questionId === null) {
      throw new SyncRequestError("question_id_missing");
    }
    const operation = {
      operationId: createOperationId(),
      questionId,
      phase: "queued",
      pageURL: `https://${SITE_ID}/questions/${questionId}`,
      answerResult,
      site: SITE_ID,
    };
    if (!isPendingAttempt(operation)) {
      throw new Error("invalid pending attempt");
    }
    await GM.setValue(PENDING_ATTEMPT_KEY, operation);
    pendingAttempt = operation;
  }

  async function submitPendingAttempt() {
    if (pendingAttempt === null || syncPromise !== null) {
      return false;
    }
    if (pendingAttempt.phase === "recorded") {
      return true;
    }

    nextQuestionOperationInProgress = true;
    const operation = pendingAttempt;
    syncInProgress = true;
    setStatus("学習記録を同期中");
    updateSyncDependentControls();

    syncPromise = (async () => {
      try {
        const result = await requestAttemptResult(syncToken, operation);
        if (
          result.attempt.questionId !== operation.questionId ||
          result.attempt.answerResult !== operation.answerResult
        ) {
          throw new SyncRequestError("invalid_response");
        }
        learningMetrics = result.learningMetrics;
        renderLearningMetrics();
        if (result.celebration !== undefined) {
          await savePendingCelebration(result.celebration);
        }

        const nextQuestion = result.nextQuestion;
        syncReady = true;
        setStatus("解答記録を同期しました");
        await markPendingAttemptRecorded(operation, nextQuestion?.url ?? null);
        return true;
      } catch (error) {
        if (error?.code === "unauthorized") {
          syncReady = false;
        }
        if (error?.code === "question_id_missing") {
          setStatus("問題IDを取得できないため解答を記録できません");
        } else {
          setStatus(`${syncErrorMessage(error)}.再試行してください`);
        }
        return false;
      } finally {
        nextQuestionOperationInProgress = false;
        syncInProgress = false;
        syncPromise = null;
        updateSyncDependentControls();
      }
    })();
    return syncPromise;
  }

  async function recordCurrentAnswer(answerResult, status = "解答記録を保存中") {
    const questionId = currentQuestionId();
    if (questionId === null) {
      setStatus("問題IDを取得できないため解答を記録できません");
      updateSyncDependentControls();
      return false;
    }
    nextQuestionOperationInProgress = true;
    setStatus(status);
    updateSyncDependentControls();
    try {
      await createPendingAttempt(answerResult);
    } catch {
      nextQuestionOperationInProgress = false;
      setStatus("解答記録を準備できません");
      updateSyncDependentControls();
      return false;
    }
    nextQuestionOperationInProgress = false;
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
      !syncSettings.hidden
    ) {
      return false;
    }
    const answerResult = getCurrentAnswerResult();
    if (answerResult === "unknown" || currentQuestionId() === null) {
      return false;
    }
    if (answerResult === "correct") {
      void recordCurrentQuestionAndAdvance(answerResult, "正解を記録中");
    } else {
      void recordCurrentAnswer(answerResult);
    }
    return true;
  }

  async function recordCurrentQuestionAndAdvance(answerResult, status) {
    const recorded = await recordCurrentAnswer(answerResult, status);
    if (!recorded || pendingAttempt?.phase !== "recorded") {
      return false;
    }
    return advancePendingAttempt();
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
        await advancePendingAttempt();
      }
      return false;
    }
    if (pendingCelebration !== null) {
      await maybeContinuePendingCelebration();
      return false;
    }
    if (getCurrentAnswerResult() !== "unknown") {
      return false;
    }
    return recordCurrentQuestionAndAdvance("incorrect", "誤答としてスキップ中");
  }

  async function handleNextQuestion() {
    if (navigationInProgress || nextQuestionOperationInProgress) {
      return;
    }
    if (syncInProgress) {
      const activeSync = syncPromise;
      if (activeSync === null) {
        return;
      }
      await activeSync;
      if (syncInProgress || navigationInProgress || nextQuestionOperationInProgress) {
        return;
      }
    }
    if (!syncReady) {
      await refreshRemoteState();
      return;
    }
    if (pendingAttempt !== null) {
      if (pendingAttempt.phase === "queued") {
        if (pendingAttempt.answerResult === "correct") {
          await continueCorrectPendingAttempt();
        } else {
          await submitPendingAttempt();
        }
      } else {
        await advancePendingAttempt();
      }
      return;
    }
    if (pendingCelebration !== null) {
      await maybeContinuePendingCelebration();
      return;
    }
    const answerResult = getCurrentAnswerResult();
    if (answerResult === "unknown") {
      setStatus("正誤を確認できません");
      updateNextQuestionButton();
      return;
    }
    const recorded = await recordCurrentAnswer(answerResult);
    if (recorded && pendingAttempt?.phase === "recorded") {
      await advancePendingAttempt();
    }
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
          setStatus(SPEECH_GESTURE_STATUS);
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
      setStatus("読み上げ非対応");
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

  function onNextQuestionPointerUp(event) {
    if (event.pointerType !== "touch" || !event.isPrimary) {
      return;
    }

    event.preventDefault();
    void handleNextQuestion();
  }
