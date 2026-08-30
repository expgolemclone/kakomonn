const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const {
  kakomonnFreeEnvironment,
  readKakomonnConfiguration,
} = require("../../scripts/kakomonn-config.cjs");
const {
  installSyncMock,
  PENDING_ATTEMPT_KEY,
} = require("./sync_mock");

const projectRoot = path.resolve(__dirname, "..");
const scriptPath = path.join(projectRoot, "kakomonn-reader.user.js");
const site = "chushoks.kakomonn.com";
const chromeUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
const kakomonnConfiguration = readKakomonnConfiguration();

function questionHTML(answerResult = "unknown", nativeNextId = "999") {
  const resultClass =
    answerResult === "correct"
      ? "is-correct"
      : answerResult === "incorrect"
        ? "is-wrong"
        : "";
  return `<!doctype html><html><body>
    <main>
      <p>問題文です.</p>
      <div id="js-answer-result-box" class="${resultClass}"></div>
      <div id="js-commentary-wrap"><div class="item"><div class="none_text" hidden></div><div class="text">解説です.</div></div></div>
      <a id="native-next" href="/questions/next/${nativeNextId}">次の問題へ</a>
    </main>
  </body></html>`;
}

function linkPage(links) {
  return `<!doctype html><html><body>${links
    .map(({ href, text = href }) => `<a href="${href}">${text}</a>`)
    .join("")}</body></html>`;
}

function catalogListPage(links, currentPage, totalPages) {
  return `<!doctype html><html><head><title>問題一覧（${currentPage}/${totalPages}）</title></head><body>` +
    `<p>全${totalPages}ページ中${currentPage}ページです。</p>` +
    links.map(({ href, text = href }) => `<a href="${href}">${text}</a>`).join("") +
    `</body></html>`;
}

async function launchBrowser() {
  const executablePath =
    kakomonnConfiguration.KAKOMONN_CHROMIUM_EXECUTABLE;
  return chromium.launch({
    env: kakomonnFreeEnvironment(),
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: executablePath ? ["--no-sandbox"] : [],
  });
}

async function prepare(page, startPath, options = {}) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? String(error)));
  await page.route(`https://${site}/**`, (route) =>
    route.fulfill({ contentType: "text/html; charset=utf-8", body: questionHTML(options.answerResult, options.nativeNextId) }),
  );
  await page.goto(`https://${site}${startPath}`);
  await page.evaluate(() => {
    Object.defineProperty(window, "Audio", { configurable: true, value: undefined });
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: undefined });
    Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: undefined });
  });
  await installSyncMock(page, {
    stabilityDays: options.stabilityDays ?? 0,
    todayStabilityDaysDelta: options.todayStabilityDaysDelta ?? 0,
    todayAttemptedQuestionCount:
      options.todayAttemptedQuestionCount ?? 0,
    todayNewQuestionCount: options.todayNewQuestionCount ?? 0,
    todayAttemptCount: options.todayAttemptCount ?? 0,
    todayCorrectAttemptCount: options.todayCorrectAttemptCount ?? 0,
    dueCardsCompleted: options.dueCardsCompleted ?? false,
    dueCardsRemaining: options.dueCardsRemaining ?? 12,
    nextQuestionId: options.nextQuestionId === undefined ? "456" : options.nextQuestionId,
    pendingAttempt: options.pendingAttempt ?? null,
    pendingCelebration: options.pendingCelebration ?? null,
  });
  await page.addScriptTag({ content: fs.readFileSync(scriptPath, "utf8") });
  return errors;
}

async function readerFrame(page) {
  await page.waitForSelector("#kakomonn-reader-frame");
  await page.waitForFunction(() =>
    document.querySelector("#kakomonn-reader-daily-kpi-completed")?.textContent !== "--"
  );
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
  assert(frame, "reader frame must exist");
  await frame.waitForLoadState("load");
  await page.waitForTimeout(100);
  return frame;
}

async function revealAnswerResult(frame, answerResult) {
  await frame.locator("#js-answer-result-box").evaluate((element, result) => {
    element.classList.add(result === "correct" ? "is-correct" : "is-wrong");
  }, answerResult);
}

function attemptCalls(page) {
  return page.evaluate(() =>
    window.__syncMock.calls.filter((call) => new URL(call.url).pathname === "/v9/attempts"),
  );
}

function stateCalls(page) {
  return page.evaluate(() =>
    window.__syncMock.calls.filter((call) => new URL(call.url).pathname === "/v9/state"),
  );
}

async function runResumeWithoutRemoteRefreshCase(browser) {
  const context = await browser.newContext({ userAgent: chromeUserAgent });
  try {
    const page = await context.newPage();
    const errors = await prepare(page, "/questions/123", {
      nextQuestionId: "456",
    });
    const frame = await readerFrame(page);
    assert.equal((await stateCalls(page)).length, 1);

    await page.evaluate(async () => {
      for (let index = 0; index < 3; index += 1) {
        window.dispatchEvent(new Event("focus"));
        window.dispatchEvent(new PageTransitionEvent("pageshow"));
        document.dispatchEvent(new Event("visibilitychange"));
        await new Promise((resolve) => window.setTimeout(resolve, 20));
      }
    });
    await page.waitForTimeout(100);
    assert.equal((await stateCalls(page)).length, 1);

    await revealAnswerResult(frame, "correct");
    await page.waitForFunction(() =>
      window.__syncMock.calls.filter(
        (call) => new URL(call.url).pathname === "/v9/attempts",
      ).length === 1,
    );
    await frame.waitForURL(`https://${site}/questions/456`);
    assert.equal((await stateCalls(page)).length, 1);
    assert.equal((await attemptCalls(page)).length, 1);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function runQuestionIdCase(browser, startPath) {
  const context = await browser.newContext({ userAgent: chromeUserAgent });
  try {
    const page = await context.newPage();
    const errors = await prepare(page, startPath, {
      dueCardsRemaining: 12,
      nextQuestionId: "456",
      todayAttemptedQuestionCount: 28,
      todayAttemptCount: 2,
      todayCorrectAttemptCount: 1,
      todayStabilityDaysDelta: 104,
    });
    const frame = await readerFrame(page);
    assert.equal(await page.locator("#kakomonn-reader-next").isDisabled(), true);
    await page.evaluate(() => {
      window.__syncMock.nextAttemptStabilityDaysDelta = 31;
      window.__syncMock.nextAttemptDueCardsRemaining = 11;
    });
    await revealAnswerResult(frame, "correct");
    await page.waitForFunction(() =>
      window.__syncMock.calls.some((call) => new URL(call.url).pathname === "/v9/attempts"),
    );
    const calls = await attemptCalls(page);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.questionId, "123");
    assert.deepEqual(Object.keys(calls[0].body).sort(), ["answerResult", "operationId", "questionId", "site"]);
    await frame.waitForURL(`https://${site}/questions/456`);
    assert.equal((await attemptCalls(page)).length, 1);
    assert.equal(
      await page.evaluate((key) => window.__getGMValue(key), PENDING_ATTEMPT_KEY),
      null,
    );
    assert.equal(
      await page.evaluate(() =>
        window.__syncMock.calls.some(
          (call) => new URL(call.url).pathname === "/v9/next",
        ),
      ),
      false,
    );
    assert.equal(
      await page.locator("#kakomonn-reader-due-cards-remaining").innerText(),
      "11"
    );
    assert.equal(
      await page.locator("#kakomonn-reader-due-cards-remaining").isVisible(),
      true
    );
    assert.equal(
      await page.locator("#kakomonn-reader-learning-metrics-details").isHidden(),
      true
    );
    assert.equal(
      await page.locator("#kakomonn-reader-learning-metrics").getAttribute("aria-label"),
      "dueCardsRemaining あと11問. newQuestionsRemaining あと99問. 詳細を表示"
    );
    assert.equal(
      await page.locator("#kakomonn-reader-learning-metrics").getAttribute("aria-expanded"),
      "false"
    );
    assert.equal(
      await page.locator("#kakomonn-reader-learning-metrics-live-status").getAttribute("role"),
      "status"
    );
    assert.equal(
      await page.locator("#kakomonn-reader-learning-metrics-live-status").textContent(),
      "dueCardsRemaining あと11問. newQuestionsRemaining あと99問"
    );
    const collapsedControlsHeight = await page.locator(
      "#kakomonn-reader-controls"
    ).evaluate((element) => element.getBoundingClientRect().height);
    await page.locator("#kakomonn-reader-learning-metrics").click();
    assert.equal(
      await page.locator("#kakomonn-reader-learning-metrics").getAttribute("aria-expanded"),
      "true"
    );
    assert.equal(
      await page.locator("#kakomonn-reader-learning-metrics").getAttribute("aria-label"),
      "dueCardsRemaining あと11問. newQuestionsRemaining あと99問. 詳細を非表示"
    );
    assert.equal(
      await page.locator("#kakomonn-reader-learning-metrics-details").isVisible(),
      true
    );
    assert.equal(
      await page.locator("#kakomonn-reader-daily-kpi-completed").innerText(),
      "未達成"
    );
    assert.equal(
      await page.locator("#kakomonn-reader-due-cards-completed").innerText(),
      "未達成"
    );
    assert.equal(
      await page.locator("#kakomonn-reader-new-questions-remaining").innerText(),
      "99"
    );
    assert.equal(
      await page.locator("#kakomonn-reader-today-new-question-count").innerText(),
      "1"
    );
    assert.equal(
      await page.locator("#kakomonn-reader-new-question-goal").innerText(),
      "/ 100問"
    );
    assert.equal(
      await page.locator("#kakomonn-reader-today-stability-days-delta").innerText(),
      "+135"
    );
    assert.equal(
      await page.locator("#kakomonn-reader-today-attempted-question-count").innerText(),
      "29"
    );
    assert.equal(
      await page.locator("#kakomonn-reader-today-correct-rate-percent").innerText(),
      "67"
    );
    assert.equal(
      await page.locator("#kakomonn-reader-today-correct-rate-percent-unit").innerText(),
      "%"
    );
    assert.deepEqual(
      await page.evaluate((collapsedHeight) => {
        const controls = document
          .querySelector("#kakomonn-reader-controls")
          .getBoundingClientRect();
        const shell = document
          .querySelector("#kakomonn-reader-shell")
          .getBoundingClientRect();
        const actions = document
          .querySelector("#kakomonn-reader-actions")
          .getBoundingClientRect();
        return {
          controlsExpanded: controls.height > collapsedHeight,
          frameHasSpace: shell.height > 0,
          rowsTouch:
            Math.abs(shell.top - controls.bottom) <= 1 &&
            Math.abs(shell.bottom - actions.top) <= 1,
        };
      }, collapsedControlsHeight),
      {
        controlsExpanded: true,
        frameHasSpace: true,
        rowsTouch: true,
      }
    );
    assert.equal(
      await page.evaluate(() => {
        const remaining = Number.parseFloat(
          getComputedStyle(
            document.querySelector("#kakomonn-reader-due-cards-remaining")
          ).fontSize
        );
        const today = Number.parseFloat(
          getComputedStyle(
            document.querySelector("#kakomonn-reader-today-stability-days-delta")
          ).fontSize
        );
        return remaining > today;
      }),
      true
    );
    await page.locator("#kakomonn-reader-learning-metrics").press("Space");
    assert.equal(
      await page.locator("#kakomonn-reader-learning-metrics").getAttribute("aria-expanded"),
      "false"
    );
    assert.equal(
      await page.locator("#kakomonn-reader-learning-metrics-details").isHidden(),
      true
    );
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function runUnknownURLCase(browser) {
  const context = await browser.newContext({ userAgent: chromeUserAgent });
  try {
    const page = await context.newPage();
    const errors = await prepare(page, "/questions/current", { answerResult: "correct" });
    await readerFrame(page);
    assert.equal(
      await page.locator("#kakomonn-reader-learning-metrics-details").isHidden(),
      true
    );
    await page.locator("#kakomonn-reader-learning-metrics").click();
    assert.equal(
      await page.locator("#kakomonn-reader-today-correct-rate-percent").innerText(),
      "--"
    );
    assert.equal(
      await page.locator("#kakomonn-reader-today-correct-rate-percent-unit").isHidden(),
      true
    );
    await page.waitForFunction(() => document.querySelector("#kakomonn-reader-next")?.textContent === "問題IDを取得できません");
    assert.equal(await page.locator("#kakomonn-reader-next").isDisabled(), true);
    assert.equal((await attemptCalls(page)).length, 0);
    assert.equal(
      await page.evaluate(() => window.__syncMock.calls.some((call) => new URL(call.url).pathname === "/v9/next")),
      false,
    );
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function runRetryCase(browser) {
  const context = await browser.newContext({ userAgent: chromeUserAgent });
  try {
    const page = await context.newPage();
    const errors = await prepare(page, "/questions/123", { nextQuestionId: "456" });
    const frame = await readerFrame(page);
    await page.evaluate(() => {
      window.__syncMock.nextAttemptStabilityDaysDelta = 31;
      window.__syncMock.commitThenFailNextAttempt = true;
    });
    await revealAnswerResult(frame, "correct");
    await page.waitForFunction(() => document.querySelector("#kakomonn-reader-status")?.textContent?.includes("再試行してください"));
    const firstPending = await page.evaluate((key) => window.__getGMValue(key), PENDING_ATTEMPT_KEY);
    assert.match(firstPending.operationId, /^[0-9a-f]{32}$/);
    assert.equal(firstPending.questionId, "123");
    assert.equal(await page.evaluate(() => window.__syncMock.stabilityDays), 31);

    await page.locator("#kakomonn-reader-next").click();
    await page.waitForFunction(() =>
      window.__syncMock.calls.filter((call) => new URL(call.url).pathname === "/v9/attempts").length === 2,
    );
    const calls = await attemptCalls(page);
    assert.equal(calls[0].body.operationId, calls[1].body.operationId);
    assert.equal(await page.evaluate(() => window.__syncMock.stabilityDays), 31);
    await frame.waitForURL(`https://${site}/questions/456`);
    assert.equal(
      await page.evaluate(() =>
        window.__syncMock.calls.some(
          (call) => new URL(call.url).pathname === "/v9/next",
        ),
      ),
      false,
    );
    assert.equal(
      await page.locator("#kakomonn-reader-due-cards-completed").innerText(),
      "未達成"
    );
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function runCatalogRefreshCase(browser) {
  const context = await browser.newContext({ userAgent: chromeUserAgent });
  try {
    const page = await context.newPage();
    const errors = [];
    const catalogRequests = [];
    let activeCatalogRequests = 0;
    let maximumActiveCatalogRequests = 0;
    const fulfillCatalogPage = async (route, body) => {
      activeCatalogRequests += 1;
      maximumActiveCatalogRequests = Math.max(
        maximumActiveCatalogRequests,
        activeCatalogRequests,
      );
      try {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return await route.fulfill({
          contentType: "text/html; charset=utf-8",
          body,
        });
      } finally {
        activeCatalogRequests -= 1;
      }
    };
    page.on("pageerror", (error) => errors.push(error.stack ?? String(error)));
    await page.route(`https://${site}/**`, (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/questions/123") {
        return route.fulfill({ contentType: "text/html; charset=utf-8", body: questionHTML() });
      }
      catalogRequests.push(`${url.pathname}${url.search}`);
      if (url.pathname === "/createques") {
        return route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: linkPage([
            { href: "/list1/100", text: "recent" },
            { href: "/list", text: "more" },
          ]),
        });
      }
      if (url.pathname === "/list") {
        return route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: linkPage([
            { href: "/list1/100", text: "recent" },
            { href: "/list1/200", text: "older-only-on-full-index" },
          ]),
        });
      }
      if (url.pathname === "/list1/100" && url.searchParams.get("page") === "1") {
        return fulfillCatalogPage(
          route,
          catalogListPage([
            { href: "/questions/10" },
            { href: "/questions/11" },
          ], 1, 3),
        );
      }
      if (url.pathname === "/list1/100" && url.searchParams.get("page") === "2") {
        return fulfillCatalogPage(
          route,
          catalogListPage([
            { href: "/questions/12" },
            { href: "/questions/14" },
          ], 2, 3),
        );
      }
      if (url.pathname === "/list1/100" && url.searchParams.get("page") === "3") {
        return fulfillCatalogPage(
          route,
          catalogListPage([
            { href: "/questions/13" },
          ], 3, 3),
        );
      }
      if (url.pathname === "/list1/200" && url.searchParams.get("page") === "1") {
        return fulfillCatalogPage(
          route,
          catalogListPage([{ href: "/questions/20" }], 1, 1),
        );
      }
      return route.fulfill({ status: 404, contentType: "text/plain", body: "unexpected catalog URL" });
    });
    await page.goto(`https://${site}/questions/123`);
    await page.evaluate(() => {
      Object.defineProperty(window, "Audio", { configurable: true, value: undefined });
      Object.defineProperty(window, "speechSynthesis", { configurable: true, value: undefined });
      Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: undefined });
    });
    await installSyncMock(page, { catalogQuestionCount: null });
    await page.addScriptTag({ content: fs.readFileSync(scriptPath, "utf8") });
    await page.waitForFunction(() =>
      window.__syncMock.calls.some((call) => new URL(call.url).pathname === "/v9/questions"),
    );
    const catalogCall = await page.evaluate(() =>
      window.__syncMock.calls.find((call) => new URL(call.url).pathname === "/v9/questions"),
    );
    assert.deepEqual(catalogCall.body.questionIds, ["10", "11", "12", "13", "14", "20"]);
    assert.equal(catalogCall.body.expectedGeneration, 0);
    assert.equal((await stateCalls(page)).length, 1);
    assert.deepEqual(
      catalogRequests.filter((url) => url.startsWith("/list1/100")),
      [
        "/list1/100?page=1",
        "/list1/100?page=2",
        "/list1/100?page=3",
        "/list1/100?page=1",
        "/list1/100?page=2",
        "/list1/100?page=3",
      ],
    );
    assert.equal(catalogRequests.includes("/list"), true);
    assert.equal(catalogRequests.filter((url) => url === "/list1/200?page=1").length, 2);
    assert.equal(maximumActiveCatalogRequests > 1, true);
    assert.equal(maximumActiveCatalogRequests <= 4, true);
    await page.waitForFunction(() => document.querySelector("#kakomonn-reader-status")?.textContent === "待機中");
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function runCatalogTimeoutRecoveryCase(browser) {
  const context = await browser.newContext({ userAgent: chromeUserAgent });
  try {
    const page = await context.newPage();
    const errors = [];
    const catalogRequests = [];
    let holdCatalogRequest = true;
    let completeHeldCatalogRequest;
    const heldCatalogRequestCompleted = new Promise((resolve) => {
      completeHeldCatalogRequest = resolve;
    });
    page.on("pageerror", (error) => errors.push(error.stack ?? String(error)));
    await page.route(`https://${site}/**`, (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/questions/123") {
        return route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: questionHTML(),
        });
      }
      catalogRequests.push(`${url.pathname}${url.search}`);
      if (url.pathname === "/createques") {
        if (holdCatalogRequest) {
          holdCatalogRequest = false;
          return (async () => {
            try {
              await new Promise((resolve) => setTimeout(resolve, 16_000));
              await route.fulfill({
                contentType: "text/html; charset=utf-8",
                body: linkPage([
                  { href: "/list1/100", text: "recent" },
                  { href: "/list", text: "more" },
                ]),
              });
            } catch {
              // AbortControllerが先に通信を終了した場合もfixtureを解放します.
            } finally {
              completeHeldCatalogRequest();
            }
          })();
        }
        return route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: linkPage([
            { href: "/list1/100", text: "recent" },
            { href: "/list", text: "more" },
          ]),
        });
      }
      if (url.pathname === "/list") {
        return route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: linkPage([{ href: "/list1/100", text: "recent" }]),
        });
      }
      if (url.pathname === "/list1/100" && url.searchParams.get("page") === "1") {
        return route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: catalogListPage([{ href: "/questions/10" }], 1, 1),
        });
      }
      return route.fulfill({
        status: 404,
        contentType: "text/plain",
        body: "unexpected catalog URL",
      });
    });
    await page.goto(`https://${site}/questions/123`);
    await page.evaluate(() => {
      Object.defineProperty(window, "Audio", { configurable: true, value: undefined });
      Object.defineProperty(window, "speechSynthesis", { configurable: true, value: undefined });
      Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: undefined });
    });
    await installSyncMock(page, { catalogQuestionCount: null });
    await page.addScriptTag({ content: fs.readFileSync(scriptPath, "utf8") });
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-status")?.textContent ===
        "問題一覧の同期がタイムアウトしました.再試行してください",
      undefined,
      { timeout: 20_000 },
    );
    assert.equal(
      await page.locator("#kakomonn-reader-next").innerText(),
      "同期を再試行",
    );
    assert.equal(await page.locator("#kakomonn-reader-next").isEnabled(), true);

    await heldCatalogRequestCompleted;
    await page.locator("#kakomonn-reader-next").click();
    await page.waitForFunction(
      () =>
        window.__syncMock.calls.filter(
          (call) => new URL(call.url).pathname === "/v9/questions",
        ).length === 1 &&
        document.querySelector("#kakomonn-reader-next")?.textContent ===
          "次の問題へ",
    );
    assert.equal((await stateCalls(page)).length, 2);
    assert.equal(
      await page.evaluate(() =>
        window.__syncMock.calls.filter(
          (call) => new URL(call.url).pathname === "/v9/questions",
        ).length,
      ),
      1,
    );
    assert.equal(
      catalogRequests.filter((url) => url === "/createques").length,
      3,
    );
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function runCatalogIncompleteCase(browser) {
  const context = await browser.newContext({ userAgent: chromeUserAgent });
  try {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.stack ?? String(error)));
    await page.route(`https://${site}/**`, (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/questions/123") {
        return route.fulfill({ contentType: "text/html; charset=utf-8", body: questionHTML() });
      }
      if (url.pathname === "/createques") {
        return route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: linkPage([
            { href: "/list1/100", text: "recent" },
            { href: "/list", text: "more" },
          ]),
        });
      }
      if (url.pathname === "/list") {
        return route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: linkPage([{ href: "/list1/100", text: "recent" }]),
        });
      }
      if (url.pathname === "/list1/100" && url.searchParams.get("page") === "1") {
        return route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: linkPage([{ href: "/questions/10" }]),
        });
      }
      return route.fulfill({ status: 404, contentType: "text/plain", body: "unexpected catalog URL" });
    });
    await page.goto(`https://${site}/questions/123`);
    await page.evaluate(() => {
      Object.defineProperty(window, "Audio", { configurable: true, value: undefined });
      Object.defineProperty(window, "speechSynthesis", { configurable: true, value: undefined });
      Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: undefined });
    });
    await installSyncMock(page, { catalogQuestionCount: null });
    await page.addScriptTag({ content: fs.readFileSync(scriptPath, "utf8") });
    await page.waitForFunction(() =>
      document.querySelector("#kakomonn-reader-status")?.textContent ===
      "問題一覧を同期できません.再試行してください",
    );
    const catalogCalls = await page.evaluate(() =>
      window.__syncMock.calls.filter((call) => new URL(call.url).pathname === "/v9/questions"),
    );
    assert.equal(catalogCalls.length, 0);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function runCatalogFinalPageMismatchCase(browser) {
  const context = await browser.newContext({ userAgent: chromeUserAgent });
  try {
    const page = await context.newPage();
    const errors = [];
    let finalPageReads = 0;
    page.on("pageerror", (error) => errors.push(error.stack ?? String(error)));
    await page.route(`https://${site}/**`, (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/questions/123") {
        return route.fulfill({ contentType: "text/html; charset=utf-8", body: questionHTML() });
      }
      if (url.pathname === "/createques") {
        return route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: linkPage([
            { href: "/list1/100", text: "recent" },
            { href: "/list", text: "more" },
          ]),
        });
      }
      if (url.pathname === "/list") {
        return route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: linkPage([{ href: "/list1/100", text: "recent" }]),
        });
      }
      if (url.pathname === "/list1/100" && url.searchParams.get("page") === "1") {
        finalPageReads += 1;
        return route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: catalogListPage([
            { href: finalPageReads === 1 ? "/questions/10" : "/questions/11" },
          ], 1, 1),
        });
      }
      return route.fulfill({ status: 404, contentType: "text/plain", body: "unexpected catalog URL" });
    });
    await page.goto(`https://${site}/questions/123`);
    await page.evaluate(() => {
      Object.defineProperty(window, "Audio", { configurable: true, value: undefined });
      Object.defineProperty(window, "speechSynthesis", { configurable: true, value: undefined });
      Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: undefined });
    });
    await installSyncMock(page, { catalogQuestionCount: null });
    await page.addScriptTag({ content: fs.readFileSync(scriptPath, "utf8") });
    await page.waitForFunction(() =>
      document.querySelector("#kakomonn-reader-status")?.textContent ===
      "問題一覧を同期できません.再試行してください",
    );
    const catalogCalls = await page.evaluate(() =>
      window.__syncMock.calls.filter((call) => new URL(call.url).pathname === "/v9/questions"),
    );
    assert.equal(finalPageReads, 2);
    assert.equal(catalogCalls.length, 0);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function runCatalogSamePageDuplicateCase(browser) {
  const context = await browser.newContext({ userAgent: chromeUserAgent });
  try {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.stack ?? String(error)));
    await page.route(`https://${site}/**`, (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/questions/123") {
        return route.fulfill({ contentType: "text/html; charset=utf-8", body: questionHTML() });
      }
      if (url.pathname === "/createques") {
        return route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: linkPage([
            { href: "/list1/100", text: "recent" },
            { href: "/list", text: "more" },
          ]),
        });
      }
      if (url.pathname === "/list") {
        return route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: linkPage([{ href: "/list1/100", text: "recent" }]),
        });
      }
      if (url.pathname === "/list1/100" && url.searchParams.get("page") === "1") {
        return route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: catalogListPage([
            { href: "/questions/10" },
            { href: "/questions/10" },
          ], 1, 1),
        });
      }
      return route.fulfill({ status: 404, contentType: "text/plain", body: "unexpected catalog URL" });
    });
    await page.goto(`https://${site}/questions/123`);
    await page.evaluate(() => {
      Object.defineProperty(window, "Audio", { configurable: true, value: undefined });
      Object.defineProperty(window, "speechSynthesis", { configurable: true, value: undefined });
      Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: undefined });
    });
    await installSyncMock(page, { catalogQuestionCount: null });
    await page.addScriptTag({ content: fs.readFileSync(scriptPath, "utf8") });
    await page.waitForFunction(() =>
      document.querySelector("#kakomonn-reader-status")?.textContent ===
      "問題一覧を同期できません.再試行してください",
    );
    const catalogCalls = await page.evaluate(() =>
      window.__syncMock.calls.filter((call) => new URL(call.url).pathname === "/v9/questions"),
    );
    assert.equal(catalogCalls.length, 0);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function runCatalogHybridSnapshotCase(browser) {
  const context = await browser.newContext({ userAgent: chromeUserAgent });
  try {
    const page = await context.newPage();
    const errors = [];
    let pageOneReads = 0;
    page.on("pageerror", (error) => errors.push(error.stack ?? String(error)));
    await page.route(`https://${site}/**`, (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/questions/123") {
        return route.fulfill({ contentType: "text/html; charset=utf-8", body: questionHTML() });
      }
      if (url.pathname === "/createques") {
        return route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: linkPage([
            { href: "/list1/100", text: "recent" },
            { href: "/list", text: "more" },
          ]),
        });
      }
      if (url.pathname === "/list") {
        return route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: linkPage([{ href: "/list1/100", text: "recent" }]),
        });
      }
      if (url.pathname === "/list1/100" && url.searchParams.get("page") === "1") {
        pageOneReads += 1;
        const ids = pageOneReads === 1 ? ["10", "11"] : ["11", "12"];
        return route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: catalogListPage(ids.map((id) => ({ href: `/questions/${id}` })), 1, 3),
        });
      }
      if (url.pathname === "/list1/100" && url.searchParams.get("page") === "2") {
        return route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: catalogListPage([
            { href: "/questions/13" },
            { href: "/questions/14" },
          ], 2, 3),
        });
      }
      if (url.pathname === "/list1/100" && url.searchParams.get("page") === "3") {
        return route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: catalogListPage([{ href: "/questions/15" }], 3, 3),
        });
      }
      return route.fulfill({ status: 404, contentType: "text/plain", body: "unexpected catalog URL" });
    });
    await page.goto(`https://${site}/questions/123`);
    await page.evaluate(() => {
      Object.defineProperty(window, "Audio", { configurable: true, value: undefined });
      Object.defineProperty(window, "speechSynthesis", { configurable: true, value: undefined });
      Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: undefined });
    });
    await installSyncMock(page, { catalogQuestionCount: null });
    await page.addScriptTag({ content: fs.readFileSync(scriptPath, "utf8") });
    await page.waitForFunction(() =>
      document.querySelector("#kakomonn-reader-status")?.textContent ===
      "問題一覧を同期できません.再試行してください",
    );
    const catalogCalls = await page.evaluate(() =>
      window.__syncMock.calls.filter((call) => new URL(call.url).pathname === "/v9/questions"),
    );
    assert.equal(pageOneReads, 2);
    assert.equal(catalogCalls.length, 0);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function runCatalogCASConflictCase(browser) {
  const context = await browser.newContext({ userAgent: chromeUserAgent });
  try {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.stack ?? String(error)));
    await page.route(`https://${site}/**`, (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/questions/123") {
        return route.fulfill({ contentType: "text/html; charset=utf-8", body: questionHTML() });
      }
      if (url.pathname === "/createques") {
        return route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: linkPage([
            { href: "/list1/100", text: "recent" },
            { href: "/list", text: "more" },
          ]),
        });
      }
      if (url.pathname === "/list") {
        return route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: linkPage([{ href: "/list1/100", text: "recent" }]),
        });
      }
      if (url.pathname === "/list1/100" && url.searchParams.get("page") === "1") {
        return route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: catalogListPage([{ href: "/questions/10" }], 1, 1),
        });
      }
      return route.fulfill({ status: 404, contentType: "text/plain", body: "unexpected catalog URL" });
    });
    await page.goto(`https://${site}/questions/123`);
    await page.evaluate(() => {
      Object.defineProperty(window, "Audio", { configurable: true, value: undefined });
      Object.defineProperty(window, "speechSynthesis", { configurable: true, value: undefined });
      Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: undefined });
    });
    await installSyncMock(page, { catalogQuestionCount: null });
    await page.evaluate(() => { window.__syncMock.conflictNextCatalogUpdate = true; });
    await page.addScriptTag({ content: fs.readFileSync(scriptPath, "utf8") });
    await page.waitForFunction(() => document.querySelector("#kakomonn-reader-status")?.textContent === "待機中");
    const catalogCalls = await page.evaluate(() =>
      window.__syncMock.calls.filter((call) => new URL(call.url).pathname === "/v9/questions"),
    );
    assert.equal(catalogCalls.length, 1);
    assert.equal(catalogCalls[0].body.expectedGeneration, 0);
    assert.equal(await page.evaluate(() => window.__syncMock.catalogGeneration), 1);
    assert.equal((await stateCalls(page)).length, 2);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function runStabilityDaysDecreaseCase(browser) {
  const context = await browser.newContext({ userAgent: chromeUserAgent });
  try {
    const page = await context.newPage();
    const errors = await prepare(page, "/questions/123", {
      stabilityDays: 35,
      nextQuestionId: null,
    });
    const frame = await readerFrame(page);
    await page.evaluate(() => { window.__syncMock.nextAttemptStabilityDaysDelta = -30; });
    await revealAnswerResult(frame, "incorrect");
    await page.waitForFunction(() => window.__syncMock.attemptCount === 1);
    await frame.locator("#native-next").click();
    await page.waitForFunction(() =>
      document.querySelector("#kakomonn-reader-status")?.textContent ===
      "出題できる問題はありません",
    );
    assert.equal(
      await page.locator("#kakomonn-reader-due-cards-completed").innerText(),
      "未達成"
    );
    assert.equal(
      await page.locator("#kakomonn-reader-due-cards-remaining").innerText(),
      "12"
    );
    assert.equal(
      await page.locator("#kakomonn-reader-today-stability-days-delta").innerText(),
      "-30"
    );
    assert.equal(
      await page.locator("#kakomonn-reader-today-attempted-question-count").innerText(),
      "1"
    );
    assert.equal(
      await page.locator("#kakomonn-reader-today-correct-rate-percent").innerText(),
      "0"
    );
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function runCelebrationCase(browser) {
  const context = await browser.newContext({ userAgent: chromeUserAgent });
  try {
    const page = await context.newPage();
    await page.route("https://kakomonn-congratulations.kakomonn.workers.dev/**", (route) =>
      route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: "<!doctype html><html><body><h1>dailyKpiCompleted達成</h1></body></html>",
      }),
    );
    const errors = await prepare(page, "/questions/123", { nextQuestionId: "456" });
    const frame = await readerFrame(page);
    await page.evaluate(() => {
      window.__syncMock.nextAttemptStabilityDaysDelta = 31;
      window.__syncMock.nextCelebration = {
        site: "chushoks.kakomonn.com",
        date: "2026-08-10",
        dailyKpiCompleted: true,
      };
    });
    await revealAnswerResult(frame, "correct");
    await page.waitForURL((url) =>
      url.origin === "https://kakomonn-congratulations.kakomonn.workers.dev",
    );
    const url = new URL(page.url());
    assert.equal(url.searchParams.get("site"), site);
    assert.equal(url.searchParams.get("date"), "2026-08-10");
    assert.equal(url.searchParams.get("dailyKpiCompleted"), "true");
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function runPendingCelebrationRecoveryCase(browser) {
  const context = await browser.newContext({ userAgent: chromeUserAgent });
  try {
    const page = await context.newPage();
    await page.route("https://kakomonn-congratulations.kakomonn.workers.dev/**", (route) =>
      route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: "<!doctype html><html><body><h1>dailyKpiCompleted達成</h1></body></html>",
      }),
    );
    const celebration = {
      site,
      date: "2026-08-10",
      dailyKpiCompleted: true,
    };
    const errors = await prepare(page, "/questions/123", {
      pendingCelebration: celebration,
    });
    await page.waitForURL((url) =>
      url.origin === "https://kakomonn-congratulations.kakomonn.workers.dev",
    );
    const url = new URL(page.url());
    assert.equal(url.searchParams.get("dailyKpiCompleted"), "true");
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function runRecordedAttemptRecoveryCase(browser) {
  const context = await browser.newContext({ userAgent: chromeUserAgent });
  try {
    const page = await context.newPage();
    const pendingAttempt = {
      operationId: "0123456789abcdef0123456789abcdef",
      questionId: "123",
      phase: "recorded",
      pageURL: `https://${site}/questions/123`,
      answerResult: "correct",
      site,
      nextURL: `https://${site}/questions/456`,
    };
    const errors = await prepare(page, "/questions/123", { pendingAttempt });
    const frame = await readerFrame(page);
    await frame.waitForURL(`https://${site}/questions/456`);
    assert.equal((await attemptCalls(page)).length, 0);
    assert.equal(
      await page.evaluate((key) => window.__getGMValue(key), PENDING_ATTEMPT_KEY),
      null,
    );
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function runQueuedAttemptRecoveryCase(browser) {
  const context = await browser.newContext({ userAgent: chromeUserAgent });
  try {
    const page = await context.newPage();
    const pendingAttempt = {
      operationId: "fedcba9876543210fedcba9876543210",
      questionId: "123",
      phase: "queued",
      pageURL: `https://${site}/questions/123`,
      answerResult: "correct",
      site,
    };
    const errors = await prepare(page, "/questions/123", { pendingAttempt });
    const frame = await readerFrame(page);
    await frame.waitForURL(`https://${site}/questions/456`);
    const calls = await attemptCalls(page);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.operationId, pendingAttempt.operationId);
    assert.equal(
      await page.evaluate((key) => window.__getGMValue(key), PENDING_ATTEMPT_KEY),
      null,
    );
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function main() {
  execFileSync("python3", ["build.py"], {
    cwd: projectRoot,
    env: kakomonnFreeEnvironment(),
    stdio: "inherit",
  });
  const script = fs.readFileSync(scriptPath, "utf8");
  assert.equal(script.includes("/v3/answers"), false);
  assert.equal(script.includes("/v9/attempts"), true);
  assert.equal(script.includes("/v9/next"), true);
  assert.equal(script.includes("completedMilestone"), false);
  assert.equal(script.includes("masteryDelta"), false);
  assert.equal(script.includes("findNextQuestionURL"), false);

  const browser = await launchBrowser();
  try {
    await runQuestionIdCase(browser, "/questions/123");
    await runQuestionIdCase(browser, "/questions/next/123");
    await runResumeWithoutRemoteRefreshCase(browser);
    await runUnknownURLCase(browser);
    await runRetryCase(browser);
    await runCatalogRefreshCase(browser);
    await runCatalogTimeoutRecoveryCase(browser);
    await runCatalogIncompleteCase(browser);
    await runCatalogFinalPageMismatchCase(browser);
    await runCatalogSamePageDuplicateCase(browser);
    await runCatalogHybridSnapshotCase(browser);
    await runCatalogCASConflictCase(browser);
    await runStabilityDaysDecreaseCase(browser);
    await runCelebrationCase(browser);
    await runPendingCelebrationRecoveryCase(browser);
    await runRecordedAttemptRecoveryCase(browser);
    await runQueuedAttemptRecoveryCase(browser);
  } finally {
    await browser.close();
  }
  console.log("reader learning metrics smoke test passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
