import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function getAvailablePort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");

  const address = probe.address();
  assert(address && typeof address === "object");
  const { port } = address;
  await new Promise((resolveClose, rejectClose) => {
    probe.close((error) => {
      if (error) {
        rejectClose(error);
        return;
      }
      resolveClose();
    });
  });
  return port;
}

async function stopAppServer(child) {
  if (child.exitCode !== null) {
    return;
  }
  const exited = once(child, "exit");
  child.kill();
  await exited;
}

async function startAppServer(port) {
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.setEncoding("utf8");
  child.stdout.setEncoding("utf8");

  let stderr = "";
  let stdout = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const expectedMessage = `Celebration server listening on http://127.0.0.1:${port}`;
  try {
    await new Promise((resolveReady, rejectReady) => {
      const timeout = setTimeout(() => {
        rejectReady(new Error(`Server did not start.\n${stderr}`));
      }, 5_000);

      function cleanup() {
        clearTimeout(timeout);
        child.off("exit", handleExit);
        child.stdout.off("data", handleOutput);
      }

      function handleExit(code) {
        cleanup();
        rejectReady(new Error(`Server exited with code ${code}.\n${stderr}`));
      }

      function handleOutput(chunk) {
        stdout += chunk;
        if (!stdout.includes(expectedMessage)) {
          return;
        }
        cleanup();
        resolveReady();
      }

      child.once("exit", handleExit);
      child.stdout.on("data", handleOutput);
    });
  } catch (error) {
    await stopAppServer(child);
    throw error;
  }

  return { child, getStderr: () => stderr };
}

async function main() {
  const port = await getAvailablePort();
  const server = await startAppServer(port);

  try {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      const errors = [];
      page.on("console", (message) => {
        if (message.type() === "error") {
          errors.push(message.text());
        }
      });
      page.on("pageerror", (error) => errors.push(String(error)));

      const response = await page.goto(`http://127.0.0.1:${port}`, {
        waitUntil: "networkidle",
      });
      assert.equal(response?.status(), 200);
      await page.waitForFunction(
        () => document.querySelector(".celebration")?.dataset.intro === "complete",
      );

      const initialState = await page.evaluate(() => ({
        confettiCount: document.querySelectorAll(".confetti-piece").length,
        credit: document.querySelector(".credit")?.textContent ?? "",
        gsapLoaded: typeof window.gsap?.timeline === "function",
        title: document.querySelector("#hero-title")?.textContent,
      }));
      assert.equal(initialState.confettiCount, 96);
      assert.equal(initialState.credit.includes("© AI Inc."), true);
      assert.equal(initialState.gsapLoaded, true);
      assert.equal(initialState.title, "CONGRATULATIONS!!!");
      assert.equal(await page.locator(".character-card--akane").isVisible(), true);
      assert.equal(await page.locator(".character-card--aoi").isVisible(), true);
      await page.screenshot({
        path: resolve(projectRoot, "preview.png"),
        fullPage: true,
      });

      await page.locator("#boost").click();
      assert.equal(await page.locator("#boost").getAttribute("aria-pressed"), "true");
      assert.equal(await page.locator("#boost").textContent(), "祝福MAX中");
      assert.equal(
        await page.locator("#status").textContent(),
        "祝福MAXです.拍手が止まりません.",
      );

      await page.locator("#replay").click();
      assert.equal(
        await page.locator("#status").textContent(),
        "もう一度,全力で祝福しています.",
      );
      await page.waitForFunction(
        () => document.querySelector(".celebration")?.dataset.intro === "complete",
      );

      await page.setViewportSize({ width: 390, height: 844 });
      const mobileState = await page.evaluate(() => ({
        characterCount: document.querySelectorAll(".character-card").length,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      }));
      assert.equal(await page.locator("#replay").isVisible(), true);
      assert.equal(await page.locator("#boost").isVisible(), true);
      assert.equal(mobileState.characterCount, 2);
      assert.equal(mobileState.documentWidth <= mobileState.viewportWidth, true);
      assert.deepEqual(errors, []);
      await page.screenshot({
        path: resolve(projectRoot, "mobile-preview.png"),
        fullPage: true,
      });

      await writeFile(
        resolve(projectRoot, "tests", "browser-result.json"),
        `${JSON.stringify({ initialState, mobileState }, null, 2)}\n`,
      );
      console.log("Congratulations browser E2E test passed");
    } finally {
      await browser.close();
    }
  } finally {
    await stopAppServer(server.child);
  }

  assert.equal(server.getStderr(), "");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
