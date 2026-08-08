import { parseMilestone } from "../../site-selection.js";

const root = document.querySelector("[data-forge]");
const replayButton = document.querySelector("[data-replay]");
const sparks = document.querySelector("[data-sparks]");
const embers = document.querySelector("[data-embers]");
const announcement = document.querySelector("[data-announcement]");
const milestoneNode = document.querySelector("[data-milestone]");

if (!(root instanceof HTMLElement)) {
  throw new Error("Forge celebration root is missing.");
}
if (!(replayButton instanceof HTMLButtonElement)) {
  throw new Error("Replay button is missing.");
}
if (!(sparks instanceof HTMLElement) || !(embers instanceof HTMLElement)) {
  throw new Error("Particle layers are missing.");
}
if (!(announcement instanceof HTMLElement)) {
  throw new Error("Announcement region is missing.");
}
if (!(milestoneNode instanceof SVGTextElement)) {
  throw new Error("Milestone engraving is missing.");
}

const milestone = parseMilestone(window.location.search, 50);
milestoneNode.textContent = String(milestone);
document.title = `${milestone}問達成 | Forge Fury`;

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const sparkPalette = ["#fff3b0", "#ffb22c", "#ff5b2e", "#61f3db", "#ff315a"];
let strikeSequence = 0;
let activeTimers = [];

function clearTimers() {
  for (const timer of activeTimers) {
    window.clearTimeout(timer);
  }
  activeTimers = [];
}

function schedule(callback, delay) {
  const timer = window.setTimeout(callback, delay);
  activeTimers.push(timer);
}

function seedEmbers() {
  embers.replaceChildren();
  if (reducedMotion.matches) {
    return;
  }

  for (let index = 0; index < 24; index += 1) {
    const ember = document.createElement("i");
    ember.className = "ember";
    ember.style.setProperty("--left", `${8 + Math.random() * 88}%`);
    ember.style.setProperty("--size", `${2 + Math.random() * 5}px`);
    ember.style.setProperty("--duration", `${4.8 + Math.random() * 4.4}s`);
    ember.style.setProperty("--delay", `${Math.random() * -8}s`);
    ember.style.setProperty("--drift", `${-70 + Math.random() * 140}px`);
    ember.style.setProperty("--color", sparkPalette[index % sparkPalette.length]);
    embers.append(ember);
  }
}

function seedSparks() {
  sparks.replaceChildren();
  if (reducedMotion.matches) {
    return;
  }

  for (let index = 0; index < 64; index += 1) {
    const spark = document.createElement("i");
    spark.className = "spark-particle";
    spark.style.setProperty("--x", `${67 + (Math.random() - 0.5) * 7}%`);
    spark.style.setProperty("--y", `${73 + (Math.random() - 0.5) * 4}%`);
    spark.style.setProperty("--size", `${2 + Math.random() * 5}px`);
    spark.style.setProperty("--angle", `${Math.random() * 260 - 130}deg`);
    spark.style.setProperty("--distance", `${90 + Math.random() * 250}px`);
    spark.style.setProperty("--duration", `${430 + Math.random() * 430}ms`);
    spark.style.setProperty("--delay", `${420 + Math.random() * 90}ms`);
    spark.style.setProperty("--color", sparkPalette[index % sparkPalette.length]);
    sparks.append(spark);
  }
}

function strike(label = "祝勝打撃") {
  root.classList.remove("is-striking");
  void root.offsetWidth;
  seedSparks();
  root.classList.add("is-striking");
  strikeSequence += 1;
  announcement.textContent = `${label} ${strikeSequence}. GARAが達成を金床へ刻みました.`;

  schedule(() => {
    root.classList.remove("is-striking");
  }, reducedMotion.matches ? 20 : 1080);
}

function runCelebration() {
  clearTimers();
  strikeSequence = 0;
  announcement.textContent = "GARAが祝勝ハンマーを振り上げています.";

  if (reducedMotion.matches) {
    strike("達成確定");
    return;
  }

  strike("第一打");
  schedule(() => strike("第二打"), 900);
  schedule(() => strike("最終打"), 1800);
  schedule(() => {
    announcement.textContent = "達成を焼き入れました. 今夜の成果は確定です.";
  }, 2900);
}

replayButton.addEventListener("click", runCelebration);
reducedMotion.addEventListener("change", () => {
  seedEmbers();
  runCelebration();
});

seedEmbers();
requestAnimationFrame(() => {
  root.dataset.ready = "true";
  schedule(runCelebration, reducedMotion.matches ? 0 : 320);
});
