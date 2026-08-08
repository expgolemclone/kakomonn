const celebration = document.querySelector("[data-celebration]");
const confettiField = document.querySelector("[data-confetti-field]");
const encoreButton = document.querySelector("[data-encore]");
const character = document.querySelector("[data-character]");

if (!(celebration instanceof HTMLElement)) {
  throw new Error("Celebration root is missing.");
}
if (!(confettiField instanceof HTMLElement)) {
  throw new Error("Confetti field is missing.");
}
if (!(encoreButton instanceof HTMLButtonElement)) {
  throw new Error("Encore button is missing.");
}
if (!(character instanceof HTMLElement)) {
  throw new Error("Character is missing.");
}

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const confettiColors = ["#fff3b5", "#ff4fd8", "#6a43ef", "#d9d4e6", "#63e7ff"];
let encoreTimer = 0;

function createConfettiPiece(index) {
  const piece = document.createElement("i");
  piece.className = "confetti";
  piece.style.setProperty("--x", `${(index * 37 + 11) % 101}%`);
  piece.style.setProperty("--w", `${6 + (index % 5) * 2}px`);
  piece.style.setProperty("--color", confettiColors[index % confettiColors.length]);
  piece.style.setProperty("--r", `${(index * 47) % 180}deg`);
  piece.style.setProperty("--duration", `${1700 + (index % 7) * 170}ms`);
  piece.style.setProperty("--delay", `${(index % 9) * 55}ms`);
  piece.style.setProperty("--drift", `${-90 + (index % 13) * 15}px`);
  return piece;
}

function releaseConfetti() {
  confettiField.replaceChildren();
  if (reducedMotion.matches) {
    return;
  }

  const fragment = document.createDocumentFragment();
  for (let index = 0; index < 48; index += 1) {
    fragment.append(createConfettiPiece(index));
  }
  confettiField.append(fragment);
}

function playEncore() {
  window.clearTimeout(encoreTimer);
  celebration.dataset.encore = "false";
  void celebration.offsetWidth;
  celebration.dataset.encore = "true";
  releaseConfetti();
  encoreTimer = window.setTimeout(() => {
    celebration.dataset.encore = "false";
  }, 1000);
}

function updateGaze(event) {
  if (reducedMotion.matches) {
    return;
  }
  const bounds = character.getBoundingClientRect();
  const relativeX = (event.clientX - (bounds.left + bounds.width / 2)) / bounds.width;
  const relativeY = (event.clientY - (bounds.top + bounds.height * 0.34)) / bounds.height;
  const offsetX = Math.max(-3, Math.min(3, relativeX * 8));
  const offsetY = Math.max(-2, Math.min(2, relativeY * 6));

  for (const pupil of character.querySelectorAll(".pupil")) {
    pupil.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
  }
}

encoreButton.addEventListener("click", playEncore);
window.addEventListener("pointermove", updateGaze, { passive: true });

window.requestAnimationFrame(() => {
  celebration.dataset.ready = "true";
  releaseConfetti();
});
