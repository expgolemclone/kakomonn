      speakText(
        `解説。${explanationText}`,
        "解説",
        EXPLANATION_SPEECH_RATE
      );
      return;
    }

    if (!questionText) {
      setStatus("問題文を取得できません");
      return;
    }

    currentQuestionText = questionText;
    speakText(`問題文。${questionText}`, "問題文", QUESTION_SPEECH_RATE);
  }

  function checkForNewExplanation() {
    if (!speechEnabled || !currentQuestionText) {
      return;
    }

    const lines = getVisibleLines();
    if (hasVisibleExplanationLock(lines)) {
      return;
    }

    const explanationText = extractExplanationText(lines);
    if (!explanationText || explanationText === lastExplanationText) {
      return;
    }

    lastExplanationText = explanationText;
    speakText(
      `解説。${explanationText}`,
      "解説",
      EXPLANATION_SPEECH_RATE
    );
  }

  function scheduleExplanationCheck() {
    if (explanationTimer !== null) {
      clearTimeout(explanationTimer);
    }

    explanationTimer = window.setTimeout(() => {
      explanationTimer = null;
      updateNextQuestionButton();
      updateCopyButton();
      checkForNewExplanation();
    }, EXPLANATION_CHANGE_DELAY_MS);
  }

  function observeExplanationChanges() {
    frameMutationObserver?.disconnect();
    frameMutationObserver = new MutationObserver(scheduleExplanationCheck);
    frameMutationObserver.observe(frameDocument.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "aria-hidden"],
    });
  }

  function normalizeControlLabel(control) {
    return (
      control.innerText ||
      control.textContent ||
      control.value ||
      control.getAttribute("aria-label") ||
      ""
    )
      .replace(/\s+/g, "")
      .trim();
  }

  function isNextQuestionLabel(label) {
    return (
      label === "次の問題へ" ||
      /^次の問題[（(]問\d+[）)]へ$/.test(label)
    );
  }

  function findNextQuestionControl() {
    if (!frameDocument?.body) {
      return null;
    }

    const controls = frameDocument.querySelectorAll(
      "a, button, input[type='button'], input[type='submit']"
    );

    for (const control of controls) {
      if (!isVisibleElement(control)) {
        continue;
      }

      if (control.matches(":disabled") || control.getAttribute("aria-disabled") === "true") {
        continue;
      }

      if (isNextQuestionLabel(normalizeControlLabel(control))) {
        return control;
      }
    }

    return null;
  }

  function clearFrameScrollResetTimers() {
    for (const timer of frameScrollResetTimers) {
      clearTimeout(timer);
    }

    frameScrollResetTimers = [];
  }

  function resetFrameScrollToTop(sourceDocument = frameDocument) {
    if (
      !sourceDocument?.body ||
      frameDocument !== sourceDocument ||
      !frame.contentWindow
    ) {
      return;
    }

    try {
      const frameWindow = frame.contentWindow;
      if ("scrollRestoration" in frameWindow.history) {
        frameWindow.history.scrollRestoration = "manual";
      }

      const activeElement = sourceDocument.activeElement;
      if (activeElement instanceof frameWindow.HTMLElement) {
        activeElement.blur();
      }

      frameWindow.scrollTo(0, 0);
      sourceDocument.documentElement.scrollTop = 0;
      sourceDocument.body.scrollTop = 0;
    } catch {
      setStatus("ページ先頭へ戻せません");
    }
  }

  function scheduleFrameScrollReset(sourceDocument = frameDocument) {
    clearFrameScrollResetTimers();

    for (const delay of FRAME_SCROLL_RESET_DELAYS_MS) {
      if (delay === 0) {
        resetFrameScrollToTop(sourceDocument);
        continue;
      }

      const timer = window.setTimeout(() => {
        frameScrollResetTimers = frameScrollResetTimers.filter(
          (scheduledTimer) => scheduledTimer !== timer
        );
        resetFrameScrollToTop(sourceDocument);
      }, delay);
      frameScrollResetTimers.push(timer);
    }
  }

  function clearCopyFeedbackTimer() {
    if (copyFeedbackTimer === null) {
      return;
    }

    clearTimeout(copyFeedbackTimer);
    copyFeedbackTimer = null;
  }

  function updateCopyButton() {
    if (nextQuestionOperationInProgress) {
      copyButton.textContent = "解答記録を処理中";
      copyButton.disabled = true;
      return;
    }

    if (!navigator.clipboard?.writeText) {
      copyButton.textContent = "コピー非対応";
      copyButton.disabled = true;
      return;
    }

    if (pendingCelebration !== null) {
      copyButton.textContent = "祝福を準備中";
      copyButton.disabled = true;
      return;
    }

    if (
      navigationInProgress ||
      !frameDocument?.body ||
      frameDocument.defaultView === null
    ) {
      copyButton.textContent = "コピー準備中";
      copyButton.disabled = true;
      return;
    }

    const { questionText, explanationText } = extractReadableSections();
    if (!questionText) {
      copyButton.textContent = "コピー準備中";
      copyButton.disabled = true;
      return;
    }

    if (!explanationText) {
      copyButton.textContent = "回答後にコピー";
      copyButton.disabled = true;
      return;
    }

    copyButton.textContent = "問題・解説をコピー";
    copyButton.disabled = false;
  }

  async function copyReadableSections() {
    const { questionText, explanationText } = extractReadableSections();
    if (!questionText || !explanationText) {
      setStatus("回答後にコピーできます");
      updateCopyButton();
      return;
    }

    const copyText = `問題文\n${questionText}\n\n解説\n${explanationText}`;

    try {
      await navigator.clipboard.writeText(copyText);
      copyButton.textContent = "コピー済み";
      copyButton.disabled = true;
      setStatus("問題文と解説をコピーしました");
      clearCopyFeedbackTimer();
      copyFeedbackTimer = window.setTimeout(() => {
        copyFeedbackTimer = null;
        updateCopyButton();
      }, COPY_FEEDBACK_DURATION_MS);
    } catch {
      setStatus("クリップボードへコピーできません");
      updateCopyButton();
    }
  }

  function clearNextQuestionReloadTimer() {
    if (nextQuestionReloadTimer === null) {
      return;
    }

    clearTimeout(nextQuestionReloadTimer);
    nextQuestionReloadTimer = null;
  }

  function scheduleNextQuestionReload() {
    clearNextQuestionReloadTimer();
    const sourceDocument = frameDocument;

    nextQuestionReloadTimer = window.setTimeout(() => {
