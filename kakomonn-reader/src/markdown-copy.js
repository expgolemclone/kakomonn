  const MARKDOWN_BLOCK_TAG_NAMES = new Set([
    ...BLOCK_TAG_NAMES,
    "FIGURE",
  ]);

  function normalizeMarkdown(rawMarkdown) {
    return rawMarkdown
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function markdownURL(element, attributeName) {
    const rawURL = element.getAttribute(attributeName);
    if (!rawURL) {
      return "";
    }

    try {
      const url = new URL(rawURL, element.ownerDocument.baseURI);
      return url.protocol === "https:" ? url.href : "";
    } catch {
      return "";
    }
  }

  function escapeMarkdownLabel(label) {
    return escapeMarkdownText(label);
  }

  function escapeMarkdownText(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\\/g, "\\\\")
      .replace(/[*_`~\[\]]/g, "\\$&")
      .replace(
        /(^|\n)([ \t]*)([-=])(?=[-=]{2,}[ \t]*(?:\n|$))/g,
        "$1$2\\$3"
      )
      .replace(
        /(^|\n)([ \t]*)([#>+-])(?=\s)/g,
        "$1$2\\$3"
      )
      .replace(
        /(^|\n)([ \t]*)(\d+)\.(?=\s)/g,
        "$1$2$3\\."
      );
  }

  function renderMarkdownChildren(element, state) {
    return Array.from(element.childNodes)
      .map((child) => renderMarkdownNode(child, state))
      .join("");
  }

  function renderMarkdownList(element, state) {
    const ordered = element.tagName === "OL";
    const items = Array.from(element.children).filter(
      (child) => child.tagName === "LI"
    );
    const renderedItems = items
      .map((item, index) => {
        const content = normalizeMarkdown(renderMarkdownChildren(item, state));
        if (!content) {
          return "";
        }
        return `${ordered ? `${index + 1}.` : "-"} ${content}`;
      })
      .filter(Boolean);

    return renderedItems.length > 0
      ? `\n\n${renderedItems.join("\n")}\n\n`
      : "";
  }

  function renderMarkdownImage(element, state) {
    const sourceURL = markdownURL(element, "src");
    if (!sourceURL || state.seenImageURLs.has(sourceURL)) {
      return "";
    }
    state.seenImageURLs.add(sourceURL);

    let altText = normalizeInlineText(element.getAttribute("alt") ?? "");
    if (!altText) {
      state.imageNumber += 1;
      altText = `${state.defaultImageLabel} ${state.imageNumber}`;
    }

    return `\n\n![${escapeMarkdownLabel(altText)}](${sourceURL})\n\n`;
  }

  function markdownTableCells(row, state) {
    const cells = [];
    for (const cell of Array.from(row.cells)) {
      const content = normalizeMarkdown(
        renderMarkdownChildren(cell, state)
      )
        .replace(/\|/g, "\\|")
        .replace(/\n+/g, "<br>");
      cells.push(content);

      const columnSpan = Number.parseInt(
        cell.getAttribute("colspan") ?? "1",
        10
      );
      for (
        let index = 1;
        Number.isSafeInteger(columnSpan) && index < columnSpan;
        index += 1
      ) {
        cells.push("");
      }
    }
    return cells;
  }

  function renderMarkdownTable(element, state) {
    const rows = Array.from(element.rows);
    if (rows.length === 0) {
      return "";
    }

    const renderedRows = rows.map((row) =>
      markdownTableCells(row, state)
    );
    const columnCount = Math.max(
      ...renderedRows.map((row) => row.length)
    );
    if (columnCount === 0) {
      return "";
    }
    const normalizedRows = renderedRows.map((row) => [
      ...row,
      ...Array(Math.max(0, columnCount - row.length)).fill(""),
    ]);
    const firstRowIsHeader = Array.from(rows[0].cells).every(
      (cell) => cell.tagName === "TH"
    );
    const header = firstRowIsHeader
      ? normalizedRows.shift()
      : Array(columnCount).fill("");
    const separator = Array(columnCount).fill("---");
    const markdownRows = [header, separator, ...normalizedRows].map(
      (row) => `| ${row.join(" | ")} |`
    );
    return `\n\n${markdownRows.join("\n")}\n\n`;
  }

  function renderMarkdownLink(element, state) {
    const content = normalizeMarkdown(renderMarkdownChildren(element, state));
    const targetURL = markdownURL(element, "href");
    if (!content || !targetURL) {
      return content;
    }
    return `[${content}](${targetURL})`;
  }

  function renderMarkdownNode(node, state) {
    const NodeConstructor = node.ownerDocument.defaultView.Node;
    if (node.nodeType === NodeConstructor.TEXT_NODE) {
      return escapeMarkdownText(node.nodeValue ?? "");
    }
    if (node.nodeType !== NodeConstructor.ELEMENT_NODE) {
      return "";
    }
    if (isHiddenFromRendering(node)) {
      return "";
    }

    if (node.tagName === "IMG") {
      return renderMarkdownImage(node, state);
    }
    if (node.tagName === "BR") {
      return "\n";
    }
    if (node.tagName === "UL" || node.tagName === "OL") {
      return renderMarkdownList(node, state);
    }
    if (node.tagName === "TABLE") {
      return renderMarkdownTable(node, state);
    }
    if (node.tagName === "A") {
      return renderMarkdownLink(node, state);
    }

    const content = renderMarkdownChildren(node, state);
    if (node.tagName === "SUP" || node.tagName === "SUB") {
      const scriptText = normalizeMarkdown(content);
      const tagName = node.tagName.toLowerCase();
      return scriptText
        ? `<${tagName}>${scriptText}</${tagName}>`
        : "";
    }
    if (/^H[1-6]$/.test(node.tagName)) {
      const heading = normalizeMarkdown(content);
      return heading ? `\n\n#### ${heading}\n\n` : "";
    }
    if (node.tagName === "STRONG" || node.tagName === "B") {
      const strongText = normalizeMarkdown(content);
      return strongText ? `**${strongText}**` : "";
    }
    if (node.tagName === "EM" || node.tagName === "I") {
      const emphasizedText = normalizeMarkdown(content);
      return emphasizedText ? `*${emphasizedText}*` : "";
    }
    if (MARKDOWN_BLOCK_TAG_NAMES.has(node.tagName)) {
      return content ? `\n\n${content}\n\n` : "";
    }
    return content;
  }

  function directChild(element, selector) {
    return (
      Array.from(element.children).find((child) =>
        child.matches(selector)
      ) ?? null
    );
  }

  function questionMetadataText(metadataElement) {
    return normalizeInlineText(
      Array.from(metadataElement.childNodes)
        .filter(
          (node) =>
            node.nodeType ===
            metadataElement.ownerDocument.defaultView.Node.TEXT_NODE
        )
        .map((node) => node.nodeValue ?? "")
        .join(" ")
    );
  }

  function markdownState(defaultImageLabel, seenImageURLs) {
    return {
      defaultImageLabel,
      imageNumber: 0,
      seenImageURLs,
    };
  }

  function isSelectedAnswerChoice(control) {
    if (
      control.matches("input[type='radio'], input[type='checkbox']")
    ) {
      return control.checked === true;
    }

    return control.matches("[role='radio'][aria-checked='true']");
  }

  function buildCopyMarkdown(documentNode) {
    if (!documentNode?.body || documentNode.defaultView === null) {
      return { state: "unavailable", markdown: "" };
    }

    if (
      answerResultFromDocument(documentNode) === "unknown" ||
      hasVisibleExplanationLock(getVisibleLines())
    ) {
      return { state: "locked", markdown: "" };
    }

    const problemElement = documentNode.querySelector(".problem_detail");
    const explanationElement =
      documentNode.querySelector("#js-commentary-wrap");
    if (!problemElement || !explanationElement) {
      return { state: "unavailable", markdown: "" };
    }

    const metadataElement = directChild(problemElement, ".when");
    const questionElement = directChild(problemElement, ".ttl");
    const choicesElement = directChild(problemElement, "ul.list");
    const metadataText = metadataElement
      ? questionMetadataText(metadataElement)
      : "";
    if (
      !metadataElement ||
      !questionElement ||
      !choicesElement ||
      !QUESTION_META_PATTERN.test(metadataText)
    ) {
      return { state: "unavailable", markdown: "" };
    }

    const answerButton = findAnswerButtonAfter(metadataElement);
    const choiceElements = Array.from(choicesElement.children).filter(
      (child) => child.matches("li")
    );
    const answerChoiceControls =
      answerButton !== null && problemElement.contains(answerButton)
        ? findAnswerChoiceControls(metadataElement, answerButton)
        : [];
    const selectedAnswerIndexes = answerChoiceControls.reduce(
      (indexes, control, index) => {
        if (isSelectedAnswerChoice(control)) {
          indexes.push(index);
        }
        return indexes;
      },
      []
    );
    if (
      choiceElements.length === 0 ||
      choiceElements.length !== answerChoiceControls.length ||
      selectedAnswerIndexes.length !== 1
    ) {
      return { state: "unavailable", markdown: "" };
    }

    const selectedAnswerIndex = selectedAnswerIndexes[0];
    const selectedAnswerMarkdown = normalizeMarkdown(
      renderMarkdownChildren(
        choiceElements[selectedAnswerIndex],
        markdownState("回答の画像", new Set())
      )
    );
    if (!selectedAnswerMarkdown) {
      return { state: "unavailable", markdown: "" };
    }

    const seenImageURLs = new Set();
    const questionState = markdownState(
      "問題文の画像",
      seenImageURLs
    );
    const questionMarkdown = normalizeMarkdown(
      renderMarkdownNode(questionElement, questionState)
    );
    const questionImagesMarkdown = normalizeMarkdown(
      Array.from(problemElement.children)
        .filter((child) => child.matches(".zoomin"))
        .map((container) =>
          renderMarkdownNode(container, questionState)
        )
        .join("")
    );
    const choicesMarkdown = normalizeMarkdown(
      renderMarkdownNode(choicesElement, questionState)
    );
    if (!questionMarkdown || !choicesMarkdown) {
      return { state: "unavailable", markdown: "" };
    }

    const explanationState = markdownState(
      "解説画像",
      seenImageURLs
    );
    const explanationParts = [];
    const explanationItems = Array.from(
      explanationElement.children
    ).filter((item) => item.matches(".item"));
    if (explanationItems.length === 0) {
      return { state: "unavailable", markdown: "" };
    }

    for (const item of explanationItems) {
      const numberElement = directChild(item, ".num");
      const textElement = directChild(item, ".text");
      if (!numberElement || !textElement) {
        return { state: "unavailable", markdown: "" };
      }

      const number = normalizeInlineText(numberElement.innerText ?? "");
      const text = normalizeMarkdown(
        renderMarkdownChildren(textElement, explanationState)
      );
      if (!/^\d{2}$/.test(number) || !text) {
        return { state: "unavailable", markdown: "" };
      }

      explanationParts.push(`### 解説 ${number}\n\n${text}`);
    }
    const markdown = [
      `# ${escapeMarkdownText(metadataText)}`,
      "## 問題文",
      questionMarkdown,
      questionImagesMarkdown,
      "### 選択肢",
      choicesMarkdown,
      "### 自分の回答",
      `選択肢${selectedAnswerIndex + 1}: ${selectedAnswerMarkdown}`,
      "## 解説",
      ...explanationParts,
    ]
      .filter(Boolean)
      .join("\n\n");

    return { state: "ready", markdown };
  }

  function updateCopyButton() {
    if (nextQuestionOperationInProgress) {
      copyButton.textContent = "解答記録を処理中";
      copyButton.disabled = true;
      return;
    }

    if (!clipboardAPIAvailable()) {
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

    if (copyFeedbackTimer !== null) {
      copyButton.textContent = "コピー済み";
      copyButton.disabled = true;
      return;
    }

    const copyDocument = buildCopyMarkdown(frameDocument);
    if (copyDocument.state === "locked") {
      copyButton.textContent = "回答後にコピー";
      copyButton.disabled = true;
      return;
    }
    if (copyDocument.state !== "ready") {
      copyButton.textContent = "コピー対象を取得不可";
      copyButton.disabled = true;
      return;
    }

    copyButton.textContent = "Markdownをコピー";
    copyButton.disabled = false;
  }

  async function copyReadableSections() {
    const copyDocument = buildCopyMarkdown(frameDocument);
    if (copyDocument.state === "locked") {
      setStatus("回答後にコピーできます");
      updateCopyButton();
      return;
    }
    if (copyDocument.state !== "ready") {
      setStatus("コピー対象を取得できません");
      updateCopyButton();
      return;
    }

    try {
      const copied = await GM.setClipboard(copyDocument.markdown);
      if (copied === false) {
        throw new Error("clipboard write was rejected");
      }
      copyButton.textContent = "コピー済み";
      copyButton.disabled = true;
      setStatus("問題文,自分の回答,解説をMarkdownでコピーしました");
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
