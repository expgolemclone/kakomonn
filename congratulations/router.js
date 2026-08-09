import manifest from "./celebrations.json";
import {
  chooseCelebrationForMilestone,
  parseMilestone,
  validateManifest,
} from "./site-selection.js";

const STUDY_LOG_URL =
  "https://kakomonn-count-sync.expgolem-lab.workers.dev/";
const READY_MESSAGE = "kakomonn:celebration-ready";
const READY_TIMEOUT_MS = 12_000;

const frame = document.querySelector("#celebration-frame");
const milestoneLabel = document.querySelector("#milestone-label");
const studyLogButton = document.querySelector("#open-study-log");
const loading = document.querySelector("#loading");
const errorPanel = document.querySelector("#error-panel");

if (!frame || !milestoneLabel || !studyLogButton || !loading || !errorPanel) {
  throw new Error("Required celebration shell nodes are missing.");
}

function renderError(error) {
  document.documentElement.dataset.state = "error";
  errorPanel.hidden = false;
  errorPanel.querySelector("p").textContent =
    error instanceof Error ? error.message : "祝福ページを開けません.";
}

try {
  const validated = validateManifest(manifest);
  const milestone = parseMilestone(
    window.location.search,
    validated.milestoneInterval,
  );
  const selected = chooseCelebrationForMilestone(validated, milestone);
  const entryUrl = new URL(selected.entry, window.location.href);
  entryUrl.searchParams.set("milestone", String(milestone));

  milestoneLabel.textContent = `${milestone}問達成`;
  document.title = `${milestone}問達成 | ${selected.label}`;
  frame.title = `${milestone}問達成 - ${selected.label}`;
  frame.dataset.siteId = selected.id;

  const readyTimeout = window.setTimeout(() => {
    renderError(new Error("祝福ページの準備が時間内に完了しませんでした."));
  }, READY_TIMEOUT_MS);

  window.addEventListener(
    "message",
    (event) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== frame.contentWindow ||
        event.data?.type !== READY_MESSAGE ||
        event.data.siteId !== selected.id ||
        event.data.milestone !== milestone
      ) {
        return;
      }
      window.clearTimeout(readyTimeout);
      document.documentElement.dataset.state = "ready";
      loading.textContent = "祝福を開きました.";
      frame.removeAttribute("aria-busy");
    },
    { once: true },
  );

  frame.addEventListener(
    "error",
    () => {
      window.clearTimeout(readyTimeout);
      renderError(new Error("祝福ページを読み込めませんでした."));
    },
    { once: true },
  );
  frame.setAttribute("aria-busy", "true");
  frame.src = entryUrl.href;

  studyLogButton.addEventListener("click", () => {
    window.location.replace(STUDY_LOG_URL);
  });
} catch (error) {
  renderError(error);
}
