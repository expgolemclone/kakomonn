const festival = document.querySelector("[data-festival]");
const replayButton = document.querySelector("[data-replay]");
const status = document.querySelector("[data-status]");
const sparks = document.querySelector("[data-sparks]");
const soot = document.querySelector("[data-soot]");

if (!festival || !replayButton || !status || !sparks || !soot) {
  throw new Error("Taiko celebration markup is incomplete.");
}

function buildSparks() {
  const palette = ["#c69a45", "#e8ddc7", "#bd4435"];
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < 24; index += 1) {
    const particle = document.createElement("i");
    const angle = (Math.PI * 2 * index) / 24;
    const distance = 120 + (index % 6) * 34;
    particle.style.setProperty("--x", `${Math.cos(angle) * distance}px`);
    particle.style.setProperty("--y", `${Math.sin(angle) * distance * 0.64}px`);
    particle.style.setProperty("--r", `${index * 31}deg`);
    particle.style.setProperty("--w", `${3 + (index % 4)}px`);
    particle.style.setProperty("--h", `${10 + (index % 5) * 4}px`);
    particle.style.setProperty("--c", palette[index % palette.length]);
    particle.style.setProperty("--duration", `${520 + (index % 5) * 55}ms`);
    particle.style.setProperty("--delay", `${420 + (index % 4) * 85}ms`);
    fragment.append(particle);
  }
  sparks.replaceChildren(fragment);
}

function buildSoot() {
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < 18; index += 1) {
    const mote = document.createElement("i");
    mote.style.setProperty("--x", `${8 + ((index * 47) % 86)}%`);
    mote.style.setProperty("--size", `${3 + (index % 5)}px`);
    mote.style.setProperty("--drift", `${-42 + ((index * 29) % 84)}px`);
    mote.style.setProperty("--duration", `${1300 + (index % 6) * 140}ms`);
    mote.style.setProperty("--delay", `${250 + (index % 7) * 90}ms`);
    fragment.append(mote);
  }
  soot.replaceChildren(fragment);
}

function celebrate(announce = false) {
  festival.classList.remove("is-celebrating");
  void festival.offsetWidth;
  festival.classList.add("is-celebrating");

  if (announce) {
    status.textContent = "四本の撥が大太鼓へ叩き込まれ, あなたの達成が地鳴りになりました.";
  }
}

document.title = "地鳴り祝祭, GON";
buildSparks();
buildSoot();
replayButton.addEventListener("click", () => celebrate(true));

festival.dataset.ready = "true";
requestAnimationFrame(() => celebrate(false));
