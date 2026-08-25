const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
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

function questionHTML(answerResult = "correct", nativeNextId = "999") {
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
  const executablePath = process.env.KAKOMONN_CHROMIUM_EXECUTABLE;
  return chromium.launch({
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
    dueCardsCompleted: options.dueCardsCompleted ?? false,
    dueCardsRemaining: options.dueCardsRemaining ?? 12,
    nextQuestionId: options.nextQuestionId === undefined ? "456" : options.nextQuestionId,
    pendingCelebration: options.pendingCelebration ?? null,
  });
  await page.addScriptTag({ content: fs.readFileSync(scriptPath, "utf8") });
  return errors;
}

async function readerFrame(page) {
  await page.waitForSelector("#kakomonn-reader-frame");
  await page.waitForFunction(() =>
    document.querySelector("#kakomonn-reader-due-cards-completed")?.textContent !== "--"
  );
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
  assert(frame, "reader frame must exist");
  await frame.waitForLoadState("load");
  await page.waitForTimeout(100);
  return frame;
}

function attemptCalls(page) {
  return page.evaluate(() =>
    window.__syncMock.calls.filter((call) => new URL(call.url).pathname === "/v8/attempts"),
  );
}

async function runQuestionIdCase(browser, startPath) {
  const context = await browser.newContext({ userAgent: chromeUserAgent });
  try {
    const page = await context.newPage();
    const errors = await prepare(page, startPath, {
      dueCardsRemaining: 12,
      nextQuestionId: "456",
      todayAttemptedQuestionCount: 28,
      todayStabilityDaysDelta: 104,
    });
    const frame = await readerFrame(page);
    await page.waitForFunction(() => document.querySelector("#kakomonn-reader-next")?.disabled === false);
    await page.evaluate(() => {
      window.__syncMock.nextAttemptStabilityDaysDelta = 31;
      window.__syncMock.nextAttemptDueCardsRemaining = 11;
    });
    await frame.locator("#native-next").click();
    await page.waitForFunction(() =>
      window.__syncMock.calls.some((call) => new URL(call.url).pathname === "/v8/attempts"),
    );
    const calls = await attemptCalls(page);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.questionId, "123");
    assert.deepEqual(Object.keys(calls[0].body).sort(), ["answerResult", "operationId", "questionId", "site"]);
    await frame.waitForURL(`https://${site}/questions/456`);
    assert.equal(
      await page.evaluate(() =>
        window.__syncMock.calls.some(
          (call) => new URL(call.url).pathname === "/v8/next",
        ),
      ),
      false,
    );
    assert.equal(
      await page.locator("#kakomonn-reader-due-cards-completed").innerText(),
      "未達成"
    );
    assert.equal(
      await page.locator("#kakomonn-reader-due-cards-remaining").innerText(),
      "11"
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
      await page.locator("#kakomonn-reader-learning-metrics").getAttribute("aria-label"),
      "dueCardsCompleted 未達成. dueCardsRemaining あと11問. todayStabilityDaysDelta +135日. todayAttemptedQuestionCount 29問"
    );
    assert.equal(
      await page.locator("#kakomonn-reader-learning-metrics").getAttribute("role"),
      "status"
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
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function runUnknownURLCase(browser) {
  const context = await browser.newContext({ userAgent: chromeUserAgent });
  try {
    const page = await context.newPage();
    const errors = await prepare(page, "/questions/current");
    await readerFrame(page);
    await page.waitForFunction(() => document.querySelector("#kakomonn-reader-next")?.textContent === "問題IDを取得できません");
    assert.equal(await page.locator("#kakomonn-reader-next").isDisabled(), true);
    assert.equal((await attemptCalls(page)).length, 0);
    assert.equal(
      await page.evaluate(() => window.__syncMock.calls.some((call) => new URL(call.url).pathname === "/v8/next")),
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
    await page.waitForFunction(() => document.querySelector("#kakomonn-reader-next")?.disabled === false);
    await page.evaluate(() => {
      window.__syncMock.nextAttemptStabilityDaysDelta = 31;
      window.__syncMock.commitThenFailNextAttempt = true;
    });
    await frame.locator("#native-next").click();
    await page.waitForFunction(() => document.querySelector("#kakomonn-reader-status")?.textContent?.includes("再試行してください"));
    const firstPending = await page.evaluate((key) => window.__getGMValue(key), PENDING_ATTEMPT_KEY);
    assert.match(firstPending.operationId, /^[0-9a-f]{32}$/);
    assert.equal(firstPending.questionId, "123");
    assert.equal(await page.evaluate(() => window.__syncMock.stabilityDays), 31);

    await page.locator("#kakomonn-reader-next").click();
    await page.waitForFunction(() =>
      window.__syncMock.calls.filter((call) => new URL(call.url).pathname === "/v8/attempts").length === 2,
    );
    const calls = await attemptCalls(page);
    assert.equal(calls[0].body.operationId, calls[1].body.operationId);
    assert.equal(await page.evaluate(() => window.__syncMock.stabilityDays), 31);
    await frame.waitForURL(`https://${site}/questions/456`);
    assert.equal(
      await page.evaluate(() =>
        window.__syncMock.calls.some(
          (call) => new URL(call.url).pathname === "/v8/next",
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
        return route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: catalogListPage([
            { href: "/questions/10" },
            { href: "/questions/11" },
          ], 1, 3),
        });
      }
      if (url.pathname === "/list1/100" && url.searchParams.get("page") === "2") {
        return route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: catalogListPage([
            { href: "/questions/12" },
            { href: "/questions/14" },
          ], 2, 3),
        });
      }
      if (url.pathname === "/list1/100" && url.searchParams.get("page") === "3") {
        return route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: catalogListPage([
            { href: "/questions/13" },
          ], 3, 3),
        });
      }
      if (url.pathname === "/list1/200" && url.searchParams.get("page") === "1") {
        return route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: catalogListPage([{ href: "/questions/20" }], 1, 1),
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
      window.__syncMock.calls.some((call) => new URL(call.url).pathname === "/v8/questions"),
    );
    const catalogCall = await page.evaluate(() =>
      window.__syncMock.calls.find((call) => new URL(call.url).pathname === "/v8/questions"),
    );
    assert.deepEqual(catalogCall.body.questionIds, ["10", "11", "12", "13", "14", "20"]);
    assert.equal(catalogCall.body.expectedGeneration, 0);
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
    await page.waitForFunction(() => document.querySelector("#kakomonn-reader-status")?.textContent === "待機中");
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
      window.__syncMock.calls.filter((call) => new URL(call.url).pathname === "/v8/questions"),
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
      window.__syncMock.calls.filter((call) => new URL(call.url).pathname === "/v8/questions"),
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
      window.__syncMock.calls.filter((call) => new URL(call.url).pathname === "/v8/questions"),
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
      window.__syncMock.calls.filter((call) => new URL(call.url).pathname === "/v8/questions"),
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
      window.__syncMock.calls.filter((call) => new URL(call.url).pathname === "/v8/questions"),
    );
    assert.equal(catalogCalls.length, 1);
    assert.equal(catalogCalls[0].body.expectedGeneration, 0);
    assert.equal(await page.evaluate(() => window.__syncMock.catalogGeneration), 1);
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
      answerResult: "incorrect",
      nextQuestionId: null,
    });
    const frame = await readerFrame(page);
    await page.waitForFunction(() => document.querySelector("#kakomonn-reader-next")?.disabled === false);
    await page.evaluate(() => { window.__syncMock.nextAttemptStabilityDaysDelta = -30; });
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
        body: "<!doctype html><html><body><h1>dueCardsCompleted達成</h1></body></html>",
      }),
    );
    const errors = await prepare(page, "/questions/123", { nextQuestionId: "456" });
    const frame = await readerFrame(page);
    await page.waitForFunction(() => document.querySelector("#kakomonn-reader-next")?.disabled === false);
    await page.evaluate(() => {
      window.__syncMock.nextAttemptStabilityDaysDelta = 31;
      window.__syncMock.nextCelebration = {
        site: "chushoks.kakomonn.com",
        date: "2026-08-10",
        dueCardsCompleted: true,
      };
    });
    await frame.locator("#native-next").click();
    await page.waitForURL((url) =>
      url.origin === "https://kakomonn-congratulations.kakomonn.workers.dev",
    );
    const url = new URL(page.url());
    assert.equal(url.searchParams.get("site"), site);
    assert.equal(url.searchParams.get("date"), "2026-08-10");
    assert.equal(url.searchParams.get("dueCardsCompleted"), "true");
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
        body: "<!doctype html><html><body><h1>dueCardsCompleted達成</h1></body></html>",
      }),
    );
    const celebration = {
      site,
      date: "2026-08-10",
      dueCardsCompleted: true,
    };
    const errors = await prepare(page, "/questions/123", {
      pendingCelebration: celebration,
    });
    await page.waitForURL((url) =>
      url.origin === "https://kakomonn-congratulations.kakomonn.workers.dev",
    );
    const url = new URL(page.url());
    assert.equal(url.searchParams.get("dueCardsCompleted"), "true");
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function main() {
  execFileSync("python3", ["build.py"], { cwd: projectRoot, stdio: "inherit" });
  const script = fs.readFileSync(scriptPath, "utf8");
  assert.equal(script.includes("/v3/answers"), false);
  assert.equal(script.includes("/v8/attempts"), true);
  assert.equal(script.includes("/v8/next"), true);
  assert.equal(script.includes("completedMilestone"), false);
  assert.equal(script.includes("masteryDelta"), false);
  assert.equal(script.includes("findNextQuestionURL"), false);

  const browser = await launchBrowser();
  try {
    await runQuestionIdCase(browser, "/questions/123");
    await runQuestionIdCase(browser, "/questions/next/123");
    await runUnknownURLCase(browser);
    await runRetryCase(browser);
    await runCatalogRefreshCase(browser);
    await runCatalogIncompleteCase(browser);
    await runCatalogFinalPageMismatchCase(browser);
    await runCatalogSamePageDuplicateCase(browser);
    await runCatalogHybridSnapshotCase(browser);
    await runCatalogCASConflictCase(browser);
    await runStabilityDaysDecreaseCase(browser);
    await runCelebrationCase(browser);
    await runPendingCelebrationRecoveryCase(browser);
  } finally {
    await browser.close();
  }
  console.log("reader learning metrics smoke test passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
