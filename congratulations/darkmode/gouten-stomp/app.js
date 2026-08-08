const stage = document.querySelector("[data-gouten-stage]");
const replayButton = document.querySelector("[data-replay]");
const talismanField = document.querySelector("[data-talismans]");
const milestoneTargets = document.querySelectorAll("[data-milestone]");

if (!(stage instanceof HTMLElement)) {
  throw new Error("Gouten stage is missing.");
}
if (!(replayButton instanceof HTMLButtonElement)) {
  throw new Error("Replay button is missing.");
}
if (!(talismanField instanceof HTMLElement)) {
  throw new Error("Talisman field is missing.");
}

function readMilestone() {
  const raw = new URLSearchParams(window.location.search).get("milestone");
  if (raw === null) {
    return 50;
  }
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new TypeError("milestone must be a positive integer.");
  }
  const milestone = Number(raw);
  if (!Number.isSafeInteger(milestone) || milestone % 50 !== 0) {
    throw new TypeError("milestone must be a positive multiple of 50.");
  }
  return milestone;
}

const milestone = readMilestone();
for (const target of milestoneTargets) {
  target.textContent = String(milestone);
}

document.title = `${milestone}問達成 | 祝砲鬼ゴウテンの勝ち四股`;

const talismanPattern = [
  { x: 60, dx: -310, dy: -470, spin: -220, delay: 510 },
  { x: 64, dx: -240, dy: -560, spin: 190, delay: 535 },
  { x: 68, dx: -175, dy: -430, spin: -150, delay: 560 },
  { x: 72, dx: -90, dy: -600, spin: 260, delay: 520 },
  { x: 76, dx: -20, dy: -500, spin: -320, delay: 575 },
  { x: 80, dx: 65, dy: -580, spin: 230, delay: 545 },
  { x: 84, dx: 145, dy: -450, spin: -180, delay: 590 },
  { x: 88, dx: 225, dy: -535, spin: 300, delay: 525 },
  { x: 92, dx: 285, dy: -410, spin: -240, delay: 565 },
];

const marks = ["正", "解", "積", "祝", "問", "達", "成", "続", "勝"];
for (const [index, pattern] of talismanPattern.entries()) {
  const talisman = document.createElement("span");
  talisman.className = "talisman";
  talisman.textContent = marks[index];
  talisman.style.setProperty("--x", `${pattern.x}%`);
  talisman.style.setProperty("--dx", `${pattern.dx}px`);
  talisman.style.setProperty("--dy", `${pattern.dy}px`);
  talisman.style.setProperty("--spin", `${pattern.spin}deg`);
  talisman.style.setProperty("--delay", `${pattern.delay}ms`);
  talisman.style.setProperty("--r", `${(index % 2 === 0 ? -1 : 1) * (7 + index * 3)}deg`);
  talismanField.append(talisman);
}

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let impactTimer = 0;

function playImpact() {
  window.clearTimeout(impactTimer);
  stage.classList.remove("impacting");
  void stage.offsetWidth;
  stage.classList.add("impacting");
  impactTimer = window.setTimeout(() => stage.classList.remove("impacting"), 1350);
}

replayButton.addEventListener("click", playImpact);

requestAnimationFrame(() => {
  stage.dataset.ready = "true";
  if (!reducedMotion.matches) {
    playImpact();
  }
});
