import manifest from "./celebrations.json" with { type: "json" };
import { parseCelebration } from "./shared/celebration-contract.js";
import { chooseCelebration, validateManifest } from "./celebration-selection.js";

const READY_MESSAGE = "kakomonn:celebration-ready";
const READY_TIMEOUT_MS = 12_000;

const frame = document.querySelector("#celebration-frame");
const loading = document.querySelector("#loading");
const errorPanel = document.querySelector("#error-panel");

if (!frame || !loading || !errorPanel) {
  throw new Error("Required celebration shell nodes are missing.");
}

function sameCelebration(left, right) {
  return (
    left?.site === right.site &&
    left?.date === right.date &&
    left?.dueCardsCompleted === right.dueCardsCompleted
  );
}

function renderError(error) {
  document.documentElement.dataset.state = "error";
  loading.hidden = true;
  frame.hidden = true;
  errorPanel.hidden = false;
  errorPanel.querySelector("p").textContent =
    error instanceof Error ? error.message : "The celebration could not be opened.";
}

try {
  const celebration = parseCelebration(window.location.search);
  const validatedManifest = validateManifest(manifest);
  if (validatedManifest.experiences.length === 0) {
    throw new Error("No celebration experiences are installed.");
  }
  const selected = chooseCelebration(validatedManifest);
  const entryUrl = new URL(selected.entry, window.location.href);
  entryUrl.search = window.location.search;

  document.title = `dueCardsCompleted achieved | ${selected.label}`;
  frame.title = `dueCardsCompleted celebration - ${selected.label}`;
  frame.dataset.experienceId = selected.id;

  const readyTimeout = window.setTimeout(() => {
    renderError(new Error("The celebration took too long to get ready."));
  }, READY_TIMEOUT_MS);

  const handleReady = (event) => {
    if (
      event.origin !== window.location.origin ||
      event.source !== frame.contentWindow ||
      event.data?.type !== READY_MESSAGE ||
      event.data.siteId !== selected.id ||
      !sameCelebration(event.data.celebration, celebration)
    ) {
      return;
    }
    window.removeEventListener("message", handleReady);
    window.clearTimeout(readyTimeout);
    document.documentElement.dataset.state = "ready";
    loading.hidden = true;
    frame.hidden = false;
    frame.removeAttribute("aria-busy");
  };
  window.addEventListener("message", handleReady);

  frame.src = entryUrl.href;
} catch (error) {
  renderError(error);
}
