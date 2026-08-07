const root = document.documentElement;
const eye = document.querySelector("#eye span");
const replay = document.querySelector("#replay");
const confetti = document.querySelector("#confetti");
const sweep = document.querySelector(".sweep");

if (!(eye instanceof HTMLElement) || !(replay instanceof HTMLButtonElement) || !(confetti instanceof HTMLElement) || !(sweep instanceof HTMLElement)) {
  throw new Error("Clearance Officer UI nodes are missing.");
}

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const pieces = 34;

function makeConfetti() {
  confetti.replaceChildren();
  const fragment = document.createDocumentFragment();

  for (let index = 0; index < pieces; index += 1) {
    const piece = document.createElement("i");
    const isAccent = index % 4 === 0;
    piece.style.setProperty("--x", `${(index * 37) % 101}%`);
    piece.style.setProperty("--size", `${6 + ((index * 11) % 9)}px`);
    piece.style.setProperty("--duration", `${1.15 + ((index * 7) % 12) / 10}s`);
    piece.style.setProperty("--delay", `${((index * 13) % 30) / 100}s`);
    piece.style.setProperty("--drift", `${((index * 29) % 180) - 90}px`);
    piece.style.setProperty("--spin", `${((index * 53) % 720) - 360}deg`);
    piece.style.setProperty("--piece-color", isAccent ? "#ff2a2a" : "#eaeaea");
    fragment.append(piece);
  }

  confetti.append(fragment);
}

function fireProtocol() {
  root.classList.remove("is-fired");
  makeConfetti();

  if (!reducedMotion.matches) {
    sweep.animate(
      [
        { left: "-20%", opacity: 0 },
        { opacity: 0.9, offset: 0.15 },
        { left: "120%", opacity: 0 },
      ],
      { duration: 760, easing: "steps(18, end)" },
    );
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => root.classList.add("is-fired"));
  });
}

function trackEye(event) {
  if (reducedMotion.matches) {
    eye.style.transform = "translate(-50%, -50%)";
    return;
  }

  const frame = eye.parentElement?.getBoundingClientRect();
  if (!frame) {
    return;
  }

  const centerX = frame.left + frame.width / 2;
  const centerY = frame.top + frame.height / 2;
  const dx = Math.max(-7, Math.min(7, (event.clientX - centerX) / 26));
  const dy = Math.max(-4, Math.min(4, (event.clientY - centerY) / 30));
  eye.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
}

replay.addEventListener("click", fireProtocol);
window.addEventListener("pointermove", trackEye, { passive: true });
window.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() === "r") {
    fireProtocol();
  }
});

fireProtocol();
