const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { chromium } = require("playwright");

const projectRoot = path.resolve(__dirname, "..");
const scriptPath = path.join(projectRoot, "kakomonn-reader.user.js");

const mockBody = `
  <div id="meta">中小企業診断士試験 令和6年度 第1問</div>
  <p>これは動作確認用の問題文です.</p>
  <div><label><input type="radio" name="answer">選択肢1</label></div>
  <div><label><input type="radio" name="answer">選択肢2</label></div>
  <button type="button">解答する</button>
  <h2>この過去問の解説</h2>
  <p id="explanation-lock">解説は問題に回答すると<br>表示されます。</p>
  <p id="explanation" hidden>これは動作確認用の解説です.</p>
  <a href="#report">（訂正依頼・報告はこちら）</a>
  <button id="next" type="button">次の問題へ</button>
`;

async function preparePage(page, speechSupported) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.setContent("<!doctype html><html><body></body></html>");
  await page.evaluate((supportsSpeech) => {
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

    if (!supportsSpeech) {
      Object.defineProperty(window, "speechSynthesis", {
        configurable: true,
        value: undefined,
      });
      Object.defineProperty(window, "SpeechSynthesisUtterance", {
        configurable: true,
        value: undefined,
      });
      return;
    }

    window.__speechCalls = [];

    class FakeSpeechSynthesisUtterance {
      constructor(text) {
        this.text = text;
        this.lang = "";
        this.rate = 1;
        this.pitch = 1;
        this.volume = 1;
        this.voice = null;
        this.onstart = null;
        this.onend = null;
        this.onerror = null;
      }
    }

    const fakeSpeechSynthesis = {
      cancel() {},
      speak(utterance) {
        window.__speechCalls.push({
          text: utterance.text,
          lang: utterance.lang,
          rate: utterance.rate,
          pitch: utterance.pitch,
          volume: utterance.volume,
          voice: utterance.voice,
        });

        window.setTimeout(() => {
          utterance.onstart?.();
          window.setTimeout(() => utterance.onend?.(), 100);
        }, 0);
      },
    };

    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: fakeSpeechSynthesis,
    });
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      configurable: true,
      value: FakeSpeechSynthesisUtterance,
    });
  }, speechSupported);

  return errors;
}

async function main() {
  execFileSync("python3", ["build.py"], {
    cwd: projectRoot,
    stdio: "inherit",
  });

  const script = fs.readFileSync(scriptPath, "utf8");
  assert.equal(script.includes("// @version"), false);

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = await preparePage(page, true);
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
      mockBody,
    );

    await page.waitForTimeout(900);
    assert.equal(
      await page.locator("#kakomonn-reader-count").innerText(),
      "0/100",
    );
    assert.equal(
      await page.locator("#kakomonn-reader-start").isVisible(),
      true,
    );

    await page.locator("#kakomonn-reader-start").click();
    await page.waitForSelector("#kakomonn-reader-next", { state: "visible" });
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-status").textContent ===
        "問題文 1/1",
    );
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-status").textContent ===
        "問題文完了",
    );
    await page.waitForFunction(
      () => document.querySelector("#kakomonn-reader-next").disabled === false,
    );

    assert.deepEqual(await page.evaluate(() => window.__speechCalls[0]), {
      text: "問題文。これは動作確認用の問題文です.",
      lang: "ja-JP",
      rate: 1.5,
      pitch: 1,
      volume: 1,
      voice: null,
    });

    await childFrame.evaluate(() => {
      document.querySelector("#explanation-lock").hidden = true;
      document.querySelector("#explanation").hidden = false;
    });
    await page.waitForFunction(() => window.__speechCalls.length === 2);
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-status").textContent ===
        "解説 1/1",
    );
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-status").textContent ===
        "解説完了",
    );
    assert.deepEqual(await page.evaluate(() => window.__speechCalls[1]), {
      text: "解説。これは動作確認用の解説です.",
      lang: "ja-JP",
      rate: 1.2,
      pitch: 1,
      volume: 1,
      voice: null,
    });

    await childFrame.locator("#next").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-count").textContent ===
        "1/100",
    );

    assert.deepEqual(errors, []);

    const unsupportedPage = await context.newPage();
    const unsupportedErrors = await preparePage(unsupportedPage, false);
    await unsupportedPage.addScriptTag({ content: script });
    await unsupportedPage.waitForSelector("#kakomonn-reader-start");
    assert.equal(
      await unsupportedPage.locator("#kakomonn-reader-start").innerText(),
      "読み上げ非対応",
    );
    assert.equal(
      await unsupportedPage.locator("#kakomonn-reader-start").isDisabled(),
      true,
    );
    await unsupportedPage.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-status").textContent ===
        "読み上げ非対応",
    );
    assert.deepEqual(unsupportedErrors, []);
  } finally {
    await browser.close();
  }

  console.log("smoke test passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
