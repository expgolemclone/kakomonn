const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { chromium } = require("playwright");
const {
  CONGRATULATIONS_ORIGIN,
  installSyncMock,
  PENDING_CELEBRATION_KEY,
  PENDING_CORRECT_KEY,
  SYNC_API_ORIGIN,
} = require("./sync_mock");

const projectRoot = path.resolve(__dirname, "..");
const scriptPath = path.join(projectRoot, "kakomonn-reader.user.js");
const edgeUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0";

function createMockBody(result) {
  const resultClasses = {
    correct: "is-correct",
    incorrect: "is-wrong",
    unknown: "",
  };
  assert.equal(Object.hasOwn(resultClasses, result), true);
  const resultClass = resultClasses[result];
  const resultClassAttribute =
    resultClass === "" ? "" : ` class="${resultClass}"`;
  return `
    <div id="meta">中小企業診断士試験 令和7年度（2025年） 問1（経済学・経済政策 問1）</div>
    <p>これは動作確認用の問題文です.</p>
    <div><label><input type="radio" name="answer">選択肢1</label></div>
    <div><label><input type="radio" name="answer">選択肢2</label></div>
    <button type="button">解答する</button>
    <p id="correct-result" hidden>正解！素晴らしいです</p>
    <p id="incorrect-result" hidden>残念...</p>
    <h2>この過去問の解説</h2>
    <div>解答結果</div>
    <div id="js-answer-result-box"${resultClassAttribute}></div>
    <p>選択肢2は正解の選択肢となります.</p>
    <a href="#report">（訂正依頼・報告はこちら）</a>
    <button id="next" type="button"
      onclick="location.href='/questions/next'">次の問題へ</button>
  `;
}

async function preparePage(page, syncOptions = {}) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? String(error)));
  await page.route("https://chushoks.kakomonn.com/**", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: "<!doctype html><html><body></body></html>",
    }),
  );
  await page.route(`${CONGRATULATIONS_ORIGIN}/**`, (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: "<!doctype html><html><body><h1>Congratulations</h1></body></html>",
    }),
  );
  await page.goto("https://chushoks.kakomonn.com/questions/current");
  await page.evaluate(() => {
    const store = new Map();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => store.set(key, String(value)),
        removeItem: (key) => store.delete(key),
        clear: () => store.clear(),
      },
    });
    Object.defineProperty(window, "Audio", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      configurable: true,
      value: undefined,
    });
  });
  await installSyncMock(page, syncOptions);
  return errors;
}

async function waitForReaderFrame(page) {
  await page.waitForSelector("#kakomonn-reader-frame");
  const childFrames = page
    .frames()
    .filter((frame) => frame !== page.mainFrame());
  assert.equal(childFrames.length, 1);
  const childFrame = childFrames[0];
  await childFrame.waitForURL(
    "https://chushoks.kakomonn.com/questions/current",
  );
  await childFrame.waitForLoadState("load");
  await page.waitForTimeout(50);
  return childFrame;
}

async function runCountCase(browser, script, result, expectedCount) {
  const context = await browser.newContext({ userAgent: edgeUserAgent });
  try {
    const page = await context.newPage();
    const errors = await preparePage(page);
    await page.addScriptTag({ content: script });
    const childFrame = await waitForReaderFrame(page);
    await childFrame.evaluate(
      (html) => {
        document.body.innerHTML = html;
      },
      createMockBody(result),
    );
    await page.waitForTimeout(950);

    assert.equal(
      await page.locator("#kakomonn-reader-count").innerText(),
      "0問,次は50問",
    );
    await childFrame.locator("#next").click();
    if (result === "unknown") {
      await page.waitForFunction(
        () =>
          document.querySelector("#kakomonn-reader-status").textContent ===
          "正誤を確認できません",
      );
    }
    try {
      await page.waitForFunction(
        (countText) =>
          document.querySelector("#kakomonn-reader-count").textContent ===
          countText,
        expectedCount,
      );
    } catch (error) {
      error.readerState = await page.evaluate(() => ({
        count: document.querySelector("#kakomonn-reader-count")?.textContent,
        status: document.querySelector("#kakomonn-reader-status")?.textContent,
        calls: JSON.stringify(window.__syncMock?.calls),
      }));
      error.pageErrors = errors;
      throw error;
    }
    assert.equal(
      await page.locator("#kakomonn-reader-count").innerText(),
      expectedCount,
    );
    assert.equal(
      await page.evaluate(
        () =>
          window.__syncMock.calls.filter(
            (call) =>
              call.method === "POST" &&
              new URL(call.url).pathname === "/v1/correct",
          ).length,
      ),
      result === "correct" ? 1 : 0,
    );
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function runSyncRefreshClickRaceCase(browser, script) {
  const context = await browser.newContext({ userAgent: edgeUserAgent });
  try {
    const page = await context.newPage();
    const errors = await preparePage(page);
    await page.addScriptTag({ content: script });
    const childFrame = await waitForReaderFrame(page);
    await childFrame.evaluate(
      (html) => {
        document.body.innerHTML = html;
      },
      createMockBody("correct"),
    );
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-count").textContent ===
        "0問,次は50問",
    );

    await page.evaluate(() => {
      window.__syncMock.holdNextRequest = true;
      window.dispatchEvent(new Event("focus"));
    });
    await page.waitForFunction(
      () => window.__syncMock.releaseHeldRequest !== null,
    );

    await childFrame.locator("#next").click();
    await page.evaluate(() => window.__syncMock.releaseHeldRequest());
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-count").textContent ===
        "1問,次は50問",
    );

    const correctCalls = await page.evaluate(() =>
      window.__syncMock.calls.filter(
        (call) =>
          call.method === "POST" &&
          new URL(call.url).pathname === "/v1/correct",
      ),
    );
    assert.equal(correctCalls.length, 1);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function runRetryCase(browser, script) {
  const context = await browser.newContext({ userAgent: edgeUserAgent });
  try {
    const page = await context.newPage();
    const errors = await preparePage(page);
    await page.addScriptTag({ content: script });
    const childFrame = await waitForReaderFrame(page);
    await childFrame.evaluate(
      (html) => {
        document.body.innerHTML = html;
      },
      createMockBody("correct"),
    );
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-count").textContent ===
        "0問,次は50問",
    );
    await page.evaluate(() => {
      window.__syncMock.commitThenFailNextCorrect = true;
    });

    await childFrame.locator("#next").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-status").textContent ===
        "正解数を同期できません.再試行してください",
    );
    assert.equal(
      await page.locator("#kakomonn-reader-count").innerText(),
      "0問,次は50問",
    );

    await childFrame.locator("#next").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-count").textContent ===
        "1問,次は50問",
    );

    const result = await page.evaluate(() => {
      const correctCalls = window.__syncMock.calls.filter(
        (call) =>
          call.method === "POST" &&
          new URL(call.url).pathname === "/v1/correct",
      );
      return {
        serverCount: window.__syncMock.count,
        operationIds: correctCalls.map((call) => call.body.operationId),
      };
    });
    assert.equal(result.serverCount, 1);
    assert.equal(result.operationIds.length, 2);
    assert.match(result.operationIds[0], /^[0-9a-f]{32}$/);
    assert.equal(result.operationIds[0], result.operationIds[1]);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function runDoubleClickCase(browser, script) {
  const context = await browser.newContext({ userAgent: edgeUserAgent });
  try {
    const page = await context.newPage();
    const errors = await preparePage(page);
    await page.addScriptTag({ content: script });
    const childFrame = await waitForReaderFrame(page);
    await childFrame.evaluate(
      (html) => {
        document.body.innerHTML = html;
      },
      createMockBody("correct"),
    );
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-count").textContent ===
        "0問,次は50問",
    );
    await page.evaluate(() => {
      window.__syncMock.holdNextSetValue = true;
    });

    await childFrame.locator("#next").click();
    await page.waitForFunction(
      () => window.__syncMock.releaseHeldSetValue !== null,
    );
    assert.equal(
      await page.evaluate(() => {
        window.dispatchEvent(new Event("focus"));
        return window.__syncMock.calls.length;
      }),
      1,
    );
    assert.equal(
      await page.locator("#kakomonn-reader-sync-settings-button").isDisabled(),
      true,
    );
    await childFrame.locator("#next").click();
    await page.evaluate(() => window.__syncMock.releaseHeldSetValue());
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-count").textContent ===
        "1問,次は50問",
    );

    const result = await page.evaluate(() => ({
      serverCount: window.__syncMock.count,
      correctCalls: window.__syncMock.calls.filter(
        (call) =>
          call.method === "POST" &&
          new URL(call.url).pathname === "/v1/correct",
      ),
    }));
    assert.equal(result.serverCount, 1);
    assert.equal(result.correctCalls.length, 1);
    assert.match(
      result.correctCalls[0].body.operationId,
      /^[0-9a-f]{32}$/,
    );
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function runDeleteFailureCase(browser, script) {
  const context = await browser.newContext({ userAgent: edgeUserAgent });
  try {
    const page = await context.newPage();
    const errors = await preparePage(page);
    await page.addScriptTag({ content: script });
    const childFrame = await waitForReaderFrame(page);
    await childFrame.evaluate(
      (html) => {
        document.body.innerHTML = html;
      },
      createMockBody("correct"),
    );
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-count").textContent ===
        "0問,次は50問",
    );
    await page.evaluate(() => {
      window.__syncMock.failNextDeleteValue = true;
    });

    await childFrame.locator("#next").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-status").textContent ===
        "正解数を同期できません.再試行してください",
    );
    const storedPending = await page.evaluate(
      (key) => window.__getGMValue(key),
      PENDING_CORRECT_KEY,
    );
    assert.match(storedPending.operationId, /^[0-9a-f]{32}$/);
    assert.equal(
      await page.locator("#kakomonn-reader-count").innerText(),
      "1問,次は50問",
    );

    await childFrame.locator("#next").click();
    await page.waitForFunction(
      (key) => window.__getGMValue(key) === null,
      PENDING_CORRECT_KEY,
    );
    const result = await page.evaluate(() => {
      const correctCalls = window.__syncMock.calls.filter(
        (call) =>
          call.method === "POST" &&
          new URL(call.url).pathname === "/v1/correct",
      );
      return {
        serverCount: window.__syncMock.count,
        operationIds: correctCalls.map((call) => call.body.operationId),
      };
    });
    assert.equal(result.serverCount, 1);
    assert.deepEqual(result.operationIds, [
      storedPending.operationId,
      storedPending.operationId,
    ]);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function runFrameChangeDuringSyncCase(browser, script) {
  const context = await browser.newContext({ userAgent: edgeUserAgent });
  try {
    const page = await context.newPage();
    const errors = await preparePage(page);
    await page.addScriptTag({ content: script });
    const frameElement = page.locator("#kakomonn-reader-frame");
    const childFrame = await waitForReaderFrame(page);
    await childFrame.evaluate(
      (html) => {
        document.body.innerHTML = html;
      },
      createMockBody("correct"),
    );
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-count").textContent ===
        "0問,次は50問",
    );
    await page.evaluate(() => {
      window.__syncMock.holdNextRequest = true;
    });

    await childFrame.locator("#next").click();
    await page.waitForFunction(
      () => window.__syncMock.releaseHeldRequest !== null,
    );
    await frameElement.evaluate((iframe) => {
      iframe.srcdoc = `
        <button id="replacement-next" type="button"
          onclick="window.__replacementClicked = true">次の問題へ</button>
        <script>window.__replacementClicked = false;<\/script>
      `;
    });
    const replacementFrame = frameElement.contentFrame();
    await replacementFrame
      .locator("#replacement-next")
      .waitFor({ state: "visible" });
    await page.evaluate(() => window.__syncMock.releaseHeldRequest());
    await page.waitForFunction(
      (key) => window.__getGMValue(key) === null,
      PENDING_CORRECT_KEY,
    );

    assert.equal(
      await replacementFrame
        .locator("body")
        .evaluate(() => window.__replacementClicked),
      false,
    );
    assert.equal(await page.evaluate(() => window.__syncMock.count), 1);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function runDateChangeCase(browser, script) {
  const context = await browser.newContext({ userAgent: edgeUserAgent });
  try {
    const page = await context.newPage();
    const errors = await preparePage(page);
    await page.addScriptTag({ content: script });
    const childFrame = await waitForReaderFrame(page);
    await childFrame.evaluate(
      (html) => {
        document.body.innerHTML = html;
      },
      createMockBody("correct"),
    );
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-count").textContent ===
        "0問,次は50問",
    );
    await page.evaluate(() => {
      window.__syncMock.date = "2026-07-18";
      window.__syncMock.count = 4;
      window.__syncMock.failNextDeleteValue = true;
    });

    await childFrame.locator("#next").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-status").textContent ===
        "前日の未同期分を破棄できません.再試行してください",
    );
    assert.equal(
      await page.locator("#kakomonn-reader-count").innerText(),
      "4問,次は50問",
    );
    assert.notEqual(
      await page.evaluate(
        (key) => window.__getGMValue(key),
        PENDING_CORRECT_KEY,
      ),
      null,
    );

    await childFrame.locator("#next").click();
    await page.waitForFunction(
      (key) => window.__getGMValue(key) === null,
      PENDING_CORRECT_KEY,
    );
    const correctCalls = await page.evaluate(() =>
      window.__syncMock.calls.filter(
        (call) =>
          call.method === "POST" &&
          new URL(call.url).pathname === "/v1/correct",
      ),
    );
    assert.equal(correctCalls.length, 2);
    assert.equal(correctCalls[0].body.date, "2026-07-17");
    assert.equal(
      correctCalls[0].body.operationId,
      correctCalls[1].body.operationId,
    );
    assert.equal(await page.evaluate(() => window.__syncMock.count), 4);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function runReloadRetryCase(browser, script) {
  const context = await browser.newContext({ userAgent: edgeUserAgent });
  try {
    const firstPage = await context.newPage();
    const firstErrors = await preparePage(firstPage);
    await firstPage.addScriptTag({ content: script });
    const firstFrame = await waitForReaderFrame(firstPage);
    await firstFrame.evaluate(
      (html) => {
        document.body.innerHTML = html;
      },
      createMockBody("correct"),
    );
    await firstPage.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-count").textContent ===
        "0問,次は50問",
    );
    await firstPage.evaluate(() => {
      window.__syncMock.commitThenFailNextCorrect = true;
    });
    await firstFrame.locator("#next").click();
    await firstPage.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-status").textContent ===
        "正解数を同期できません.再試行してください",
    );
    const pending = await firstPage.evaluate(
      (key) => window.__getGMValue(key),
      PENDING_CORRECT_KEY,
    );
    assert.match(pending.operationId, /^[0-9a-f]{32}$/);
    assert.equal(await firstPage.evaluate(() => window.__syncMock.count), 1);
    assert.deepEqual(firstErrors, []);
    await firstPage.close();

    const restoredPending = {
      ...pending,
      pageURL: "https://chushoks.kakomonn.com/questions/restored",
    };
    const secondPage = await context.newPage();
    const secondErrors = await preparePage(secondPage, {
      count: 1,
      pendingCorrect: restoredPending,
      processedOperations: [
        { operationId: pending.operationId, resultingCount: 1 },
      ],
    });
    await secondPage.addScriptTag({ content: script });
    const secondFrame = await waitForReaderFrame(secondPage);
    await secondFrame.evaluate(
      (html) => {
        document.body.innerHTML = html;
      },
      createMockBody("correct"),
    );
    await secondPage.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-count").textContent ===
        "1問,次は50問",
    );
    await secondFrame.locator("#next").click();
    await secondPage.waitForFunction(
      (key) => window.__getGMValue(key) === null,
      PENDING_CORRECT_KEY,
    );
    const result = await secondPage.evaluate(() => {
      const correctCalls = window.__syncMock.calls.filter(
        (call) =>
          call.method === "POST" &&
          new URL(call.url).pathname === "/v1/correct",
      );
      return {
        serverCount: window.__syncMock.count,
        operationIds: correctCalls.map((call) => call.body.operationId),
      };
    });
    assert.equal(result.serverCount, 1);
    assert.deepEqual(result.operationIds, [pending.operationId]);
    assert.deepEqual(secondErrors, []);
  } finally {
    await context.close();
  }
}

async function runMilestoneCase(browser, script, initialCount, milestone) {
  const context = await browser.newContext({ userAgent: edgeUserAgent });
  try {
    const page = await context.newPage();
    const errors = await preparePage(page, { count: initialCount });
    const congratulationsRequests = [];
    page.on("request", (request) => {
      if (request.url().startsWith(CONGRATULATIONS_ORIGIN)) {
        congratulationsRequests.push(request.url());
      }
    });
    await page.addScriptTag({ content: script });
    const childFrame = await waitForReaderFrame(page);
    await childFrame.evaluate(
      (html) => {
        document.body.innerHTML = html;
      },
      createMockBody("correct"),
    );
    await page.waitForFunction(
      ({ expectedCount, expectedMilestone }) =>
        document.querySelector("#kakomonn-reader-count").textContent ===
        `${expectedCount}問,次は${expectedMilestone}問`,
      { expectedCount: initialCount, expectedMilestone: milestone },
    );

    await childFrame.locator("#next").click();
    await page.waitForURL(
      `${CONGRATULATIONS_ORIGIN}/?milestone=${milestone}`,
    );
    assert.deepEqual(congratulationsRequests, [
      `${CONGRATULATIONS_ORIGIN}/?milestone=${milestone}`,
    ]);

    await page.goBack();
    await page.waitForURL("https://chushoks.kakomonn.com/questions/next");
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function runObservedMilestoneCase(browser, script) {
  const context = await browser.newContext({ userAgent: edgeUserAgent });
  try {
    const page = await context.newPage();
    const errors = await preparePage(page, { count: 50 });
    const congratulationsRequests = [];
    page.on("request", (request) => {
      if (request.url().startsWith(CONGRATULATIONS_ORIGIN)) {
        congratulationsRequests.push(request.url());
      }
    });
    await page.addScriptTag({ content: script });
    await waitForReaderFrame(page);
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-count").textContent ===
        "50問,次は100問",
    );
    await page.waitForTimeout(150);

    assert.equal(
      page.url(),
      "https://chushoks.kakomonn.com/questions/current",
    );
    assert.deepEqual(congratulationsRequests, []);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function runPendingCelebrationRecoveryCase(browser, script) {
  const context = await browser.newContext({ userAgent: edgeUserAgent });
  try {
    const page = await context.newPage();
    const errors = await preparePage(page, {
      count: 50,
      pendingCelebration: {
        date: "2026-07-17",
        milestone: 50,
        sourcePageURL:
          "https://chushoks.kakomonn.com/questions/current",
      },
    });
    await page.addScriptTag({ content: script });
    const childFrame = await waitForReaderFrame(page);
    await childFrame.evaluate(
      (html) => {
        document.body.innerHTML = html;
      },
      createMockBody("correct"),
    );
    await childFrame.locator("#next").click();
    await page.waitForURL(`${CONGRATULATIONS_ORIGIN}/?milestone=50`);

    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function runMilestoneStorageRetryCase(browser, script) {
  const context = await browser.newContext({ userAgent: edgeUserAgent });
  try {
    const page = await context.newPage();
    const errors = await preparePage(page, { count: 49 });
    const congratulationsRequests = [];
    page.on("request", (request) => {
      if (request.url().startsWith(CONGRATULATIONS_ORIGIN)) {
        congratulationsRequests.push(request.url());
      }
    });
    await page.addScriptTag({ content: script });
    const childFrame = await waitForReaderFrame(page);
    await childFrame.evaluate(
      (html) => {
        document.body.innerHTML = html;
      },
      createMockBody("correct"),
    );
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-count").textContent ===
        "49問,次は50問",
    );
    await page.evaluate(() => {
      window.__syncMock.holdNextRequest = true;
    });

    await childFrame.locator("#next").click();
    await page.waitForFunction(
      () => window.__syncMock.releaseHeldRequest !== null,
    );
    await page.evaluate(() => {
      window.__syncMock.failNextSetValue = true;
      window.__syncMock.releaseHeldRequest();
    });
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-status").textContent ===
        "正解数を同期できません.再試行してください",
    );

    const pendingCorrect = await page.evaluate(
      (key) => window.__getGMValue(key),
      PENDING_CORRECT_KEY,
    );
    assert.match(pendingCorrect.operationId, /^[0-9a-f]{32}$/);
    assert.equal(
      await page.evaluate(
        (key) => window.__getGMValue(key),
        PENDING_CELEBRATION_KEY,
      ),
      null,
    );
    assert.equal(await page.evaluate(() => window.__syncMock.count), 50);
    assert.deepEqual(congratulationsRequests, []);

    await childFrame.locator("#next").click();
    await page.waitForURL(`${CONGRATULATIONS_ORIGIN}/?milestone=50`);
    assert.deepEqual(congratulationsRequests, [
      `${CONGRATULATIONS_ORIGIN}/?milestone=50`,
    ]);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function main() {
  execFileSync("python3", ["build.py"], {
    cwd: projectRoot,
    stdio: "inherit",
  });
  const script = fs.readFileSync(scriptPath, "utf8");
  assert.equal(script.includes("shortcuts:"), false);
  assert.equal(script.includes(SYNC_API_ORIGIN), true);

  const browser = await chromium.launch({ headless: true });
  try {
    await runCountCase(browser, script, "correct", "1問,次は50問");
    await runCountCase(browser, script, "incorrect", "0問,次は50問");
    await runCountCase(browser, script, "unknown", "0問,次は50問");
    await runSyncRefreshClickRaceCase(browser, script);
    await runRetryCase(browser, script);
    await runDoubleClickCase(browser, script);
    await runFrameChangeDuringSyncCase(browser, script);
    await runDeleteFailureCase(browser, script);
    await runDateChangeCase(browser, script);
    await runReloadRetryCase(browser, script);
    await runMilestoneCase(browser, script, 49, 50);
    await runMilestoneCase(browser, script, 99, 100);
    await runMilestoneCase(browser, script, 149, 150);
    await runObservedMilestoneCase(browser, script);
    await runPendingCelebrationRecoveryCase(browser, script);
    await runMilestoneStorageRetryCase(browser, script);
  } finally {
    await browser.close();
  }

  console.log("count smoke test passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
