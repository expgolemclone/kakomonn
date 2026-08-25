import assert from "node:assert/strict";
import { chromium } from "playwright";
import { celebrationSearch } from "../celebration-contract.js";

const origin = "https://kakomonn-congratulations.kakomonn.workers.dev";
const search = celebrationSearch({
  site: "chushoks.kakomonn.com",
  date: "2026-08-13",
  dueCardsCompleted: true,
});
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  const response = await page.goto(`${origin}/?${search}`, { waitUntil: "domcontentloaded" });
  assert.equal(response?.status(), 200);
  await page.waitForSelector('html[data-state="error"]');
  assert.equal(await page.locator("#error-panel").isVisible(), true);
  assert.equal(await page.locator("#error-panel p").innerText(), "祝福designは未実装です.");
  assert.equal(await page.locator("#celebration-frame").isVisible(), false);
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
console.log("Congratulations production E2E passed");
