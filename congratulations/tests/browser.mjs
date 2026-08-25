import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import { celebrationSearch } from "../shared/celebration-contract.js";
import { validateManifest } from "../celebration-selection.js";
import { startStaticServer } from "./server-helper.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = validateManifest(
  JSON.parse(await readFile(resolve(projectRoot, "celebrations.json"), "utf8")),
);
const celebration = {
  site: "chushoks.kakomonn.com",
  date: "2026-08-13",
  dueCardsCompleted: true,
};
const search = celebrationSearch(celebration);
const japaneseText = /[\u3040-\u30ff\u3400-\u9fff]/u;

function captureErrors(page, origin) {
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

async function verifyShell(browser, origin) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = captureErrors(page, origin);
  try {
    await page.goto(`${origin}/?${search}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('html[data-state="ready"]');
    const selectedId = await page.locator("#celebration-frame").getAttribute("data-experience-id");
    assert.ok(manifest.experiences.some(({ id }) => id === selectedId));
    assert.equal(await page.locator("#celebration-frame").isVisible(), true);
    assert.equal(await page.locator("#loading").isVisible(), false);
    assert.equal(japaneseText.test(await page.locator("body").innerText()), false);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

async function verifyInvalidParameters(browser, origin) {
  const page = await browser.newPage();
  const errors = captureErrors(page, origin);
  try {
    await page.goto(`${origin}/?${search}&extra=1`, { waitUntil: "domcontentloaded" });
    await page.locator("#error-panel").waitFor({ state: "visible" });
    assert.equal(await page.locator("html").getAttribute("data-state"), "error");
    assert.equal(await page.locator("#celebration-frame").isVisible(), false);
    assert.equal(japaneseText.test(await page.locator("body").innerText()), false);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

async function verifyExperience(browser, origin, experience, viewport) {
  const page = await browser.newPage({ viewport });
  const errors = captureErrors(page, origin);
  await page.addInitScript(() => {
    window.__celebrationMessages = [];
    window.addEventListener("message", (event) => {
      if (event.data?.type === "kakomonn:celebration-ready") {
        window.__celebrationMessages.push(event.data);
      }
    });
  });
  try {
    const response = await page.goto(`${origin}/${experience.entry}?${search}`, {
      waitUntil: "domcontentloaded",
    });
    assert.equal(response?.status(), 200);
    await page.waitForFunction(
      (id) => window.__celebrationMessages.some((message) => message.siteId === id),
      experience.id,
    );
    await page.waitForLoadState("load");
    assert.ok((await page.title()).trim().length > 0);
    const visibleText = await page.locator("body").innerText();
    assert.ok(visibleText.trim().length > 0);
    assert.equal(japaneseText.test(visibleText), false);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

const server = await startStaticServer();
const browser = await chromium.launch({ headless: true });
try {
  await verifyShell(browser, server.origin);
  await verifyInvalidParameters(browser, server.origin);
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1440, height: 900 },
  ]) {
    for (const experience of manifest.experiences) {
      await verifyExperience(browser, server.origin, experience, viewport);
    }
  }
  console.log("Congratulations browser E2E passed for all experiences");
} finally {
  await browser.close();
  await server.stop();
  assert.equal(server.getStderr(), "");
}
