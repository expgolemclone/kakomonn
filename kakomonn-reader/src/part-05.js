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
        updateNextQuestionButton();
      }
    }, NEXT_QUESTION_RELOAD_DELAY_MS);
  }

  function updateNextQuestionButton() {
    if (goalCompleted || count >= GOAL) {
      nextQuestionButton.textContent = `${GOAL}問完了`;
      nextQuestionButton.disabled = true;
      copyButton.disabled = true;
      return;
    }

    if (navigationInProgress) {
      nextQuestionButton.textContent = "移動中…";
      nextQuestionButton.disabled = true;
      copyButton.textContent = "コピー準備中";
      copyButton.disabled = true;
      return;
    }

    nextQuestionButton.textContent = "次の問題へ";
    nextQuestionButton.disabled = findNextQuestionControl() === null;
  }

  function completeGoal(event) {
    if (goalCompleted) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    goalCompleted = true;
    event.preventDefault();
    event.stopImmediatePropagation();
    stopSpeech();

    const shortcutURL = new URL("shortcuts://x-callback-url/run-shortcut");
    shortcutURL.searchParams.set("name", SHORTCUT_NAME);
    shortcutURL.searchParams.set("input", "text");
    shortcutURL.searchParams.set("text", "done");
    shortcutURL.searchParams.set("x-success", currentFrameURL);

    window.location.href = shortcutURL.href;
  }

  function onFrameClick(event) {
    const target = event.target;
    if (!(target instanceof frame.contentWindow.Element)) {
      return;
    }

    const control = target.closest(
      "a, button, input[type='button'], input[type='submit']"
    );
    if (!control) {
      return;
    }

    const label = normalizeControlLabel(control);
    if (!isNextQuestionLabel(label)) {
      return;
    }

    syncDailyCount();

    if (goalCompleted || count >= GOAL) {
      event.preventDefault();
      event.stopImmediatePropagation();
      setStatus(`本日の${GOAL}問を完了`);
      return;
    }

    if (navigationInProgress) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    navigationInProgress = true;
    count = Math.min(count + 1, GOAL);
    saveCountState(activeCountDate, count);
    renderCount();
    updateNextQuestionButton();
    updateCopyButton();

    if (count >= GOAL) {
      completeGoal(event);
      return;
    }

    stopSpeech();
    setStatus("次の問題を反映中");
    scheduleNextQuestionReload();
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
    frameDocument.addEventListener("click", onFrameClick, true);
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
    readCurrentPage();
  });

  nextQuestionButton.addEventListener("click", () => {
    syncDailyCount();

    if (goalCompleted || count >= GOAL) {
      setStatus(`本日の${GOAL}問を完了`);
      updateNextQuestionButton();
      return;
    }

    if (navigationInProgress) {
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
  frame.addEventListener("load", bindFrameDocument);
  window.addEventListener("focus", handlePageResume);
  window.addEventListener("pageshow", handlePageResume);
  window.addEventListener("storage", (event) => {
    if (event.key === COUNT_STATE_KEY) {
      syncDailyCount();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      handlePageResume();
    }
  });

  renderCount();
  scheduleDailyReset();

  // iframeのloadがキャッシュ等で先に完了していた場合にも対応します.
  if (frame.contentDocument?.readyState === "complete") {
    bindFrameDocument();
  }
})();
