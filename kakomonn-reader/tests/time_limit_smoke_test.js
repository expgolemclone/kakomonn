const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const { resolve } = require("node:path");

const { chromium } = require("playwright");
const {
  createSyncMockConfiguration,
  installSyncMockInWindow,
} = require("./sync_mock.js");

const projectRoot = resolve(__dirname, "..", "..");
const scriptPath = resolve(
  projectRoot,
  "kakomonn-reader",
  "kakomonn-reader.user.js"
);
const currentURL = "https://chushoks.kakomonn.com/questions/100";
const nextURL = "https://chushoks.kakomonn.com/questions/101";

function questionHTML(number) {
  return `<!doctype html>
    <html lang="ja">
      <head><meta charset="utf-8"><title>問${number}</title></head>
      <body>
        <main class="problem_detail">
          <p class="when">令和8年度 問${number}</p>
          <p class="ttl">制限時間を確認する問題です.</p>
          <ul class="list"><li><label><input type="radio" name="answer">選択肢1</label></li></ul>
          <button type="button">解答する</button>
        </main>
      </body>
    </html>`;
}

async function preparePage(browser, script) {
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
  });
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(message.text());
    }
  });
  await page.clock.install({ time: new Date("2026-07-17T03:00:00.000Z") });
  await page.route("https://chushoks.kakomonn.com/**", async (route) => {
    const url = new URL(route.request().url());
    const number = url.pathname.endsWith("/101") ? 101 : 100;
    await route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: questionHTML(number),
    });
  });
  await page.goto(currentURL, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    installSyncMockInWindow,
    createSyncMockConfiguration({ configured: true, nextQuestionId: "101" })
  );
  await page.addScriptTag({ content: script });
  await page.locator("#kakomonn-reader-time-limit").waitFor({
    state: "visible",
  });
  return { browserErrors, page };
}

async function readerFrame(page) {
  await page.waitForFunction(() => {
    const frame = document.querySelector("#kakomonn-reader-frame");
    return frame?.contentDocument?.querySelector(".problem_detail") !== null;
  });
  return page.frames().find((frame) => frame !== page.mainFrame());
}

async function questionExpiryRecordsIncorrectAndSkips(browser, script) {
  const { browserErrors, page } = await preparePage(browser, script);
  try {
    assert.equal(
      await page.locator("#kakomonn-reader-time-limit").getAttribute("data-phase"),
      "question"
    );
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.clock.fastForward(300_100);
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-frame")?.contentWindow
          ?.location.href === "https://chushoks.kakomonn.com/questions/101"
    );
    const answerCalls = await page.evaluate(() =>
      window.__syncMock.calls.filter(
        (call) => new URL(call.url).pathname === "/v5/attempts"
      )
    );
    assert.equal(answerCalls.length, 1);
    assert.equal(answerCalls[0].body.result, "incorrect");
    assert.equal(answerCalls[0].body.questionId, "100");
    assert.equal(await page.evaluate(() => window.__syncMock.attemptCount), 1);
    const nextCall = await page.evaluate(() =>
      window.__syncMock.calls.find(
        (call) => new URL(call.url).pathname === "/v5/next"
      )
    );
    assert.equal(
      new URL(nextCall.url).searchParams.get("excludeQuestionId"),
      "100"
    );
    assert.deepEqual(browserErrors, []);
  } finally {
    await page.close();
  }
}

async function explanationExpiryRecordsAndAdvances(browser, script) {
  const { browserErrors, page } = await preparePage(browser, script);
  try {
    const frame = await readerFrame(page);
    await frame.evaluate(() => {
      const result = document.createElement("div");
      result.id = "js-answer-result-box";
      result.className = "is-correct";
      document.body.append(result);
    });
    await page.clock.fastForward(1_000);
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-time-limit")?.dataset.phase ===
        "explanation"
    );
    await page.clock.fastForward(300_100);
    await page.waitForFunction(
      () =>
        window.__syncMock.calls.filter(
          (call) => new URL(call.url).pathname === "/v5/attempts"
        ).length === 1
    );
    const recorded = await page.evaluate(() => ({
      answered: window.__syncMock.attemptCount,
      body: window.__syncMock.calls.find(
        (call) => new URL(call.url).pathname === "/v5/attempts"
      ).body,
    }));
    assert.equal(recorded.answered, 1);
    assert.equal(recorded.body.result, "correct");
    assert.equal(recorded.body.site, "chushoks.kakomonn.com");
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-frame")?.contentWindow
          ?.location.href === "https://chushoks.kakomonn.com/questions/101"
    );
    assert.deepEqual(browserErrors, []);
  } finally {
    await page.close();
  }
}

async function main() {
  const script = await readFile(scriptPath, "utf8");
  const browser = await chromium.launch({ headless: true });
  try {
    await questionExpiryRecordsIncorrectAndSkips(browser, script);
    await explanationExpiryRecordsAndAdvances(browser, script);
  } finally {
    await browser.close();
  }
  console.log("time limit smoke test passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
