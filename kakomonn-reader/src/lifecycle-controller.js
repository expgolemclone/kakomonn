export function installLifecycleController(app) {
  function checkForNewAnswerResult() {
    const answerResult = app.getCurrentAnswerResult();
    if (answerResult === "unknown") {
      return;
    }
  
    if (answerResult === "correct") {
      app.beginCorrectAnswerFeedback();
      return;
    }
  
    if (!app.speechEnabled || !app.awaitingAnswerResultSpeech) {
      return;
    }
  
    app.speakAnswerResult(answerResult);
  }
  
  function processAnswerStateChange() {
    suppressNextQuestionControls();
    app.synchronizeAnswerPresentation();
    synchronizeTimeLimitPhase();
    checkForNewAnswerResult();
    app.recordCurrentAnswerIfAvailable();
    void app.processPendingAutomaticCopy();
  }
  
  function attachAnswerStateObserver() {
    const answerResult = app.frameDocument.querySelector("#js-answer-result-box");
    const commentary = app.frameDocument.querySelector("#js-commentary-wrap");
    if (
      answerResult === app.observedAnswerResult &&
      commentary === app.observedCommentary
    ) {
      return answerResult !== null || commentary !== null;
    }
  
    app.frameMutationObserver?.disconnect();
    if (app.frameMutationObserver === null) {
      app.frameMutationObserver = new MutationObserver(processAnswerStateChange);
    }
    app.observedAnswerResult = answerResult;
    app.observedCommentary = commentary;
    const answerObserverOptions = {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "aria-hidden"],
    };
    if (answerResult !== null) {
      app.frameMutationObserver.observe(answerResult, answerObserverOptions);
    }
    if (commentary !== null) {
      app.frameMutationObserver.observe(commentary, answerObserverOptions);
    }
    processAnswerStateChange();
    return answerResult !== null || commentary !== null;
  }
  
  function observeFrameChanges() {
    app.frameMutationObserver?.disconnect();
    app.frameMutationObserver = null;
    app.observedAnswerResult = null;
    app.observedCommentary = null;
    app.frameControlObserver?.disconnect();
  
    attachAnswerStateObserver();
  
    app.frameControlObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const addedNode of mutation.addedNodes) {
          suppressNextQuestionControlsIn(addedNode);
        }
      }
      attachAnswerStateObserver();
      app.processCurrentPageSpeech();
    });
    app.frameControlObserver.observe(app.frameDocument.body, {
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
      url.href === app.currentFrameURL
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
    if (!(rootNode instanceof app.frame.contentWindow.Element)) {
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
  
  function suppressNextQuestionControls(sourceDocument = app.frameDocument) {
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
    if (app.timeLimitTimeout !== null) {
      window.clearTimeout(app.timeLimitTimeout);
      app.timeLimitTimeout = null;
    }
    if (app.timeLimitInterval !== null) {
      window.clearInterval(app.timeLimitInterval);
      app.timeLimitInterval = null;
    }
    app.timeLimitPhase = null;
    app.timeLimitDeadline = 0;
    app.timeLimitSourceDocument = null;
    if (hide) {
      app.timeLimitProgress.hidden = true;
      app.timeLimitProgress.removeAttribute("data-phase");
    }
  }
  
  function renderTimeLimit() {
    if (app.timeLimitPhase === null || app.timeLimitDeadline === 0) {
      return;
    }
    const remaining = Math.max(0, app.timeLimitDeadline - Date.now());
    const totalSeconds = Math.ceil(remaining / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const phaseLabel =
      app.timeLimitPhase === "question" ? "問題" : "解説";
    app.timeLimitProgress.hidden = false;
    app.timeLimitProgress.dataset.phase = app.timeLimitPhase;
    app.timeLimitProgress.value = remaining;
    app.timeLimitProgress.setAttribute(
      "aria-valuetext",
      `${phaseLabel}の残り時間${minutes}分${seconds}秒`
    );
  }
  
  function startTimeLimit(phase, sourceDocument) {
    clearTimeLimit();
    app.timeLimitPhase = phase;
    app.timeLimitDeadline = Date.now() + app.TIME_LIMIT_MS;
    app.timeLimitSourceDocument = sourceDocument;
    app.timeLimitTimeout = window.setTimeout(
      () => expireTimeLimit(phase, sourceDocument),
      app.TIME_LIMIT_MS
    );
    app.timeLimitInterval = window.setInterval(renderTimeLimit, 1000);
    renderTimeLimit();
  }
  
  function synchronizeTimeLimitPhase() {
    if (
      !app.syncReady ||
      app.navigationInProgress ||
      app.frameDocument?.body === undefined ||
      app.currentQuestionControls() === null
    ) {
      clearTimeLimit();
      return;
    }
  
    const phase =
      app.getCurrentAnswerResult() === "unknown" ? "question" : "explanation";
    if (
      app.timeLimitPhase === phase &&
      app.timeLimitSourceDocument === app.frameDocument
    ) {
      if (Date.now() >= app.timeLimitDeadline) {
        expireTimeLimit(phase, app.frameDocument);
      } else {
        renderTimeLimit();
      }
      return;
    }
  
    startTimeLimit(phase, app.frameDocument);
  }
  
  function expireTimeLimit(expectedPhase, sourceDocument) {
    if (
      app.timeLimitPhase !== expectedPhase ||
      app.timeLimitSourceDocument !== sourceDocument ||
      app.frameDocument !== sourceDocument
    ) {
      return;
    }
  
    const currentPhase =
      app.getCurrentAnswerResult() === "unknown" ? "question" : "explanation";
    if (currentPhase !== expectedPhase) {
      startTimeLimit(currentPhase, sourceDocument);
      return;
    }
  
    renderTimeLimit();
    clearTimeLimit(false);
    app.timeLimitProgress.value = 0;
  
    if (expectedPhase === "question") {
      void app.handleSkipQuestion();
    }
  }
  
  function clearFrameProblemScrollTimers() {
    for (const timer of app.frameProblemScrollTimers) {
      clearTimeout(timer);
    }
  
    app.frameProblemScrollTimers = [];
  }
  
  function resetFrameScrollToTop(sourceDocument = app.frameDocument) {
    if (
      !sourceDocument?.body ||
      app.frameDocument !== sourceDocument ||
      !app.frame.contentWindow
    ) {
      return;
    }
  
    clearFrameProblemScrollTimers();
    try {
      const frameWindow = app.frame.contentWindow;
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
      app.showReaderError(
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
        (heading) => app.normalizeInlineText(heading.textContent ?? "") === "問題"
      ) ?? null
    );
  }
  
  function scrollFrameToProblemHeading(sourceDocument = app.frameDocument) {
    if (
      !sourceDocument?.body ||
      app.frameDocument !== sourceDocument ||
      !app.frame.contentWindow
    ) {
      return false;
    }
  
    const problemHeading = findProblemHeading(sourceDocument);
    if (problemHeading === null) {
      return false;
    }
  
    try {
      const frameWindow = app.frame.contentWindow;
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
      app.showReaderError(
        "problem-scroll",
        "問題の位置へ移動できません",
        "問題見出しまでscrollできませんでした.",
        error
      );
      return false;
    }
  }
  
  function scheduleFrameProblemScroll(sourceDocument = app.frameDocument) {
    clearFrameProblemScrollTimers();
  
    for (const delay of app.FRAME_PROBLEM_SCROLL_DELAYS_MS) {
      if (delay === 0) {
        scrollFrameToProblemHeading(sourceDocument);
        continue;
      }
  
      const timer = window.setTimeout(() => {
        app.frameProblemScrollTimers = app.frameProblemScrollTimers.filter(
          (scheduledTimer) => scheduledTimer !== timer
        );
        scrollFrameToProblemHeading(sourceDocument);
      }, delay);
      app.frameProblemScrollTimers.push(timer);
    }
  }

  Object.defineProperties(app, {
    checkForNewAnswerResult: { enumerable: false, get: () => checkForNewAnswerResult },
    processAnswerStateChange: { enumerable: false, get: () => processAnswerStateChange },
    attachAnswerStateObserver: { enumerable: false, get: () => attachAnswerStateObserver },
    observeFrameChanges: { enumerable: false, get: () => observeFrameChanges },
    normalizeControlLabel: { enumerable: false, get: () => normalizeControlLabel },
    isNextQuestionLabel: { enumerable: false, get: () => isNextQuestionLabel },
    getNextQuestionURL: { enumerable: false, get: () => getNextQuestionURL },
    suppressNextQuestionControl: { enumerable: false, get: () => suppressNextQuestionControl },
    suppressNextQuestionControlsIn: { enumerable: false, get: () => suppressNextQuestionControlsIn },
    suppressNextQuestionControls: { enumerable: false, get: () => suppressNextQuestionControls },
    clearTimeLimit: { enumerable: false, get: () => clearTimeLimit },
    renderTimeLimit: { enumerable: false, get: () => renderTimeLimit },
    startTimeLimit: { enumerable: false, get: () => startTimeLimit },
    synchronizeTimeLimitPhase: { enumerable: false, get: () => synchronizeTimeLimitPhase },
    expireTimeLimit: { enumerable: false, get: () => expireTimeLimit },
    clearFrameProblemScrollTimers: { enumerable: false, get: () => clearFrameProblemScrollTimers },
    resetFrameScrollToTop: { enumerable: false, get: () => resetFrameScrollToTop },
    findProblemHeading: { enumerable: false, get: () => findProblemHeading },
    scrollFrameToProblemHeading: { enumerable: false, get: () => scrollFrameToProblemHeading },
    scheduleFrameProblemScroll: { enumerable: false, get: () => scheduleFrameProblemScroll },
  });
}
