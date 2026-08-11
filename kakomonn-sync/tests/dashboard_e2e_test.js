const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const publicDir = path.resolve(__dirname, "..", "public");
const token = "test-dashboard-token";
const site = "chushoks.kakomonn.com";
const otherSite = "shindans.kakomonn.com";
const solvedHistory = [18, 22, 19, 26, 31, 24, 28];
const history = [306, 307, 307, 309, 310, 308, 312].map((mastered, index) => ({
  date: `2026-08-${String(index + 4).padStart(2, "0")}`,
  mastered,
  solved: solvedHistory[index],
}));

function fixtureHTML() {
  return fs
    .readFileSync(path.join(publicDir, "index.html"), "utf8")
    .replace(/<link rel="stylesheet" href="\/styles\.css">/, "")
    .replace(/<script defer src="\/app\.js"><\/script>/, "");
}

const appSource = fs.readFileSync(path.join(publicDir, "app.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(publicDir, "styles.css"), "utf8");

async function launchBrowser() {
  const executablePath = process.env.KAKOMONN_CHROMIUM_EXECUTABLE;
  return chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: executablePath ? ["--no-sandbox"] : [],
  });
}

async function installApiMock(page) {
  await page.evaluate(
    ({ tokenValue, siteValue, otherSiteValue, historyValue }) => {
      const storage = new Map([
        ["kakomonn-dashboard.sync-token", tokenValue],
        ["kakomonn-dashboard.site", siteValue],
      ]);
      let settingsValue = { dailyMasteryGoal: 5 };
      window.__delayedSite = "";
      window.__delayedResolvers = [];
      window.__releaseDelayedSite = () => {
        window.__delayedSite = "";
        for (const resolve of window.__delayedResolvers.splice(0)) resolve();
      };
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: {
          get length() { return storage.size; },
          clear() { storage.clear(); },
          getItem(key) { return storage.has(String(key)) ? storage.get(String(key)) : null; },
          key(index) { return [...storage.keys()][index] ?? null; },
          removeItem(key) { storage.delete(String(key)); },
          setItem(key, value) { storage.set(String(key), String(value)); },
        },
      });
      window.__apiCalls = [];
      window.fetch = async (input, init = {}) => {
        const url = new URL(String(input), "https://dashboard.test");
        const headers = new Headers(init.headers ?? {});
        window.__apiCalls.push({
          pathname: url.pathname,
          search: url.search,
          method: init.method ?? "GET",
          authorization: headers.get("Authorization"),
        });
        const respond = (status, body) =>
          new Response(JSON.stringify(body), {
            status,
            headers: { "Content-Type": "application/json" },
          });
        if (headers.get("Authorization") !== `Bearer ${tokenValue}`) {
          return respond(401, { error: "unauthorized" });
        }
        if (url.pathname === "/v4/sites") {
          return respond(200, { sites: [siteValue, otherSiteValue] });
        }
        if (url.pathname === "/v4/state") {
          const requestedSite = url.searchParams.get("site");
          if (requestedSite === window.__delayedSite) {
            await new Promise((resolve) => window.__delayedResolvers.push(resolve));
          }
          return respond(200, {
            site: requestedSite,
            today: "2026-08-10",
            mastered: requestedSite === siteValue ? 312 : 99,
            solved: requestedSite === siteValue ? 640 : 100,
            todaySolved: requestedSite === siteValue ? 28 : 4,
            todayDelta: requestedSite === siteValue ? 4 : 1,
            catalog: { questionCount: 999, updatedAtMs: Date.now() },
          });
        }
        if (url.pathname === "/v4/history") {
          const requestedSite = url.searchParams.get("site");
          if (requestedSite === window.__delayedSite) {
            await new Promise((resolve) => window.__delayedResolvers.push(resolve));
          }
          return respond(200, {
            site: requestedSite,
            timeZone: "Asia/Tokyo",
            today: "2026-08-10",
            days: requestedSite === siteValue
              ? historyValue
              : historyValue.map((day) => ({ ...day, mastered: 99 })),
          });
        }
        if (url.pathname === "/v4/settings" && (init.method ?? "GET") === "GET") {
          return respond(200, settingsValue);
        }
        if (url.pathname === "/v4/settings" && init.method === "PUT") {
          settingsValue = JSON.parse(init.body);
          return respond(200, settingsValue);
        }
        return respond(404, { error: "not_found" });
      };
    },
    { tokenValue: token, siteValue: site, otherSiteValue: otherSite, historyValue: history },
  );
}

async function assertDashboard(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? String(error)));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setContent(fixtureHTML());
  await installApiMock(page);
  await page.addStyleTag({ content: stylesSource });
  await page.addScriptTag({ content: appSource });
  await page.waitForFunction(() => document.querySelector("#mastered-count")?.textContent === "312");

  assert.equal(await page.locator("#mastery-title").innerText(), "定着問題数");
  assert.equal(await page.locator("#mastered-count").innerText(), "312");
  assert.equal(await page.locator("#solved-count").innerText(), "640");
  assert.equal(await page.locator(".mastery-meta").innerText(), "今日 +4\n目標 +5\n解いた問題数 640問");
  assert.equal(await page.locator("#today-delta").innerText(), "今日 +4");
  assert.equal(await page.locator("#goal-label").innerText(), "目標 +5");
  assert.equal(await page.locator("#goal-progress").innerText(), "今日 +4 / +5");
  assert.equal(await page.locator("#history-title").innerText(), "定着問題数と解いた問題数の7日推移");
  assert.equal(await page.locator("#mastery-chart rect.mastery-bar").count(), 7);
  assert.equal(await page.locator("#mastery-chart polyline.solved-line").count(), 1);
  assert.equal(await page.locator("#mastery-chart circle.solved-point").count(), 7);
  assert.equal(await page.locator("#mastery-chart .mastery-value-label").count(), 7);
  assert.equal(await page.locator("#mastery-chart .solved-value-label").count(), 7);
  assert.equal(await page.locator("#mastery-chart .mastery-axis-label").count(), 5);
  assert.equal(await page.locator("#mastery-chart .solved-axis-label").count(), 5);
  assert.equal(await page.locator(".chart-legend").innerText(), "定着問題数\n解いた問題数");
  assert.match(await page.locator("#history-chart-description").textContent(), /2026-08-10, 定着312問, 解いた問題28問/);

  const text = await page.locator("body").innerText();
  assert.equal(text.includes("正解数"), false);
  assert.equal(text.includes("回答数"), false);
  assert.equal(text.includes("正答率"), false);
  assert.equal(await page.locator(".goal-card").innerText().then((value) => value.includes("解いた問題数")), false);
  const calls = await page.evaluate(() => window.__apiCalls);
  assert.equal(calls.some((call) => call.pathname.startsWith("/v3/")), false);
  assert.equal(calls.filter((call) => call.pathname === "/v4/state").length, 1);
  assert.equal(calls.filter((call) => call.pathname === "/v4/history").length, 1);
  assert.equal(calls.filter((call) => call.pathname === "/v4/settings" && call.method === "GET").length, 1);
  assert.deepEqual(errors, []);

  await page.locator("#daily-goal").fill("7");
  await page.locator("#save-goal").click();
  await page.waitForFunction(() => document.querySelector("#goal-label")?.textContent === "目標 +7");
  assert.equal(await page.locator("#goal-label").innerText(), "目標 +7");
  assert.equal(await page.locator("#goal-progress").innerText(), "今日 +4 / +7");
  assert.equal(
    await page.evaluate(() => localStorage.getItem("今日の定着純増目標")),
    null,
  );
  const updatedCalls = await page.evaluate(() => window.__apiCalls);
  assert.equal(updatedCalls.filter((call) => call.pathname === "/v4/settings" && call.method === "PUT").length, 1);

  await page.evaluate((siteValue) => { window.__delayedSite = siteValue; }, otherSite);
  await page.locator("#site-select").selectOption(otherSite);
  await page.locator("#site-select").selectOption(site);
  await page.waitForFunction(() => document.querySelector("#mastered-count")?.textContent === "312");
  await page.evaluate(() => window.__releaseDelayedSite());
  await page.waitForTimeout(50);
  assert.equal(await page.locator("#dashboard").isVisible(), true);
  assert.equal(await page.locator("#load-error").isVisible(), false);

  await page.locator("#settings-button").click();
  await page.locator("#settings-token").fill("incorrect-token");
  await page.locator("#settings-form button[type=submit]").click();
  await page.waitForFunction(() => document.querySelector("#settings-message")?.textContent === "同期tokenが正しくありません.");
  await page.locator("#settings-close").click();
  await page.locator("#refresh-button").click();
  await page.waitForFunction(() => document.querySelector("#dashboard-status")?.textContent === "更新日 2026-08-10");
  const finalCalls = await page.evaluate(() => window.__apiCalls);
  const finalStateCall = finalCalls.filter((call) => call.pathname === "/v4/state").at(-1);
  assert.equal(finalStateCall.authorization, `Bearer ${token}`);
}

async function main() {
  const browser = await launchBrowser();
  try {
    const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await assertDashboard(desktop);
    await desktop.close();

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await assertDashboard(mobile);
    const metrics = await mobile.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }));
    assert.equal(metrics.width <= metrics.viewport, true, JSON.stringify(metrics));
    await mobile.close();
  } finally {
    await browser.close();
  }
  console.log("dashboard mastery E2E passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
