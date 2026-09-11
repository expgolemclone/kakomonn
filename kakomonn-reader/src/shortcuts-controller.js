import { isIPhoneNextQuestionSwipe } from "./swipe-navigation.js";

export function installShortcutsController(app) {
  const ANSWER_CHOICE_SHORTCUT_KEYS = "qwert";
  const DISPLAY_CHOICE_SHORTCUT_KEYS = "asdfg";
  const SHORTCUT_SCROLL_DISTANCE = 100;
  let shortcutSequenceTimer = null;
  let shortcutSequenceDocument = null;
  let shortcutSequenceKey = "";
  let frameSwipeStart = null;
  
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
    if (!app.frameDocument?.body || app.frameDocument.defaultView === null) {
      return null;
    }
  
    const metadataElement = app.findQuestionMetadataElement(app.frameDocument);
    if (metadataElement === null) {
      return null;
    }
  
    const problemElement = metadataElement.closest(".problem_detail");
    const answerButton = app.findAnswerButtonAfter(metadataElement);
    if (
      problemElement === null ||
      answerButton === null ||
      !problemElement.contains(answerButton)
    ) {
      return null;
    }
  
    return {
      answerButton,
      answerChoiceControls: app.findAnswerChoiceControls(
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
      !app.isVisibleElement(label)
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
      !app.isVisibleElement(answerButton)
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
  
    const list = app.directChild(controls.problemElement, "ul.list");
    const choices =
      list === null ? [] : Array.from(list.children).filter((child) =>
        child.matches("li")
      );
    const choice = choices[index];
    if (
      choices.length !== controls.answerChoiceControls.length ||
      choice === undefined ||
      !app.isVisibleElement(choice)
    ) {
      return false;
    }
  
    choice.click();
    return true;
  }
  
  function scrollQuestionFrame(direction) {
    const frameWindow = app.frameDocument?.defaultView;
    if (frameWindow === null || frameWindow === undefined) {
      return false;
    }
  
    app.clearFrameProblemScrollTimers();
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
      sourceDocument !== app.frameDocument ||
      app.syncSettings.open ||
      app.errorDialog.open
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
    shortcutSequenceDocument = app.frameDocument;
    shortcutSequenceTimer = window.setTimeout(() => {
      if (key === "g") {
        commitPendingShortcut();
      } else {
        clearShortcutSequence();
      }
    }, app.SHORTCUT_SEQUENCE_TIMEOUT_MS);
  }
  
  function completeShortcutSequence(key) {
    if (
      shortcutSequenceTimer === null ||
      shortcutSequenceDocument !== app.frameDocument
    ) {
      return false;
    }
  
    if (shortcutSequenceKey === "g" && key === "g") {
      clearShortcutSequence();
      app.resetFrameScrollToTop();
      return true;
    }
    commitPendingShortcut();
    return false;
  }
  
  function handleEnterShortcut() {
    const answerResult = app.getCurrentAnswerResult();
    if (answerResult === "unknown") {
      app.beginAutomaticCopyFromGesture();
      return activateAnswerButton();
    }
    return answerResult === "incorrect" && app.requestIncorrectAnswerAdvance();
  }
  
  function onReaderKeyDown(event) {
    const key = event.key.toLowerCase();
    const browserBackShortcut = event.shiftKey && key === "h";
    const scrollDirection = key === "z" ? 1 : key === "x" ? -1 : 0;
    if (
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      (event.shiftKey && !browserBackShortcut) ||
      event.isComposing ||
      app.syncSettings.open ||
      app.errorDialog.open ||
      isEditableShortcutTarget(event.target) ||
      (event.repeat && scrollDirection === 0)
    ) {
      clearShortcutSequence();
      return;
    }
  
    let handled = false;
    if (browserBackShortcut) {
      clearShortcutSequence();
      history.back();
      handled = true;
    } else {
      handled = completeShortcutSequence(key);
    }
    if (!handled) {
      if (key === "g") {
        startShortcutSequence(key);
        handled = true;
      } else if (event.key === "Enter") {
        handled = handleEnterShortcut();
      } else if (event.key === " ") {
        handled = app.toggleSpeechPause();
      } else if (key === "n" && app.canSkipCurrentQuestion()) {
        void app.handleSkipQuestion();
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
  
    if (!browserBackShortcut) {
      app.activateSpeechFromGesture();
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  
  function onFrameClick(event) {
    app.activateSpeechFromGesture();
    const target = event.target;
    if (!(target instanceof app.frame.contentWindow.Element)) {
      return;
    }
  
    const answerButton = target.closest("button, input[type='button'], input[type='submit']");
    if (answerButton === currentQuestionControls()?.answerButton) {
      app.beginAutomaticCopyFromGesture();
      return;
    }
  
    const link = target.closest("a[href]");
    if (!link || app.getNextQuestionURL(link) === null) {
      return;
    }
  
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function onFrameTouchStart(event) {
    frameSwipeStart = null;
    if (
      !app.isIPhoneSafari ||
      event.touches.length !== 1 ||
      app.syncSettings.open ||
      app.errorDialog.open ||
      app.getCurrentAnswerResult() !== "incorrect"
    ) {
      return;
    }

    const touch = event.touches[0];
    frameSwipeStart = {
      identifier: touch.identifier,
      timeStamp: event.timeStamp,
      x: touch.clientX,
      y: touch.clientY,
    };
  }

  function onFrameTouchMove(event) {
    if (event.touches.length !== 1) {
      frameSwipeStart = null;
    }
  }

  function onFrameTouchCancel() {
    frameSwipeStart = null;
  }

  function onFrameTouchEnd(event) {
    const start = frameSwipeStart;
    frameSwipeStart = null;
    if (start === null || event.changedTouches.length === 0) {
      return;
    }

    const touch = Array.from(event.changedTouches).find(
      (candidate) => candidate.identifier === start.identifier
    );
    if (touch === undefined) {
      return;
    }

    if (
      !isIPhoneNextQuestionSwipe({
        durationMs: event.timeStamp - start.timeStamp,
        endX: touch.clientX,
        endY: touch.clientY,
        startX: start.x,
        startY: start.y,
        viewportWidth: app.frame.contentWindow.innerWidth,
      }) ||
      !app.requestIncorrectAnswerAdvance()
    ) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
  }
  
  function clearFrameState() {
    clearShortcutSequence();
    frameSwipeStart = null;
    app.clearTimeLimit();
    app.clearFrameProblemScrollTimers();
    app.discardAnswerCopyOperation();
    app.frameMutationObserver?.disconnect();
    app.frameMutationObserver = null;
    app.frameControlObserver?.disconnect();
    app.frameControlObserver = null;
    app.observedAnswerResult = null;
    app.observedCommentary = null;
    app.currentPageReadPending = false;
    app.awaitingAnswerResultSpeech = false;
  }
  
  function applyFrameDarkMode(sourceDocument) {
    let darkModeStyle = sourceDocument.getElementById(
      app.FRAME_DARK_MODE_STYLE_ID
    );
    if (darkModeStyle === null) {
      darkModeStyle = sourceDocument.createElement("style");
      darkModeStyle.id = app.FRAME_DARK_MODE_STYLE_ID;
      sourceDocument.head.appendChild(darkModeStyle);
    }
    darkModeStyle.textContent = `${app.FRAME_DARK_MODE_CSS}\n${app.CORRECT_FEEDBACK_CSS}`;
  }
  
  function bindFrameDocument() {
    let nextDocument;
    let nextURL;
  
    try {
      nextDocument = app.frame.contentDocument;
      nextURL = app.frame.contentWindow.location.href;
    } catch (error) {
      app.showReaderError(
        "frame-access",
        "問題pageへアクセスできません",
        "Readerと問題pageが同じoriginであることを確認してください.",
        error
      );
      return;
    }
  
    if (nextURL === "about:blank" && app.frame.src !== "about:blank") {
      return;
    }
    if (nextURL === "about:blank" && app.shouldLaunchNextQuestionAfterSync) {
      return;
    }
  
    if (!nextDocument?.body) {
      app.showReaderError(
        "frame-document",
        "問題pageの本文がありません",
        "問題pageを再読み込みしてください.",
        { code: "document_body_missing" }
      );
      return;
    }
  
    if (nextDocument === app.boundFrameDocument) {
      app.scheduleFrameProblemScroll(nextDocument);
      return;
    }
  
    clearFrameState();
    app.boundFrameDocument = nextDocument;
    app.navigationInProgress = false;
    app.frameDocument = nextDocument;
    app.synchronizeAnswerPresentation(app.frameDocument);
    applyFrameDarkMode(app.frameDocument);
    app.suppressNextQuestionControls(app.frameDocument);
    if (app.getCurrentAnswerResult() === "correct") {
      app.beginCorrectAnswerFeedback(app.frameDocument);
    }
    app.scheduleFrameProblemScroll(app.frameDocument);
    app.frame.contentWindow.addEventListener("click", onFrameClick, true);
    app.frame.contentWindow.addEventListener(
      "keydown",
      onReaderKeyDown,
      true
    );
    if (app.isIPhoneSafari) {
      app.frame.contentWindow.addEventListener(
        "touchstart",
        onFrameTouchStart,
        { capture: true, passive: true }
      );
      app.frame.contentWindow.addEventListener(
        "touchmove",
        onFrameTouchMove,
        { capture: true, passive: true }
      );
      app.frame.contentWindow.addEventListener(
        "touchcancel",
        onFrameTouchCancel,
        { capture: true, passive: true }
      );
      app.frame.contentWindow.addEventListener(
        "touchend",
        onFrameTouchEnd,
        { capture: true, passive: false }
      );
    }
    app.observeFrameChanges();
  
    try {
      app.currentFrameURL = nextURL;
      if (!app.synchronizeCurrentHistoryURL()) {
        return;
      }
    } catch (error) {
      app.showReaderError(
        "frame-url",
        "問題pageのURLを反映できません",
        "Readerのhistoryを更新できませんでした.",
        error
      );
      return;
    }
  
    app.synchronizeTimeLimitPhase();
    void app.resumePendingLearningFlow();
    app.currentPageReadPending = true;
    app.processCurrentPageSpeech();
  }
  
  function onReaderFrameReady(event) {
    const message = event.data;
    if (
      event.origin !== location.origin ||
      event.source !== app.frame.contentWindow ||
      message === null ||
      typeof message !== "object" ||
      Array.isArray(message) ||
      Object.keys(message).sort().join(",") !== "href,type" ||
      message.type !== app.READER_FRAME_READY_MESSAGE_TYPE ||
      typeof message.href !== "string" ||
      !app.isSitePageURL(message.href)
    ) {
      return;
    }
  
    try {
      if (
        app.frame.contentWindow.location.href !== message.href ||
        app.frame.contentDocument?.readyState === "loading"
      ) {
        return;
      }
    } catch {
      return;
    }
  
    bindFrameDocument();
  }
  
  app.syncSettings.addEventListener("cancel", (event) => {
    event.preventDefault();
  });
  app.syncSettingsPanel.addEventListener("submit", (event) => {
    event.preventDefault();
    void app.saveSyncSettings();
  });
  window.addEventListener("message", onReaderFrameReady);
  document.addEventListener("keydown", onReaderKeyDown, true);
  if (app.speechSupported) {
    document.addEventListener("click", app.activateSpeechFromGesture, true);
  }
  window.addEventListener("focus", app.handlePageResume);
  window.addEventListener("popstate", app.handleReaderPopState);
  window.addEventListener("pagehide", app.handleReaderPageHide);
  window.addEventListener("pageshow", () => {
    app.handleReaderPageShow();
    app.handlePageResume();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      app.handlePageResume();
    }
  });
  
  if (app.isNextQuestionLauncher) {
    void app.startNextQuestionLauncher();
  } else {
    app.enterReaderUI();
  }

  Object.defineProperties(app, {
    ANSWER_CHOICE_SHORTCUT_KEYS: { enumerable: false, get: () => ANSWER_CHOICE_SHORTCUT_KEYS },
    DISPLAY_CHOICE_SHORTCUT_KEYS: { enumerable: false, get: () => DISPLAY_CHOICE_SHORTCUT_KEYS },
    SHORTCUT_SCROLL_DISTANCE: { enumerable: false, get: () => SHORTCUT_SCROLL_DISTANCE },
    shortcutSequenceTimer: { enumerable: false, get: () => shortcutSequenceTimer, set: (value) => { shortcutSequenceTimer = value; } },
    shortcutSequenceDocument: { enumerable: false, get: () => shortcutSequenceDocument, set: (value) => { shortcutSequenceDocument = value; } },
    shortcutSequenceKey: { enumerable: false, get: () => shortcutSequenceKey, set: (value) => { shortcutSequenceKey = value; } },
    frameSwipeStart: { enumerable: false, get: () => frameSwipeStart, set: (value) => { frameSwipeStart = value; } },
    shortcutTargetElement: { enumerable: false, get: () => shortcutTargetElement },
    isEditableShortcutTarget: { enumerable: false, get: () => isEditableShortcutTarget },
    currentQuestionControls: { enumerable: false, get: () => currentQuestionControls },
    isDisabledControl: { enumerable: false, get: () => isDisabledControl },
    activateAnswerChoice: { enumerable: false, get: () => activateAnswerChoice },
    activateAnswerButton: { enumerable: false, get: () => activateAnswerButton },
    activateDisplayChoice: { enumerable: false, get: () => activateDisplayChoice },
    scrollQuestionFrame: { enumerable: false, get: () => scrollQuestionFrame },
    clearShortcutSequence: { enumerable: false, get: () => clearShortcutSequence },
    commitPendingShortcut: { enumerable: false, get: () => commitPendingShortcut },
    startShortcutSequence: { enumerable: false, get: () => startShortcutSequence },
    completeShortcutSequence: { enumerable: false, get: () => completeShortcutSequence },
    handleEnterShortcut: { enumerable: false, get: () => handleEnterShortcut },
    onReaderKeyDown: { enumerable: false, get: () => onReaderKeyDown },
    onFrameClick: { enumerable: false, get: () => onFrameClick },
    onFrameTouchStart: { enumerable: false, get: () => onFrameTouchStart },
    onFrameTouchMove: { enumerable: false, get: () => onFrameTouchMove },
    onFrameTouchCancel: { enumerable: false, get: () => onFrameTouchCancel },
    onFrameTouchEnd: { enumerable: false, get: () => onFrameTouchEnd },
    clearFrameState: { enumerable: false, get: () => clearFrameState },
    applyFrameDarkMode: { enumerable: false, get: () => applyFrameDarkMode },
    bindFrameDocument: { enumerable: false, get: () => bindFrameDocument },
    onReaderFrameReady: { enumerable: false, get: () => onReaderFrameReady },
  });
}
