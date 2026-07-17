const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { chromium } = require("playwright");
const {
  installSyncMock,
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
    <button id="next" type="button">次の問題へ</button>
  `;
}

async function preparePage(page, syncOptions = {}) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.setContent("<!doctype html><html><body></body></html>");
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

async function runCountCase(browser, script, result, expectedCount) {
  const context = await browser.newContext({ userAgent: edgeUserAgent });
  try {
    const page = await context.newPage();
    const errors = await preparePage(page);
    await page.addScriptTag({ content: script });
    await page.waitForSelector("#kakomonn-reader-frame");

    const childFrames = page
      .frames()
      .filter((frame) => frame !== page.mainFrame());
    assert.equal(childFrames.length, 1);
    const childFrame = childFrames[0];
    await childFrame.evaluate(
      (html) => {
        document.body.innerHTML = html;
      },
      createMockBody(result),
    );
    await page.waitForTimeout(950);

    assert.equal(
      await page.locator("#kakomonn-reader-count").innerText(),
      "0/50",
    );
    await childFrame.locator("#next").click();
    if (result === "unknown") {
      await page.waitForFunction(
        () =>
          document.querySelector("#kakomonn-reader-status").textContent ===
          "正誤を確認できません",
      );
    }
    await page.waitForFunction(
      (countText) =>
        document.querySelector("#kakomonn-reader-count").textContent ===
        countText,
      expectedCount,
    );
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

async function runRetryCase(browser, script) {
  const context = await browser.newContext({ userAgent: edgeUserAgent });
  try {
    const page = await context.newPage();
    const errors = await preparePage(page);
    await page.addScriptTag({ content: script });
    await page.waitForSelector("#kakomonn-reader-frame");
    const childFrame = page
      .frames()
      .find((candidate) => candidate !== page.mainFrame());
    await childFrame.evaluate(
      (html) => {
        document.body.innerHTML = html;
      },
      createMockBody("correct"),
    );
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-count").textContent ===
        "0/50",
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
      "0/50",
    );

    await childFrame.locator("#next").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-count").textContent ===
        "1/50",
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
    await page.waitForSelector("#kakomonn-reader-frame");
    const childFrame = page
      .frames()
      .find((candidate) => candidate !== page.mainFrame());
    await childFrame.evaluate(
      (html) => {
        document.body.innerHTML = html;
      },
      createMockBody("correct"),
    );
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-count").textContent ===
        "0/50",
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
        "1/50",
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
    await page.waitForSelector("#kakomonn-reader-frame");
    const childFrame = page
      .frames()
      .find((candidate) => candidate !== page.mainFrame());
    await childFrame.evaluate(
      (html) => {
        document.body.innerHTML = html;
      },
      createMockBody("correct"),
    );
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-count").textContent ===
        "0/50",
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
    assert.equal(await page.locator("#kakomonn-reader-count").innerText(), "1/50");

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
    await frameElement.waitFor({ state: "attached" });
    const childFrame = page
      .frames()
      .find((candidate) => candidate !== page.mainFrame());
    await childFrame.evaluate(
      (html) => {
        document.body.innerHTML = html;
      },
      createMockBody("correct"),
    );
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-count").textContent ===
        "0/50",
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
    await page.waitForSelector("#kakomonn-reader-frame");
    const childFrame = page
      .frames()
      .find((candidate) => candidate !== page.mainFrame());
    await childFrame.evaluate(
      (html) => {
        document.body.innerHTML = html;
      },
      createMockBody("correct"),
    );
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-count").textContent ===
        "0/50",
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
    assert.equal(await page.locator("#kakomonn-reader-count").innerText(), "4/50");
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
    await firstPage.waitForSelector("#kakomonn-reader-frame");
    const firstFrame = firstPage
      .frames()
      .find((candidate) => candidate !== firstPage.mainFrame());
    await firstFrame.evaluate(
      (html) => {
        document.body.innerHTML = html;
      },
      createMockBody("correct"),
    );
    await firstPage.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-count").textContent ===
        "0/50",
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
      processedOperationIds: [pending.operationId],
    });
    await secondPage.addScriptTag({ content: script });
    await secondPage.waitForSelector("#kakomonn-reader-frame");
    const secondFrame = secondPage
      .frames()
      .find((candidate) => candidate !== secondPage.mainFrame());
    await secondFrame.evaluate(
      (html) => {
        document.body.innerHTML = html;
      },
      createMockBody("correct"),
    );
    await secondPage.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-count").textContent ===
        "1/50",
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

async function runGoalCase(browser, script) {
  const context = await browser.newContext({ userAgent: edgeUserAgent });
  try {
    const page = await context.newPage();
    const errors = await preparePage(page, { count: 49 });
    await page.addScriptTag({ content: script });
    await page.waitForSelector("#kakomonn-reader-frame");
    const childFrame = page
      .frames()
      .find((candidate) => candidate !== page.mainFrame());
    await childFrame.evaluate(
      (html) => {
        document.body.innerHTML = html;
      },
      createMockBody("correct"),
    );
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-count").textContent ===
        "49/50",
    );

    await childFrame.locator("#next").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-count").textContent ===
        "50/50",
    );

    assert.equal(
      await page.locator("#kakomonn-reader-next").innerText(),
      "50問完了",
    );
    assert.equal(await page.locator("#kakomonn-reader-next").isDisabled(), true);
    assert.equal(page.url().startsWith("shortcuts:"), false);
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
    await runCountCase(browser, script, "correct", "1/50");
    await runCountCase(browser, script, "incorrect", "0/50");
    await runCountCase(browser, script, "unknown", "0/50");
    await runRetryCase(browser, script);
    await runDoubleClickCase(browser, script);
    await runFrameChangeDuringSyncCase(browser, script);
    await runDeleteFailureCase(browser, script);
    await runDateChangeCase(browser, script);
    await runReloadRetryCase(browser, script);
    await runGoalCase(browser, script);
  } finally {
    await browser.close();
  }

  console.log("count smoke test passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
