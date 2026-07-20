  function answeredQuestionHasNextURL() {
    return (
      getCurrentAnswerResult() !== "unknown" && findNextQuestionURL() !== null
    );
  }

  function updateNextQuestionButton() {
    if (syncInProgress) {
      nextQuestionButton.textContent = "学習記録を同期中";
      nextQuestionButton.disabled =
        !syncReady ||
        navigationInProgress ||
        nextQuestionOperationInProgress ||
        !syncSettings.hidden ||
        !answeredQuestionHasNextURL();
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
      nextQuestionButton.textContent = "同期を再試行";
      nextQuestionButton.disabled = findNextQuestionURL() === null;
      return;
    }

    if (pendingCelebration !== null) {
      const sourcePageActive =
        currentFrameURL === pendingCelebration.sourcePageURL;
      nextQuestionButton.textContent = sourcePageActive
        ? "次の問題を準備中"
        : "祝福を表示";
      nextQuestionButton.disabled =
        celebrationTransitionPromise !== null ||
        navigationInProgress ||
        (sourcePageActive && findNextQuestionURL() === null);
      return;
    }

    if (navigationInProgress) {
      nextQuestionButton.textContent = "移動中…";
      nextQuestionButton.disabled = true;
      return;
    }

    nextQuestionButton.textContent = "次の問題へ";
    nextQuestionButton.disabled = !answeredQuestionHasNextURL();
  }

  function getCurrentAnswerResult() {
    const resultBox = frameDocument?.querySelector("#js-answer-result-box");
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

  function createOperationId() {
    if (typeof globalThis.crypto?.getRandomValues !== "function") {
      throw new Error("secure random values are unavailable");
    }

    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
      ""
    );
  }

  function isOperationPageActive(operation, sourceDocument) {
    if (frameDocument !== sourceDocument) {
      return false;
    }

    try {
      return frame.contentWindow.location.href === operation.pageURL;
    } catch {
      return false;
    }
  }

  function proceedToNextQuestion() {
    const nextURL = findNextQuestionURL();
    if (nextURL === null) {
      navigationInProgress = false;
      setStatus("次の問題リンクがありません");
      updateNextQuestionButton();
      return;
    }

    navigationInProgress = true;
    stopSpeech();
    setStatus("次の問題を反映中");
    updateNextQuestionButton();
    updateCopyButton();

    try {
      frame.src = nextURL;
    } catch {
      navigationInProgress = false;
      setStatus("次の問題へ移動できません");
      updateSyncDependentControls();
    }
  }

  async function savePendingCelebration(operation, milestone) {
    const celebration = {
      date: operation.date,
      milestone,
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

    if (pendingCelebration.date !== activeCountDate) {
      celebrationTransitionPromise = (async () => {
        try {
          await clearPendingCelebration();
          setStatus("前日の祝福データを破棄しました");
          return false;
        } catch {
          setStatus("前日の祝福データを破棄できません.再試行してください");
          return false;
        } finally {
          celebrationTransitionPromise = null;
          updateSyncDependentControls();
        }
      })();
      return celebrationTransitionPromise;
    }

    if (currentFrameURL === pendingCelebration.sourcePageURL) {
      if (navigationInProgress) {
        return false;
      }
      proceedToNextQuestion();
      return true;
    }

    const milestone = pendingCelebration.milestone;
    celebrationTransitionPromise = (async () => {
      navigationInProgress = true;
      stopSpeech();
      setStatus(`${milestone}問達成`);
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
    const operation = {
      operationId: createOperationId(),
      date: activeCountDate,
      pageURL: currentFrameURL,
      result,
    };
    if (!isPendingAnswer(operation)) {
      throw new Error("invalid pending answer");
    }
    await GM.setValue(PENDING_ANSWER_KEY, operation);
    pendingAnswer = operation;
  }

  async function submitPendingAnswer() {
    if (pendingAnswer === null || syncPromise !== null) {
      return;
    }

    nextQuestionOperationInProgress = true;
    const operation = pendingAnswer;
    const sourceDocument = frameDocument;
    navigationInProgress = true;
    syncInProgress = true;
    setStatus("学習記録を同期中");
    updateSyncDependentControls();

    syncPromise = (async () => {
      try {
        const result = await requestAnswerResult(syncToken, {
          date: operation.date,
          operationId: operation.operationId,
          result: operation.result,
        });
        applyRemoteState(result.state);
        if (result.completedMilestone !== null) {
          await savePendingCelebration(
            operation,
            result.completedMilestone
          );
        }
        await clearPendingAnswer();
        syncReady = true;
        const shouldNavigate = isOperationPageActive(
          operation,
          sourceDocument
        );

        if (shouldNavigate) {
          proceedToNextQuestion();
        } else {
          navigationInProgress = false;
          setStatus(
            pendingCelebration === null
              ? "未完了の解答記録を同期しました"
              : `${pendingCelebration.milestone}問達成.祝福を準備中`
          );
        }
        return true;
      } catch (error) {
        if (error?.code === "date_changed" && isSyncState(error.state)) {
          applyRemoteState(error.state);
          try {
            await clearPendingAnswer();
            await reconcilePendingDates();
          } catch {
            navigationInProgress = false;
            setStatus("前日の未同期分を破棄できません.再試行してください");
            return false;
          }
          syncReady = true;
          const shouldNavigate = isOperationPageActive(
            operation,
            sourceDocument
          );

          if (shouldNavigate) {
            setStatus("前日の未同期分を破棄しました");
            proceedToNextQuestion();
          } else {
            navigationInProgress = false;
            setStatus("前日の未同期分を破棄しました");
          }
          return false;
        }

        navigationInProgress = false;
        if (error?.code === "unauthorized") {
          syncReady = false;
        }
        setStatus(`${syncErrorMessage(error)}.再試行してください`);
        return false;
      } finally {
        nextQuestionOperationInProgress = false;
        syncInProgress = false;
        syncPromise = null;
        updateSyncDependentControls();
        void maybeContinuePendingCelebration();
      }
    })();

    return syncPromise;
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
      if (
        syncInProgress ||
        navigationInProgress ||
        nextQuestionOperationInProgress
      ) {
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
    nextQuestionOperationInProgress = true;
    navigationInProgress = true;
    setStatus("解答記録を保存中");
    updateSyncDependentControls();
    try {
      await createPendingAnswer(answerResult);
    } catch {
      nextQuestionOperationInProgress = false;
      navigationInProgress = false;
      setStatus("未同期の解答記録を保存できません");
      updateSyncDependentControls();
      return;
    }

    await submitPendingAnswer();
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
    if (event.pointerType !== "touch") {
      return;
    }
    event.preventDefault();
    void handleNextQuestion();
  }

  function onFrameClick(event) {
    activateSpeechFromGesture();
    const target = event.target;
    if (!(target instanceof frame.contentWindow.Element)) {
      return;
    }

    const link = target.closest("a[href]");
    if (!link || getNextQuestionURL(link) === null) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    void handleNextQuestion();
  }

  function clearFrameState() {
    if (loadTimer !== null) {
      clearTimeout(loadTimer);
      loadTimer = null;
    }

    if (explanationTimer !== null) {
      clearTimeout(explanationTimer);
      explanationTimer = null;
    }

    clearFrameScrollResetTimers();
    clearCopyFeedbackTimer();
    frameMutationObserver?.disconnect();
    frameMutationObserver = null;
    currentPageReadPending = false;
    lastExplanationText = "";
    currentQuestionText = "";
  }

  function bindFrameDocument() {
    let nextDocument;
    let nextURL;

    try {
      nextDocument = frame.contentDocument;
      nextURL = frame.contentWindow.location.href;
    } catch {
      setStatus("ページへアクセスできません");
      return;
    }

    if (nextURL === "about:blank" && frame.src !== "about:blank") {
      return;
    }

    if (!nextDocument?.body) {
      setStatus("ページ本文がありません");
      return;
    }

    if (nextDocument === boundFrameDocument) {
      scheduleFrameScrollReset(nextDocument);
      return;
    }

    clearFrameState();
    boundFrameDocument = nextDocument;
    navigationInProgress = false;
    frameDocument = nextDocument;
    scheduleFrameScrollReset(frameDocument);
    frame.contentWindow.addEventListener("click", onFrameClick, true);
    observeExplanationChanges();

    try {
      currentFrameURL = nextURL;
      history.replaceState(null, "", currentFrameURL);
    } catch {
      setStatus("URLを取得できません");
      return;
    }

    updateNextQuestionButton();
    updateCopyButton();
    void maybeContinuePendingCelebration();

    loadTimer = window.setTimeout(() => {
      loadTimer = null;
      currentPageReadPending = true;
      if (pendingCelebration !== null) {
        void maybeContinuePendingCelebration();
        return;
      }
      processCurrentPageSpeech();
    }, FRAME_LOAD_DELAY_MS);
  }

  nextQuestionButton.addEventListener("pointerup", onNextQuestionPointerUp);
  nextQuestionButton.addEventListener("click", () => {
    void handleNextQuestion();
  });

  copyButton.addEventListener("click", copyReadableSections);
  stopButton.addEventListener("click", stopSpeech);
  syncSettingsButton.addEventListener("click", () => {
    openSyncSettings(!syncToken);
  });
  syncSettingsCancelButton.addEventListener("click", closeSyncSettings);
  syncSettingsSaveButton.addEventListener("click", () => {
    void saveSyncSettings();
  });
  syncTokenInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !syncSettingsSaveButton.disabled) {
      event.preventDefault();
      void saveSyncSettings();
    }
  });
  frame.addEventListener("load", bindFrameDocument);
  if (speechSupported) {
    document.addEventListener("click", activateSpeechFromGesture, true);
  }
  window.addEventListener("focus", handlePageResume);
  window.addEventListener("pageshow", handlePageResume);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      handlePageResume();
    }
  });

  renderCount();
  void initializeSync();

  // iframeのloadがキャッシュ等で先に完了していた場合にも対応します.
  try {
    if (
      frame.contentDocument?.readyState === "complete" &&
      (frame.contentWindow.location.href !== "about:blank" ||
        frame.src === "about:blank")
    ) {
      bindFrameDocument();
    }
  } catch {
    setStatus("ページへアクセスできません");
  }
})();
