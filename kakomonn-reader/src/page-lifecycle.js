  function checkForNewAnswerResult() {
    const answerResult = getCurrentAnswerResult();
    if (answerResult === "unknown") {
      return;
    }

    if (answerResult === "correct") {
      beginCorrectAnswerFeedback();
      return;
    }

    if (!speechEnabled || !awaitingAnswerResultSpeech) {
      return;
    }

    speakAnswerResult(answerResult);
  }

  function processAnswerStateChange() {
    suppressNextQuestionControls();
    synchronizeAnswerPresentation();
    synchronizeTimeLimitPhase();
    checkForNewAnswerResult();
    recordCurrentAnswerIfAvailable();
    void processPendingAutomaticCopy();
  }

  function attachAnswerStateObserver() {
    const answerResult = frameDocument.querySelector("#js-answer-result-box");
    const commentary = frameDocument.querySelector("#js-commentary-wrap");
    if (
      answerResult === observedAnswerResult &&
      commentary === observedCommentary
    ) {
      return answerResult !== null || commentary !== null;
    }

    frameMutationObserver?.disconnect();
    if (frameMutationObserver === null) {
      frameMutationObserver = new MutationObserver(processAnswerStateChange);
    }
    observedAnswerResult = answerResult;
    observedCommentary = commentary;
    const answerObserverOptions = {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "aria-hidden"],
    };
    if (answerResult !== null) {
      frameMutationObserver.observe(answerResult, answerObserverOptions);
    }
    if (commentary !== null) {
      frameMutationObserver.observe(commentary, answerObserverOptions);
    }
    processAnswerStateChange();
    return answerResult !== null || commentary !== null;
  }

  function observeFrameChanges() {
    frameMutationObserver?.disconnect();
    frameMutationObserver = null;
    observedAnswerResult = null;
    observedCommentary = null;
    frameControlObserver?.disconnect();

    attachAnswerStateObserver();

    frameControlObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const addedNode of mutation.addedNodes) {
          suppressNextQuestionControlsIn(addedNode);
        }
      }
      attachAnswerStateObserver();
    });
    frameControlObserver.observe(frameDocument.body, {
      subtree: true,
      childList: true,
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

  function getNextQuestionURL(link) {
    const url = new URL(link.href);
    if (
      !isNextQuestionLabel(normalizeControlLabel(link)) ||
      link.getAttribute("aria-disabled") === "true" ||
      url.origin !== location.origin ||
      !/^\/questions\/(?:\d+|next\/\d+)$/.test(url.pathname) ||
      url.search !== "" ||
      url.hash !== "" ||
      url.href === currentFrameURL
    ) {
      return null;
    }

    return url.href;
  }

  function suppressNextQuestionControl(candidate) {
    const isNextControl = candidate.matches("a[href]")
      ? getNextQuestionURL(candidate) !== null
      : isNextQuestionLabel(normalizeControlLabel(candidate));
    if (!isNextControl) {
      return;
    }

    const control = candidate.closest(".next_ques_btn") ?? candidate;
    if (!control.hidden) {
      control.hidden = true;
    }
    if (control.getAttribute("aria-hidden") !== "true") {
      control.setAttribute("aria-hidden", "true");
    }
  }

  function suppressNextQuestionControlsIn(rootNode) {
    if (!(rootNode instanceof frame.contentWindow.Element)) {
      return;
    }

    const selector = "a[href], button, input[type='button'], input[type='submit']";
    if (rootNode.matches(selector)) {
      suppressNextQuestionControl(rootNode);
    }
    for (const candidate of rootNode.querySelectorAll(selector)) {
      suppressNextQuestionControl(candidate);
    }
  }

  function suppressNextQuestionControls(sourceDocument = frameDocument) {
    if (!sourceDocument?.body) {
      return;
    }
    for (const candidate of sourceDocument.querySelectorAll(
      "a[href], button, input[type='button'], input[type='submit']"
    )) {
      suppressNextQuestionControl(candidate);
    }
  }

  function clearTimeLimit(hide = true) {
    if (timeLimitTimeout !== null) {
      window.clearTimeout(timeLimitTimeout);
      timeLimitTimeout = null;
    }
    if (timeLimitInterval !== null) {
      window.clearInterval(timeLimitInterval);
      timeLimitInterval = null;
    }
    timeLimitPhase = null;
    timeLimitDeadline = 0;
    timeLimitSourceDocument = null;
    if (hide) {
      timeLimitProgress.hidden = true;
      timeLimitProgress.removeAttribute("data-phase");
    }
  }

  function renderTimeLimit() {
    if (timeLimitPhase === null || timeLimitDeadline === 0) {
      return;
    }
    const remaining = Math.max(0, timeLimitDeadline - Date.now());
    const totalSeconds = Math.ceil(remaining / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const phaseLabel =
      timeLimitPhase === "question" ? "問題" : "解説";
    timeLimitProgress.hidden = false;
    timeLimitProgress.dataset.phase = timeLimitPhase;
    timeLimitProgress.value = remaining;
    timeLimitProgress.setAttribute(
      "aria-valuetext",
      `${phaseLabel}の残り時間${minutes}分${seconds}秒`
    );
  }

  function startTimeLimit(phase, sourceDocument) {
    clearTimeLimit();
    timeLimitPhase = phase;
    timeLimitDeadline = Date.now() + TIME_LIMIT_MS;
    timeLimitSourceDocument = sourceDocument;
    timeLimitTimeout = window.setTimeout(
      () => expireTimeLimit(phase, sourceDocument),
      TIME_LIMIT_MS
    );
    timeLimitInterval = window.setInterval(renderTimeLimit, 1000);
    renderTimeLimit();
  }

  function synchronizeTimeLimitPhase() {
    if (
      !syncReady ||
      navigationInProgress ||
      frameDocument?.body === undefined ||
      currentQuestionControls() === null
    ) {
      clearTimeLimit();
      return;
    }

    const phase =
      getCurrentAnswerResult() === "unknown" ? "question" : "explanation";
    if (
      timeLimitPhase === phase &&
      timeLimitSourceDocument === frameDocument
    ) {
      if (Date.now() >= timeLimitDeadline) {
        expireTimeLimit(phase, frameDocument);
      } else {
        renderTimeLimit();
      }
      return;
    }

    startTimeLimit(phase, frameDocument);
  }

  function expireTimeLimit(expectedPhase, sourceDocument) {
    if (
      timeLimitPhase !== expectedPhase ||
      timeLimitSourceDocument !== sourceDocument ||
      frameDocument !== sourceDocument
    ) {
      return;
    }

    const currentPhase =
      getCurrentAnswerResult() === "unknown" ? "question" : "explanation";
    if (currentPhase !== expectedPhase) {
      startTimeLimit(currentPhase, sourceDocument);
      return;
    }

    renderTimeLimit();
    clearTimeLimit(false);
    timeLimitProgress.value = 0;

    if (expectedPhase === "question") {
      void handleSkipQuestion();
    }
  }

  function clearFrameProblemScrollTimers() {
    for (const timer of frameProblemScrollTimers) {
      clearTimeout(timer);
    }

    frameProblemScrollTimers = [];
  }

  function resetFrameScrollToTop(sourceDocument = frameDocument) {
    if (
      !sourceDocument?.body ||
      frameDocument !== sourceDocument ||
      !frame.contentWindow
    ) {
      return;
    }

    clearFrameProblemScrollTimers();
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
    } catch (error) {
      showReaderError(
        "page-scroll-top",
        "ページ先頭へ戻せません",
        "問題pageのscroll位置を変更できませんでした.",
        error
      );
    }
  }

  function findProblemHeading(sourceDocument) {
    const headings = sourceDocument.querySelectorAll(
      ".sect_problem > .ttl_box03 > h2.main"
    );
    return (
      Array.from(headings).find(
        (heading) => normalizeInlineText(heading.textContent ?? "") === "問題"
      ) ?? null
    );
  }

  function scrollFrameToProblemHeading(sourceDocument = frameDocument) {
    if (
      !sourceDocument?.body ||
      frameDocument !== sourceDocument ||
      !frame.contentWindow
    ) {
      return false;
    }

    const problemHeading = findProblemHeading(sourceDocument);
    if (problemHeading === null) {
      return false;
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

      const headingTop =
        frameWindow.scrollY + problemHeading.getBoundingClientRect().top;
      frameWindow.scrollTo({ behavior: "auto", left: 0, top: headingTop });
      return true;
    } catch (error) {
      showReaderError(
        "problem-scroll",
        "問題の位置へ移動できません",
        "問題見出しまでscrollできませんでした.",
        error
      );
      return false;
    }
  }

  function scheduleFrameProblemScroll(sourceDocument = frameDocument) {
    clearFrameProblemScrollTimers();

    for (const delay of FRAME_PROBLEM_SCROLL_DELAYS_MS) {
      if (delay === 0) {
        scrollFrameToProblemHeading(sourceDocument);
        continue;
      }

      const timer = window.setTimeout(() => {
        frameProblemScrollTimers = frameProblemScrollTimers.filter(
          (scheduledTimer) => scheduledTimer !== timer
        );
        scrollFrameToProblemHeading(sourceDocument);
      }, delay);
      frameProblemScrollTimers.push(timer);
    }
  }
