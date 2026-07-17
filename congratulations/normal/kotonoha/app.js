import { gsap } from "gsap";

const root = document.querySelector(".celebration");
const status = document.querySelector("#status");
const title = document.querySelector("#hero-title");
const replayButton = document.querySelector("#replay");
const boostButton = document.querySelector("#boost");
const confettiLayer = document.querySelector("#confetti");

if (!root || !status || !title || !replayButton || !boostButton || !confettiLayer) {
  throw new Error("Required celebration DOM nodes are missing.");
}

const TITLE_TEXT = "CONGRATULATIONS!!!";
const CONFETTI_COLORS = ["#ff5aa9", "#54d7ff", "#ffe889", "#ffffff", "#bd8cff"];
let introTimeline;
let danceTimeline;
let boostActive = false;

function renderTitle() {
  const fragment = document.createDocumentFragment();
  for (const character of TITLE_TEXT) {
    const span = document.createElement("span");
    span.className = "char";
    span.textContent = character;
    span.setAttribute("aria-hidden", "true");
    fragment.append(span);
  }
  title.replaceChildren(fragment);
}

function renderConfetti(count = 96) {
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < count; index += 1) {
    const piece = document.createElement("i");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = CONFETTI_COLORS[index % CONFETTI_COLORS.length];
    piece.style.borderRadius = index % 4 === 0 ? "50%" : "2px";
    fragment.append(piece);
  }
  confettiLayer.replaceChildren(fragment);
}

function createIntroTimeline() {
  introTimeline?.kill();
  root.dataset.intro = "running";
  introTimeline = gsap.timeline({
    defaults: { ease: "power3.out" },
    onComplete: () => {
      root.dataset.intro = "complete";
    },
  });

  introTimeline
    .set(".speech", { autoAlpha: 0, scale: 0.6 })
    .fromTo(".eyebrow", { autoAlpha: 0, y: -24 }, { autoAlpha: 1, y: 0, duration: 0.55 })
    .fromTo(
      ".hero-title .char",
      { autoAlpha: 0, y: 130, rotation: () => gsap.utils.random(-22, 22), scale: 0.2 },
      {
        autoAlpha: 1,
        y: 0,
        rotation: 0,
        scale: 1,
        duration: 0.9,
        ease: "back.out(2.2)",
        stagger: { each: 0.045, from: "center" },
      },
      "-=0.18",
    )
    .fromTo(".hero-copy", { autoAlpha: 0, y: 22 }, { autoAlpha: 1, y: 0, duration: 0.7 }, "-=0.38")
    .fromTo(
      ".character-card--akane",
      { autoAlpha: 0, xPercent: -70, rotation: -18, scale: 0.55 },
      { autoAlpha: 1, xPercent: 0, rotation: 0, scale: 1, duration: 1.05, ease: "elastic.out(1, 0.45)" },
      "-=0.6",
    )
    .fromTo(
      ".character-card--aoi",
      { autoAlpha: 0, xPercent: 70, rotation: 18, scale: 0.55 },
      { autoAlpha: 1, xPercent: 0, rotation: 0, scale: 1, duration: 1.05, ease: "elastic.out(1, 0.45)" },
      "<0.08",
    )
    .to(".speech", {
      autoAlpha: 1,
      scale: 1,
      duration: 0.48,
      ease: "back.out(2.4)",
      stagger: 0.12,
    }, "-=0.45")
    .fromTo(
      ".controls",
      { autoAlpha: 0, y: 20 },
      { autoAlpha: 1, y: 0, duration: 0.5 },
      "-=0.3",
    );

  return introTimeline;
}

function createDanceTimeline() {
  danceTimeline?.kill();
  danceTimeline = gsap.timeline({ repeat: -1, repeatRefresh: true });

  danceTimeline
    .to(".character-card--akane", {
      xPercent: () => gsap.utils.random(-6, 6),
      yPercent: () => gsap.utils.random(-7, -2),
      rotation: () => gsap.utils.random(-8, 8),
      duration: 0.22,
      ease: "power1.inOut",
    })
    .to(".character-card--akane", {
      xPercent: () => gsap.utils.random(-5, 5),
      yPercent: 0,
      rotation: () => gsap.utils.random(-7, 7),
      duration: 0.2,
      ease: "power1.inOut",
    })
    .to(".character-card--aoi", {
      xPercent: () => gsap.utils.random(-6, 6),
      yPercent: () => gsap.utils.random(-7, -2),
      rotation: () => gsap.utils.random(-8, 8),
      duration: 0.22,
      ease: "power1.inOut",
    }, 0)
    .to(".character-card--aoi", {
      xPercent: () => gsap.utils.random(-5, 5),
      yPercent: 0,
      rotation: () => gsap.utils.random(-7, 7),
      duration: 0.2,
      ease: "power1.inOut",
    }, 0.22);

  gsap.to(".arm--left", {
    rotation: -18,
    transformOrigin: "100% 100%",
    duration: 0.18,
    ease: "sine.inOut",
    repeat: -1,
    yoyo: true,
  });

  gsap.to(".arm--right", {
    rotation: 18,
    transformOrigin: "0% 100%",
    duration: 0.16,
    ease: "sine.inOut",
    repeat: -1,
    yoyo: true,
  });

  gsap.to(".character-shadow", {
    scaleX: 0.72,
    opacity: 0.3,
    duration: 0.22,
    repeat: -1,
    yoyo: true,
    ease: "sine.inOut",
  });

  gsap.to(".speech", {
    y: () => gsap.utils.random(-12, 12),
    rotation: () => gsap.utils.random(-4, 4),
    duration: () => gsap.utils.random(0.8, 1.4),
    repeat: -1,
    yoyo: true,
    ease: "sine.inOut",
    stagger: 0.08,
  });

  return danceTimeline;
}

function animateBackground() {
  gsap.to(".aurora", {
    rotation: 352,
    duration: 26,
    ease: "none",
    repeat: -1,
  });

  gsap.to(".spotlight--left", {
    rotation: 7,
    duration: 1.4,
    repeat: -1,
    yoyo: true,
    ease: "sine.inOut",
  });

  gsap.to(".spotlight--right", {
    rotation: -7,
    duration: 1.5,
    repeat: -1,
    yoyo: true,
    ease: "sine.inOut",
  });

  gsap.to(".rings span", {
    scale: 1.18,
    opacity: 0,
    duration: 2.6,
    repeat: -1,
    ease: "power1.out",
    stagger: 0.36,
  });

  gsap.to(".praise-track", {
    xPercent: -50,
    duration: 18,
    repeat: -1,
    ease: "none",
  });
}

function burstConfetti(multiplier = 1) {
  const pieces = gsap.utils.toArray(".confetti-piece");
  gsap.killTweensOf(pieces);
  gsap.set(pieces, {
    y: -120,
    x: 0,
    autoAlpha: 1,
    rotation: 0,
    scale: () => gsap.utils.random(0.65, 1.35),
  });

  gsap.to(pieces, {
    y: () => window.innerHeight + gsap.utils.random(140, 460),
    x: () => gsap.utils.random(-220, 220),
    rotation: () => gsap.utils.random(-900, 900),
    duration: () => gsap.utils.random(2.8, 5.2) / multiplier,
    delay: () => gsap.utils.random(0, 1.2 / multiplier),
    ease: "none",
    stagger: 0.003,
    onComplete: () => gsap.set(pieces, { autoAlpha: 0 }),
  });
}

function pulseTitle() {
  gsap.fromTo(
    ".hero-title .char",
    { y: 0, scale: 1 },
    {
      y: () => gsap.utils.random(-18, 18),
      scale: () => gsap.utils.random(0.88, 1.2),
      duration: 0.18,
      repeat: 3,
      yoyo: true,
      ease: "power1.inOut",
      stagger: { each: 0.015, from: "random" },
    },
  );
}

function replayCelebration() {
  status.textContent = "もう一度,全力で祝福しています.";
  createIntroTimeline().restart();
  burstConfetti(boostActive ? 1.65 : 1);
  pulseTitle();
  window.setTimeout(() => {
    status.textContent = "";
  }, 2200);
}

function setBoost(active) {
  boostActive = active;
  boostButton.setAttribute("aria-pressed", String(active));
  boostButton.textContent = active ? "祝福MAX中" : "祝福MAX";
  danceTimeline.timeScale(active ? 2.15 : 1);
  gsap.to(".aurora", { opacity: active ? 1 : 0.72, duration: 0.35 });
  gsap.to(".character", { filter: active ? "drop-shadow(0 0 32px rgba(255,255,255,.45))" : "drop-shadow(0 24px 26px rgba(0,0,0,.35))", duration: 0.35 });
  burstConfetti(active ? 1.8 : 1);
  pulseTitle();
  status.textContent = active ? "祝福MAXです.拍手が止まりません." : "通常の祝福へ戻りました.";
  window.setTimeout(() => {
    status.textContent = "";
  }, 1800);
}

function bindPointerParallax() {
  const moveX = gsap.quickTo(".stage", "x", { duration: 0.55, ease: "power3.out" });
  const moveY = gsap.quickTo(".stage", "y", { duration: 0.55, ease: "power3.out" });

  window.addEventListener("pointermove", (event) => {
    const xRatio = event.clientX / window.innerWidth - 0.5;
    const yRatio = event.clientY / window.innerHeight - 0.5;
    moveX(xRatio * 20);
    moveY(yRatio * 12);
  });
}

renderTitle();
renderConfetti();
createIntroTimeline();
createDanceTimeline();
animateBackground();
burstConfetti();
bindPointerParallax();

replayButton.addEventListener("click", replayCelebration);
boostButton.addEventListener("click", () => setBoost(!boostActive));
