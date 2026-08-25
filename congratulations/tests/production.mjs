import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import { celebrationSearch } from "../shared/celebration-contract.js";
import { validateManifest } from "../celebration-selection.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = validateManifest(
  JSON.parse(await readFile(resolve(projectRoot, "celebrations.json"), "utf8")),
);
const origin = "https://kakomonn-congratulations.kakomonn.workers.dev";
const search = celebrationSearch({
  site: "chushoks.kakomonn.com",
  date: "2026-08-13",
  dueCardsCompleted: true,
});

function captureErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("response", (response) => {
    if (response.url().startsWith(origin) && response.status() >= 400) {
      errors.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on("requestfailed", (request) => {
    if (request.url().startsWith(origin)) {
      errors.push(`${request.failure()?.errorText ?? "request failed"} ${request.url()}`);
    }
  });
  return errors;
}

const browser = await chromium.launch({ headless: true });
try {
  const shell = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const shellErrors = captureErrors(shell);
  const response = await shell.goto(`${origin}/?${search}`, { waitUntil: "domcontentloaded" });
  assert.equal(response?.status(), 200);
  await shell.waitForSelector('html[data-state="ready"]');
  assert.equal(await shell.locator("#celebration-frame").isVisible(), true);
  assert.deepEqual(shellErrors, []);
  await shell.close();

  for (const experience of manifest.experiences) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = captureErrors(page);
    await page.addInitScript(() => {
      window.__celebrationMessages = [];
      window.addEventListener("message", (event) => {
        if (event.data?.type === "kakomonn:celebration-ready") {
          window.__celebrationMessages.push(event.data);
        }
      });
    });
    try {
      const experienceResponse = await page.goto(
        `${origin}/${experience.entry}?${search}`,
        { waitUntil: "domcontentloaded" },
      );
      assert.equal(experienceResponse?.status(), 200);
      await page.waitForFunction(
        (id) => window.__celebrationMessages.some((message) => message.siteId === id),
        experience.id,
      );
      await page.waitForLoadState("load");
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
console.log("Congratulations production E2E passed for all experiences");
