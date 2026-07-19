import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import { startStaticServer } from "./server-helper.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STUDY_LOG_URL =
  "https://kakomonn-count-sync.expgolem-lab.workers.dev/";
const manifest = JSON.parse(
  await readFile(resolve(projectRoot, "celebrations.json"), "utf8"),
);
const selectors = new Map([
  ["kotonoha", ".celebration"],
  ["study-complete", "[data-burst]"],
  ["gsap-study", ".celebrate-button"],
]);
const entryViewports = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
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

async function verifyEntryAtViewport(browser, origin, site, viewport) {
  const page = await browser.newPage({
    viewport,
    reducedMotion: "reduce",
  });
  const errors = captureErrors(page);
  try {
    const response = await page.goto(`${origin}/${site.entry}`, {
      waitUntil: "domcontentloaded",
    });
    assert.equal(response?.status(), 200, site.id);
    await page.locator(selectors.get(site.id)).first().waitFor({
      state: "visible",
      timeout: 15_000,
    });

    if (site.id === "kotonoha") {
      await page.waitForFunction(
        () => document.querySelector(".celebration")?.dataset.intro === "complete",
      );
      assert.equal(
        await page.locator(".credit").textContent().then((text) => text.includes("© AI Inc.")),
        true,
      );
    } else if (site.id === "study-complete") {
      await page.waitForFunction(
        () => document.querySelector("[data-progress-number]")?.textContent === "100",
      );
    } else if (site.id === "gsap-study") {
      await page.waitForFunction(() => document.querySelector(".loader") === null);
    }

    const layout = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
    }));
    assert.equal(
      layout.documentWidth <= layout.viewportWidth + 1,
      true,
      `${site.id} has horizontal overflow`,
    );
    assert.equal(
      layout.documentHeight > layout.viewportHeight,
      true,
      `${site.id} cannot scroll vertically at ${viewport.width}px`,
    );

    await page.mouse.wheel(0, Math.min(700, layout.documentHeight - layout.viewportHeight));
    await page.waitForFunction(() => window.scrollY > 0);
    assert.deepEqual(errors, [], site.id);
  } finally {
    await page.close();
  }
}

async function verifyEntry(browser, origin, site) {
  for (const viewport of entryViewports) {
    await verifyEntryAtViewport(browser, origin, site, viewport);
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
    await page.goto(`${origin}/normal/kotonoha/`, { waitUntil: "domcontentloaded" });
    await page.evaluate((url) => window.location.assign(url), `${origin}/?milestone=100`);
    await page.waitForSelector('html[data-state="ready"]');

    const shell = await page.evaluate(() => ({
      milestone: document.querySelector("#milestone-label")?.textContent,
      studyLogText: document.querySelector("#open-study-log")?.textContent,
      selectedSite: document.querySelector("#celebration-frame")?.dataset.siteId,
      frameSource: document.querySelector("#celebration-frame")?.src,
    }));
    const selected = manifest.sites.find((site) => site.id === shell.selectedSite);
    assert(selected, `Unknown selected site, ${shell.selectedSite}`);
    assert.equal(shell.milestone, "100問達成");
    assert.equal(shell.studyLogText, "週間の記録を見る");
    assert.equal(new URL(shell.frameSource).pathname.endsWith(`/${selected.entry}`), true);
    assert.equal(await page.locator("#open-study-log").isVisible(), true);
    assert.deepEqual(errors, []);

    await page.screenshot({
      path: resolve(projectRoot, "preview.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileLayout = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      ticketWidth: document.querySelector(".study-log-ticket")?.getBoundingClientRect().width,
    }));
    assert.equal(mobileLayout.documentWidth <= mobileLayout.viewportWidth, true);
    assert.equal(mobileLayout.ticketWidth <= mobileLayout.viewportWidth - 12, true);
    await page.screenshot({
      path: resolve(projectRoot, "mobile-preview.png"),
      fullPage: true,
    });

    await Promise.all([
      page.waitForURL(STUDY_LOG_URL),
      page.locator("#open-study-log").click(),
    ]);
    assert.equal(await page.locator("h1").textContent(), "過去問 学習ログ");

    await Promise.all([
      page.waitForURL(`${origin}/normal/kotonoha/`),
      page.goBack(),
    ]);
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

const configuredOrigin = process.env.CONGRATULATIONS_ORIGIN?.replace(/\/$/, "");
const server = configuredOrigin === undefined ? await startStaticServer() : null;
const origin = configuredOrigin ?? server.origin;
const browser = await chromium.launch({ headless: true });
try {
  for (const site of manifest.sites) {
    await verifyEntry(browser, origin, site);
  }
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
