const root = document.querySelector("#night-vault");
const replayButton = document.querySelector("[data-replay]");
const milestoneNode = document.querySelector("[data-milestone]");
const clockNode = document.querySelector("[data-clock]");

if (!(root instanceof HTMLElement)) {
  throw new Error("Night examiner root is missing.");
}
if (!(replayButton instanceof HTMLButtonElement)) {
  throw new Error("Replay button is missing.");
}
if (!(milestoneNode instanceof HTMLElement)) {
  throw new Error("Milestone node is missing.");
}
if (!(clockNode instanceof HTMLElement)) {
  throw new Error("Clock node is missing.");
}

const NIGHT_EXAMINER_MILESTONE = 150;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function readMilestone(search) {
  const raw = new URLSearchParams(search).get("milestone");
  if (raw === null || !/^[1-9]\d*$/.test(raw)) {
    return null;
  }
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

function resolveMilestone() {
  const ownMilestone = readMilestone(window.location.search);
  if (ownMilestone !== null) {
    if (ownMilestone !== NIGHT_EXAMINER_MILESTONE) {
      throw new Error("Night examiner is reserved for the 150-question milestone.");
    }
    return ownMilestone;
  }

  if (window.parent !== window) {
    const parentMilestone = readMilestone(window.parent.location.search);
    if (parentMilestone !== NIGHT_EXAMINER_MILESTONE) {
      throw new Error("Night examiner requires the 150-question milestone.");
    }
    return parentMilestone;
  }

  return NIGHT_EXAMINER_MILESTONE;
}

function renderClock() {
  clockNode.textContent = new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}

function updateGaze(event) {
  if (reducedMotion.matches) {
    return;
  }
  const x = event.clientX / window.innerWidth - 0.5;
  const y = event.clientY / window.innerHeight - 0.5;
  root.style.setProperty("--gaze-x", `${x * 7}px`);
  root.style.setProperty("--gaze-y", `${y * 5}px`);
  root.style.setProperty("--tilt-x", `${x * 2.2}deg`);
  root.style.setProperty("--tilt-y", `${y * -1.7}deg`);
}

function replayCelebration() {
  if (reducedMotion.matches) {
    root.classList.add("is-armed");
    window.setTimeout(() => root.classList.remove("is-armed"), 32);
    return;
  }

  root.classList.add("is-replaying");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root.classList.remove("is-replaying");
      root.classList.add("is-armed");
      window.setTimeout(() => root.classList.remove("is-armed"), 1800);
    });
  });
}

milestoneNode.textContent = String(resolveMilestone());
renderClock();
window.setInterval(renderClock, 1000);
window.addEventListener("pointermove", updateGaze, { passive: true });
replayButton.addEventListener("click", replayCelebration);

requestAnimationFrame(() => {
  root.dataset.ready = "true";
});
