import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const [html, css, js] = await Promise.all([
  readFile(resolve(root, "index.html"), "utf8"),
  readFile(resolve(root, "styles.css"), "utf8"),
  readFile(resolve(root, "app.js"), "utf8"),
]);

const assertions = [
  [html.includes("Congratulations!!!") && js.includes("CONGRATULATIONS!!!"), "title markup"],
  [html.includes("琴葉茜 琴葉葵 © AI Inc."), "required character attribution"],
  [html.includes("node_modules/gsap/dist/gsap.min.js"), "local GSAP dependency"],
  [html.includes("character--akane") && html.includes("character--aoi"), "both character illustrations"],
  [css.includes("@media (max-width: 720px)"), "responsive layout"],
  [js.includes("gsap.timeline") && js.includes("repeat: -1"), "GSAP timelines"],
  [js.includes("burstConfetti") && js.includes("setBoost"), "interactive celebration controls"],
];

for (const [passed, label] of assertions) {
  if (!passed) {
    throw new Error(`Smoke assertion failed: ${label}`);
  }
}

console.log(`Smoke assertions passed: ${assertions.length}`);
