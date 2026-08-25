import manifest from "./celebrations.json" with { type: "json" };
import { parseCelebration } from "./celebration-contract.js";
import { chooseCelebration, validateManifest } from "./celebration-selection.js";

const STUDY_LOG_URL = "https://kakomonn-sync.kakomonn.workers.dev/";
const READY_MESSAGE = "kakomonn:celebration-ready";
const READY_TIMEOUT_MS = 12_000;

const frame = document.querySelector("#celebration-frame");
const achievementLabel = document.querySelector("#achievement-label");
const studyLogButton = document.querySelector("#open-study-log");
const loading = document.querySelector("#loading");
const errorPanel = document.querySelector("#error-panel");

if (!frame || !achievementLabel || !studyLogButton || !loading || !errorPanel) {
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
  errorPanel.hidden = false;
  errorPanel.querySelector("p").textContent =
    error instanceof Error ? error.message : "祝福pageを開けません.";
}

try {
  const celebration = parseCelebration(window.location.search);
  const selected = chooseCelebration(validateManifest(manifest));
  const entryUrl = new URL(selected.entry, window.location.href);
  entryUrl.search = window.location.search;

  achievementLabel.textContent = "dueCardsCompleted 達成";
  document.title = `dueCardsCompleted達成 | ${selected.label}`;
  frame.title = `dueCardsCompleted達成 - ${selected.label}`;
  frame.dataset.experienceId = selected.id;

  const readyTimeout = window.setTimeout(() => {
    renderError(new Error("祝福pageの準備が時間内に完了しませんでした."));
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
      loading.textContent = "祝福を開きました.";
      frame.removeAttribute("aria-busy");
    };
  window.addEventListener("message", handleReady);

  frame.src = entryUrl.href;
  studyLogButton.addEventListener("click", () => window.location.assign(STUDY_LOG_URL));
} catch (error) {
  renderError(error);
}
