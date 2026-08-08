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
  ["hikakin", "main, .stage, .celebration"],
  ["study-complete", "[data-burst]"],
  ["imura-rally", ".stage"],
  ["void-conductor", "#night-stage"],
  ["midnight-orbit", "[data-celebration-ready]"],
  ["midnight-emcee", "[data-celebration]"],
  ["night-archivist", "[data-night-archivist]"],
  ["clearance-officer", ".console"],
  ["forge-fury", "[data-forge]"],
  ["taiko-oni", "[data-festival]"],
  ["night-examiner", "#night-vault"],
]);

const retiredPaths = [
  "/sensational/gsap-study",
  "/sensational/gsap-study/",
  "/sensational/victory-observatory",
  "/sensational/victory-observatory/",
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

async function verifyEntry(browser, origin, site) {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  const errors = captureErrors(page);
  try {
    const entryUrl = new URL(`/${site.entry}`, origin);
    if (site.id === "night-examiner") {
      entryUrl.searchParams.set("milestone", "150");
    }
    const response = await page.goto(entryUrl.href, {
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
    } else if (site.id === "hikakin") {
      await page.waitForFunction(() => document.title !== "Loading celebration");
    } else if (site.id === "study-complete") {
      await page.waitForFunction(
        () => document.querySelector("[data-progress-number]")?.textContent === "100",
      );
    } else if (site.id === "imura-rally") {
      await page.waitForFunction(
        () => document.querySelector("#stage")?.dataset.ready === "true",
      );
    } else if (site.id === "void-conductor") {
      await page.waitForFunction(
        () => document.querySelector("#night-stage")?.dataset.ready === "true",
      );
      assert.equal(await page.locator("#encore").isVisible(), true);
    } else if (site.id === "midnight-orbit") {
      await page.waitForFunction(
        () => document.querySelector("[data-celebration-ready]")?.dataset.celebrationReady === "true",
      );
    } else if (site.id === "midnight-emcee") {
      await page.waitForFunction(
        () => document.querySelector("[data-celebration]")?.dataset.ready === "true",
      );
      assert.equal(await page.locator("[data-character]").isVisible(), true);
      await page.locator("[data-encore]").click();
    } else if (site.id === "night-archivist") {
      await page.waitForFunction(
        () =>
          document.querySelector("[data-night-archivist]")?.dataset.ready ===
          "true",
      );
      assert.equal(await page.locator("[data-stars] .star-node").count(), 12);
      assert.equal(await page.locator("[data-star-lines] .star-line").count(), 12);
    } else if (site.id === "clearance-officer") {
      await page.waitForFunction(() =>
        document.documentElement.classList.contains("is-fired"),
      );
      assert.equal(await page.locator(".officer-caption strong").textContent(), "K-50");
      assert.equal(await page.locator("#replay").isVisible(), true);
      await page.locator("#replay").click();
    } else if (site.id === "forge-fury") {
      await page.waitForFunction(
        () => document.querySelector("[data-forge]")?.dataset.ready === "true",
      );
      assert.equal(await page.locator("[data-smith]").isVisible(), true);
      assert.equal(await page.locator("[data-replay]").isVisible(), true);
      await page.locator("[data-replay]").click();
      assert.match(await page.locator("[data-announcement]").textContent(), /達成確定/);
    } else if (site.id === "taiko-oni") {
      await page.waitForFunction(
        () => document.querySelector("[data-festival]")?.dataset.ready === "true",
      );
      assert.equal(await page.locator("[data-sparks] i").count(), 24);
      assert.equal(await page.locator("[data-soot] i").count(), 18);
      assert.equal(await page.locator("[data-replay]").isVisible(), true);
      await page.locator("[data-replay]").click();
      assert.match(await page.locator("[data-status]").textContent(), /地鳴り/);
    } else if (site.id === "night-examiner") {
      await page.waitForFunction(
        () => document.querySelector("#night-vault")?.dataset.ready === "true",
      );
      assert.equal(await page.locator("[data-milestone]").textContent(), "150");
    }

    const layout = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    assert.equal(
      layout.documentWidth <= layout.viewportWidth + 1,
      true,
      `${site.id} has horizontal overflow`,
    );
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
    await page.goto(`${origin}/normal/kotonoha/`, { waitUntil: "domcontentloaded" });
    await page.evaluate((url) => window.location.assign(url), `${origin}/?milestone=100`);
    await page.waitForSelector('html[data-state="ready"]');

    const regularShell = await page.evaluate(() => ({
      milestone: document.querySelector("#milestone-label")?.textContent,
      studyLogText: document.querySelector("#open-study-log")?.textContent,
      selectedSite: document.querySelector("#celebration-frame")?.dataset.siteId,
      frameSource: document.querySelector("#celebration-frame")?.src,
    }));
    const regularSelection = manifest.sites.find(
      (site) => site.id === regularShell.selectedSite,
    );
    assert(regularSelection, `Unknown selected site, ${regularShell.selectedSite}`);
    assert.equal(regularShell.milestone, "100問達成");
    assert.equal(regularShell.studyLogText, "週間の記録を見る");
    assert.notEqual(regularShell.selectedSite, "night-examiner");
    assert.equal(
      new URL(regularShell.frameSource).pathname.endsWith(`/${regularSelection.entry}`),
      true,
    );

    await page.goto(`${origin}/?milestone=150`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('html[data-state="ready"]');
    const specialShell = await page.evaluate(() => ({
      milestone: document.querySelector("#milestone-label")?.textContent,
      selectedSite: document.querySelector("#celebration-frame")?.dataset.siteId,
      frameSource: document.querySelector("#celebration-frame")?.src,
    }));
    assert.equal(specialShell.milestone, "150問達成");
    assert.equal(specialShell.selectedSite, "night-examiner");
    assert.equal(
      new URL(specialShell.frameSource).pathname.endsWith(
        "/darkmode/night-examiner/index.html",
      ),
      true,
    );
    const celebrationFrame = page.locator("#celebration-frame");
    await celebrationFrame.contentFrame().locator("#night-vault").waitFor({
      state: "visible",
    });
    assert.equal(
      await celebrationFrame.contentFrame().locator("[data-milestone]").textContent(),
      "150",
    );
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
  for (const site of manifest.sites) {
    await verifyEntry(browser, origin, site);
  }
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
