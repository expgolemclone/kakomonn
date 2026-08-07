const SVG_NS = "http://www.w3.org/2000/svg";
const experience = document.querySelector("[data-night-archivist]");
const starMap = document.querySelector("[data-star-map]");
const starLines = document.querySelector("[data-star-lines]");
const stars = document.querySelector("[data-stars]");
const replayButton = document.querySelector("[data-replay]");
const announcement = document.querySelector("[data-announcement]");
const parallaxTarget = document.querySelector("[data-parallax]");

if (
  !(experience instanceof HTMLElement) ||
  !(starMap instanceof SVGSVGElement) ||
  !(starLines instanceof SVGGElement) ||
  !(stars instanceof SVGGElement) ||
  !(replayButton instanceof HTMLButtonElement) ||
  !(announcement instanceof HTMLElement) ||
  !(parallaxTarget instanceof HTMLElement)
) {
  throw new Error("Night Archivist markup is incomplete.");
}

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const points = [
  [82, 316],
  [126, 232],
  [189, 274],
  [228, 168],
  [293, 218],
  [358, 126],
  [401, 224],
  [443, 302],
  [351, 350],
  [271, 318],
  [210, 399],
  [128, 378],
];

function createSvgElement(name, attributes) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

function lineLength([x1, y1], [x2, y2]) {
  return Math.hypot(x2 - x1, y2 - y1).toFixed(2);
}

function drawConstellation() {
  starLines.replaceChildren();
  stars.replaceChildren();

  for (let index = 0; index < points.length - 1; index += 1) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[index + 1];
    const length = lineLength(points[index], points[index + 1]);
    const line = createSvgElement("line", {
      class: "star-line",
      x1,
      y1,
      x2,
      y2,
    });
    line.style.setProperty("--line-length", length);
    line.style.setProperty("--delay", `${180 + index * 105}ms`);
    starLines.append(line);
  }

  const lastPoint = points[points.length - 1];
  const closingLength = lineLength(lastPoint, points[0]);
  const closingLine = createSvgElement("line", {
    class: "star-line",
    x1: lastPoint[0],
    y1: lastPoint[1],
    x2: points[0][0],
    y2: points[0][1],
  });
  closingLine.style.setProperty("--line-length", closingLength);
  closingLine.style.setProperty("--delay", `${180 + (points.length - 1) * 105}ms`);
  starLines.append(closingLine);

  points.forEach(([cx, cy], index) => {
    const star = createSvgElement("circle", {
      class: "star-node",
      cx,
      cy,
      r: index % 4 === 0 ? 6.5 : 4,
      "data-accent": index % 5 === 0 ? "gold" : index % 3 === 0 ? "mint" : "ink",
    });
    star.style.setProperty("--delay", `${90 + index * 105}ms`);
    stars.append(star);
  });
}

function replay() {
  experience.classList.remove("is-replaying");
  void experience.offsetWidth;
  experience.classList.add("is-replaying");
  drawConstellation();
  announcement.textContent = "星図を再生しています.";
  window.setTimeout(() => {
    announcement.textContent = "記録完了. 星図は保存されました.";
  }, prefersReducedMotion.matches ? 0 : 1_650);
}

function handlePointerMove(event) {
  if (prefersReducedMotion.matches) {
    return;
  }
  const x = (event.clientX / window.innerWidth - 0.5) * 12;
  const y = (event.clientY / window.innerHeight - 0.5) * 9;
  parallaxTarget.style.setProperty("--parallax-x", `${x.toFixed(2)}px`);
  parallaxTarget.style.setProperty("--parallax-y", `${y.toFixed(2)}px`);
}

replayButton.addEventListener("click", replay);
window.addEventListener("pointermove", handlePointerMove, { passive: true });

replay();
requestAnimationFrame(() => {
  document.documentElement.dataset.state = "ready";
  experience.dataset.ready = "true";
});
