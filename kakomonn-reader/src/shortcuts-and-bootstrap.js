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
    if (key === "g") {
      return activateDisplayChoice(DISPLAY_CHOICE_SHORTCUT_KEYS.indexOf("g"));
    }
    return false;
  }

  function startShortcutSequence(key) {
    shortcutSequenceKey = key;
    shortcutSequenceDocument = frameDocument;
    shortcutSequenceTimer = window.setTimeout(() => {
      if (key === "g") {
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
      if (key === "g" || key === "y") {
        startShortcutSequence(key);
        handled = true;
      } else if (event.key === "Enter") {
        handled = handleEnterShortcut();
      } else if (event.key === " ") {
        handled = toggleSpeechPause();
      } else if (key === "n" && !skipButton.hidden && !skipButton.disabled) {
        skipButton.click();
        handled = true;
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

    loadTimer = window.setTimeout(() => {
      loadTimer = null;
      currentPageReadPending = true;
      processCurrentPageSpeech();
    }, FRAME_LOAD_DELAY_MS);
  }

  nextQuestionButton.addEventListener("pointerup", onNextQuestionPointerUp);
  nextQuestionButton.addEventListener("click", () => {
    void handleNextQuestion();
  });

  copyButton.addEventListener("click", copyReadableSections);
  skipButton.addEventListener("click", () => {
    void handleSkipQuestion();
  });
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
