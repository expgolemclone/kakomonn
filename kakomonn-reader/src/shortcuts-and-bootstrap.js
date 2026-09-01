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

    clearFrameProblemScrollTimers();
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
    if (
      sourceDocument !== frameDocument ||
      syncSettings.open ||
      errorDialog.open
    ) {
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
    commitPendingShortcut();
    return false;
  }

  function handleEnterShortcut() {
    const answerResult = getCurrentAnswerResult();
    if (answerResult === "unknown") {
      beginAutomaticCopyFromGesture();
      return activateAnswerButton();
    }
    return answerResult === "incorrect" && requestIncorrectAnswerAdvance();
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
      syncSettings.open ||
      errorDialog.open ||
      isEditableShortcutTarget(event.target) ||
      (event.repeat && scrollDirection === 0)
    ) {
      clearShortcutSequence();
      return;
    }

    let handled = completeShortcutSequence(key);
    if (!handled) {
      if (key === "g") {
        startShortcutSequence(key);
        handled = true;
      } else if (event.key === "Enter") {
        handled = handleEnterShortcut();
      } else if (event.key === " ") {
        handled = toggleSpeechPause();
      } else if (key === "n" && canSkipCurrentQuestion()) {
        void handleSkipQuestion();
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

    activateSpeechFromGesture();
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function onFrameClick(event) {
    activateSpeechFromGesture();
    const target = event.target;
    if (!(target instanceof frame.contentWindow.Element)) {
      return;
    }

    const answerButton = target.closest("button, input[type='button'], input[type='submit']");
    if (answerButton === currentQuestionControls()?.answerButton) {
      beginAutomaticCopyFromGesture();
      return;
    }

    const link = target.closest("a[href]");
    if (!link || getNextQuestionURL(link) === null) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function clearFrameState() {
    clearShortcutSequence();
    clearTimeLimit();
    if (loadTimer !== null) {
      clearTimeout(loadTimer);
      loadTimer = null;
    }

    clearFrameProblemScrollTimers();
    discardAnswerCopyOperation();
    frameMutationObserver?.disconnect();
    frameMutationObserver = null;
    frameControlObserver?.disconnect();
    frameControlObserver = null;
    observedAnswerResult = null;
    observedCommentary = null;
    currentPageReadPending = false;
    awaitingAnswerResultSpeech = false;
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
    darkModeStyle.textContent = `${FRAME_DARK_MODE_CSS}\n${CORRECT_FEEDBACK_CSS}`;
  }

  function bindFrameDocument() {
    let nextDocument;
    let nextURL;

    try {
      nextDocument = frame.contentDocument;
      nextURL = frame.contentWindow.location.href;
    } catch (error) {
      showReaderError(
        "frame-access",
        "問題pageへアクセスできません",
        "Readerと問題pageが同じoriginであることを確認してください.",
        error
      );
      return;
    }

    if (nextURL === "about:blank" && frame.src !== "about:blank") {
      return;
    }
    if (nextURL === "about:blank" && shouldLaunchNextQuestionAfterSync) {
      return;
    }

    if (!nextDocument?.body) {
      showReaderError(
        "frame-document",
        "問題pageの本文がありません",
        "問題pageを再読み込みしてください.",
        { code: "document_body_missing" }
      );
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
    suppressNextQuestionControls(frameDocument);
    if (getCurrentAnswerResult() === "correct") {
      beginCorrectAnswerFeedback(frameDocument);
    }
    scheduleFrameProblemScroll(frameDocument);
    frame.contentWindow.addEventListener("click", onFrameClick, true);
    frame.contentWindow.addEventListener(
      "keydown",
      onReaderKeyDown,
      true
    );
    observeFrameChanges();

    try {
      currentFrameURL = nextURL;
      if (!synchronizeCurrentHistoryURL()) {
        return;
      }
    } catch (error) {
      showReaderError(
        "frame-url",
        "問題pageのURLを反映できません",
        "Readerのhistoryを更新できませんでした.",
        error
      );
      return;
    }

    synchronizeTimeLimitPhase();
    void resumePendingLearningFlow();

    loadTimer = window.setTimeout(() => {
      loadTimer = null;
      currentPageReadPending = true;
      processCurrentPageSpeech();
    }, FRAME_LOAD_DELAY_MS);
  }

  syncSettings.addEventListener("cancel", (event) => {
    event.preventDefault();
  });
  syncSettingsPanel.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveSyncSettings();
  });
  frame.addEventListener("load", bindFrameDocument);
  document.addEventListener("keydown", onReaderKeyDown, true);
  if (speechSupported) {
    document.addEventListener("click", activateSpeechFromGesture, true);
  }
  window.addEventListener("focus", handlePageResume);
  window.addEventListener("popstate", handleReaderPopState);
  window.addEventListener("pagehide", handleReaderPageHide);
  window.addEventListener("pageshow", () => {
    handleReaderPageShow();
    handlePageResume();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      handlePageResume();
    }
  });

  if (isNextQuestionLauncher) {
    void startNextQuestionLauncher();
  } else {
    enterReaderUI();
  }

  // iframeのloadがキャッシュ等で先に完了していた場合にも対応します.
  try {
    if (
      !shouldLaunchNextQuestionAfterSync &&
      frame.contentDocument?.readyState === "complete" &&
      (frame.contentWindow.location.href !== "about:blank" ||
        frame.src === "about:blank")
    ) {
      bindFrameDocument();
    }
  } catch (error) {
    showReaderError(
      "initial-frame-access",
      "問題pageへアクセスできません",
      "問題pageを再読み込みしてください.",
      error
    );
  }
})();
