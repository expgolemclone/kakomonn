  document.documentElement.appendChild(style);

  const shell = document.createElement("div");
  shell.id = "kakomonn-reader-shell";

  const frame = document.createElement("iframe");
  frame.id = "kakomonn-reader-frame";
  frame.title = "過去問ページ";
  frame.allow = "autoplay";
  frame.src = currentFrameURL;
  shell.appendChild(frame);

  const controls = document.createElement("div");
  controls.id = "kakomonn-reader-controls";

  const statusBadge = document.createElement("div");
  statusBadge.id = "kakomonn-reader-status";
  statusBadge.textContent = "ページ読込中";

  const countBadge = document.createElement("div");
  countBadge.id = "kakomonn-reader-count";

  const stopButton = document.createElement("button");
  stopButton.id = "kakomonn-reader-stop";
  stopButton.type = "button";
  stopButton.textContent = "停止";

  controls.append(statusBadge, countBadge, stopButton);

  const nextQuestionButton = document.createElement("button");
  nextQuestionButton.id = "kakomonn-reader-next";
  nextQuestionButton.type = "button";
  nextQuestionButton.textContent = "次の問題へ";
  nextQuestionButton.setAttribute("aria-label", "次の問題へ移動");
  nextQuestionButton.hidden = true;
  nextQuestionButton.disabled = true;

  const copyButton = document.createElement("button");
  copyButton.id = "kakomonn-reader-copy";
  copyButton.type = "button";
  copyButton.textContent = "回答後にコピー";
  copyButton.setAttribute("aria-label", "問題文と解説をコピー");
  copyButton.hidden = true;
  copyButton.disabled = true;

  const startWrap = document.createElement("div");
  startWrap.id = "kakomonn-reader-start-wrap";

  const startButton = document.createElement("button");
  startButton.id = "kakomonn-reader-start";
  startButton.type = "button";
  startButton.textContent = "読み上げを開始";
  if (!speechSupported) {
    startButton.textContent = "読み上げ非対応";
    startButton.disabled = true;
  }
  startWrap.appendChild(startButton);

  document.body.replaceChildren(
    shell,
    controls,
    startWrap,
    copyButton,
    nextQuestionButton
  );

  function renderCount() {
    countBadge.textContent = `${Math.min(count, GOAL)}/${GOAL}`;
  }

  function setStatus(message) {
    statusBadge.textContent = message;
  }

  function syncDailyCount() {
    const state = loadCountState();
    const dateChanged = state.date !== activeCountDate;
    const countChanged = state.count !== count;

    activeCountDate = state.date;
    count = state.count;

    goalCompleted = count >= GOAL;

    if (dateChanged || countChanged) {
      renderCount();
    }

    updateNextQuestionButton();
  }

  function millisecondsUntilNextMidnight(now = new Date()) {
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 0, 0);
    return nextMidnight.getTime() - now.getTime();
  }

  function scheduleDailyReset() {
    if (dailyResetTimer !== null) {
      clearTimeout(dailyResetTimer);
    }

    dailyResetTimer = window.setTimeout(() => {
      dailyResetTimer = null;
      syncDailyCount();
      scheduleDailyReset();
    }, millisecondsUntilNextMidnight());
  }

  function handlePageResume() {
    syncDailyCount();
    scheduleDailyReset();
  }

  function stopSpeech() {
    speechRunId += 1;
    activeUtterance = null;
    if (speechSupported) {
      speech.cancel();
    }
    stopButton.style.display = "none";

    if (speechEnabled) {
      setStatus("待機中");
    }
  }

  function normalizeText(rawText) {
    return rawText
      .replace(/\u00a0/g, " ")
      .split(/\r?\n/)
      .map((line) => line.replace(/[ \t]+/g, " ").trim())
      .filter(Boolean)
      .join("。")
      .replace(/。{2,}/g, "。")
      .trim();
  }

  function getVisibleLines() {
    if (!frameDocument?.body) {
      return [];
    }

    return visibleStructuredText(frameDocument.body)
      .replace(/\u00a0/g, " ")
      .split(/\r?\n/)
      .map((line) => line.replace(/[ \t]+/g, " ").trim())
      .filter(Boolean);
  }

  function compactLine(line) {
    return line.replace(/\s+/g, "").trim();
  }

  function normalizeInlineText(rawText) {
    return rawText
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function findFirstIndex(lines, startIndex, predicate) {
    for (let index = startIndex; index < lines.length; index += 1) {
      if (predicate(lines[index], index)) {
        return index;
      }
    }

    return -1;
  }

  // BEGIN QUESTION EXTRACTION
  const QUESTION_META_PATTERN =
    /^中小企業診断士試験\s*.+?(?:問|第)\s*\d+/;
  const ANSWER_CHOICE_SELECTOR =
    "input[type='radio'], input[type='checkbox'], [role='radio']";
  const BLOCK_TAG_NAMES = new Set([
    "ADDRESS",
    "ARTICLE",
    "ASIDE",
    "BLOCKQUOTE",
    "DD",
    "DIV",
    "DL",
    "DT",
    "FIELDSET",
    "FIGCAPTION",
    "FIGURE",
    "FOOTER",
    "FORM",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "HEADER",
    "HR",
    "LEGEND",
    "LI",
    "MAIN",
    "NAV",
    "OL",
    "P",
    "PRE",
    "SECTION",
    "TABLE",
    "TBODY",
    "TD",
    "TFOOT",
    "TH",
    "THEAD",
    "TR",
    "UL",
  ]);
  const CONTROL_BREAK_TAG_NAMES = new Set([
    "A",
    "BUTTON",
    "INPUT",
    "SELECT",
    "TEXTAREA",
  ]);


  function isVisibleElement(element) {
    const view = element.ownerDocument.defaultView;
    const style = view?.getComputedStyle(element);

    if (style?.display === "none" || style?.visibility === "hidden") {
      return false;
    }

    return element.getClientRects().length > 0;
  }

  function elementDepth(element) {
    let depth = 0;
    let current = element;

    while (current.parentElement) {
      depth += 1;
      current = current.parentElement;
    }

    return depth;
  }

  function findQuestionMetadataElement(documentNode) {
    const candidates = [];
    const checkedElements = new Set();
    const NodeFilterConstructor = documentNode.defaultView.NodeFilter;
    const walker = documentNode.createTreeWalker(
      documentNode.body,
      NodeFilterConstructor.SHOW_TEXT
    );
