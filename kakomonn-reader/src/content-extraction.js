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
  const QUESTION_META_PATTERN = /(?:問\s*\d+|第\s*\d+)/;
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

  function findQuestionMetadataElement(documentNode) {
    const candidates = Array.from(
      documentNode.querySelectorAll(".problem_detail > .when")
    ).filter((element) => {
      const text = normalizeInlineText(element.innerText ?? "");
      const problemElement = element.closest(".problem_detail");
      const answerButton = findAnswerButtonAfter(element);
      return (
        text.length > 0 &&
        text.length <= 220 &&
        QUESTION_META_PATTERN.test(text) &&
        isVisibleElement(element) &&
        problemElement !== null &&
        answerButton !== null &&
        problemElement.contains(answerButton)
      );
    });

    return candidates.length === 1 ? candidates[0] : null;
  }

  function isFollowingNode(referenceNode, candidateNode) {
    const NodeConstructor = referenceNode.ownerDocument.defaultView.Node;
    return Boolean(
      referenceNode.compareDocumentPosition(candidateNode) &
        NodeConstructor.DOCUMENT_POSITION_FOLLOWING
    );
  }

  function findAnswerButtonAfter(metadataElement) {
    const controls = metadataElement.ownerDocument.querySelectorAll(
      "a, button, input[type='button'], input[type='submit']"
    );

    for (const control of controls) {
      if (!isFollowingNode(metadataElement, control)) {
        continue;
      }

      const label = normalizeInlineText(
        control.innerText ||
          control.textContent ||
          control.value ||
          control.getAttribute("aria-label") ||
          ""
      ).replace(/\s+/g, "");

      if (label === "解答する") {
        return control;
      }
    }

    return null;
  }

  function findAnswerChoiceControls(metadataElement, answerButton) {
    const controls = [];

    for (const control of metadataElement.ownerDocument.querySelectorAll(
      ANSWER_CHOICE_SELECTOR
    )) {
      if (
        isFollowingNode(metadataElement, control) &&
        isFollowingNode(control, answerButton)
      ) {
        controls.push(control);
      }
    }

    return controls;
  }

  const NON_READABLE_SELECTOR =
    "script, style, noscript, template, [hidden], [aria-hidden='true'], [inert]";

  function isHiddenFromRendering(element) {
    if (element.matches(NON_READABLE_SELECTOR)) {
      return true;
    }

    const view = element.ownerDocument.defaultView;
    const style = view?.getComputedStyle(element);
    if (!style) {
      return false;
    }

    return (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.contentVisibility === "hidden" ||
      style.opacity === "0"
    );
  }

  function isRenderedTextNode(textNode) {
    if (!normalizeInlineText(textNode.nodeValue ?? "")) {
      return false;
    }

    const range = textNode.ownerDocument.createRange();
    range.selectNodeContents(textNode);
    const isRendered = range.getClientRects().length > 0;
    range.detach?.();
    return isRendered;
  }

  function visibleStructuredText(rootNode) {
    const parts = [];
    const documentNode =
      rootNode.nodeType === rootNode.DOCUMENT_NODE
        ? rootNode
        : rootNode.ownerDocument;
    const NodeConstructor = documentNode.defaultView.Node;

    function appendBreak() {
      if (parts.length > 0 && parts.at(-1) !== "\n") {
        parts.push("\n");
      }
    }

    function visit(node) {
      if (node.nodeType === NodeConstructor.TEXT_NODE) {
        if (isRenderedTextNode(node)) {
          parts.push(node.nodeValue ?? "");
        }
        return;
      }

      if (node.nodeType !== NodeConstructor.ELEMENT_NODE) {
        for (const child of node.childNodes) {
          visit(child);
        }
        return;
      }

      if (isHiddenFromRendering(node)) {
        return;
      }

      if (node.tagName === "BR") {
        appendBreak();
        return;
      }

      const createsBreak =
        BLOCK_TAG_NAMES.has(node.tagName) ||
        CONTROL_BREAK_TAG_NAMES.has(node.tagName);
      if (createsBreak) {
        appendBreak();
      }

      for (const child of node.childNodes) {
        visit(child);
      }

      if (createsBreak) {
        appendBreak();
      }
    }

    visit(rootNode);
    return parts.join("");
  }

  function extractQuestionTextFromDocument(documentNode) {
    if (!documentNode?.body) {
      return "";
    }

    const metadataElement = findQuestionMetadataElement(documentNode);
    if (!metadataElement) {
      return "";
    }

    const answerButton = findAnswerButtonAfter(metadataElement);
    if (!answerButton) {
      return "";
    }

    const problemElement = metadataElement.closest(".problem_detail");
    if (!problemElement || !problemElement.contains(answerButton)) {
      return "";
    }

    const questionElement =
      Array.from(problemElement.children).find((child) =>
        child.matches(".ttl")
      ) ?? null;
    const choicesElement =
      Array.from(problemElement.children).find((child) =>
        child.matches("ul.list")
      ) ?? null;
    if (
      !questionElement ||
      !choicesElement ||
      !isFollowingNode(metadataElement, questionElement) ||
      !isFollowingNode(questionElement, choicesElement) ||
      !isFollowingNode(choicesElement, answerButton)
    ) {
      return "";
    }

    const choiceControls = findAnswerChoiceControls(
      metadataElement,
      answerButton
    );
    const choiceElements = Array.from(choicesElement.children).filter(
      (child) => child.matches("li")
    );
    if (
      choiceElements.length < 2 ||
      choiceElements.length !== choiceControls.length
    ) {
      return "";
    }

    const text = normalizeText(visibleStructuredText(questionElement));
    if (!text) {
      return "";
    }

    return text;
  }
  // END QUESTION EXTRACTION

  function extractQuestionText() {
    return extractQuestionTextFromDocument(frameDocument);
  }

  const EXPLANATION_LOCK_TEXT = "解説は問題に回答すると表示されます";

  function normalizePageStateText(rawText) {
    return compactLine(rawText).replace(/[。．]+$/u, "");
  }

  function hasVisibleExplanationLock(lines) {
    for (let startIndex = 0; startIndex < lines.length; startIndex += 1) {
      let combinedText = "";

      for (
        let lineOffset = 0;
        lineOffset < 3 && startIndex + lineOffset < lines.length;
        lineOffset += 1
      ) {
        combinedText += normalizePageStateText(
          lines[startIndex + lineOffset]
        );

        if (combinedText === EXPLANATION_LOCK_TEXT) {
          return true;
        }

        if (!EXPLANATION_LOCK_TEXT.startsWith(combinedText)) {
          break;
        }
      }
    }

    return false;
  }

  function isExplanationHeading(line) {
    return /^この過去問の解説(?:（\d+件）)?$/.test(compactLine(line));
  }

  function isExplanationEnd(line) {
    const compact = compactLine(line);
    return (
      compact.startsWith("（訂正依頼・報告はこちら）") ||
      /^前の問題(?:（問\d+）)?へ$/.test(compact) ||
      /^令和.+問題一覧$/.test(compact) ||
      compact === "TOP"
    );
  }

  function isExplanationNoise(line) {
    const compact = compactLine(line);
    return (
      compact === "解答結果" ||
      compact === "解説は問題に回答すると" ||
      compact === "表示されます。" ||
      compact === "表示されます" ||
      /^\d{2}$/.test(compact) ||
      /^参考になった数\d+$/.test(compact) ||
      compact === "参考になった" ||
      compact === "参考にならなかった" ||
      compact === "この解説の修正を提案する" ||
      compact.toLowerCase() === "advertisement" ||
      compact === "次の問題は下へ"
    );
  }

  function extractExplanationText(lines) {
    const headingIndex = findFirstIndex(lines, 0, isExplanationHeading);
    if (headingIndex < 0) {
      return "";
    }

    const endIndex = findFirstIndex(lines, headingIndex + 1, isExplanationEnd);
    if (endIndex < 0) {
      return "";
    }

    const explanationLines = lines
      .slice(headingIndex + 1, endIndex)
      .filter((line) => !isExplanationNoise(line));

    return normalizeText(explanationLines.join("\n"));
  }

  function extractReadableSections() {
    const lines = getVisibleLines();
    const explanationLocked =
      getCurrentAnswerResult() === "unknown" ||
      hasVisibleExplanationLock(lines);

    return {
      questionText: extractQuestionText(),
      explanationText: explanationLocked ? "" : extractExplanationText(lines),
    };
  }

  function splitText(text) {
    const sentences = text.match(/[^。！？!?]+[。！？!?]?/g) ?? [];
    const chunks = [];
    let current = "";

    for (const sentence of sentences) {
      if ((current + sentence).length <= MAX_CHUNK_LENGTH) {
        current += sentence;
        continue;
      }

      if (current) {
        chunks.push(current);
        current = "";
      }

      if (sentence.length <= MAX_CHUNK_LENGTH) {
        current = sentence;
        continue;
      }

      for (
        let offset = 0;
        offset < sentence.length;
        offset += MAX_CHUNK_LENGTH
      ) {
        chunks.push(sentence.slice(offset, offset + MAX_CHUNK_LENGTH));
      }
    }

    if (current) {
      chunks.push(current);
    }

    return chunks;
  }

