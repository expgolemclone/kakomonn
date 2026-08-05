    for (let textNode = walker.nextNode(); textNode; textNode = walker.nextNode()) {
      if (!normalizeInlineText(textNode.nodeValue ?? "").includes(
        "中小企業診断士試験"
      )) {
        continue;
      }

      let element = textNode.parentElement;
      for (let level = 0; element && level < 6; level += 1) {
        if (checkedElements.has(element)) {
          element = element.parentElement;
          continue;
        }
        checkedElements.add(element);

        const text = normalizeInlineText(element.innerText ?? "");
        if (
          text.length > 0 &&
          text.length <= 220 &&
          QUESTION_META_PATTERN.test(text) &&
          isVisibleElement(element)
        ) {
          candidates.push({
            element,
            textLength: text.length,
            depth: elementDepth(element),
          });
        }

        element = element.parentElement;
      }
    }

    candidates.sort(
      (left, right) =>
        left.textLength - right.textLength || right.depth - left.depth
    );

    return candidates[0]?.element ?? null;
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
