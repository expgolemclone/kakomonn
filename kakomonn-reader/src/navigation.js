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

  function updateSkipButton() {
    const unansweredQuestionReady =
      frameDocument?.body !== undefined &&
      currentQuestionControls() !== null &&
      currentQuestionId() !== null &&
      getCurrentAnswerResult() === "unknown";
    skipButton.hidden = !unansweredQuestionReady;
    skipButton.disabled =
      !syncReady ||
      syncInProgress ||
      nextQuestionOperationInProgress ||
      navigationInProgress ||
      pendingAnswer !== null ||
      pendingCelebration !== null ||
      !syncSettings.hidden;
  }

  function updateNextQuestionButton() {
    updateSkipButton();
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
    if (pendingAnswer !== null) {
      nextQuestionButton.textContent =
        pendingAnswer.phase === "queued" ? "同期を再試行" : "次の問題を準備中";
      nextQuestionButton.disabled = navigationInProgress;
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
    stopSpeech();
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

  async function maybeContinuePendingAnswerNavigation() {
    if (
      pendingAnswer === null ||
      pendingAnswer.phase !== "awaiting_navigation" ||
      !syncReady ||
      syncInProgress ||
      nextQuestionOperationInProgress
    ) {
      return false;
    }
    if (pendingAnswerTransitionPromise !== null) {
      return pendingAnswerTransitionPromise;
    }
    const operation = pendingAnswer;
    pendingAnswerTransitionPromise = (async () => {
      if (currentFrameURL === operation.nextURL) {
        await clearPendingAnswer();
        setStatus(
          pendingCelebration === null
            ? "解答記録を同期しました"
            : `${pendingCelebration.milestone}問定着.祝福を準備中`
        );
        return true;
      }
      if (frameDocument === null || navigationInProgress) {
        return false;
      }
      return navigateToScheduledQuestion(operation.nextURL);
    })();
    try {
      return await pendingAnswerTransitionPromise;
    } catch {
      setStatus("次の問題への遷移を完了できません.再試行してください");
      return false;
    } finally {
      pendingAnswerTransitionPromise = null;
      updateSyncDependentControls();
      void maybeContinuePendingCelebration();
    }
  }

  async function savePendingCelebration(operation, milestone) {
    const celebration = {
      milestone,
      site: SITE_ID,
      sourcePageURL: operation.pageURL,
    };
    if (!isPendingCelebration(celebration)) {
      throw new Error("invalid pending celebration");
    }
    await GM.setValue(PENDING_CELEBRATION_KEY, celebration);
    pendingCelebration = celebration;
  }

  function congratulationsURL(milestone) {
    const url = new URL(CONGRATULATIONS_URL);
    url.searchParams.set("milestone", String(milestone));
    return url.href;
  }

  async function maybeContinuePendingCelebration() {
    if (
      pendingCelebration === null ||
      !syncReady ||
      pendingAnswer !== null ||
      syncInProgress ||
      nextQuestionOperationInProgress ||
      celebrationTransitionPromise !== null
    ) {
      return false;
    }
    const milestone = pendingCelebration.milestone;
    celebrationTransitionPromise = (async () => {
      navigationInProgress = true;
      stopSpeech();
      setStatus(`${milestone}問定着`);
      updateSyncDependentControls();
      try {
        await clearPendingCelebration();
        location.assign(congratulationsURL(milestone));
        return true;
      } catch {
        navigationInProgress = false;
        setStatus("祝福ページを開けません.再試行してください");
        return false;
      } finally {
        celebrationTransitionPromise = null;
        updateSyncDependentControls();
      }
    })();
    return celebrationTransitionPromise;
  }

  async function createPendingAnswer(result) {
    const questionId = currentQuestionId();
    if (questionId === null) {
      throw new SyncRequestError("question_id_missing");
    }
    const operation = {
      operationId: createOperationId(),
      questionId,
      phase: "queued",
      pageURL: `https://${SITE_ID}/questions/${questionId}`,
      result,
      site: SITE_ID,
    };
    if (!isPendingAnswer(operation)) {
      throw new Error("invalid pending answer");
    }
    await GM.setValue(PENDING_ANSWER_KEY, operation);
    pendingAnswer = operation;
  }

  async function submitPendingAnswer() {
    if (pendingAnswer === null || syncPromise !== null) {
      return false;
    }
    if (pendingAnswer.phase === "awaiting_navigation") {
      return maybeContinuePendingAnswerNavigation();
    }

    nextQuestionOperationInProgress = true;
    const operation = pendingAnswer;
    navigationInProgress = true;
    syncInProgress = true;
    setStatus("学習記録を同期中");
    updateSyncDependentControls();

    syncPromise = (async () => {
      try {
        const result = await requestAttemptResult(syncToken, operation);
        if (
          result.attempt.questionId !== operation.questionId ||
          result.attempt.result !== operation.result
        ) {
          throw new SyncRequestError("invalid_response");
        }
        masteredCount = result.totals.mastered;
        renderCount();
        if (result.completedMilestone !== null) {
          await savePendingCelebration(operation, result.completedMilestone);
        }

        const next = await requestNextQuestion(syncToken, operation.questionId);
        syncReady = true;
        navigationInProgress = false;
        if (result.attempt.masteryDelta === 1) {
          setStatus("定着 +1");
        } else if (result.attempt.masteryDelta === -1) {
          setStatus("定着 -1");
        } else {
          setStatus("解答記録を同期しました");
        }

        if (next.question === null) {
          await clearPendingAnswer();
          setStatus(
            result.attempt.masteryDelta === 1
              ? "定着 +1.出題できる問題はありません"
              : result.attempt.masteryDelta === -1
                ? "定着 -1.出題できる問題はありません"
                : "出題できる問題はありません"
          );
          return true;
        }
        await markPendingAnswerAwaitingNavigation(operation, next.question.url);
        return true;
      } catch (error) {
        navigationInProgress = false;
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
        void maybeContinuePendingAnswerNavigation();
        void maybeContinuePendingCelebration();
      }
    })();
    return syncPromise;
  }

  async function recordCurrentQuestionAndAdvance(result, status) {
    const questionId = currentQuestionId();
    if (questionId === null) {
      setStatus("問題IDを取得できないため解答記録と次問移動を停止しました");
      updateSyncDependentControls();
      return false;
    }
    nextQuestionOperationInProgress = true;
    navigationInProgress = true;
    stopSpeech();
    setStatus(status);
    updateSyncDependentControls();
    try {
      await createPendingAnswer(result);
    } catch {
      nextQuestionOperationInProgress = false;
      navigationInProgress = false;
      setStatus("解答記録を準備できません");
      updateSyncDependentControls();
      return false;
    }
    nextQuestionOperationInProgress = false;
    navigationInProgress = false;
    await submitPendingAnswer();
    return true;
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
    if (pendingAnswer !== null) {
      await submitPendingAnswer();
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
    if (pendingAnswer !== null) {
      await submitPendingAnswer();
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
    await recordCurrentQuestionAndAdvance(answerResult, "解答記録を保存中");
  }

  function readPendingCurrentPage() {
    if (
      !speechEnabled ||
      !currentPageReadPending ||
      !syncReady ||
      syncInProgress ||
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
      pendingCelebration !== null
    ) {
      return false;
    }

    speechInitializationInProgress = true;
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
        readPendingCurrentPage();
      },
      () => {
        if (runId === speechRunId) {
          speechInitializationInProgress = false;
          speechEnabled = false;
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
    if (isIOS) {
      setStatus(SPEECH_GESTURE_STATUS);
      return;
    }

    startSpeechForCurrentPage();
  }

  function activateSpeechFromGesture() {
    // 自動再生が拒否された場合は,ユーザー操作内で同じ読み上げ経路を再試行します.
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

