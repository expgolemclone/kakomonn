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

    if (goalCompleted || count >= GOAL) {
      nextQuestionButton.textContent = `${GOAL}問完了`;
      nextQuestionButton.disabled = true;
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

  function completeGoal() {
    goalCompleted = true;
    navigationInProgress = false;
    stopSpeech();
    setStatus(`本日の${GOAL}問を完了`);
    updateNextQuestionButton();
    updateCopyButton();
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
        const state = await requestSyncState(
          "POST",
          "/v1/correct",
          syncToken,
          {
            date: operation.date,
            operationId: operation.operationId,
          }
        );
        applyRemoteState(state);
        await clearPendingCorrect();
        syncReady = true;
        const shouldNavigate = isOperationPageActive(
          operation,
          sourceDocument
        );

        if (goalCompleted) {
          completeGoal();
        } else if (shouldNavigate) {
          proceedToNextQuestion();
        } else {
          navigationInProgress = false;
          setStatus("未完了の正解数を同期しました");
        }
        return true;
      } catch (error) {
        if (error?.code === "date_changed" && isCountState(error.state)) {
          applyRemoteState(error.state);
          try {
            await clearPendingCorrect();
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

          if (goalCompleted) {
            completeGoal();
          } else if (shouldNavigate) {
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
      }
    })();

    return syncPromise;
  }

  async function handleNextQuestion() {
    if (
      syncInProgress ||
      navigationInProgress ||
      nextQuestionOperationInProgress
    ) {
      return;
    }
    if (!syncReady) {
      await refreshRemoteCount();
      return;
    }
    if (goalCompleted || count >= GOAL) {
      completeGoal();
      return;
    }
    if (pendingCorrect !== null) {
      await submitPendingCorrect();
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

    try {
      nextDocument = frame.contentDocument;
    } catch {
      setStatus("ページへアクセスできません");
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
    updateNextQuestionButton();
    updateCopyButton();

    try {
      currentFrameURL = frame.contentWindow.location.href;
      history.replaceState(null, "", currentFrameURL);
    } catch {
      setStatus("URLを取得できません");
      return;
    }

    loadTimer = window.setTimeout(() => {
      loadTimer = null;

      if (!syncReady) {
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
  if (frame.contentDocument?.readyState === "complete") {
    bindFrameDocument();
  }
})();
