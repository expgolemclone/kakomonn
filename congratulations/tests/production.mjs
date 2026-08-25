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
  await page.waitForSelector('html[data-state="ready"]');
  assert.equal(await page.locator("#achievement-label").innerText(), "dueCardsCompleted 達成");
  const frame = page.locator("#celebration-frame").contentFrame();
  await frame.locator('[data-celebration-root][data-ready="true"]').waitFor();
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
console.log("Congratulations production E2E passed");
