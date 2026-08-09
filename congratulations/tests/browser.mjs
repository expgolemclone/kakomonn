import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import { startStaticServer } from "./server-helper.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STUDY_LOG_URL = "https://kakomonn-count-sync.expgolem-lab.workers.dev/";
const manifest = JSON.parse(
  await readFile(resolve(projectRoot, "celebrations.json"), "utf8"),
);
const sites = manifest.tiers.flatMap((tier) =>
  tier.sites.map((site) => ({ ...site, milestone: tier.milestone })),
);
const retiredPaths = [
  "/dance/hikakin/",
  "/dark/void-conductor/",
  "/sensational/midnight-emcee/",
  "/sensational/midnight-orbit/",
  "/darkmode/clearance-officer/",
  "/sensational/night-archivist/",
  "/darkmode/gouten-stomp/",
  "/sensational/imura-rally/",
  "/darkmode/taiko-oni/",
  "/darkmode/night-examiner/",
  "/normal/kotonoha/",
  "/darkmode/forge-fury/",
  "/sensational/study-complete/",
  "/congratulationss/midnight-orbit/",
];

function captureErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  return errors;
}

async function verifyEntry(browser, origin, site, viewport, reducedMotion) {
  const page = await browser.newPage({ viewport, reducedMotion });
  const errors = captureErrors(page);
  try {
    const url = new URL(`/${site.entry}`, origin);
    url.searchParams.set("milestone", String(site.milestone));
    const response = await page.goto(url.href, { waitUntil: "domcontentloaded" });
    assert.equal(response?.status(), 200, site.id);
    const root = page.locator("[data-celebration-root]");
    await root.waitFor({ state: "visible", timeout: 15_000 });
    await page.waitForFunction(
      () => document.querySelector("[data-celebration-root]")?.dataset.ready === "true",
    );

    const milestoneTexts = await page.locator("[data-milestone]").allTextContents();
    assert.equal(milestoneTexts.length >= 2, true, `${site.id} milestone markers`);
    assert.equal(
      milestoneTexts.every((text) => text.trim() === String(site.milestone)),
      true,
      `${site.id} milestone values`,
    );
    assert.match(await page.title(), new RegExp(`^${site.milestone}問達成`));

    const layout = await page.evaluate(() => {
      const action = document.querySelector("[data-replay]")?.getBoundingClientRect();
      const heading = document.querySelector("h1")?.getBoundingClientRect();
      return {
        width: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
        heightRatio: document.documentElement.scrollHeight / innerHeight,
        actionBottom: action?.bottom,
        headingLeft: heading?.left,
        headingRight: heading?.right,
        state: document.documentElement.dataset.state,
        theme: document.documentElement.dataset.site,
        accent: getComputedStyle(document.documentElement)
          .getPropertyValue("--celebration-accent")
          .trim(),
      };
    });
    assert.equal(layout.width <= layout.viewportWidth + 1, true, `${site.id} overflow`);
    if (viewport.height >= 800) {
      assert.equal(layout.actionBottom <= viewport.height, true, `${site.id} action below fold`);
    }
    assert.equal(layout.headingLeft >= 0, true, `${site.id} heading left clipping`);
    assert.equal(layout.headingRight <= viewport.width + 1, true, `${site.id} heading right clipping`);
    assert.equal(layout.state, "ready");
    assert.equal(layout.theme, site.id);
    assert.notEqual(layout.accent, "", `${site.id} theme accent`);
    if (viewport.width === 390) {
      assert.equal(layout.heightRatio <= 2.2, true, `${site.id} is too long`);
    }

    const status = page.locator("[data-status]");
    const before = await status.textContent();
    await page.locator("[data-replay]").click();
    const after = await status.textContent();
    assert.notEqual(after, before, `${site.id} replay status`);
    assert.equal((after ?? "").length > 0, true);
    assert.deepEqual(errors, [], site.id);
  } finally {
    await page.close();
  }
}

async function verifyShell(browser, origin) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = captureErrors(page);
  try {
    await page.route(`${STUDY_LOG_URL}**`, (route) =>
      route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: "<!doctype html><html><body><h1>過去問 学習ログ</h1></body></html>",
      }),
    );

    for (const milestone of [50, 100, 150, 200, 250, 300]) {
      await page.goto(`${origin}/?milestone=${milestone}`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForSelector('html[data-state="ready"]');
      const state = await page.evaluate(() => ({
        milestone: document.querySelector("#milestone-label")?.textContent,
        study: document.querySelector("#open-study-log")?.textContent,
        id: document.querySelector("#celebration-frame")?.dataset.siteId,
        src: document.querySelector("#celebration-frame")?.src,
        title: document.title,
        frameTitle: document.querySelector("#celebration-frame")?.title,
        busy: document.querySelector("#celebration-frame")?.getAttribute("aria-busy"),
      }));
      const selected = sites.find((site) => site.id === state.id);
      assert(selected, `Unknown selected site, ${state.id}`);
      assert.equal(selected.milestone, Math.min(milestone, 250));
      assert.equal(state.milestone, `${milestone}問達成`);
      assert.equal(state.study, "週間の記録を見る");
      assert.equal(state.title, `${milestone}問達成 | ${selected.label}`);
      assert.equal(state.frameTitle, `${milestone}問達成 - ${selected.label}`);
      assert.equal(state.busy, null);
      const frameUrl = new URL(state.src);
      assert.equal(frameUrl.pathname.endsWith(`/${selected.entry}`), true);
      assert.equal(frameUrl.searchParams.get("milestone"), String(milestone));
      const frame = page.locator("#celebration-frame").contentFrame();
      await frame.locator('[data-celebration-root][data-ready="true"]').waitFor({
        state: "visible",
        timeout: 15_000,
      });
      assert.equal(
        (await frame.locator("[data-milestone]").first().textContent())?.trim(),
        String(milestone),
      );
    }

    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      viewport: innerWidth,
      ticket: document.querySelector(".study-log-ticket")?.getBoundingClientRect().width,
    }));
    assert.equal(mobile.width <= mobile.viewport, true);
    assert.equal(mobile.ticket <= mobile.viewport - 12, true);
    assert.deepEqual(errors, []);
    await Promise.all([
      page.waitForURL(STUDY_LOG_URL),
      page.locator("#open-study-log").click(),
    ]);
    assert.equal(await page.locator("h1").textContent(), "過去問 学習ログ");
  } finally {
    await page.close();
  }
}

async function verifyInvalidMilestone(browser, origin) {
  const page = await browser.newPage();
  try {
    await page.goto(`${origin}/?milestone=51`, { waitUntil: "domcontentloaded" });
    await page.locator("#error-panel").waitFor({ state: "visible" });
    assert.equal(await page.locator(".study-log-ticket").isVisible(), false);
    assert.match(await page.locator("#error-panel p").textContent(), /multiple of 50/);
  } finally {
    await page.close();
  }
}

async function verifyRetiredEntries(browser, origin) {
  const page = await browser.newPage();
  try {
    for (const path of retiredPaths) {
      const response = await page.goto(`${origin}${path}`, {
        waitUntil: "domcontentloaded",
      });
      assert.equal(response?.status(), 404, path);
    }
  } finally {
    await page.close();
  }
}

const configuredOrigin = process.env.CONGRATULATIONS_ORIGIN?.replace(/\/$/, "");
const server = configuredOrigin === undefined ? await startStaticServer() : null;
const origin = configuredOrigin ?? server.origin;
const browser = await chromium.launch({ headless: true });
try {
  for (const site of sites) {
    await verifyEntry(
      browser,
      origin,
      site,
      { width: 390, height: 844 },
      "reduce",
    );
    await verifyEntry(
      browser,
      origin,
      site,
      { width: 1440, height: 900 },
      "no-preference",
    );
    await verifyEntry(
      browser,
      origin,
      site,
      { width: 320, height: 568 },
      "reduce",
    );
  }
  await verifyRetiredEntries(browser, origin);
  await verifyShell(browser, origin);
  await verifyInvalidMilestone(browser, origin);
  console.log(`Congratulations browser E2E passed for ${sites.length} sites`);
} finally {
  await browser.close();
  if (server !== null) {
    await server.stop();
    assert.equal(server.getStderr(), "");
  }
}
