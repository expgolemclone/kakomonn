const celebration = document.querySelector("[data-celebration-ready]");
const starField = document.querySelector("[data-star-field]");
const replayButton = document.querySelector("[data-replay]");
const status = document.querySelector("[data-status]");

if (!(celebration instanceof HTMLElement)) {
  throw new Error("Celebration root was not found.");
}

if (!(starField instanceof HTMLElement)) {
  throw new Error("Star field was not found.");
}

if (!(replayButton instanceof HTMLButtonElement)) {
  throw new Error("Replay button was not found.");
}

if (!(status instanceof HTMLElement)) {
  throw new Error("Live status was not found.");
}

function createStars() {
  const fragment = document.createDocumentFragment();
  const tones = [
    "oklch(0.91 0.09 195)",
    "oklch(0.82 0.14 290)",
    "oklch(0.88 0.13 330)",
  ];

  for (let index = 0; index < 54; index += 1) {
    const star = document.createElement("i");
    const x = (index * 37 + 11) % 101;
    const y = (index * 61 + 17) % 97;
    const size = 1.5 + ((index * 13) % 27) / 10;
    const opacity = 0.22 + ((index * 17) % 68) / 100;
    star.className = "star";
    star.style.left = `${x}%`;
    star.style.top = `${y}%`;
    star.style.setProperty("--size", `${size}px`);
    star.style.setProperty("--opacity", String(opacity));
    star.style.setProperty("--tone", tones[index % tones.length]);
    star.style.setProperty("--duration", `${2.8 + (index % 6) * 0.7}s`);
    star.style.setProperty("--delay", `${(index % 9) * -0.31}s`);
    fragment.append(star);
  }

  starField.replaceChildren(fragment);
}

function startCelebration(message) {
  celebration.classList.remove("is-replaying");
  celebration.dataset.celebrationReady = "false";

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      celebration.dataset.celebrationReady = "true";
      status.textContent = message;
    });
  });
}

createStars();
startCelebration("管制官MIRAが達成信号を受信しました.");

replayButton.addEventListener("click", () => {
  celebration.classList.add("is-replaying");
  startCelebration("祝福信号を再送信しました. 軌道突破をもう一度確認します.");
});
