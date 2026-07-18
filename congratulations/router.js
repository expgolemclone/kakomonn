import manifest from "./celebrations.json";
import {
  chooseCelebration,
  parseMilestone,
  validateManifest,
} from "./site-selection.js";

const STUDY_LOG_URL =
  "https://kakomonn-count-sync.expgolem-lab.workers.dev/";

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
  const selected = chooseCelebration(validated);

  milestoneLabel.textContent = `${milestone}問達成`;
  frame.dataset.siteId = selected.id;
  frame.src = new URL(selected.entry, window.location.href).href;
  frame.addEventListener(
    "load",
    () => {
      document.documentElement.dataset.state = "ready";
      loading.textContent = "祝福を開きました.";
    },
    { once: true },
  );

  studyLogButton.addEventListener("click", () => {
    window.location.replace(STUDY_LOG_URL);
  });
} catch (error) {
  renderError(error);
}
