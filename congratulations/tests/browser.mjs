import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import { celebrationSearch } from "../celebration-contract.js";
import { startStaticServer } from "./server-helper.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  await readFile(resolve(projectRoot, "celebrations.json"), "utf8"),
);
const celebration = {
  site: "chushoks.kakomonn.com",
  date: "2026-08-13",
  todayStabilityDaysDelta: 31,
  dailyStabilityDaysDeltaGoal: 30,
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

async function verifyExperience(browser, origin, experience, viewport, reducedMotion) {
  const page = await browser.newPage({ viewport, reducedMotion });
  const errors = captureErrors(page);
  try {
    const response = await page.goto(`${origin}/${experience.entry}?${search}`, {
      waitUntil: "domcontentloaded",
    });
    assert.equal(response?.status(), 200, experience.id);
    const root = page.locator('[data-celebration-root][data-ready="true"]');
    await root.waitFor({ state: "visible" });
    const epilogue = page.locator("[data-scroll-epilogue]");
    await epilogue.waitFor({ state: "visible" });
    assert.equal(await page.locator("[data-scroll-chapter]").count(), 3, experience.id);
    assert.equal(await page.title(), `todayStabilityDaysDelta達成 | ${experience.label}`);
    assert.equal(
      await page.locator(".achievement-metric").innerText(),
      "todayStabilityDaysDelta\n+31\n日\n\ndailyStabilityDaysDeltaGoal\n+30\n日",
    );
    const layout = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      viewport: innerWidth,
      height: document.documentElement.scrollHeight,
      viewportHeight: innerHeight,
      state: document.documentElement.dataset.state,
      ready: document.querySelector("[data-celebration-root]")?.dataset.ready,
      scrollDepth: document.documentElement.dataset.scrollDepth,
    }));
    assert.equal(layout.width <= layout.viewport + 1, true, experience.id);
    assert.equal(layout.scrollDepth, "ready", experience.id);
    assert.equal(
      layout.height / layout.viewportHeight >= (viewport.width <= 560 ? 5 : 3),
      true,
      `${experience.id} scroll depth`,
    );
    assert.deepEqual(layout, { ...layout, state: "ready", ready: "true" });
    const status = page.locator("[data-status]");
    const before = await status.textContent();
    await page.locator("[data-replay]").click();
    assert.notEqual(await status.textContent(), before);
    assert.deepEqual(errors, [], experience.id);
  } finally {
    await page.close();
  }
}

async function verifyShell(browser, origin) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = captureErrors(page);
  try {
    await page.route("https://kakomonn-sync.expgolem-lab.workers.dev/", (route) =>
      route.fulfill({ contentType: "text/html", body: "<h1>学習ログ</h1>" }),
    );
    await page.goto(`${origin}/?${search}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('html[data-state="ready"]');
    assert.equal(await page.locator("#achievement-label").innerText(), "todayStabilityDaysDelta +31日");
    assert.equal(await page.locator("#celebration-frame").getAttribute("aria-busy"), null);
    const frameUrl = new URL(await page.locator("#celebration-frame").getAttribute("src"));
    assert.equal(frameUrl.search.slice(1), search);
    const frame = page.locator("#celebration-frame").contentFrame();
    await frame.locator('[data-celebration-root][data-ready="true"]').waitFor();
    await frame.locator("[data-scroll-epilogue]").waitFor();
    const layout = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      viewport: innerWidth,
    }));
    assert.equal(layout.width <= layout.viewport + 1, true);
    await Promise.all([
      page.waitForURL("https://kakomonn-sync.expgolem-lab.workers.dev/"),
      page.locator("#open-study-log").click(),
    ]);
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
  for (const experience of manifest.experiences) {
    await verifyExperience(browser, server.origin, experience, { width: 390, height: 844 }, "reduce");
    await verifyExperience(browser, server.origin, experience, { width: 1440, height: 900 }, "no-preference");
  }
  await verifyShell(browser, server.origin);
  await verifyInvalidParameters(browser, server.origin);
  console.log(`Congratulations browser E2E passed for ${manifest.experiences.length} experiences`);
} finally {
  await browser.close();
  await server.stop();
  assert.equal(server.getStderr(), "");
}
