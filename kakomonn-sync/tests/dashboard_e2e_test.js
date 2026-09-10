const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium, webkit } = require("playwright");
const {
  kakomonnFreeEnvironment,
  readKakomonnConfiguration,
} = require("../../scripts/kakomonn-config.cjs");

const distDir = path.resolve(__dirname, "..", "dist");
const token = "test-dashboard-token";
const site = "chushoks.kakomonn.com";
const otherSite = "shindans.kakomonn.com";
const kakomonnConfiguration = readKakomonnConfiguration();
const attemptedQuestionCountHistory = [0, 22, 19, 0, 31, 24, 50];
const deltaHistory = [null, 112, -14, 0, 138, 106, 104];
const closingStabilityDaysHistory = [null, 9307, 9412, 9550, 9688, 9794, 9912];
const correctRateHistory = [null, 100, 33, null, 75, 50, 67];
const history = Array.from({ length: 31 }, (_, index) => {
  const currentWeekIndex = index - 24;
  return {
    date: new Date(Date.UTC(2026, 7, 10 - (30 - index))).toISOString().slice(0, 10),
    closingStabilityDays: currentWeekIndex < 0 ? null : closingStabilityDaysHistory[currentWeekIndex],
    stabilityDaysDelta: currentWeekIndex < 0 ? null : deltaHistory[currentWeekIndex],
    dailyAttemptedQuestionCount: currentWeekIndex < 0 ? 0 : attemptedQuestionCountHistory[currentWeekIndex],
    dailyNewQuestionCount: currentWeekIndex < 0 ? 0 : attemptedQuestionCountHistory[currentWeekIndex],
    dailyCorrectRatePercent: currentWeekIndex < 0 ? null : correctRateHistory[currentWeekIndex],
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
      attempted_question_count: 50,
      new_question_count: 50,
      attempt_count: 51,
      correct_attempt_count: 34,
    }],
    attempts: Array.from({ length: 51 }, (_, index) => ({
      site,
      operation_id: (index + 1).toString(16).padStart(32, "0"),
      question_id: String(44615 + Math.min(index, 49)),
      attempted_at_ms: 1786320000000 + index,
      answer_result: index < 34 ? "correct" : "incorrect",
      previous_card_stability_days: 31.25,
      resulting_card_stability_days: 42.75,
    })),
  },
};

function dashboardFixture(requestedSite) {
  return {
    sites: [site, otherSite],
    selectedSite: requestedSite,
    state: {
      site: requestedSite,
      today: "2026-08-10",
      learningMetrics: {
        stabilityDays: requestedSite === site ? 9912 : 2999,
        dailyKpiCompleted: requestedSite === site,
        dueCardsCompleted: false,
        dueCardsRemaining: requestedSite === site ? 5 : 12,
        todayNewQuestionCount: requestedSite === site ? 50 : 30,
        newQuestionGoal: 50,
        newQuestionsRemaining: requestedSite === site ? 0 : 20,
        todayStabilityDaysDelta: requestedSite === site ? 104 : 21,
        attemptedQuestionCount: requestedSite === site ? 640 : 100,
        todayAttemptedQuestionCount: requestedSite === site ? 50 : 30,
        todayCorrectRatePercent: requestedSite === site ? 67 : 0,
      },
      catalog: {
        questionCount: 999,
        updatedAtMs: 1786320000000,
        generation: 1,
      },
    },
    history: {
      site: requestedSite,
      timeZone: "Asia/Tokyo",
      today: "2026-08-10",
      days: requestedSite === site
        ? history
        : history.map((day, index) => ({
            ...day,
            closingStabilityDays: index < 24 ? null : 2999,
            stabilityDaysDelta:
              index < 24 ? null : index === 30 ? 21 : day.stabilityDaysDelta ?? 0,
            dailyAttemptedQuestionCount: index === 30 ? 30 : day.dailyAttemptedQuestionCount,
            dailyNewQuestionCount: index === 30 ? 30 : day.dailyNewQuestionCount,
            dailyCorrectRatePercent: index === 30 ? 0 : day.dailyCorrectRatePercent,
          })),
    },
  };
}

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
]);

function builtAssetForPath(pathname) {
  const relativePath = pathname === "/"
    ? "index.html"
    : pathname === "/open"
      ? "open.html"
      : decodeURIComponent(pathname).replace(/^\//, "");
  const assetPath = path.resolve(distDir, relativePath);
  assert.equal(assetPath.startsWith(`${distDir}${path.sep}`), true);
  return assetPath;
}

async function launchBrowser(browserType = chromium) {
  const executablePath =
    browserType === chromium
      ? kakomonnConfiguration.KAKOMONN_CHROMIUM_EXECUTABLE
      : "";
  return browserType.launch({
    env: kakomonnFreeEnvironment(),
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: executablePath ? ["--no-sandbox"] : [],
  });
}

async function installApiMock(page) {
  await page.addInitScript(
    ({ tokenValue, siteValue, otherSiteValue, dashboardBySite, dailyDetailsValue }) => {
      const storage = new Map([
        ["kakomonn-dashboard.sync-token", tokenValue],
        ["kakomonn-dashboard.site", siteValue],
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
      window.__nativeFetchCalls = 0;
      window.fetch = async () => {
        window.__nativeFetchCalls += 1;
        throw new Error("dashboard must use the userscript bridge");
      };
      const respond = (response) => document.dispatchEvent(new CustomEvent(
        "kakomonn-dashboard:response",
        { detail: JSON.stringify(response) },
      ));
      document.addEventListener("kakomonn-dashboard:request", async (event) => {
        const request = JSON.parse(event.detail);
        window.__apiCalls.push(request);
        if (request.operation === "dashboard") {
          const requestedSite = [siteValue, otherSiteValue].includes(request.site)
            ? request.site
            : siteValue;
          if (requestedSite === window.__delayedSite) {
            await new Promise((resolve) => window.__delayedResolvers.push(resolve));
          }
          respond({ data: dashboardBySite[requestedSite], id: request.id, ok: true });
          return;
        }
        if (request.operation === "daily-details") {
          const requestedSite = request.site;
          const date = request.date;
          if (date === window.__delayedDetailDate) {
            await new Promise((resolve) => window.__delayedDetailResolvers.push(resolve));
          }
          if (date === window.__detailErrorDate) {
            respond({ code: "request_failed", id: request.id, ok: false, status: 500 });
            return;
          }
          const data = requestedSite === siteValue && date === dailyDetailsValue.date
            ? dailyDetailsValue
            : {
            site: requestedSite,
            date,
            timeZone: "Asia/Tokyo",
            tables: { stability_history: [], attempts: [] },
          };
          respond({ data, id: request.id, ok: true });
          return;
        }
        respond({ code: "invalid_request", id: request.id, ok: false, status: 0 });
      });
      const markReady = () => {
        if (document.documentElement === null) {
          document.addEventListener("readystatechange", markReady, { once: true });
          return;
        }
        document.documentElement.setAttribute(
          "data-kakomonn-dashboard-bridge-state",
          "ready",
        );
      };
      markReady();
    },
    {
      tokenValue: token,
      siteValue: site,
      otherSiteValue: otherSite,
      dashboardBySite: {
        [site]: dashboardFixture(site),
        [otherSite]: dashboardFixture(otherSite),
      },
      dailyDetailsValue: dailyDetails,
    },
  );
}

async function assertDashboard(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? String(error)));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await installApiMock(page);
  await page.route("https://dashboard.test/**", async (route) => {
    const assetPath = builtAssetForPath(new URL(route.request().url()).pathname);
    await route.fulfill({
      body: fs.readFileSync(assetPath),
      contentType: contentTypes.get(path.extname(assetPath)) ?? "application/octet-stream",
    });
  });
  await page.goto("https://dashboard.test/");
  await page.waitForFunction(() => document.querySelector("#today-stability-days-delta")?.textContent === "+104");

  assert.equal(await page.locator("#primary-kpi-title").innerText(), "dailyKpiCompleted");
  assert.equal(await page.locator("#daily-kpi-completed").innerText(), "達成");
  assert.equal(await page.locator("#daily-kpi-completed").getAttribute("data-completed"), "true");
  assert.deepEqual(await page.locator(".primary-kpi-remaining > span").allInnerTexts(), ["dueCardsRemaining", "newQuestionsRemaining"]);
  assert.equal(await page.locator("#due-cards-remaining").innerText(), "5");
  assert.equal(await page.locator("#new-questions-remaining").innerText(), "0");
  assert.equal(await page.locator("#today-stability-days-delta").innerText(), "+104");
  assert.equal(await page.locator("#stability-days").innerText(), "9,912");
  assert.equal(await page.locator(".goal-card").count(), 0);
  assert.deepEqual(await page.locator(".metric-list dt").allInnerTexts(), ["todayStabilityDaysDelta", "stabilityDays", "attemptedQuestionCount", "todayAttemptedQuestionCount", "todayCorrectRatePercent"]);
  assert.equal(await page.locator("#attempted-question-count").innerText(), "640");
  assert.equal(await page.locator("#today-attempted-question-count").innerText(), "50");
  assert.equal(await page.locator("#today-correct-rate-percent").innerText(), "67");
  assert.equal(await page.locator("#today-correct-rate-percent-unit").innerText(), "%");
  assert.equal(await page.locator("#goal-label, #goal-progress, .stability-card, .stability-meta").count(), 0);
  assert.equal(await page.locator("#dashboard *").evaluateAll((elements) => elements.filter((element) => element.childElementCount === 0 && element.textContent.trim() === "+104" && element.getClientRects().length > 0).length), 2);
  assert.equal(await page.locator("#history-title").innerText(), "stabilityDaysDeltaとdailyCorrectRatePercentの31日推移");
  assert.equal(await page.locator("#stability-chart .chart-day").count(), 31);
  assert.equal(await page.locator("#stability-chart rect.delta-bar").count(), 6);
  assert.equal(await page.locator("#stability-chart rect.delta-bar.negative").count(), 1);
  assert.equal(await page.locator("#stability-chart rect.delta-bar.zero").count(), 1);
  assert.equal(await page.locator("#stability-chart .delta-value-label").count(), 6);
  assert.equal(await page.locator('[data-chart-date="2026-08-10"] .delta-value-label').textContent(), "+104");
  assert.equal(await page.locator('[data-chart-date="2026-08-09"] .delta-value-label').textContent(), "+106");
  assert.equal(await page.locator("#stability-chart .correct-rate-line").count(), 1);
  assert.equal(await page.locator("#stability-chart .correct-rate-point").count(), 5);
  assert.match(await page.locator("#stability-chart .correct-rate-line").getAttribute("d"), /^M[^M]+M/);
  assert.equal(await page.locator('[data-chart-date="2026-08-10"] .correct-rate-value-label').textContent(), "67%");
  assert.equal(await page.locator('[data-chart-date="2026-08-04"] .correct-rate-value-label').textContent(), "--");
  assert.match(await page.locator('[data-chart-date="2026-08-10"]').getAttribute("aria-label"), /stabilityDaysDelta \+104日, dailyCorrectRatePercent 67%/);
  assert.equal((await page.locator("#stability-chart-axis .delta-axis-label").count()) >= 2, true);
  assert.match(await page.locator("#history-chart-description").textContent(), /2026-08-04, stabilityDaysDelta 記録なし/);
  assert.match(await page.locator("#history-chart-description").textContent(), /2026-08-10, stabilityDaysDelta \+104日/);
  assert.match(await page.locator("#history-chart-description").textContent(), /dailyCorrectRatePercent 67%/);
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
  assert.equal(await page.locator(".primary-kpi-card").innerText().then((value) => value.includes("解いた問題数")), false);
  const calls = await page.evaluate(() => window.__apiCalls);
  assert.equal(calls.some((call) => !["dashboard", "daily-details"].includes(call.operation)), false);
  assert.equal(calls.filter((call) => call.operation === "dashboard").length, 1);
  assert.equal(await page.evaluate(() => window.__nativeFetchCalls), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem("kakomonn-dashboard.sync-token")), null);
  assert.deepEqual(errors, []);

  await page.locator('[data-chart-date="2026-08-10"]').click();
  await page.waitForFunction(() => document.querySelector("#attempts-table tbody td")?.textContent === "chushoks.kakomonn.com");
  assert.equal(await page.locator('[data-chart-date="2026-08-10"]').getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator("#daily-details-date").innerText(), "2026-08-10");
  assert.equal(await page.locator("#stability-history-table th").allInnerTexts().then((values) => values.join("\n")), "site\ndate\nopening_stability_days\nclosing_stability_days\nattempted_question_count\nnew_question_count\nattempt_count\ncorrect_attempt_count");
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
  await page.waitForFunction(() => document.querySelector("#daily-details-date")?.textContent === "2026-08-10" && document.querySelector("#daily-details-status")?.textContent === "52 rows");
  await page.evaluate(() => window.__releaseDelayedDetail());
  await page.waitForTimeout(20);
  assert.equal(await page.locator("#daily-details-date").innerText(), "2026-08-10");

  await page.evaluate(() => { window.__detailErrorDate = "2026-08-07"; });
  await page.locator('[data-chart-date="2026-08-07"]').click();
  await page.waitForFunction(() => document.querySelector("#daily-details-status")?.textContent === "日別詳細を読み込めませんでした.");
  assert.equal(await page.locator("#dashboard").isVisible(), true);
  await page.evaluate(() => { window.__detailErrorDate = ""; });
  await page.locator('[data-chart-date="2026-08-10"]').click();
  await page.waitForFunction(() => document.querySelector("#daily-details-status")?.textContent === "52 rows");

  await page.locator("#site-select").selectOption(otherSite);
  await page.waitForFunction(() => document.querySelector("#today-stability-days-delta")?.textContent === "+21");
  assert.equal(await page.locator("#daily-kpi-completed").innerText(), "未達成");
  assert.equal(await page.locator("#due-cards-remaining").innerText(), "12");
  assert.equal(await page.locator("#new-questions-remaining").innerText(), "20");
  assert.equal(await page.locator("#today-correct-rate-percent").innerText(), "0");
  assert.equal(await page.locator("#today-correct-rate-percent-unit").isHidden(), false);
  await page.locator("#site-select").selectOption(site);
  await page.waitForFunction(() => document.querySelector("#today-stability-days-delta")?.textContent === "+104");

  await page.evaluate((siteValue) => { window.__delayedSite = siteValue; }, otherSite);
  await page.locator("#site-select").selectOption(otherSite);
  await page.locator("#site-select").selectOption(site);
  await page.waitForFunction(() => document.querySelector("#today-stability-days-delta")?.textContent === "+104");
  await page.evaluate(() => window.__releaseDelayedSite());
  await page.waitForTimeout(50);
  assert.equal(await page.locator("#dashboard").isVisible(), true);
  assert.equal(await page.locator("#load-error").isVisible(), false);
  assert.equal(await page.locator("#daily-details-instruction").isVisible(), true);

  await page.locator("#refresh-button").click();
  await page.waitForFunction(() => document.querySelector("#dashboard-status")?.textContent === "更新日 2026-08-10");
  assert.equal(await page.locator("#settings-button, #settings-dialog, #auth-token").count(), 0);
}

async function assertDashboardConnectionStates(browser) {
  async function openState(mode) {
    const page = await browser.newPage();
    await page.addInitScript((bridgeMode) => {
      if (bridgeMode === "missing" || bridgeMode === "unauthorized") {
        document.addEventListener("kakomonn-dashboard:request", (event) => {
          const request = JSON.parse(event.detail);
          document.dispatchEvent(new CustomEvent("kakomonn-dashboard:response", {
            detail: JSON.stringify({
              code: bridgeMode === "missing" ? "token_missing" : "unauthorized",
              id: request.id,
              ok: false,
              status: bridgeMode === "missing" ? 0 : 401,
            }),
          }));
        });
      }
      if (bridgeMode === "timeout") return;
      const markState = () => {
        if (document.documentElement === null) {
          document.addEventListener("readystatechange", markState, { once: true });
          return;
        }
        document.documentElement.setAttribute(
          "data-kakomonn-dashboard-bridge-state",
          bridgeMode === "unavailable" ? "error" : "ready",
        );
      };
      markState();
    }, mode);
    await page.route("https://dashboard.test/**", async (route) => {
      const assetPath = builtAssetForPath(new URL(route.request().url()).pathname);
      await route.fulfill({
        body: fs.readFileSync(assetPath),
        contentType: contentTypes.get(path.extname(assetPath)) ?? "application/octet-stream",
      });
    });
    return page;
  }

  for (const mode of ["missing", "unauthorized"]) {
    const page = await openState(mode);
    try {
      await page.goto("https://dashboard.test/");
      await page.waitForFunction(() =>
        document.querySelector("#auth-title")?.textContent ===
        "Readerの同期設定が必要です");
      assert.equal(await page.locator("#auth-panel").isVisible(), true);
      assert.equal(await page.locator("#auth-token").count(), 0);
      assert.equal(
        await page.locator("#auth-actions a").getAttribute("href"),
        "https://chushoks.kakomonn.com/createques#kakomonn-next",
      );
      assert.match(
        await page.locator("#auth-message").innerText(),
        mode === "missing" ? /まだ保存されていません/ : /認証されませんでした/,
      );
    } finally {
      await page.close();
    }
  }

  const unavailablePage = await openState("unavailable");
  try {
    await unavailablePage.goto("https://dashboard.test/");
    await unavailablePage.locator("#load-error").waitFor({ state: "visible" });
    assert.match(await unavailablePage.locator("#error-message").innerText(), /最新のreader/);
  } finally {
    await unavailablePage.close();
  }

  const timeoutPage = await openState("timeout");
  try {
    await timeoutPage.clock.install();
    await timeoutPage.goto("https://dashboard.test/");
    await timeoutPage.clock.fastForward(15_000);
    await timeoutPage.locator("#load-error").waitFor({ state: "visible" });
    assert.match(await timeoutPage.locator("#error-message").innerText(), /確認できませんでした/);
  } finally {
    await timeoutPage.close();
  }
}

async function assertOpenBridge(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  let dashboardRequestCount = 0;
  await context.exposeFunction("__recordDashboardBridgeRequest", () => {
    dashboardRequestCount += 1;
  });
  await context.addInitScript(
    ({ siteValue, dashboardValue }) => {
      if (location.hostname !== "dashboard.test") return;
      localStorage.setItem("kakomonn-dashboard.site", siteValue);
      window.__dashboardBridgeRequests = [];
      document.addEventListener("kakomonn-dashboard:request", (event) => {
        const request = JSON.parse(event.detail);
        window.__dashboardBridgeRequests.push(request);
        void window.__recordDashboardBridgeRequest();
        document.dispatchEvent(new CustomEvent("kakomonn-dashboard:response", {
          detail: JSON.stringify({ data: dashboardValue, id: request.id, ok: true }),
        }));
      });
      const markReady = () => {
        if (document.documentElement === null) {
          document.addEventListener("readystatechange", markReady, { once: true });
          return;
        }
        document.documentElement.setAttribute(
          "data-kakomonn-dashboard-bridge-state",
          "ready",
        );
      };
      markReady();
    },
    { siteValue: site, dashboardValue: dashboardFixture(site) },
  );
  let readerRequestCount = 0;
  await context.route("https://dashboard.test/**", async (route) => {
    const url = new URL(route.request().url());
    const assetPath = builtAssetForPath(url.pathname);
    await route.fulfill({
      body: fs.readFileSync(assetPath),
      contentType: contentTypes.get(path.extname(assetPath)) ?? "application/octet-stream",
    });
  });
  await context.route("https://chushoks.kakomonn.com/**", (route) => {
    readerRequestCount += 1;
    return route.fulfill({
      body: "<!doctype html><html lang=\"ja\"><title>reader</title><body>reader</body></html>",
      contentType: "text/html; charset=utf-8",
    });
  });

  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? String(error)));
  try {
    await page.goto("https://dashboard.test/open");
    assert.equal(page.url(), "https://dashboard.test/open");
    assert.equal(readerRequestCount, 0);
    assert.equal(
      await page.locator("#open-status-title").innerText(),
      "Readerを準備しています",
    );
    const layout = await page.evaluate(() => {
      const panel = document.querySelector("#open-bridge .open-panel").getBoundingClientRect();
      return {
        panelLeft: panel.left,
        panelRight: panel.right,
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });
    assert.equal(layout.scrollWidth <= layout.viewportWidth, true, JSON.stringify(layout));
    assert.equal(layout.panelLeft >= 0, true, JSON.stringify(layout));
    assert.equal(layout.panelRight <= layout.viewportWidth, true, JSON.stringify(layout));

    await page.evaluate(() => {
      document.documentElement.dataset.kakomonnReaderBridgeTarget =
        "https://chushoks.kakomonn.com/questions/45124";
      document.documentElement.dataset.kakomonnReaderBridgeState = "ready";
    });
    await page.waitForURL("https://chushoks.kakomonn.com/questions/45124");
    assert.equal(readerRequestCount, 1);
    assert.equal(dashboardRequestCount, 0);

    await page.goBack();
    await page.waitForURL("https://dashboard.test/");
    await page.waitForFunction(
      () => document.querySelector("#today-stability-days-delta")?.textContent === "+104",
    );
    assert.equal(await page.locator("#dashboard").isVisible(), true);
    assert.equal(await page.locator("#daily-kpi-completed").innerText(), "達成");
    assert.equal(dashboardRequestCount, 1);

    const unavailablePage = await context.newPage();
    unavailablePage.on("pageerror", (error) => errors.push(error.stack ?? String(error)));
    await unavailablePage.goto("https://dashboard.test/open");
    await unavailablePage.evaluate(() => {
      document.documentElement.dataset.kakomonnReaderBridgeState = "error";
    });
    await unavailablePage.locator("#open-error").waitFor({ state: "visible" });
    assert.equal(
      await unavailablePage.locator("#open-error-title").innerText(),
      "Readerを起動できません",
    );
    assert.equal(
      await unavailablePage.locator("#open-error-message").innerText(),
      "Tampermonkeyと過去問readerが有効か確認して, ページを再読み込みしてください.",
    );
    assert.match(
      await unavailablePage.locator("#open-error-detail").innerText(),
      /code=reader_unavailable$/,
    );
    const reloadButton = unavailablePage.locator("#open-error-reload");
    await reloadButton.focus();
    assert.equal(
      await unavailablePage.evaluate(() => document.activeElement?.id),
      "open-error-reload",
    );
    assert.equal((await reloadButton.boundingBox()).height >= 44, true);
    assert.equal(
      (await unavailablePage.getByRole("link", { name: "dashboardへ戻る" }).boundingBox()).height >= 44,
      true,
    );
    await unavailablePage.close();

    for (const bridgeFailure of [
      {
        code: "invalid_url",
        state: "ready",
        target: "https://chushoks.kakomonn.com:444/questions/45124",
        title: "次の問題を開けません",
      },
      {
        code: "no_next_question",
        state: "empty",
        title: "今解く問題はありません",
      },
      {
        code: "sync_unauthorized",
        state: "unauthorized",
        title: "同期tokenを確認してください",
      },
    ]) {
      const failurePage = await context.newPage();
      failurePage.on("pageerror", (error) => errors.push(error.stack ?? String(error)));
      await failurePage.goto("https://dashboard.test/open");
      await failurePage.evaluate(({ state, target }) => {
        if (target !== undefined) {
          document.documentElement.setAttribute(
            "data-kakomonn-reader-bridge-target",
            target,
          );
        }
        document.documentElement.dataset.kakomonnReaderBridgeState = state;
      }, bridgeFailure);
      await failurePage.locator("#open-error").waitFor({ state: "visible" });
      assert.equal(
        await failurePage.locator("#open-error-title").innerText(),
        bridgeFailure.title,
      );
      assert.match(
        await failurePage.locator("#open-error-detail").innerText(),
        new RegExp(`code=${bridgeFailure.code}$`),
      );
      assert.equal(readerRequestCount, 1);
      await failurePage.close();
    }

    const timeoutPage = await context.newPage();
    timeoutPage.on("pageerror", (error) => errors.push(error.stack ?? String(error)));
    await timeoutPage.clock.install();
    await timeoutPage.goto("https://dashboard.test/open");
    await timeoutPage.clock.fastForward(15_000);
    await timeoutPage.locator("#open-error").waitFor({ state: "visible" });
    assert.match(
      await timeoutPage.locator("#open-error-detail").innerText(),
      /code=reader_ready_timeout$/,
    );
    assert.equal(readerRequestCount, 1);
    await timeoutPage.close();
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
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
    await assertDashboardConnectionStates(browser);
    await assertOpenBridge(browser);
  } finally {
    await browser.close();
  }
  const webkitBrowser = await launchBrowser(webkit);
  try {
    const dashboard = await webkitBrowser.newPage({ viewport: { width: 390, height: 844 } });
    await assertDashboard(dashboard);
    await dashboard.close();
    await assertOpenBridge(webkitBrowser);
  } finally {
    await webkitBrowser.close();
  }
  console.log("dashboard KPI E2E passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
