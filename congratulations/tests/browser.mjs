import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import { startStaticServer } from "./server-helper.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STUDY_LOG_URL = "https://kakomonn-count-sync.expgolem-lab.workers.dev/";
const manifest = JSON.parse(await readFile(resolve(projectRoot, "celebrations.json"), "utf8"));
const selectors = new Map([
  ["kotonoha", ".celebration"], ["hikakin", "main, .stage, .celebration"],
  ["study-complete", "[data-burst]"], ["imura-rally", ".stage"],
  ["void-conductor", "#night-stage"], ["midnight-orbit", "[data-celebration-ready]"],
  ["midnight-emcee", "[data-celebration]"], ["night-archivist", "[data-night-archivist]"],
  ["clearance-officer", ".console"], ["forge-fury", "[data-forge]"],
  ["taiko-oni", "[data-festival]"], ["gouten-stomp", "[data-gouten-stage]"],
  ["night-examiner", "#night-vault"],
]);
const retiredPaths = [
  "/sensational/gsap-study", "/sensational/gsap-study/",
  "/sensational/victory-observatory", "/sensational/victory-observatory/",
];

function captureErrors(page) {
  const errors = [];
  page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
  page.on("pageerror", (error) => errors.push(String(error)));
  return errors;
}

const siteChecks = {
  async kotonoha(page) {
    await page.waitForFunction(() => document.querySelector(".celebration")?.dataset.intro === "complete");
    assert.equal((await page.locator(".credit").textContent()).includes("© AI Inc."), true);
  },
  async hikakin(page) { await page.waitForFunction(() => document.title !== "Loading celebration"); },
  async "study-complete"(page) {
    await page.waitForFunction(() => document.querySelector("[data-progress-number]")?.textContent === "100");
  },
  async "imura-rally"(page) { await page.waitForFunction(() => document.querySelector("#stage")?.dataset.ready === "true"); },
  async "void-conductor"(page) {
    await page.waitForFunction(() => document.querySelector("#night-stage")?.dataset.ready === "true");
    assert.equal(await page.locator("#encore").isVisible(), true);
  },
  async "midnight-orbit"(page) {
    await page.waitForFunction(() => document.querySelector("[data-celebration-ready]")?.dataset.celebrationReady === "true");
  },
  async "midnight-emcee"(page) {
    await page.waitForFunction(() => document.querySelector("[data-celebration]")?.dataset.ready === "true");
    assert.equal(await page.locator("[data-character]").isVisible(), true);
    await page.locator("[data-encore]").click();
  },
  async "night-archivist"(page) {
    await page.waitForFunction(() => document.querySelector("[data-night-archivist]")?.dataset.ready === "true");
    assert.equal(await page.locator("[data-stars] .star-node").count(), 12);
    assert.equal(await page.locator("[data-star-lines] .star-line").count(), 12);
  },
  async "clearance-officer"(page) {
    await page.waitForFunction(() => document.documentElement.classList.contains("is-fired"));
    assert.equal(await page.locator(".officer-caption strong").textContent(), "K-50");
    assert.equal(await page.locator("#replay").isVisible(), true);
    await page.locator("#replay").click();
  },
  async "forge-fury"(page) {
    await page.waitForFunction(() => document.querySelector("[data-forge]")?.dataset.ready === "true");
    assert.equal(await page.locator("[data-smith]").isVisible(), true);
    await page.locator("[data-replay]").click();
    assert.match(await page.locator("[data-announcement]").textContent(), /達成確定/);
  },
  async "taiko-oni"(page) {
    await page.waitForFunction(() => document.querySelector("[data-festival]")?.dataset.ready === "true");
    assert.equal(await page.locator("[data-replay]").isVisible(), true);
    await page.locator("[data-replay]").click();
    assert.match(await page.locator("[data-status]").textContent(), /地鳴り/);
  },
  async "gouten-stomp"(page) {
    await page.waitForFunction(() => document.querySelector("[data-gouten-stage]")?.dataset.ready === "true");
    assert.equal(await page.locator("[data-character]").isVisible(), true);
    assert.equal(await page.locator("[data-milestone]").first().textContent(), "50");
    assert.equal(await page.locator("[data-talismans] .talisman").count(), 9);
    await page.locator("[data-replay]").click();
  },
  async "night-examiner"(page) {
    await page.waitForFunction(() => document.querySelector("#night-vault")?.dataset.ready === "true");
    assert.equal(await page.locator("[data-milestone]").textContent(), "150");
  },
};

async function verifyEntry(browser, origin, site) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const errors = captureErrors(page);
  try {
    const url = new URL(`/${site.entry}`, origin);
    if (site.id === "night-examiner") url.searchParams.set("milestone", "150");
    const response = await page.goto(url.href, { waitUntil: "domcontentloaded" });
    assert.equal(response?.status(), 200, site.id);
    const selector = selectors.get(site.id);
    assert(selector, `Missing selector for ${site.id}`);
    await page.locator(selector).first().waitFor({ state: "visible", timeout: 15_000 });
    await siteChecks[site.id]?.(page);
    const layout = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.equal(layout.width <= layout.viewport + 1, true, `${site.id} has horizontal overflow`);
    assert.deepEqual(errors, [], site.id);
  } finally { await page.close(); }
}

async function verifyShell(browser, origin) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = captureErrors(page);
  try {
    await page.route(`${STUDY_LOG_URL}**`, (route) => route.fulfill({
      contentType: "text/html; charset=utf-8", body: "<!doctype html><html><body><h1>過去問 学習ログ</h1></body></html>",
    }));
    await page.goto(`${origin}/normal/kotonoha/`, { waitUntil: "domcontentloaded" });
    await page.evaluate((url) => location.assign(url), `${origin}/?milestone=100`);
    await page.waitForSelector('html[data-state="ready"]');
    const regular = await page.evaluate(() => ({
      milestone: document.querySelector("#milestone-label")?.textContent,
      study: document.querySelector("#open-study-log")?.textContent,
      id: document.querySelector("#celebration-frame")?.dataset.siteId,
      src: document.querySelector("#celebration-frame")?.src,
    }));
    const selected = manifest.sites.find((site) => site.id === regular.id);
    assert(selected, `Unknown selected site, ${regular.id}`);
    assert.equal(regular.milestone, "100問達成");
    assert.equal(regular.study, "週間の記録を見る");
    assert.notEqual(regular.id, "night-examiner");
    assert.equal(new URL(regular.src).pathname.endsWith(`/${selected.entry}`), true);

    await page.goto(`${origin}/?milestone=150`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('html[data-state="ready"]');
    assert.equal(await page.locator("#milestone-label").textContent(), "150問達成");
    assert.equal(await page.locator("#celebration-frame").getAttribute("data-site-id"), "night-examiner");
    const frame = page.locator("#celebration-frame").contentFrame();
    await frame.locator("#night-vault").waitFor({ state: "visible" });
    assert.equal(await frame.locator("[data-milestone]").textContent(), "150");
    assert.equal(await page.locator("#open-study-log").isVisible(), true);
    assert.deepEqual(errors, []);

    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth, viewport: innerWidth,
      ticket: document.querySelector(".study-log-ticket")?.getBoundingClientRect().width,
    }));
    assert.equal(mobile.width <= mobile.viewport, true);
    assert.equal(mobile.ticket <= mobile.viewport - 12, true);
    await Promise.all([page.waitForURL(STUDY_LOG_URL), page.locator("#open-study-log").click()]);
    assert.equal(await page.locator("h1").textContent(), "過去問 学習ログ");
  } finally { await page.close(); }
}

async function verifyInvalidMilestone(browser, origin) {
  const page = await browser.newPage();
  try {
    await page.goto(`${origin}/?milestone=51`, { waitUntil: "domcontentloaded" });
    await page.locator("#error-panel").waitFor({ state: "visible" });
    assert.equal(await page.locator(".study-log-ticket").isVisible(), false);
    assert.match(await page.locator("#error-panel p").textContent(), /multiple of 50/);
  } finally { await page.close(); }
}

async function verifyRetiredEntries(browser, origin) {
  const page = await browser.newPage();
  try {
    for (const path of retiredPaths) {
      const response = await page.goto(`${origin}${path}`, { waitUntil: "domcontentloaded" });
      assert.equal(response?.status(), 404, path);
    }
  } finally { await page.close(); }
}

const configuredOrigin = process.env.CONGRATULATIONS_ORIGIN?.replace(/\/$/, "");
const server = configuredOrigin === undefined ? await startStaticServer() : null;
const origin = configuredOrigin ?? server.origin;
const browser = await chromium.launch({ headless: true });
try {
  for (const site of manifest.sites) await verifyEntry(browser, origin, site);
  await verifyRetiredEntries(browser, origin);
  await verifyShell(browser, origin);
  await verifyInvalidMilestone(browser, origin);
  console.log(`Congratulations browser E2E passed for ${manifest.sites.length} sites`);
} finally {
  await browser.close();
  if (server !== null) {
    await server.stop();
    assert.equal(server.getStderr(), "");
  }
}
