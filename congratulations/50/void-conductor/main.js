const stage = document.querySelector("#night-stage");
const field = document.querySelector("#star-field");
const encore = document.querySelector("#encore");

if (!(stage instanceof HTMLElement)) {
  throw new Error("Night stage was not found.");
}
if (!(field instanceof HTMLElement)) {
  throw new Error("Star field was not found.");
}
if (!(encore instanceof HTMLButtonElement)) {
  throw new Error("Encore button was not found.");
}

const palette = ["#8ee7ff", "#c4b5fd", "#fb7185", "#f3f5fb"];
const stars = 42;

for (let index = 0; index < stars; index += 1) {
  const star = document.createElement("span");
  const angle = (index / stars) * Math.PI * 2;
  const distance = 90 + (index % 7) * 20;
  const size = 1 + (index % 4) * 0.7;

  star.className = "star";
  star.style.setProperty("--x", `${(index * 37) % 101}%`);
  star.style.setProperty("--y", `${(index * 53) % 97}%`);
  star.style.setProperty("--size", `${size}px`);
  star.style.setProperty("--opacity", `${0.18 + (index % 5) * 0.11}`);
  star.style.setProperty("--duration", `${3.6 + (index % 6) * 0.7}s`);
  star.style.setProperty("--delay", `${-(index % 8) * 0.37}s`);
  star.style.setProperty("--drift-x", `${((index % 5) - 2) * 5}px`);
  star.style.setProperty("--drift-y", `${-7 - (index % 4) * 3}px`);
  star.style.setProperty("--star-color", palette[index % palette.length]);
  star.style.setProperty("--burst-delay", `${(index % 9) * 0.018}s`);
  star.style.setProperty("--burst-x", `${Math.cos(angle) * distance}px`);
  star.style.setProperty("--burst-y", `${Math.sin(angle) * distance}px`);
  field.append(star);
}

let replayTimer = 0;

function replayApplause() {
  window.clearTimeout(replayTimer);
  stage.classList.remove("is-encore");
  void stage.offsetWidth;
  stage.classList.add("is-encore");
  replayTimer = window.setTimeout(() => {
    stage.classList.remove("is-encore");
  }, 1400);
}

encore.addEventListener("click", replayApplause);
requestAnimationFrame(() => {
  stage.dataset.ready = "true";
});
