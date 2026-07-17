      nextQuestionReloadTimer = null;

      if (
        !navigationInProgress ||
        frameDocument !== sourceDocument ||
        !frame.contentWindow
      ) {
        return;
      }

      setStatus("次の問題を再読込中");

      try {
        resetFrameScrollToTop(sourceDocument);
        frame.contentWindow.location.reload();
      } catch {
        navigationInProgress = false;
        setStatus("次の問題を再読込できません");
        updateSyncDependentControls();
      }
    }, NEXT_QUESTION_RELOAD_DELAY_MS);
  }

  function updateNextQuestionButton() {
    if (syncInProgress) {
      nextQuestionButton.textContent = "正解数を同期中";
      nextQuestionButton.disabled = true;
      return;
    }

    if (nextQuestionOperationInProgress) {
      nextQuestionButton.textContent = "正解情報を処理中";
      nextQuestionButton.disabled = true;
      return;
    }

    if (!syncReady) {
      nextQuestionButton.textContent = "同期を再試行";
      nextQuestionButton.disabled = !syncToken;
      return;
    }

    if (pendingCorrect !== null) {
      nextQuestionButton.textContent = "同期を再試行";
      nextQuestionButton.disabled = findNextQuestionControl() === null;
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
        (sourcePageActive && findNextQuestionControl() === null);
      return;
    }

    if (navigationInProgress) {
      nextQuestionButton.textContent = "移動中…";
      nextQuestionButton.disabled = true;
      return;
    }

    nextQuestionButton.textContent = "次の問題へ";
    nextQuestionButton.disabled = findNextQuestionControl() === null;
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
    const nextControl = findNextQuestionControl();
    if (nextControl === null) {
      navigationInProgress = false;
      setStatus("次の問題ボタンがありません");
      updateNextQuestionButton();
      return;
    }

    navigationInProgress = true;
    stopSpeech();
    setStatus("次の問題を反映中");
    updateNextQuestionButton();
    updateCopyButton();

    allowNextQuestionClick = true;
    try {
      nextControl.click();
    } finally {
      allowNextQuestionClick = false;
    }
    scheduleNextQuestionReload();
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
      pendingCorrect !== null ||
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

  async function createPendingCorrect() {
    const operation = {
      operationId: createOperationId(),
      date: activeCountDate,
      pageURL: currentFrameURL,
    };
    await GM.setValue(PENDING_CORRECT_KEY, operation);
    pendingCorrect = operation;
  }

  async function submitPendingCorrect() {
    if (pendingCorrect === null || syncPromise !== null) {
      return;
    }

    nextQuestionOperationInProgress = true;
    const operation = pendingCorrect;
    const sourceDocument = frameDocument;
    navigationInProgress = true;
    syncInProgress = true;
    setStatus("正解数を同期中");
    updateSyncDependentControls();

    syncPromise = (async () => {
      try {
        const result = await requestCorrectResult(syncToken, {
          date: operation.date,
          operationId: operation.operationId,
        });
        applyRemoteState(result.state);
        if (result.completedMilestone !== null) {
          await savePendingCelebration(
            operation,
            result.completedMilestone
          );
        }
        await clearPendingCorrect();
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
              ? "未完了の正解数を同期しました"
              : `${pendingCelebration.milestone}問達成.祝福を準備中`
          );
        }
        return true;
      } catch (error) {
        if (error?.code === "date_changed" && isCountState(error.state)) {
          applyRemoteState(error.state);
          try {
            await clearPendingCorrect();
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
      await refreshRemoteCount();
      return;
    }
    if (pendingCorrect !== null) {
      await submitPendingCorrect();
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
    if (answerResult === "incorrect") {
      proceedToNextQuestion();
      return;
    }

    nextQuestionOperationInProgress = true;
    navigationInProgress = true;
    setStatus("正解情報を保存中");
    updateSyncDependentControls();
    try {
      await createPendingCorrect();
    } catch {
      nextQuestionOperationInProgress = false;
      navigationInProgress = false;
      setStatus("未同期の正解情報を保存できません");
      updateSyncDependentControls();
      return;
    }

    await submitPendingCorrect();
  }

  function onFrameClick(event) {
    const target = event.target;
    if (!(target instanceof frame.contentWindow.Element)) {
      return;
    }

    const control = target.closest(
      "a, button, input[type='button'], input[type='submit']"
    );
    if (!control || !isNextQuestionLabel(normalizeControlLabel(control))) {
      return;
    }
    if (allowNextQuestionClick) {
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

    clearNextQuestionReloadTimer();
    clearFrameScrollResetTimers();
    clearCopyFeedbackTimer();
    frameMutationObserver?.disconnect();
    frameMutationObserver = null;
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
    frame.contentWindow.addEventListener(
      "pagehide",
      clearNextQuestionReloadTimer,
      { once: true }
    );
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

      if (!syncReady) {
        return;
      }
      if (pendingCelebration !== null) {
        void maybeContinuePendingCelebration();
        return;
      }
      if (!speechSupported) {
        setStatus("読み上げ非対応");
      } else if (speechEnabled) {
        readCurrentPage();
      } else {
        setStatus("開始ボタンを押してください");
      }
    }, FRAME_LOAD_DELAY_MS);
  }

  startButton.addEventListener("click", () => {
    if (!syncReady) {
      void refreshRemoteCount();
      return;
    }

    if (pendingCelebration !== null) {
      void maybeContinuePendingCelebration();
      return;
    }
    if (!speechSupported) {
      setStatus("読み上げ非対応");
      return;
    }

    speechEnabled = true;
    startWrap.remove();
    nextQuestionButton.hidden = false;
    copyButton.hidden = false;
    updateNextQuestionButton();
    updateCopyButton();

    // iOSでは初回の発話をユーザー操作の中で直接開始する必要があります.
    speech.cancel();
    speechRunId += 1;
    const runId = speechRunId;
    initializeSpeechVoice(runId, readCurrentPage);
  });

  nextQuestionButton.addEventListener("click", () => {
    if (
      syncInProgress ||
      navigationInProgress ||
      nextQuestionOperationInProgress
    ) {
      return;
    }

    if (!syncReady) {
      void refreshRemoteCount();
      return;
    }

    if (pendingCelebration !== null) {
      void maybeContinuePendingCelebration();
      return;
    }

    const nextControl = findNextQuestionControl();
    if (nextControl === null) {
      setStatus("次の問題ボタンがありません");
      updateNextQuestionButton();
      return;
    }

    nextControl.click();
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
