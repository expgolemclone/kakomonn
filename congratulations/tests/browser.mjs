import assert from "node:assert/strict";
import { chromium } from "playwright";
import { celebrationSearch } from "../celebration-contract.js";
import { startStaticServer } from "./server-helper.mjs";

const celebration = {
  site: "chushoks.kakomonn.com",
  date: "2026-08-13",
  dueCardsCompleted: true,
};
const search = celebrationSearch(celebration);

function captureErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  return errors;
}

async function verifyNoInstalledDesign(browser, origin) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = captureErrors(page);
  try {
    await page.goto(`${origin}/?${search}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('html[data-state="error"]');
    assert.equal(await page.locator("#error-panel").isVisible(), true);
    assert.equal(await page.locator("#error-panel p").innerText(), "祝福designは未実装です.");
    assert.equal(await page.locator("#loading").isVisible(), false);
    assert.equal(await page.locator("#celebration-frame").isVisible(), false);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

async function verifyInvalidParameters(browser, origin) {
  const page = await browser.newPage();
  try {
    await page.goto(`${origin}/?${search}&extra=1`, { waitUntil: "domcontentloaded" });
    await page.locator("#error-panel").waitFor({ state: "visible" });
    assert.equal(await page.locator(".study-log-ticket").isVisible(), false);
    assert.equal(await page.locator("#celebration-frame").isVisible(), false);
  } finally {
    await page.close();
  }
}

const server = await startStaticServer();
const browser = await chromium.launch({ headless: true });
try {
  await verifyNoInstalledDesign(browser, server.origin);
  await verifyInvalidParameters(browser, server.origin);
  console.log("Congratulations browser E2E passed with no installed design");
} finally {
  await browser.close();
  await server.stop();
  assert.equal(server.getStderr(), "");
}
