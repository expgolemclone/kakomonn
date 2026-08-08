import { parseMilestone } from "../../site-selection.js";

const milestone = parseMilestone(window.location.search, 50);
const milestoneTargets = document.querySelectorAll("[data-milestone]");
const paradeButton = document.querySelector("#parade-button");
const statusMessage = document.querySelector("#status-message");
const confettiLayer = document.querySelector("#confetti-layer");
const stage = document.querySelector(".stage");

if (
  !(paradeButton instanceof HTMLButtonElement) ||
  !(statusMessage instanceof HTMLElement) ||
  !(confettiLayer instanceof HTMLElement) ||
  !(stage instanceof HTMLElement)
) {
  throw new Error("Midnight Orbit markup is incomplete.");
}

for (const target of milestoneTargets) {
  target.textContent = String(milestone);
}
document.title = `Midnight Orbit - ${milestone}問達成`;

const colors = ["#d58a5f", "#b6f0e6", "#6d3bc0", "#f4e8d7"];
let isRunning = false;

function createConfetti(index) {
  const piece = document.createElement("span");
  const left = ((index * 47) % 97) + Math.random() * 3;
  const duration = 1600 + ((index * 83) % 1400);
  const drift = -90 + ((index * 31) % 180);
  const angle = (index * 29) % 180;

  piece.className = "confetti";
  piece.style.left = `${left}%`;
  piece.style.background = colors[index % colors.length];
  piece.style.setProperty("--duration", `${duration}ms`);
  piece.style.setProperty("--drift", `${drift}px`);
  piece.style.setProperty("--angle", `${angle}deg`);
  piece.addEventListener("animationend", () => piece.remove(), { once: true });
  return piece;
}

function launchParade() {
  if (isRunning) {
    return;
  }

  isRunning = true;
  statusMessage.textContent = `軌道 ${milestone} から祝賀信号を送信しました.`;
  stage.classList.add("is-celebrating");

  const fragment = document.createDocumentFragment();
  for (let index = 0; index < 72; index += 1) {
    fragment.append(createConfetti(index));
  }
  confettiLayer.append(fragment);

  window.setTimeout(() => {
    stage.classList.remove("is-celebrating");
    isRunning = false;
  }, 900);
}

paradeButton.addEventListener("click", launchParade);
stage.dataset.celebrationReady = "true";
