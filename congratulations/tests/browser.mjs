import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
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
  dailyKpiCompleted: true,
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

async function rejectExternalRequests(page, origin) {
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (/^https?:/.test(url) && !url.startsWith(origin)) {
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
}

async function verifyShell(browser, origin, experience, selectedIndex) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await rejectExternalRequests(page, origin);
  const errors = captureErrors(page, origin);
  await page.addInitScript((index) => {
    const nativeGetRandomValues = Crypto.prototype.getRandomValues;
    Object.defineProperty(Crypto.prototype, "getRandomValues", {
      configurable: true,
      value(values) {
        if (values instanceof Uint32Array && values.length === 1) {
          values[0] = index;
          return values;
        }
        return nativeGetRandomValues.call(this, values);
      },
    });
  }, selectedIndex);
  try {
    const response = await page.goto(`${origin}/?${search}`, {
      waitUntil: "domcontentloaded",
    });
    assert.equal(response?.headers()["cache-control"], "no-cache");
    await page.waitForSelector('html[data-state="ready"]');
    const selectedId = await page.locator("#celebration-frame").getAttribute("data-experience-id");
    assert.equal(selectedId, experience.id);
    const frameURL = new URL(
      await page.locator("#celebration-frame").getAttribute("src"),
      origin,
    );
    assert.equal(frameURL.search, "");
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
  await rejectExternalRequests(page, origin);
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

async function verifyFrameVisibleBeforeReady(browser, origin) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let releaseRuntime;
  const runtimeReleased = new Promise((resolve) => {
    releaseRuntime = resolve;
  });
  await rejectExternalRequests(page, origin);
  await page.route("**/shared/experience-runtime.js", async (route) => {
    await runtimeReleased;
    await route.continue();
  });
  await page.addInitScript(() => {
    const nativeGetRandomValues = Crypto.prototype.getRandomValues;
    Object.defineProperty(Crypto.prototype, "getRandomValues", {
      configurable: true,
      value(values) {
        if (values instanceof Uint32Array && values.length === 1) {
          values[0] = 0;
          return values;
        }
        return nativeGetRandomValues.call(this, values);
      },
    });
  });
  try {
    await page.goto(`${origin}/?${search}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => document.querySelector("#celebration-frame")?.src !== "",
    );
    assert.equal(await page.locator("#celebration-frame").isVisible(), true);
    assert.equal(await page.locator("#loading").isVisible(), true);
    assert.equal(await page.locator("html").getAttribute("data-state"), "loading");
    releaseRuntime();
    await page.waitForSelector('html[data-state="ready"]');
  } finally {
    releaseRuntime();
    await page.close();
  }
}

async function verifyExperience(browser, origin, experience, viewport) {
  const page = await browser.newPage({ viewport });
  await rejectExternalRequests(page, origin);
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
    assert.equal(response?.headers()["cache-control"], "no-cache");
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

async function verifyLocalCachePolicy(origin) {
  const stableResponse = await fetch(`${origin}/shared/experience-runtime.js`);
  assert.equal(stableResponse.status, 200);
  assert.equal(stableResponse.headers.get("cache-control"), "no-cache");

  const builtAssets = await readdir(resolve(projectRoot, "dist", "assets"));
  assert.notEqual(builtAssets.length, 0);
  const immutableResponse = await fetch(
    `${origin}/assets/${builtAssets.sort()[0]}`,
  );
  assert.equal(immutableResponse.status, 200);
  assert.equal(
    immutableResponse.headers.get("cache-control"),
    "public, max-age=31536000, immutable",
  );

  const vendorResponse = await fetch(`${origin}/vendor/gsap/3.12.5/gsap.min.js`);
  assert.equal(vendorResponse.status, 200);
  assert.equal(
    vendorResponse.headers.get("cache-control"),
    "public, max-age=31536000, immutable",
  );
}

async function verifyReadyBeforeImages(browser, origin) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let releaseImage;
  const imageReleased = new Promise((resolveRelease) => {
    releaseImage = resolveRelease;
  });
  await page.route("**/formwork-meridian/assets/hero.jpg", async (route) => {
    await imageReleased;
    await route.continue();
  });
  await page.addInitScript(() => {
    window.__celebrationReady = false;
    window.addEventListener("message", (event) => {
      if (event.data?.type === "kakomonn:celebration-ready") {
        window.__celebrationReady = true;
      }
    });
  });
  try {
    await page.goto(
      `${origin}/experiences/formwork-meridian/?${search}`,
      { waitUntil: "domcontentloaded" },
    );
    await page.waitForFunction(() => window.__celebrationReady === true);
    assert.equal(await page.evaluate(() => document.readyState), "interactive");
  } finally {
    releaseImage();
    await page.waitForLoadState("load");
    await page.close();
  }
}

const server = await startStaticServer();
const browser = await chromium.launch({ headless: true });
try {
  await verifyLocalCachePolicy(server.origin);
  await verifyReadyBeforeImages(browser, server.origin);
  await verifyFrameVisibleBeforeReady(browser, server.origin);
  for (const [index, experience] of manifest.experiences.entries()) {
    await verifyShell(browser, server.origin, experience, index);
  }
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
