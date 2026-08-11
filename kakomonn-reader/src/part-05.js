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

  async function advanceWithoutAttempt() {
    if (
      !syncReady ||
      syncInProgress ||
      nextQuestionOperationInProgress ||
      navigationInProgress ||
      pendingAnswer !== null ||
      pendingCelebration !== null
    ) {
      return false;
    }
    const questionId = currentQuestionId();
    if (questionId === null) {
      setStatus("問題IDを取得できないため次問移動を停止しました");
      updateSyncDependentControls();
      return false;
    }
    nextQuestionOperationInProgress = true;
    navigationInProgress = true;
    setStatus("次の問題を準備中");
    updateSyncDependentControls();
    try {
      const next = await requestNextQuestion(syncToken, questionId);
      navigationInProgress = false;
      if (next.question === null) {
        setStatus("出題できる問題はありません");
        return true;
      }
      return navigateToScheduledQuestion(next.question.url);
    } catch (error) {
      navigationInProgress = false;
      if (error?.code === "unauthorized") {
        syncReady = false;
      }
      setStatus(`${syncErrorMessage(error)}.再試行してください`);
      return false;
    } finally {
      nextQuestionOperationInProgress = false;
      updateSyncDependentControls();
    }
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

    const questionId = currentQuestionId();
    if (questionId === null) {
      setStatus("問題IDを取得できないため解答記録と次問移動を停止しました");
      updateNextQuestionButton();
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
      setStatus("問題IDを取得できないため解答を記録できません");
      updateSyncDependentControls();
      return;
    }
    nextQuestionOperationInProgress = false;
    navigationInProgress = false;
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
    if (event.pointerType !== "touch" || !event.isPrimary) {
      return;
    }

    event.preventDefault();
    void handleNextQuestion();
  }

  const ANSWER_CHOICE_SHORTCUT_KEYS = "qwert";
  const DISPLAY_CHOICE_SHORTCUT_KEYS = "asdfg";
  const SHORTCUT_SCROLL_DISTANCE = 100;
  let shortcutSequenceTimer = null;
  let shortcutSequenceDocument = null;
  let shortcutSequenceKey = "";

  function shortcutTargetElement(target) {
    if (target?.nodeType === target?.ownerDocument?.defaultView?.Node.ELEMENT_NODE) {
      return target;
    }
    return target?.parentElement ?? null;
  }

  function isEditableShortcutTarget(target) {
    const element = shortcutTargetElement(target);
    if (element === null) {
      return false;
    }

    if (
      element.isContentEditable ||
      element.closest("textarea, select, [role='textbox']") !== null
    ) {
      return true;
    }

    const input = element.closest("input");
    return (
      input !== null &&
      !["button", "checkbox", "radio", "reset", "submit"].includes(
        input.type
      )
    );
  }

  function currentQuestionControls() {
    if (!frameDocument?.body || frameDocument.defaultView === null) {
      return null;
    }

    const metadataElement = findQuestionMetadataElement(frameDocument);
    if (metadataElement === null) {
      return null;
    }

    const problemElement = metadataElement.closest(".problem_detail");
    const answerButton = findAnswerButtonAfter(metadataElement);
    if (
      problemElement === null ||
      answerButton === null ||
      !problemElement.contains(answerButton)
    ) {
      return null;
    }

    return {
      answerButton,
      answerChoiceControls: findAnswerChoiceControls(
        metadataElement,
        answerButton
      ),
      problemElement,
    };
  }

  function isDisabledControl(control) {
    return control.matches(":disabled, [aria-disabled='true']");
  }

  function activateAnswerChoice(index) {
    const controls = currentQuestionControls();
    const control = controls?.answerChoiceControls[index];
    const label = control?.closest("label");
    if (
      control === undefined ||
      label === null ||
      isDisabledControl(control) ||
      !isVisibleElement(label)
    ) {
      return false;
    }

    label.click();
    return true;
  }

  function activateAnswerButton() {
    const answerButton = currentQuestionControls()?.answerButton;
    if (
      answerButton === undefined ||
      isDisabledControl(answerButton) ||
      !isVisibleElement(answerButton)
    ) {
      return false;
    }

    answerButton.click();
    return true;
  }

  function activateDisplayChoice(index) {
    const controls = currentQuestionControls();
    if (controls === null) {
      return false;
    }

    const list = directChild(controls.problemElement, "ul.list");
    const choices =
      list === null ? [] : Array.from(list.children).filter((child) =>
        child.matches("li")
      );
    const choice = choices[index];
    if (
      choices.length !== controls.answerChoiceControls.length ||
      choice === undefined ||
      !isVisibleElement(choice)
    ) {
      return false;
    }

    choice.click();
    return true;
  }

  function scrollQuestionFrame(direction) {
    const frameWindow = frameDocument?.defaultView;
    if (frameWindow === null || frameWindow === undefined) {
      return false;
    }

    frameWindow.scrollBy({
      behavior: "auto",
      left: 0,
      top: direction * SHORTCUT_SCROLL_DISTANCE,
    });
    return true;
  }

  function clearShortcutSequence() {
    if (shortcutSequenceTimer !== null) {
      window.clearTimeout(shortcutSequenceTimer);
      shortcutSequenceTimer = null;
    }
    shortcutSequenceDocument = null;
    shortcutSequenceKey = "";
  }

  function commitPendingShortcut() {
    const key = shortcutSequenceKey;
    const sourceDocument = shortcutSequenceDocument;
    clearShortcutSequence();
    if (sourceDocument !== frameDocument || !syncSettings.hidden) {
      return false;
    }
    if (key === "s") {
      return activateDisplayChoice(DISPLAY_CHOICE_SHORTCUT_KEYS.indexOf("s"));
    }
    if (key === "g") {
      return activateDisplayChoice(DISPLAY_CHOICE_SHORTCUT_KEYS.indexOf("g"));
    }
    return false;
  }

  function startShortcutSequence(key) {
    shortcutSequenceKey = key;
    shortcutSequenceDocument = frameDocument;
    shortcutSequenceTimer = window.setTimeout(() => {
      if (key === "s" || key === "g") {
        commitPendingShortcut();
      } else {
        clearShortcutSequence();
      }
    }, SHORTCUT_SEQUENCE_TIMEOUT_MS);
  }

  function completeShortcutSequence(key) {
    if (
      shortcutSequenceTimer === null ||
      shortcutSequenceDocument !== frameDocument
    ) {
      return false;
    }

    if (shortcutSequenceKey === "s" && key === "k") {
      clearShortcutSequence();
      stopSpeech();
      return true;
    }
    if (shortcutSequenceKey === "g" && key === "g") {
      clearShortcutSequence();
      resetFrameScrollToTop();
      return true;
    }
    if (shortcutSequenceKey === "y" && key === "y") {
      clearShortcutSequence();
      if (!copyButton.disabled) {
        copyButton.click();
      }
      return true;
    }

    commitPendingShortcut();
    return false;
  }

  function handleEnterShortcut() {
    if (getCurrentAnswerResult() === "unknown") {
      return activateAnswerButton();
    }
    if (nextQuestionButton.disabled) {
      return false;
    }
    nextQuestionButton.click();
    return true;
  }

  function onReaderKeyDown(event) {
    const key = event.key.toLowerCase();
    const scrollDirection = key === "z" ? 1 : key === "x" ? -1 : 0;
    if (
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.isComposing ||
      !syncSettings.hidden ||
      isEditableShortcutTarget(event.target) ||
      (event.repeat && scrollDirection === 0)
    ) {
      clearShortcutSequence();
      return;
    }

    let handled = completeShortcutSequence(key);
    if (!handled) {
      if (key === "s" || key === "g" || key === "y") {
        startShortcutSequence(key);
        handled = true;
      } else if (event.key === "Enter") {
        handled = handleEnterShortcut();
      } else if (event.key === " ") {
        handled = toggleSpeechPause();
      } else {
        const answerChoiceIndex = ANSWER_CHOICE_SHORTCUT_KEYS.indexOf(key);
        const displayChoiceIndex = DISPLAY_CHOICE_SHORTCUT_KEYS.indexOf(key);
        if (answerChoiceIndex >= 0) {
          handled = activateAnswerChoice(answerChoiceIndex);
        } else if (displayChoiceIndex >= 0) {
          handled = activateDisplayChoice(displayChoiceIndex);
        } else if (scrollDirection !== 0) {
          handled = scrollQuestionFrame(scrollDirection);
        }
      }
    }

    if (!handled) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
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
    clearShortcutSequence();
    clearTimeLimit();
    if (loadTimer !== null) {
      clearTimeout(loadTimer);
      loadTimer = null;
    }

    if (explanationTimer !== null) {
      clearTimeout(explanationTimer);
      explanationTimer = null;
    }

    clearFrameProblemScrollTimers();
    clearCopyFeedbackTimer();
    frameMutationObserver?.disconnect();
    frameMutationObserver = null;
    currentPageReadPending = false;
    lastExplanationText = "";
    currentQuestionText = "";
  }

  function applyFrameDarkMode(sourceDocument) {
    let darkModeStyle = sourceDocument.getElementById(
      FRAME_DARK_MODE_STYLE_ID
    );
    if (darkModeStyle === null) {
      darkModeStyle = sourceDocument.createElement("style");
      darkModeStyle.id = FRAME_DARK_MODE_STYLE_ID;
      sourceDocument.head.appendChild(darkModeStyle);
    }
    darkModeStyle.textContent = FRAME_DARK_MODE_CSS;
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
      scheduleFrameProblemScroll(nextDocument);
      return;
    }

    clearFrameState();
    boundFrameDocument = nextDocument;
    navigationInProgress = false;
    frameDocument = nextDocument;
    synchronizeAnswerPresentation(frameDocument);
    applyFrameDarkMode(frameDocument);
    scheduleFrameProblemScroll(frameDocument);
    frame.contentWindow.addEventListener("click", onFrameClick, true);
    frame.contentWindow.addEventListener(
      "keydown",
      onReaderKeyDown,
      true
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
    synchronizeTimeLimitPhase();
    void maybeContinuePendingAnswerNavigation();
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
  document.addEventListener("keydown", onReaderKeyDown, true);
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
