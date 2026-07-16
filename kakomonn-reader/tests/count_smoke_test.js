const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { chromium } = require("playwright");

const projectRoot = path.resolve(__dirname, "..");
const scriptPath = path.join(projectRoot, "kakomonn-reader.user.js");
const edgeUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0";

function createMockBody(resultText) {
  const result =
    resultText === null ? "" : `<div id="answer-result">${resultText}</div>`;
  return `
    <div id="meta">中小企業診断士試験 令和6年度 第1問</div>
    <p>これは動作確認用の問題文です.</p>
    <div><label><input type="radio" name="answer">選択肢1</label></div>
    <div><label><input type="radio" name="answer">選択肢2</label></div>
    <button type="button">解答する</button>
    <div>解答結果</div>
    ${result}
    <h2>この過去問の解説</h2>
    <p>これは動作確認用の解説です.</p>
    <a href="#report">（訂正依頼・報告はこちら）</a>
    <button id="next" type="button">次の問題へ</button>
  `;
}

async function preparePage(page) {
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
  return errors;
}

async function runCountCase(browser, script, resultText, expectedCount) {
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
      createMockBody(resultText),
    );
    await page.waitForTimeout(950);

    assert.equal(
      await page.locator("#kakomonn-reader-count").innerText(),
      "0/50",
    );
    await childFrame.locator("#next").click();
    await page.waitForTimeout(100);
    assert.equal(
      await page.locator("#kakomonn-reader-count").innerText(),
      expectedCount,
    );
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

  const browser = await chromium.launch({ headless: true });
  try {
    await runCountCase(browser, script, "正解です！", "1/50");
    await runCountCase(
      browser,
      script,
      "不正解です。正解はアです。",
      "0/50",
    );
    await runCountCase(browser, script, null, "0/50");
  } finally {
    await browser.close();
  }

  console.log("count smoke test passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
