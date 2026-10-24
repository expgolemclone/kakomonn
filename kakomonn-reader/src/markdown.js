import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import {
  QUESTION_META_PATTERN,
  answerResultFromDocument,
  findAnswerButtonAfter,
  findAnswerChoiceControls,
  hasVisibleExplanationLock,
  isHiddenFromRendering,
  normalizeInlineText,
} from "./content.js";

const service = new TurndownService({
  headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced",
});
service.use(gfm);
service.keep(["sup", "sub"]);

function markdownState(defaultImageLabel, seenImageURLs) {
  return { defaultImageLabel, imageNumber: 0, seenImageURLs };
}

function renderContent(element, state, childrenOnly = false) {
  if (isHiddenFromRendering(element)) return "";
  const clone = element.cloneNode(true);
  function prepare(original, copy) {
    if (original.nodeType !== 1) return;
    if (isHiddenFromRendering(original)) {
      copy.remove();
      return;
    }
    const copiedChildren = Array.from(copy.childNodes);
    for (let index = 0; index < original.childNodes.length; index += 1) {
      prepare(original.childNodes[index], copiedChildren[index]);
    }
    for (const attribute of ["href", "src"]) {
      const raw = original.getAttribute(attribute);
      if (!raw) continue;
      let url;
      try { url = new URL(raw, original.ownerDocument.baseURI); } catch {}
      if (url?.protocol === "https:") copy.setAttribute(attribute, url.href);
      else copy.removeAttribute(attribute);
    }
    if (original.tagName === "IMG") {
      const url = copy.getAttribute("src");
      if (!url || state.seenImageURLs.has(url)) {
        copy.remove();
        return;
      }
      state.seenImageURLs.add(url);
      if (!normalizeInlineText(copy.getAttribute("alt") ?? "")) {
        state.imageNumber += 1;
        copy.setAttribute("alt", `${state.defaultImageLabel} ${state.imageNumber}`);
      }
    }
    if (copy.tagName === "A") {
      const images = original.querySelectorAll("img");
      if (!copy.hasAttribute("href") ||
          (images.length === 1 && !copy.textContent.trim() && original.href === images[0].src)) {
        copy.replaceWith(...copy.childNodes);
      }
    }
  }
  prepare(element, clone);
  const input = childrenOnly ? clone.innerHTML : clone.outerHTML;
  return service.turndown(input).trim();
}

export function directChild(element, selector) {
  return Array.from(element.children).find((child) => child.matches(selector)) ?? null;
}

function questionMetadataText(metadataElement) {
  return normalizeInlineText(
    Array.from(metadataElement.childNodes)
      .filter((node) => node.nodeType === metadataElement.ownerDocument.defaultView.Node.TEXT_NODE)
      .map((node) => node.nodeValue ?? "")
      .join(" "),
  );
}

export function isSelectedAnswerChoice(control) {
  if (control.matches("input[type='radio'], input[type='checkbox']")) {
    return control.checked === true;
  }

  return control.matches("[role='radio'][aria-checked='true']");
}

export function buildCopyMarkdown(documentNode) {
  if (!documentNode?.body || documentNode.defaultView === null) {
    return { state: "unavailable", markdown: "" };
  }

  if (
    answerResultFromDocument(documentNode) === "unknown" ||
    hasVisibleExplanationLock(documentNode)
  ) {
    return { state: "locked", markdown: "" };
  }

  const problemElement = documentNode.querySelector(".problem_detail");
  const explanationElement = documentNode.querySelector("#js-commentary-wrap");
  if (!problemElement || !explanationElement) {
    return { state: "unavailable", markdown: "" };
  }

  const metadataElement = directChild(problemElement, ".when");
  const questionElement = directChild(problemElement, ".ttl");
  const choicesElement = directChild(problemElement, "ul.list");
  const metadataText = metadataElement ? questionMetadataText(metadataElement) : "";
  if (
    !metadataElement ||
    !questionElement ||
    !choicesElement ||
    !QUESTION_META_PATTERN.test(metadataText)
  ) {
    return { state: "unavailable", markdown: "" };
  }

  const answerButton = findAnswerButtonAfter(metadataElement);
  const choiceElements = Array.from(choicesElement.children).filter((child) => child.matches("li"));
  const answerChoiceControls =
    answerButton !== null && problemElement.contains(answerButton)
      ? findAnswerChoiceControls(metadataElement, answerButton)
      : [];
  const selectedAnswerIndexes = answerChoiceControls.reduce((indexes, control, index) => {
    if (isSelectedAnswerChoice(control)) {
      indexes.push(index);
    }
    return indexes;
  }, []);
  if (
    choiceElements.length === 0 ||
    choiceElements.length !== answerChoiceControls.length ||
    selectedAnswerIndexes.length !== 1
  ) {
    return { state: "unavailable", markdown: "" };
  }

  const selectedAnswerIndex = selectedAnswerIndexes[0];
  const selectedAnswerMarkdown = renderContent(choiceElements[selectedAnswerIndex], markdownState("回答の画像", new Set()), true);
  if (!selectedAnswerMarkdown) {
    return { state: "unavailable", markdown: "" };
  }

  const seenImageURLs = new Set();
  const questionState = markdownState("問題文の画像", seenImageURLs);
  const questionMarkdown = renderContent(questionElement, questionState);
  const questionImagesMarkdown = Array.from(problemElement.children)
    .filter((child) => child.matches(".zoomin"))
    .map((container) => renderContent(container, questionState))
    .filter(Boolean).join("\n\n");
  const choicesMarkdown = renderContent(choicesElement, questionState);
  if (!questionMarkdown || !choicesMarkdown) {
    return { state: "unavailable", markdown: "" };
  }

  const explanationState = markdownState("解説画像", seenImageURLs);
  const explanationParts = [];
  const explanationItems = Array.from(explanationElement.children).filter((item) =>
    item.matches(".item"),
  );
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
    const text = renderContent(textElement, explanationState, true);
    if (!/^\d{2}$/.test(number) || !text) {
      return { state: "unavailable", markdown: "" };
    }

    explanationParts.push(`### 解説 ${number}\n\n${text}`);
  }
  const markdown = [
    `# ${service.escape(metadataText)}`,
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
