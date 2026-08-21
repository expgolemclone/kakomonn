const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const publicDir = path.resolve(__dirname, "..", "public");
const token = "test-dashboard-token";
const site = "chushoks.kakomonn.com";
const otherSite = "shindans.kakomonn.com";
const attemptedQuestionCountHistory = [18, 22, 19, 26, 31, 24, 28];
const deltaHistory = [null, 112, -14, 0, 138, 106, 104];
const closingStabilityDaysHistory = [null, 9307, 9412, 9550, 9688, 9794, 9912];
const history = Array.from({ length: 31 }, (_, index) => {
  const currentWeekIndex = index - 24;
  return {
    date: new Date(Date.UTC(2026, 7, 10 - (30 - index))).toISOString().slice(0, 10),
    closingStabilityDays: currentWeekIndex < 0 ? null : closingStabilityDaysHistory[currentWeekIndex],
    stabilityDaysDelta: currentWeekIndex < 0 ? null : deltaHistory[currentWeekIndex],
    dailyAttemptedQuestionCount: currentWeekIndex < 0 ? 0 : attemptedQuestionCountHistory[currentWeekIndex],
  };
});
const dailyDetails = {
  site,
  date: "2026-08-10",
  timeZone: "Asia/Tokyo",
  tables: {
    stability_history: [{
      site,
      date: "2026-08-10",
      opening_stability_days: 9808,
      closing_stability_days: 9912,
    }],
    attempts: [{
      site,
      operation_id: "00000000000000000000000000000001",
      question_id: "44615",
      attempted_at_ms: 1786320000000,
      answer_result: "correct",
      previous_card_stability_days: 31.25,
      resulting_card_stability_days: 42.75,
    }],
  },
};

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
    ({ tokenValue, siteValue, otherSiteValue, historyValue, dailyDetailsValue }) => {
      const storage = new Map([
        ["kakomonn-dashboard.sync-token", tokenValue],
        ["kakomonn-dashboard.site", siteValue],
      ]);
      const settingsValues = new Map([
        [siteValue, { site: siteValue, dailyStabilityDaysDeltaGoal: 30 }],
        [otherSiteValue, { site: otherSiteValue, dailyStabilityDaysDeltaGoal: 100 }],
      ]);
      window.__delayedSite = "";
      window.__delayedResolvers = [];
      window.__releaseDelayedSite = () => {
        window.__delayedSite = "";
        for (const resolve of window.__delayedResolvers.splice(0)) resolve();
      };
      window.__delayedDetailDate = "";
      window.__delayedDetailResolvers = [];
      window.__releaseDelayedDetail = () => {
        window.__delayedDetailDate = "";
        for (const resolve of window.__delayedDetailResolvers.splice(0)) resolve();
      };
      window.__detailErrorDate = "";
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
        if (url.pathname === "/v7/dashboard") {
          const requestedSite = [siteValue, otherSiteValue].includes(url.searchParams.get("site"))
            ? url.searchParams.get("site")
            : siteValue;
          if (requestedSite === window.__delayedSite) {
            await new Promise((resolve) => window.__delayedResolvers.push(resolve));
          }
          return respond(200, {
            sites: [siteValue, otherSiteValue],
            selectedSite: requestedSite,
            state: {
              site: requestedSite,
              today: "2026-08-10",
              learningMetrics: {
                stabilityDays: requestedSite === siteValue ? 9912 : 2999,
                todayStabilityDaysDelta: requestedSite === siteValue ? 104 : 21,
                attemptedQuestionCount: requestedSite === siteValue ? 640 : 100,
                todayAttemptedQuestionCount: requestedSite === siteValue ? 28 : 4,
              },
              catalog: { questionCount: 999, updatedAtMs: Date.now() },
            },
            history: {
              site: requestedSite,
              timeZone: "Asia/Tokyo",
              today: "2026-08-10",
              days: requestedSite === siteValue
                ? historyValue
                : historyValue.map((day) => ({ ...day, closingStabilityDays: 2999 })),
            },
            settings: settingsValues.get(requestedSite),
          });
        }
        if (url.pathname === "/v7/daily-details") {
          const requestedSite = url.searchParams.get("site");
          const date = url.searchParams.get("date");
          if (date === window.__delayedDetailDate) {
            await new Promise((resolve) => window.__delayedDetailResolvers.push(resolve));
          }
          if (date === window.__detailErrorDate) return respond(500, { error: "request_failed" });
          if (requestedSite === siteValue && date === dailyDetailsValue.date) return respond(200, dailyDetailsValue);
          return respond(200, {
            site: requestedSite,
            date,
            timeZone: "Asia/Tokyo",
            tables: { stability_history: [], attempts: [] },
          });
        }
        if (url.pathname === "/v7/settings" && init.method === "PUT") {
          const settingsValue = JSON.parse(init.body);
          settingsValues.set(settingsValue.site, settingsValue);
          return respond(200, settingsValue);
        }
        return respond(404, { error: "not_found" });
      };
    },
    { tokenValue: token, siteValue: site, otherSiteValue: otherSite, historyValue: history, dailyDetailsValue: dailyDetails },
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
  await page.waitForFunction(() => document.querySelector("#today-stability-days-delta")?.textContent === "+104");

  assert.equal(await page.locator("#primary-kpi-title").innerText(), "todayStabilityDaysDelta");
  assert.equal(await page.locator("#today-stability-days-delta").innerText(), "+104");
  assert.equal(await page.locator("#stability-days").innerText(), "9,912");
  assert.equal(await page.locator("#goal-title").innerText(), "dailyStabilityDaysDeltaGoal");
  assert.equal(await page.locator('label[for="daily-goal"]').innerText(), "dailyStabilityDaysDeltaGoal");
  assert.equal(await page.locator("#daily-goal").inputValue(), "30");
  assert.deepEqual(await page.locator(".metric-list dt").allInnerTexts(), ["stabilityDays", "attemptedQuestionCount", "todayAttemptedQuestionCount"]);
  assert.equal(await page.locator("#attempted-question-count").innerText(), "640");
  assert.equal(await page.locator("#today-attempted-question-count").innerText(), "28");
  assert.equal(await page.locator("#goal-label, #goal-progress, .stability-card, .stability-meta").count(), 0);
  assert.equal(await page.locator("#dashboard *").evaluateAll((elements) => elements.filter((element) => element.childElementCount === 0 && element.textContent.trim() === "+104" && element.getClientRects().length > 0).length), 1);
  assert.equal(await page.locator("#history-title").innerText(), "stabilityDaysDeltaの31日推移");
  assert.equal(await page.locator("#stability-chart .chart-day").count(), 31);
  assert.equal(await page.locator("#stability-chart rect.delta-bar").count(), 6);
  assert.equal(await page.locator("#stability-chart rect.delta-bar.negative").count(), 1);
  assert.equal(await page.locator("#stability-chart rect.delta-bar.zero").count(), 1);
  assert.equal(await page.locator("#stability-chart .delta-value-label").count(), 5);
  assert.equal(await page.locator('[data-chart-date="2026-08-10"] .delta-value-label').count(), 0);
  assert.equal(await page.locator('[data-chart-date="2026-08-09"] .delta-value-label').textContent(), "+106");
  assert.match(await page.locator('[data-chart-date="2026-08-10"]').getAttribute("aria-label"), /stabilityDaysDelta \+104日/);
  assert.equal((await page.locator("#stability-chart-axis .delta-axis-label").count()) >= 2, true);
  assert.match(await page.locator("#history-chart-description").textContent(), /2026-08-04, stabilityDaysDelta 記録なし/);
  assert.match(await page.locator("#history-chart-description").textContent(), /2026-08-10, stabilityDaysDelta \+104日/);
  await page.waitForFunction(() => {
    const scroller = document.querySelector("#history-scroll");
    return scroller !== null && scroller.scrollWidth > scroller.clientWidth && Math.abs(scroller.scrollLeft - (scroller.scrollWidth - scroller.clientWidth)) <= 1;
  });
  assert.equal(await page.locator("#history-scroll").getAttribute("tabindex"), "0");
  assert.match(await page.locator("#history-scroll").getAttribute("aria-label"), /左右にスワイプまたはスクロール/);
  await page.locator("#history-scroll").evaluate((scroller) => { scroller.scrollLeft = 0; });
  assert.equal(await page.locator('[data-chart-date="2026-07-11"]').evaluate((day) => {
    const dayRect = day.getBoundingClientRect();
    const scrollRect = day.closest("#history-scroll").getBoundingClientRect();
    return dayRect.left >= scrollRect.left - 1 && dayRect.right <= scrollRect.right + 1;
  }), true);
  await page.locator("#history-scroll").evaluate((scroller) => { scroller.scrollLeft = scroller.scrollWidth; });
  assert.equal(await page.locator("#daily-details-instruction").isVisible(), true);
  assert.equal(await page.locator("#daily-details-tables").isHidden(), true);

  const text = await page.locator("body").innerText();
  assert.equal(text.includes("正解数"), false);
  assert.equal(text.includes("回答数"), false);
  assert.equal(text.includes("正答率"), false);
  assert.equal(text.includes("解いた問題数"), false);
  assert.equal(text.includes("30日以上"), false);
  assert.equal(text.includes("祝福"), false);
  assert.equal(await page.locator(".goal-card").allInnerTexts().then((values) => values.some((value) => value.includes("解いた問題数"))), false);
  const calls = await page.evaluate(() => window.__apiCalls);
  assert.equal(calls.some((call) => !call.pathname.startsWith("/v7/")), false);
  assert.equal(calls.filter((call) => call.pathname === "/v7/dashboard").length, 1);
  assert.equal(calls.filter((call) => ["/v7/sites", "/v7/state", "/v7/history"].includes(call.pathname)).length, 0);
  assert.equal(calls.filter((call) => call.pathname === "/v7/settings" && call.method === "GET").length, 0);
  assert.deepEqual(errors, []);

  await page.locator('[data-chart-date="2026-08-10"]').click();
  await page.waitForFunction(() => document.querySelector("#attempts-table tbody td")?.textContent === "chushoks.kakomonn.com");
  assert.equal(await page.locator('[data-chart-date="2026-08-10"]').getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator("#daily-details-date").innerText(), "2026-08-10");
  assert.equal(await page.locator("#stability-history-table th").allInnerTexts().then((values) => values.join("\n")), "site\ndate\nopening_stability_days\nclosing_stability_days");
  assert.equal(await page.locator("#attempts-table th").allInnerTexts().then((values) => values.join("\n")), "site\noperation_id\nquestion_id\nattempted_at_ms\nanswer_result\nprevious_card_stability_days\nresulting_card_stability_days");
  assert.equal(await page.locator("#attempts-table tbody").innerText().then((value) => value.includes("1786320000000")), true);
  assert.equal(await page.locator("#attempts-table tbody").innerText().then((value) => value.includes("1,786,320,000,000")), false);

  await page.locator('[data-chart-date="2026-08-09"]').focus();
  await page.locator('[data-chart-date="2026-08-09"]').press("Enter");
  await page.waitForFunction(() => document.querySelector("#daily-details-date")?.textContent === "2026-08-09" && document.querySelector("#daily-details-status")?.textContent === "0 rows");
  assert.equal(await page.locator("#stability-history-table tbody").innerText(), "0 rows");
  assert.equal(await page.locator("#attempts-table tbody").innerText(), "0 rows");

  await page.evaluate(() => { window.__delayedDetailDate = "2026-08-08"; });
  await page.locator('[data-chart-date="2026-08-08"]').press("Space");
  await page.locator('[data-chart-date="2026-08-10"]').click();
  await page.waitForFunction(() => document.querySelector("#daily-details-date")?.textContent === "2026-08-10" && document.querySelector("#daily-details-status")?.textContent === "2 rows");
  await page.evaluate(() => window.__releaseDelayedDetail());
  await page.waitForTimeout(20);
  assert.equal(await page.locator("#daily-details-date").innerText(), "2026-08-10");

  await page.evaluate(() => { window.__detailErrorDate = "2026-08-07"; });
  await page.locator('[data-chart-date="2026-08-07"]').click();
  await page.waitForFunction(() => document.querySelector("#daily-details-status")?.textContent === "日別詳細を読み込めませんでした.");
  assert.equal(await page.locator("#dashboard").isVisible(), true);
  await page.evaluate(() => { window.__detailErrorDate = ""; });
  await page.locator('[data-chart-date="2026-08-10"]').click();
  await page.waitForFunction(() => document.querySelector("#daily-details-status")?.textContent === "2 rows");

  await page.locator("#daily-goal").fill("250");
  await page.locator("#save-goal").click();
  await page.waitForFunction(() => document.querySelector("#dashboard-status")?.textContent === "dailyStabilityDaysDeltaGoalを同期しました.");
  assert.equal(await page.locator("#daily-goal").inputValue(), "250");
  assert.equal((await page.locator(".goal-card").innerText()).includes("+104"), false);
  assert.equal(
    await page.evaluate(() => localStorage.getItem("今日の定着日数純増目標")),
    null,
  );
  const updatedCalls = await page.evaluate(() => window.__apiCalls);
  assert.equal(updatedCalls.filter((call) => call.pathname === "/v7/settings" && call.method === "PUT").length, 1);

  await page.evaluate((siteValue) => { window.__delayedSite = siteValue; }, otherSite);
  await page.locator("#site-select").selectOption(otherSite);
  await page.locator("#site-select").selectOption(site);
  await page.waitForFunction(() => document.querySelector("#today-stability-days-delta")?.textContent === "+104");
  await page.evaluate(() => window.__releaseDelayedSite());
  await page.waitForTimeout(50);
  assert.equal(await page.locator("#dashboard").isVisible(), true);
  assert.equal(await page.locator("#load-error").isVisible(), false);
  assert.equal(await page.locator("#daily-details-instruction").isVisible(), true);

  await page.locator("#settings-button").click();
  await page.locator("#settings-token").fill("incorrect-token");
  await page.locator("#settings-form button[type=submit]").click();
  await page.waitForFunction(() => document.querySelector("#settings-message")?.textContent === "同期tokenが正しくありません.");
  await page.locator("#settings-close").click();
  await page.locator("#refresh-button").click();
  await page.waitForFunction(() => document.querySelector("#dashboard-status")?.textContent === "更新日 2026-08-10");
  const finalCalls = await page.evaluate(() => window.__apiCalls);
  const finalDashboardCall = finalCalls.filter((call) => call.pathname === "/v7/dashboard").at(-1);
  assert.equal(finalDashboardCall.authorization, `Bearer ${token}`);
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
  console.log("dashboard KPI E2E passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
