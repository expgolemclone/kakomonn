import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const server = spawn(process.execPath, [resolve(root, "server.mjs")], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, PORT: "4173" },
});

let serverOutput = "";
server.stdout.on("data", (chunk) => {
  serverOutput += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  serverOutput += chunk.toString();
});

try {
  await Promise.race([
    new Promise((resolveReady, rejectReady) => {
      const timeout = setTimeout(() => rejectReady(new Error(`Server did not start.\n${serverOutput}`)), 5000);
      server.stdout.on("data", (chunk) => {
        if (chunk.toString().includes("Celebration server listening")) {
          clearTimeout(timeout);
          resolveReady();
        }
      });
    }),
    once(server, "exit").then(([code]) => {
      throw new Error(`Server exited early with code ${code}.\n${serverOutput}`);
    }),
  ]);

  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });

    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const serverResponse = await fetch("http://127.0.0.1:4173");
    if (!serverResponse.ok) {
      throw new Error(`Static server failed: ${serverResponse.status}`);
    }
    const servedHtml = await serverResponse.text();
    if (!servedHtml.includes("Congratulations!!!")) {
      throw new Error("Static server returned unexpected HTML.");
    }

    const sourceHtml = await readFile(resolve(root, "index.html"), "utf8");
    const browserHtml = sourceHtml
      .replace(/<link rel="stylesheet" href="\.\/styles\.css">/, "")
      .replace(/<script src="\.\/node_modules\/gsap\/dist\/gsap\.min\.js"><\/script>/, "")
      .replace(/<script defer src="\.\/app\.js"><\/script>/, "");

    await page.setContent(browserHtml, { waitUntil: "domcontentloaded" });
    await page.addStyleTag({ path: resolve(root, "styles.css") });
    await page.addScriptTag({ path: resolve(root, "node_modules", "gsap", "dist", "gsap.min.js") });
    await page.addScriptTag({ path: resolve(root, "app.js") });

    await page.waitForSelector(".hero-title .char");
    await page.waitForFunction(() => document.querySelectorAll(".hero-title .char").length === 18);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 800));

    const before = await page.evaluate(() => ({
      titleCount: document.querySelectorAll(".hero-title .char").length,
      confettiCount: document.querySelectorAll(".confetti-piece").length,
      hasErrorClass: document.querySelector(".celebration")?.classList.contains("is-error") ?? true,
      boostPressed: document.querySelector("#boost")?.getAttribute("aria-pressed"),
      status: document.querySelector("#status")?.textContent ?? "",
    }));

    if (before.titleCount !== 18) {
      throw new Error(`Expected 18 title characters, received ${before.titleCount}`);
    }
    if (before.confettiCount !== 96) {
      throw new Error(`Expected 96 confetti pieces, received ${before.confettiCount}`);
    }
    if (before.hasErrorClass) {
      throw new Error("The page entered the explicit GSAP error state.");
    }

    await page.waitForFunction(() => document.querySelector(".celebration")?.dataset.intro === "complete");
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 350));
    await page.screenshot({ path: resolve(root, "preview.png"), fullPage: true });

    await page.evaluate(() => document.querySelector("#boost")?.scrollIntoView({ block: "center" }));
    await page.click("#boost");
    await page.waitForFunction(() => document.querySelector("#boost")?.getAttribute("aria-pressed") === "true");
    await page.click("#replay");

    const after = await page.evaluate(() => ({
      boostPressed: document.querySelector("#boost")?.getAttribute("aria-pressed"),
      replayLabel: document.querySelector("#replay")?.textContent,
      credit: document.querySelector(".credit")?.textContent,
      status: document.querySelector("#status")?.textContent,
    }));

    if (after.boostPressed !== "true") {
      throw new Error("Boost control did not activate.");
    }
    if (!after.status.includes("祝福")) {
      throw new Error("Replay control did not publish a live status message.");
    }
    if (!after.credit.includes("© AI Inc.")) {
      throw new Error("Character attribution is missing in the rendered page.");
    }
    if (pageErrors.length > 0) {
      throw new Error(`Browser page errors:\n${pageErrors.join("\n")}`);
    }

    const mobilePage = await browser.newPage();
    await mobilePage.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await mobilePage.setContent(browserHtml, { waitUntil: "domcontentloaded" });
    await mobilePage.addStyleTag({ path: resolve(root, "styles.css") });
    await mobilePage.addScriptTag({ path: resolve(root, "node_modules", "gsap", "dist", "gsap.min.js") });
    await mobilePage.addScriptTag({ path: resolve(root, "app.js") });
    await mobilePage.waitForSelector(".hero-title .char");
    await mobilePage.waitForFunction(() => document.querySelector(".celebration")?.dataset.intro === "complete");

    const mobile = await mobilePage.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      characterCount: document.querySelectorAll(".character-card").length,
    }));

    if (mobile.documentWidth > mobile.viewportWidth + 2) {
      throw new Error(`Mobile layout overflows horizontally: ${mobile.documentWidth}px > ${mobile.viewportWidth}px`);
    }
    if (mobile.characterCount !== 2) {
      throw new Error(`Expected two mobile characters, received ${mobile.characterCount}`);
    }

    await mobilePage.screenshot({ path: resolve(root, "mobile-preview.png"), fullPage: true });
    await mobilePage.close();

    await writeFile(resolve(root, "tests", "browser-result.json"), JSON.stringify({ before, after, mobile }, null, 2));
    console.log("Browser interaction test passed.");
  } finally {
    await browser.close();
  }
} finally {
  if (server.exitCode === null) {
    const exited = once(server, "exit");
    server.kill("SIGTERM");
    await Promise.race([
      exited,
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2000)),
    ]);
  }
}
