const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { chromium } = require("playwright");
const {
  kakomonnFreeEnvironment,
} = require("../../scripts/kakomonn-config.cjs");
const {
  installSyncMock,
  PENDING_ATTEMPT_KEY,
  SYNC_API_ORIGIN,
  SYNC_TOKEN_KEY,
} = require("./sync_mock");

const projectRoot = path.resolve(__dirname, "..");
const scriptPath = path.join(projectRoot, "kakomonn-reader.user.js");
const windowsEdgeUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0";
const chromeUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/150.0.0.0 Safari/537.36";
const iosUserAgent =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 " +
  "Mobile/15E148 Safari/604.1";
const windowsFirefoxUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:141.0) " +
  "Gecko/20100101 Firefox/141.0";
const iosChromeUserAgent =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/150.0.0.0 " +
  "Mobile/15E148 Safari/604.1";
const azureSpeechUrl =
  "https://japaneast.tts.speech.microsoft.com/cognitiveservices/v1";
const azureSpeechVoiceName = "ja-JP-NanamiNeural";
const azureSpeechOutputFormat = "audio-24khz-48kbitrate-mono-mp3";

function expectedSpeechSSML(
  text,
  rate,
  {
    locale = "ja-JP",
    voiceName = azureSpeechVoiceName,
  } = {},
) {
  const escapedText = text.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character]);
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}">` +
    `<voice name="${voiceName}">` +
    `<prosody rate="${rate}">${escapedText}</prosody>` +
    "</voice></speak>"
  );
}

const mockBody = `
  <style>
    #js-answer-result-box.is-correct {
      background-color: rgb(24, 121, 78);
      color: rgb(255, 255, 255);
    }
    #js-answer-result-box.is-wrong {
      background-color: rgb(139, 47, 47);
      color: rgb(255, 255, 255);
    }
  </style>
  <div hidden>
    <img src="https://cdn.example.test/question.png" alt="拡大表示の重複画像">
    <div id="dark-mode-light-surface" style="background-color: rgb(255, 255, 255)">
      <div
        id="dark-mode-dark-surface"
        style="background-color: rgb(20, 20, 20); filter: contrast(90%)"
      >
        <div
          id="dark-mode-nested-light-surface"
          style="background-color: rgb(255, 255, 255)"
        ></div>
      </div>
      <div
        id="dark-mode-alpha-surface"
        style="background-color: rgba(0, 0, 0, 0.9)"
      ></div>
    </div>
  </div>
  <header class="l-header">元サイトヘッダー</header>
  <div id="mock-page-header" style="height: 360px">ページ上部</div>
  <div class="sect_problem">
    <div class="ttl_box03"><h2 class="main">問題</h2></div>
    <div class="problem_detail">
    <p class="when">
      中小企業診断士試験 令和2年度（2020年） 問19（経済学・経済政策 問19）
      <span><a href="#report">（訂正依頼・報告はこちら）</a></span>
    </p>
    <div class="ttl">
      これは動作確認用の問題文です.<br>
      これは改行後の問題文です.
    </div>
    <div class="zoomin">
      <img
        src="https://cdn.example.test/question.png"
        alt="問題文の画像"
      >
    </div>
    <ul class="list">
      <li><div>選択肢1</div></li>
      <li><div>選択肢2</div></li>
    </ul>
    <ul class="check">
      <li><label><input type="radio" name="answer">1</label></li>
      <li><label><input type="radio" name="answer">2</label></li>
    </ul>
    <button type="button">解答する</button>
      <input id="shortcut-text-input" type="text">
      <div class="answer-right">
        <p id="correct-result" hidden>正解！素晴らしいです</p>
      </div>
      <div class="answer-mistake">
        <p id="incorrect-result" hidden>残念...</p>
      </div>
      <div id="explst"></div>
    </div>
  </div>
  <div class="sect_commentary">
    <h2>この過去問の解説</h2>
    <div>解答結果</div>
    <div id="js-answer-result-box"></div>
    <div id="js-commentary-wrap">
    <div class="item">
      <p class="none_text" id="explanation-lock" style="display:none">
        解説は問題に回答すると<br>表示されます。
      </p>
      <p class="num"><span>01</span></p>
      <div class="text" id="explanation">
        <div class="expound-top">
          <p>これは動作確認用の解説です.</p>
          <figure>
            <img
              src="https://cdn.example.test/explanation-1.png"
              alt="解説図"
            >
          </figure>
        </div>
      </div>
      <div class="reference">
        <div>参考になった数1</div>
        <button type="button">参考になった</button>
      </div>
    </div>
    <div class="advertisement-label">Advertisement</div>
    <div class="advertisement-box"></div>
    <div class="item">
      <p class="none_text" style="display:none">
        解説は問題に回答すると<br>表示されます。
      </p>
      <p class="num"><span>02</span></p>
      <div class="text">
        <div class="expound-top">
          <p>これは二つ目の解説です.</p>
          <figure>
            <img src="https://cdn.example.test/explanation-2.png">
          </figure>
          <figure>
            <img
              src="https://cdn.example.test/explanation-1.png"
              alt="重複する解説図"
            >
          </figure>
        </div>
      </div>
    </div>
    </div>
  </div>
  <a href="#report">（訂正依頼・報告はこちら）</a>
  <button id="scroll-next" type="button">次の問題へ</button>
  <a id="next" href="/questions/next/45125">次の問題（問5）へ</a>
  <div id="shortcut-scroll-spacer" style="height: 1000px"></div>
`;

const expectedCopiedMarkdown = `# 中小企業診断士試験 令和2年度（2020年） 問19（経済学・経済政策 問19）

## 問題文

これは動作確認用の問題文です.

これは改行後の問題文です.

![問題文の画像](https://cdn.example.test/question.png)

### 選択肢

- 選択肢1
- 選択肢2

### 自分の回答

選択肢1: 選択肢1

## 解説

### 解説 01

これは動作確認用の解説です.

![解説図](https://cdn.example.test/explanation-1.png)

### 解説 02

これは二つ目の解説です.

![解説画像 1](https://cdn.example.test/explanation-2.png)`;

async function preparePage(page, speechMode, syncOptions = {}) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.route("https://chushoks.kakomonn.com/**", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: "<!doctype html><html><body></body></html>",
    }),
  );
  await page.goto("https://chushoks.kakomonn.com/questions/45124");
  await page.evaluate((mode) => {
    if (
      ![
        "none",
        "audio",
        "audio-gesture-required",
        "audio-manual",
      ].includes(mode)
    ) {
      throw new Error(`unknown speech mode: ${mode}`);
    }

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
    window.__copiedTexts = [];
    window.__clipboardWriteFails = false;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        async writeText() {
          throw new Error("page clipboard API must not be used");
        },
      },
    });
    let gestureRequired = mode === "audio-gesture-required";
    const manualPlayback = mode === "audio-manual";
    window.__audioPauseCalls = 0;
    window.__audioPlayCalls = 0;
    window.__audioBlobs = [];
    const createObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      window.__audioBlobs.push({ size: blob.size, type: blob.type });
      return createObjectURL(blob);
    };

    class FakeAudio {
      constructor() {
        this.src = "";
        this.onplay = null;
        this.onended = null;
        this.onerror = null;
        this.paused = true;
        window.__audioInstance = this;
      }

      canPlayType(type) {
        return type === "audio/mpeg" ? "probably" : "";
      }

      pause() {
        this.paused = true;
        window.__audioPauseCalls += 1;
      }

      load() {
        this.paused = true;
      }

      play() {
        this.paused = false;
        window.__audioPlayCalls += 1;
        if (this.src.startsWith("data:audio/wav")) {
          if (gestureRequired) {
            gestureRequired = false;
            return Promise.reject(new Error("mock gesture required"));
          }
          return Promise.resolve();
        }
        window.setTimeout(() => {
          if (this.paused) {
            return;
          }
          this.onplay?.();
          if (!manualPlayback) {
            window.setTimeout(() => {
              if (!this.paused) {
                this.onended?.();
              }
            }, 100);
          }
        }, 0);
        return Promise.resolve();
      }
    }

    if (mode === "none") {
      Object.defineProperty(window, "Audio", {
        configurable: true,
        value: undefined,
      });
      return;
    }

    Object.defineProperty(window, "Audio", {
      configurable: true,
      value: FakeAudio,
    });
  }, speechMode);

  await installSyncMock(page, syncOptions);

  return errors;
}

async function loadMockQuestion(page, script) {
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
      Object.defineProperty(document.querySelector("#next"), "getClientRects", {
        configurable: true,
        value: () => [],
      });
      window.__answerButtonClicks = 0;
      document
        .querySelector(".problem_detail button")
        .addEventListener("click", () => {
          window.__answerButtonClicks += 1;
        });
      for (const choice of document.querySelectorAll(
        ".problem_detail > ul.list > li",
      )) {
        choice.addEventListener("click", () => {
          choice.classList.toggle("is-active");
        });
      }
    },
    mockBody,
  );
  await page.waitForTimeout(900);
  return childFrame;
}

async function installCorrectFeedbackRandom(page, values) {
  await page.evaluate((queuedValues) => {
    const queue = [...queuedValues];
    const nativeGetRandomValues = Crypto.prototype.getRandomValues;
    window.__correctFeedbackRandomCalls = [];
    Object.defineProperty(Crypto.prototype, "getRandomValues", {
      configurable: true,
      value(target) {
        if (target instanceof Uint16Array && target.length === 1) {
          if (queue.length === 0) {
            throw new Error("correct feedback random queue was exhausted");
          }
          const value = queue.shift();
          window.__correctFeedbackRandomCalls.push(value);
          target[0] = value;
          return target;
        }
        return nativeGetRandomValues.call(this, target);
      },
    });
  }, values);
}

async function assertRuntimeRejected(
  browser,
  script,
  {
    userAgent,
    scriptHandler = "Tampermonkey",
    missingAPI = null,
  },
) {
  const context = await browser.newContext({ userAgent });
  const page = await context.newPage();
  const errors = await preparePage(page, "audio");
  await page.evaluate(
    ({ handler, missing }) => {
      if (missing === "GM") {
        window.GM = undefined;
      } else if (missing === "GM_info") {
        window.GM_info = undefined;
      } else if (missing !== null) {
        delete window.GM[missing];
      }
      if (missing !== "GM_info") {
        window.GM_info = { scriptHandler: handler };
      }
    },
    { handler: scriptHandler, missing: missingAPI },
  );
  await page.addScriptTag({ content: script });
  assert.equal(await page.locator("#kakomonn-reader-shell").count(), 0);
  assert.equal(await page.locator("style").count(), 0);
  assert.deepEqual(
    await page.evaluate(() => ({
      calls: window.__syncMock.calls.length,
      clipboardWrites: window.__syncMock.clipboardWrites.length,
    })),
    { calls: 0, clipboardWrites: 0 },
  );
  assert.deepEqual(errors, []);
  await context.close();
}

async function markAnswerResult(childFrame, answerResult) {
  await childFrame.evaluate((result) => {
    if (result === "correct") {
      document.querySelector("#correct-result").hidden = false;
    }
    document
      .querySelector("#js-answer-result-box")
      .classList.add(result === "correct" ? "is-correct" : "is-wrong");
    for (const lock of document.querySelectorAll(
      "#js-commentary-wrap > .item > .none_text"
    )) {
      lock.hidden = true;
    }
    for (const explanation of document.querySelectorAll(
      "#js-commentary-wrap > .item > .text"
    )) {
      explanation.hidden = false;
    }
  }, answerResult);
}

async function azureSpeechCalls(page) {
  return page.evaluate(
    (url) => window.__syncMock.calls.filter((call) => call.url === url),
    azureSpeechUrl,
  );
}

async function speechTokenCallCount(page) {
  return page.evaluate(
    () =>
      window.__syncMock.calls.filter(
        (call) => new URL(call.url).pathname === "/v9/speech-token",
      ).length,
  );
}

async function finishManualAudio(page) {
  await page.evaluate(() => {
    const audio = window.__audioInstance;
    if (typeof audio?.onended !== "function") {
      throw new Error("manual audio does not have an active completion handler");
    }
    audio.onended();
  });
}

async function runCorrectFeedbackCase(context, script) {
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = await preparePage(page, "audio-manual");
  await installCorrectFeedbackRandom(page, [111]);
  const childFrame = await loadMockQuestion(page, script);
  try {
    await page.waitForFunction(
      () => window.__audioPlayCalls >= 2 && typeof window.__audioInstance?.onended === "function",
    );
    await finishManualAudio(page);
    await page.waitForFunction(
      () => window.__audioInstance?.src === "",
    );

    await markAnswerResult(childFrame, "correct");
    await childFrame.waitForSelector(".kakomonn-reader-correct-feedback");
    assert.deepEqual(
      await childFrame.locator(".kakomonn-reader-correct-feedback").evaluate(
        (element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            animationName: style.animationName,
            badge: element.querySelector(
              ".kakomonn-reader-correct-feedback-badge",
            )?.textContent,
            display: style.display,
            message: element.querySelector(
              ".kakomonn-reader-correct-feedback-message",
            )?.textContent,
            pointerEvents: style.pointerEvents,
            rarity: element.dataset.rarity,
            withinViewport:
              rect.left >= 0 &&
              rect.right <= innerWidth &&
              rect.width > 0 &&
              rect.height > 0,
          };
        },
      ),
      {
        animationName: "none",
        badge: "NORMAL",
        display: "grid",
        message: "That's Right!!",
        pointerEvents: "none",
        rarity: "normal",
        withinViewport: true,
      },
    );

    await childFrame.locator("#js-answer-result-box").evaluate((element) => {
      element.style.setProperty("outline", "1px solid transparent");
      element.dataset.duplicateMutationProbe = "true";
    });
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-frame")?.contentWindow
          ?.location.href ===
        "https://chushoks.kakomonn.com/questions/45125",
    );
    const carriedFeedback = page.locator(
      "#kakomonn-reader-carried-correct-feedback",
    );
    await carriedFeedback.waitFor({ state: "visible" });
    assert.deepEqual(
      await carriedFeedback.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const shell = document
          .querySelector("#kakomonn-reader-shell")
          .getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          animationName: style.animationName,
          badge: element.querySelector(
            ".kakomonn-reader-correct-feedback-badge",
          )?.textContent,
          message: element.querySelector(
            ".kakomonn-reader-correct-feedback-message",
          )?.textContent,
          pointerEvents: style.pointerEvents,
          rarity: element.dataset.rarity,
          withinShell:
            rect.left >= shell.left &&
            rect.top >= shell.top &&
            rect.right <= shell.right &&
            rect.bottom <= shell.bottom,
        };
      }),
      {
        animationName: "none",
        badge: "NORMAL",
        message: "That's Right!!",
        pointerEvents: "none",
        rarity: "normal",
        withinShell: true,
      },
    );

    await childFrame.evaluate((html) => {
      document.body.innerHTML = html;
    }, mockBody);
    await page.waitForTimeout(1_000);
    assert.equal((await azureSpeechCalls(page)).length, 2);
    assert.equal(
      (await azureSpeechCalls(page))[1].body,
      expectedSpeechSSML("That's right!", "+10%", {
        locale: "en-US",
        voiceName: "en-US-JennyNeural",
      }),
    );
    await finishManualAudio(page);
    await page.waitForFunction(
      () => window.__audioBlobs.length === 3 && typeof window.__audioInstance?.onended === "function",
    );
    assert.equal(await carriedFeedback.isVisible(), true);
    await finishManualAudio(page);
    await carriedFeedback.waitFor({ state: "hidden" });
    await page.waitForFunction(
      (url) =>
        window.__syncMock.calls.filter((call) => call.url === url).length === 3,
      azureSpeechUrl,
    );
    assert.equal(
      (await azureSpeechCalls(page))[2].body,
      expectedSpeechSSML(
        "問題文。これは動作確認用の問題文です.。これは改行後の問題文です.",
        "+100%",
      ),
    );
    assert.equal(
      (await azureSpeechCalls(page)).filter((call) =>
        call.body.includes("en-US-JennyNeural"),
      ).length,
      1,
    );
    assert.deepEqual(
      await page.evaluate(() => window.__audioBlobs),
      [
        { size: 4, type: "audio/mpeg" },
        { size: 31_796, type: "audio/wav" },
        { size: 4, type: "audio/mpeg" },
        { size: 4, type: "audio/mpeg" },
      ],
    );
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

async function runCorrectFeedbackVariantCase(context, script, expected) {
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = await preparePage(page, "audio", {
    nextQuestionId: null,
  });
  await installCorrectFeedbackRandom(page, expected.randomValues);
  const childFrame = await loadMockQuestion(page, script);
  try {
    await page.waitForFunction(
      () => window.__audioPlayCalls >= 1 && window.__audioInstance?.src === "",
    );
    await markAnswerResult(childFrame, "correct");
    const feedback = childFrame.locator(".kakomonn-reader-correct-feedback");
    await feedback.waitFor();
    assert.deepEqual(
      await feedback.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          animationName: style.animationName,
          badge: element.querySelector(
            ".kakomonn-reader-correct-feedback-badge",
          )?.textContent,
          coversViewport:
            Math.abs(rect.left) <= 1 &&
            Math.abs(rect.top) <= 1 &&
            rect.right >= innerWidth - 1 &&
            rect.bottom >= innerHeight - 1,
          message: element.querySelector(
            ".kakomonn-reader-correct-feedback-message",
          )?.textContent,
          pointerEvents: style.pointerEvents,
          position: style.position,
          rarity: element.dataset.rarity,
          withinViewport:
            rect.left >= -1 &&
            rect.right <= innerWidth + 1 &&
            rect.width > 0 &&
            rect.height > 0,
        };
      }),
      {
        animationName: "none",
        badge: expected.badge,
        coversViewport: expected.rarity === "ssr",
        message: expected.displayText,
        pointerEvents: "none",
        position: expected.rarity === "ssr" ? "fixed" : "relative",
        rarity: expected.rarity,
        withinViewport: true,
      },
    );

    await feedback.waitFor({ state: "hidden" });
    const speechCalls = await azureSpeechCalls(page);
    assert.equal(
      speechCalls.at(-1).body,
      expectedSpeechSSML(expected.speechText, "+10%", {
        locale: "en-US",
        voiceName: "en-US-JennyNeural",
      }),
    );
    assert.deepEqual(
      await page.evaluate(() => window.__audioBlobs.slice(0, 3)),
      [
        { size: 4, type: "audio/mpeg" },
        { size: expected.waveSize, type: "audio/wav" },
        { size: 4, type: "audio/mpeg" },
      ],
    );
    assert.deepEqual(
      await page.evaluate(() => window.__correctFeedbackRandomCalls),
      expected.randomValues,
    );
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

async function runQueuedCorrectFeedbackVariantCase(context, script) {
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = await preparePage(page, "audio-manual");
  await installCorrectFeedbackRandom(page, [11, 0]);
  const childFrame = await loadMockQuestion(page, script);
  try {
    await page.waitForFunction(
      () => window.__audioPlayCalls >= 2 && typeof window.__audioInstance?.onended === "function",
    );
    await finishManualAudio(page);
    await page.waitForFunction(
      () => window.__audioInstance?.src === "",
    );

    await markAnswerResult(childFrame, "correct");
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-frame")?.contentWindow
          ?.location.href ===
        "https://chushoks.kakomonn.com/questions/45125",
    );
    const carriedFeedback = page.locator(
      "#kakomonn-reader-carried-correct-feedback",
    );
    await carriedFeedback.waitFor({ state: "visible" });
    assert.equal(await carriedFeedback.getAttribute("data-rarity"), "rare");

    await childFrame.evaluate((html) => {
      document.body.innerHTML = html;
    }, mockBody);
    await page.waitForTimeout(1_000);
    await page.evaluate(() => {
      window.__syncMock.nextQuestionId = null;
    });
    await markAnswerResult(childFrame, "correct");
    await page.waitForFunction(
      () => window.__correctFeedbackRandomCalls.length === 2,
    );
    assert.equal(await carriedFeedback.getAttribute("data-rarity"), "rare");

    await finishManualAudio(page);
    await page.waitForFunction(
      () => window.__audioBlobs.length === 3 && typeof window.__audioInstance?.onended === "function",
    );
    await finishManualAudio(page);

    const queuedFeedback = childFrame.locator(
      '.kakomonn-reader-correct-feedback[data-rarity="ssr"]',
    );
    await queuedFeedback.waitFor();
    assert.equal(
      await queuedFeedback
        .locator(".kakomonn-reader-correct-feedback-message")
        .innerText(),
      "Legendary! That's Right!!",
    );
    await finishManualAudio(page);
    await page.waitForFunction(
      () => window.__audioBlobs.length === 5 && typeof window.__audioInstance?.onended === "function",
    );
    await finishManualAudio(page);
    await page.waitForFunction(
      () => window.__audioInstance?.src === "",
    );
    assert.deepEqual(
      await page.evaluate(() => window.__correctFeedbackRandomCalls),
      [11, 0],
    );
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

async function runCorrectCelebrationFeedbackCase(context, script) {
  const page = await context.newPage();
  await page.route(
    "https://kakomonn-congratulations.kakomonn.workers.dev/**",
    (route) =>
      route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: "<!doctype html><html><body><h1>dailyKpiCompleted達成</h1></body></html>",
      }),
  );
  const errors = await preparePage(page, "audio-manual", {
    nextQuestionId: null,
  });
  await installCorrectFeedbackRandom(page, [111]);
  const childFrame = await loadMockQuestion(page, script);
  try {
    await page.waitForFunction(
      () => window.__audioPlayCalls >= 2 && typeof window.__audioInstance?.onended === "function",
    );
    await finishManualAudio(page);
    await page.evaluate(() => {
      window.__syncMock.nextCelebration = {
        site: "chushoks.kakomonn.com",
        date: "2026-08-10",
        dailyKpiCompleted: true,
      };
    });
    await markAnswerResult(childFrame, "correct");
    await page.waitForFunction(
      () =>
        window.__syncMock.attemptCount === 1 &&
        document.querySelector("#kakomonn-reader-frame")?.contentWindow
          ?.location.href ===
          "https://chushoks.kakomonn.com/questions/45124",
    );
    await page.waitForTimeout(200);
    assert.equal(
      page.url(),
      "https://chushoks.kakomonn.com/questions/45124",
    );
    assert.equal(
      await childFrame
        .locator(".kakomonn-reader-correct-feedback-message")
        .innerText(),
      "That's Right!!",
    );

    await finishManualAudio(page);
    await page.waitForFunction(
      () => window.__audioBlobs.length === 3 && typeof window.__audioInstance?.onended === "function",
    );
    assert.equal(
      page.url(),
      "https://chushoks.kakomonn.com/questions/45124",
    );
    await finishManualAudio(page);
    await page.waitForURL((url) =>
      url.origin === "https://kakomonn-congratulations.kakomonn.workers.dev",
    );
    assert.equal(new URL(page.url()).searchParams.get("dailyKpiCompleted"), "true");
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

async function assertIncorrectSkip(context, script) {
  const page = await context.newPage();
  const errors = await preparePage(page, "none");
    const frame = await loadMockQuestion(page, script);
  try {
    await page.waitForFunction(
      () =>
        window.__syncMock.calls.some(
          (call) => new URL(call.url).pathname === "/v9/state",
        ) && document.querySelector("#kakomonn-reader-sync-settings")?.open === false,
    );
    if (await page.locator("#kakomonn-reader-error-dialog").getAttribute("open") !== null) {
      await page.locator("#kakomonn-reader-error-close").click();
    }
    await frame.evaluate(() => {
      document.querySelector("#next")?.remove();
      document.querySelector("#scroll-next")?.remove();
    });
    await frame.locator("input[name='answer']").first().focus();
    await page.keyboard.press("n");
    await page.waitForFunction(
      () => window.__syncMock.attemptCount === 1,
    );
    const calls = await page.evaluate(() => ({
      attempts: window.__syncMock.calls.filter(
        (call) => new URL(call.url).pathname === "/v9/attempts",
      ),
      next: window.__syncMock.calls.filter(
        (call) => new URL(call.url).pathname === "/v9/next",
      ),
    }));
    assert.equal(calls.attempts.length, 1);
    assert.equal(calls.attempts[0].body.questionId, "45124");
    assert.equal(calls.attempts[0].body.answerResult, "incorrect");
    assert.equal(calls.next.length, 0);
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-frame")?.contentWindow
          ?.location.href === "https://chushoks.kakomonn.com/questions/45125",
    );
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

async function main() {
  execFileSync("python3", ["build.py"], {
    cwd: projectRoot,
    env: kakomonnFreeEnvironment(),
    stdio: "inherit",
  });

  const script = fs.readFileSync(scriptPath, "utf8");
  assert.match(script, /^\/\/ @version\s+2\.0\.0\s*$/m);
  assert.match(
    script,
    /^\/\/ @updateURL\s+https:\/\/github\.com\/expgolemclone\/kakomonn\/releases\/latest\/download\/kakomonn-reader\.user\.js\s*$/m,
  );
  assert.equal(script.includes(SYNC_API_ORIGIN), true);
  assert.equal(
    script.includes(`// @connect      ${new URL(SYNC_API_ORIGIN).host}`),
    true,
  );
  assert.equal(script.includes("speechSynthesis"), false);
  assert.equal(script.includes("SpeechSynthesisUtterance"), false);
  assert.equal(script.includes("Microsoft Ayumi"), false);

  const browser = await chromium.launch({
    env: kakomonnFreeEnvironment(),
    headless: true,
  });
  try {
    const context = await browser.newContext({ userAgent: chromeUserAgent });
    const page = await context.newPage();
    const errors = await preparePage(page, "audio");
    const childFrame = await loadMockQuestion(page, script);
    const initialProblemPresentation = await childFrame.evaluate(() => {
      const problemHeading = document.querySelector(
        ".sect_problem > .ttl_box03 > h2.main",
      );
      return {
        answerRightDisplay: getComputedStyle(
          document.querySelector(".answer-right"),
        ).display,
        commentaryDisplay: getComputedStyle(
          document.querySelector(".sect_commentary"),
        ).display,
        explanationText: document.querySelector("#explanation").textContent,
        headingTop: problemHeading.getBoundingClientRect().top,
        phase: document.documentElement.dataset.kakomonnReaderPhase,
        scrollY: window.scrollY,
      };
    });
    assert.equal(initialProblemPresentation.answerRightDisplay, "none");
    assert.equal(initialProblemPresentation.commentaryDisplay, "none");
    assert.equal(
      initialProblemPresentation.explanationText.includes(
        "これは動作確認用の解説です.",
      ),
      true,
    );
    assert.equal(Math.abs(initialProblemPresentation.headingTop) <= 1, true);
    assert.equal(initialProblemPresentation.phase, "question");
    assert.equal(initialProblemPresentation.scrollY > 300, true);
    assert.equal(await page.evaluate(() => typeof window.Audio), "function");
    assert.equal(await page.locator("#kakomonn-reader-controls").count(), 0);
    assert.equal(await page.locator("#kakomonn-reader-status").count(), 0);
    assert.equal(await page.locator("#kakomonn-reader-learning-metrics").count(), 0);
    assert.equal(await page.locator("#kakomonn-reader-sync-settings-button").count(), 0);
    assert.equal(
      await page.locator("#kakomonn-reader-start").count(),
      0,
    );
    assert.equal(
      await page.locator("#kakomonn-reader-next").isVisible(),
      true,
    );
    assert.equal(
      await page
        .locator("#kakomonn-reader-next")
        .getAttribute("aria-keyshortcuts"),
      "Enter",
    );
    assert.equal(
      await page.locator("#kakomonn-reader-copy").isVisible(),
      true,
    );
    assert.equal(
      await page.locator("#kakomonn-reader-copy").getAttribute("title"),
      "ショートカット: yy",
    );
    assert.equal(await page.locator("#kakomonn-reader-skip").count(), 0);
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 1280, height: 720 },
      { width: 2560, height: 1440 },
    ]) {
      await page.setViewportSize(viewport);
      const readerLayout = await page.evaluate(() => {
        const shellElement = document.querySelector("#kakomonn-reader-shell");
        const frameElement = document.querySelector(
          "#kakomonn-reader-frame",
        );
        const actionsElement = document.querySelector(
          "#kakomonn-reader-actions",
        );
        const progressElement = document.querySelector(
          "#kakomonn-reader-time-limit",
        );
        const copyElement = document.querySelector("#kakomonn-reader-copy");
        const nextElement = document.querySelector("#kakomonn-reader-next");
        const shell = shellElement.getBoundingClientRect();
        const frame = frameElement.getBoundingClientRect();
        const actions = actionsElement.getBoundingClientRect();
        const progress = progressElement.getBoundingClientRect();
        const copy = copyElement.getBoundingClientRect();
        const next = nextElement.getBoundingClientRect();
        const approximatelyEqual = (left, right) =>
          Math.abs(left - right) <= 1;
        return {
          actionsFullWidth:
            approximatelyEqual(actions.left, 0) &&
            approximatelyEqual(actions.right, innerWidth),
          bottomButtonsEqual: approximatelyEqual(copy.width, next.width),
          bottomButtonsFill:
            approximatelyEqual(copy.left, actions.left + 8) &&
            approximatelyEqual(next.right, actions.right - 8),
          frameFillsShell:
            approximatelyEqual(frame.top, shell.top) &&
            approximatelyEqual(frame.right, shell.right) &&
            approximatelyEqual(frame.bottom, shell.bottom) &&
            approximatelyEqual(frame.left, shell.left) &&
            frame.height > 0,
          noHorizontalOverflow:
            shellElement.scrollWidth <= shellElement.clientWidth &&
            actionsElement.scrollWidth <= actionsElement.clientWidth,
          questionStartsAtTop: approximatelyEqual(shell.top, 0),
          shellFillsAboveActions: approximatelyEqual(shell.bottom, actions.top),
          timeBarOverlay:
            approximatelyEqual(progress.top, shell.top) &&
            approximatelyEqual(progress.left, shell.left) &&
            approximatelyEqual(progress.right, shell.right) &&
            approximatelyEqual(progress.height, 4),
        };
      });
      assert.deepEqual(
        readerLayout,
        {
          actionsFullWidth: true,
          bottomButtonsEqual: true,
          bottomButtonsFill: true,
          frameFillsShell: true,
          noHorizontalOverflow: true,
          questionStartsAtTop: true,
          shellFillsAboveActions: true,
          timeBarOverlay: true,
        },
        `${JSON.stringify(viewport)} ${JSON.stringify(readerLayout)}`,
      );
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.evaluate(() => {
      const frame = document.querySelector("#kakomonn-reader-frame");
      frame.setAttribute("height", "90");
      frame.setAttribute("width", "728");
      frame.style.height = "90px";
      frame.style.width = "728px";
    });
    await page.waitForFunction(() => {
      const frame = document.querySelector("#kakomonn-reader-frame");
      const shell = document.querySelector("#kakomonn-reader-shell");
      return (
        frame.getAttribute("height") === null &&
        frame.getAttribute("width") === null &&
        frame.clientHeight === shell.clientHeight &&
        frame.clientWidth === shell.clientWidth
      );
    });
    assert.deepEqual(
      await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement);
        const panel = getComputedStyle(
          document.querySelector("#kakomonn-reader-sync-settings-panel"),
        );
        return {
          colorScheme: root.colorScheme,
          panelBackground: panel.backgroundColor,
          panelColor: panel.color,
          rootBackground: root.backgroundColor,
        };
      }),
      {
        colorScheme: "dark",
        panelBackground: "oklch(0.22 0.018 255)",
        panelColor: "oklch(0.97 0.006 255)",
        rootBackground: "oklch(0.13 0.012 255)",
      },
    );
    assert.deepEqual(
      await childFrame.evaluate(() => {
        const choiceImage = document.createElement("img");
        choiceImage.id = "dynamic-choice-image";
        document
          .querySelector(".problem_detail > ul.list > li > div")
          .appendChild(choiceImage);
        const darkModeStyle = document.querySelector(
          "#kakomonn-reader-dark-mode"
        );
        window.__darkModeStyleNode = darkModeStyle;
        window.__darkModeStyleText = darkModeStyle?.textContent;
        const darkSurface = document.querySelector(
          "#dark-mode-dark-surface",
        );
        return {
          bodyBackground: getComputedStyle(document.body).backgroundColor,
          bodyColor: getComputedStyle(document.body).color,
          choiceBackground: getComputedStyle(
            document.querySelector(".problem_detail > ul.list > li > div")
          ).backgroundColor,
          choiceColor: getComputedStyle(
            document.querySelector(".problem_detail > ul.list > li > div")
          ).color,
          colorScheme: getComputedStyle(document.documentElement).colorScheme,
          darkFilter: getComputedStyle(darkSurface).filter,
          explanationBackground: getComputedStyle(
            document.querySelector("#js-commentary-wrap > .item > .text")
          ).backgroundColor,
          imageFilters: [
            choiceImage,
            document.querySelector(".problem_detail > .zoomin img"),
            document.querySelector("#js-commentary-wrap > .item .text img"),
          ].map((image) => getComputedStyle(image).filter),
          inputBackground: getComputedStyle(
            document.querySelector(".problem_detail input")
          ).backgroundColor,
          linkColor: getComputedStyle(
            document.querySelector(".problem_detail a")
          ).color,
          nonContentFilter: getComputedStyle(
            document.querySelector("body > div[hidden] > img")
          ).filter,
          problemBackground: getComputedStyle(
            document.querySelector(".problem_detail")
          ).backgroundColor,
          siteHeaderDisplay: getComputedStyle(
            document.querySelector("header.l-header")
          ).display,
          styleCount: document.querySelectorAll(
            "#kakomonn-reader-dark-mode"
          ).length,
          toggleCount: document.querySelectorAll(
            "[data-kakomonn-reader-dark-toggle]"
          ).length,
        };
      }),
      {
        bodyBackground: "rgb(11, 13, 16)",
        bodyColor: "rgb(243, 244, 246)",
        choiceBackground: "rgb(29, 35, 43)",
        choiceColor: "rgb(243, 244, 246)",
        colorScheme: "dark",
        darkFilter: "contrast(0.9)",
        explanationBackground: "rgb(29, 35, 43)",
        imageFilters: Array(3).fill("invert(1) hue-rotate(180deg)"),
        inputBackground: "rgb(11, 13, 16)",
        linkColor: "rgb(138, 180, 248)",
        nonContentFilter: "none",
        problemBackground: "rgb(21, 25, 30)",
        siteHeaderDisplay: "none",
        styleCount: 1,
        toggleCount: 0,
      },
    );
    await childFrame.evaluate(() => {
      document.querySelector(".problem_detail").classList.add(
        "dark-mode-stability-probe"
      );
      document.querySelector("#dark-mode-dark-surface").style.backgroundColor =
        "rgb(255, 255, 255)";
    });
    await page.waitForTimeout(100);
    assert.deepEqual(
      await childFrame.evaluate(() => ({
        darkBackground: getComputedStyle(
          document.querySelector("#dark-mode-dark-surface")
        ).backgroundColor,
        darkFilter: getComputedStyle(
          document.querySelector("#dark-mode-dark-surface")
        ).filter,
        dynamicChoiceFilter: getComputedStyle(
          document.querySelector("#dynamic-choice-image")
        ).filter,
        sameStyleNode:
          window.__darkModeStyleNode ===
          document.querySelector("#kakomonn-reader-dark-mode"),
        sameStyleText:
          window.__darkModeStyleText ===
          document.querySelector("#kakomonn-reader-dark-mode").textContent,
        styleCount: document.querySelectorAll(
          "#kakomonn-reader-dark-mode"
        ).length,
        toggleCount: document.querySelectorAll(
          "[data-kakomonn-reader-dark-toggle]"
        ).length,
      })),
      {
        darkBackground: "rgb(255, 255, 255)",
        darkFilter: "contrast(0.9)",
        dynamicChoiceFilter: "invert(1) hue-rotate(180deg)",
        sameStyleNode: true,
        sameStyleText: true,
        styleCount: 1,
        toggleCount: 0,
      },
    );
    await childFrame.locator("#dynamic-choice-image").evaluate(
      (element) => element.remove()
    );
    await page.waitForFunction(
      () => window.__audioPlayCalls >= 1 && window.__audioInstance?.src === "",
    );
    assert.equal(
      await page.locator("#kakomonn-reader-next").isDisabled(),
      true,
    );
    const answerInputs = childFrame.locator("input[name='answer']");
    const displayChoices = childFrame.locator(
      ".problem_detail > ul.list > li",
    );
    await page.locator("#kakomonn-reader-frame").focus();

    await page.keyboard.press("q");
    assert.equal(await answerInputs.first().isChecked(), true);
    await page.keyboard.press("w");
    assert.equal(await answerInputs.nth(1).isChecked(), true);
    assert.equal(await answerInputs.first().isChecked(), false);

    await page.keyboard.press("a");
    assert.equal(await displayChoices.first().evaluate((choice) =>
      choice.classList.contains("is-active")), true);
    await page.keyboard.press("a");
    assert.equal(await displayChoices.first().evaluate((choice) =>
      choice.classList.contains("is-active")), false);
    await page.keyboard.press("s");
    assert.equal(await displayChoices.nth(1).evaluate((choice) =>
      choice.classList.contains("is-active")), true);
    await page.waitForTimeout(500);
    assert.equal(await displayChoices.nth(1).evaluate((choice) =>
      choice.classList.contains("is-active")), true);

    await childFrame.evaluate(() => {
      const list = document.querySelector(".problem_detail > ul.list");
      const checks = document.querySelector(".problem_detail > ul.check");
      for (let choiceNumber = 3; choiceNumber <= 6; choiceNumber += 1) {
        list.insertAdjacentHTML(
          "beforeend",
          `<li data-shortcut-fixture><div>選択肢${choiceNumber}</div></li>`,
        );
        checks.insertAdjacentHTML(
          "beforeend",
          `<li data-shortcut-fixture><label><input type="radio" name="answer">${choiceNumber}</label></li>`,
        );
      }
      for (const choice of list.querySelectorAll(
        "li[data-shortcut-fixture]",
      )) {
        choice.addEventListener("click", () => {
          choice.classList.toggle("is-active");
        });
      }
    });

    await page.keyboard.press("g");
    await page.waitForTimeout(500);
    assert.equal(await displayChoices.nth(4).evaluate((choice) =>
      choice.classList.contains("is-active")), true);
    await childFrame.locator("body").evaluate(() => window.scrollTo(0, 600));
    await page.keyboard.press("g");
    await page.keyboard.press("g");
    await childFrame.locator("body").evaluate(() =>
      new Promise((resolve) => requestAnimationFrame(() => resolve())),
    );
    assert.equal(
      await childFrame.locator("body").evaluate(() => window.scrollY),
      0,
    );
    assert.equal(await displayChoices.nth(4).evaluate((choice) =>
      choice.classList.contains("is-active")), true);

    await page.keyboard.press("y");
    await page.keyboard.press("y");
    assert.equal(await page.evaluate(() => window.__copiedTexts.length), 0);
    await childFrame.locator("body").evaluate((body) => {
      for (const init of [
        { key: "y", repeat: true },
        { ctrlKey: true, key: "y" },
        { isComposing: true, key: "y" },
      ]) {
        body.dispatchEvent(new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ...init,
        }));
      }
    });
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => window.__copiedTexts.length), 0);

    await page.keyboard.press("q");
    assert.equal(await answerInputs.first().isChecked(), true);
    await page.keyboard.press("r");
    assert.equal(await answerInputs.nth(3).isChecked(), true);
    assert.equal(await answerInputs.first().isChecked(), false);
    await answerInputs.nth(1).focus();
    await page.keyboard.press("w");
    assert.equal(await answerInputs.nth(1).isChecked(), true);
    assert.equal(await answerInputs.first().isChecked(), false);
    await page.keyboard.press("q");
    assert.equal(await answerInputs.first().isChecked(), true);

    await page.keyboard.press("Enter");
    assert.equal(
      await childFrame.evaluate(() => window.__answerButtonClicks),
      1,
    );
    await childFrame.evaluate(() => {
      const target = document.querySelector("input[name='answer']");
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
          repeat: true,
        }),
      );
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: "w",
        }),
      );
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          isComposing: true,
          key: "a",
        }),
      );
    });
    assert.equal(
      await childFrame.evaluate(() => window.__answerButtonClicks),
      1,
    );
    assert.equal(await answerInputs.first().isChecked(), true);
    assert.equal(await displayChoices.first().evaluate((choice) =>
      choice.classList.contains("is-active")), false);

    await childFrame.locator("body").evaluate(() => window.scrollTo(0, 100));
    await answerInputs.first().focus();
    await page.keyboard.press("z");
    await childFrame.locator("body").evaluate(() =>
      new Promise((resolve) => requestAnimationFrame(() => resolve())),
    );
    assert.equal(
      await childFrame.locator("body").evaluate(() => window.scrollY),
      200,
    );
    await page.keyboard.press("x");
    await childFrame.locator("body").evaluate(() =>
      new Promise((resolve) => requestAnimationFrame(() => resolve())),
    );
    assert.equal(
      await childFrame.locator("body").evaluate(() => window.scrollY),
      100,
    );
    await childFrame.locator("body").evaluate((body) => {
      body.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "z",
          repeat: true,
        }),
      );
    });
    assert.equal(
      await childFrame.locator("body").evaluate(() => window.scrollY),
      200,
    );
    await childFrame.locator("body").evaluate((body) => {
      body.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "x",
          repeat: true,
        }),
      );
    });
    assert.equal(
      await childFrame.locator("body").evaluate(() => window.scrollY),
      100,
    );

    const shortcutTextInput = childFrame.locator("#shortcut-text-input");
    await shortcutTextInput.focus();
    const scrollBeforeTextInput = await childFrame
      .locator("body")
      .evaluate(() => window.scrollY);
    await page.keyboard.type("qwert asdfg n gg yy xz ");
    assert.equal(
      await shortcutTextInput.inputValue(),
      "qwert asdfg n gg yy xz ",
    );
    assert.equal(await answerInputs.first().isChecked(), true);
    assert.equal(await displayChoices.first().evaluate((choice) =>
      choice.classList.contains("is-active")), false);
    assert.equal(
      await childFrame.locator("body").evaluate(() => window.scrollY),
      scrollBeforeTextInput,
    );
    assert.equal(
      await childFrame.evaluate(() => window.__answerButtonClicks),
      1,
    );
    await page.evaluate(() => { window.__syncMock.nextAttemptStabilityDaysDelta = 31; });
    await childFrame.locator("input[name='answer']").first().focus();
    await page.keyboard.press("Enter");
    assert.equal(
      await childFrame.evaluate(() => window.__answerButtonClicks),
      2,
    );
    assert.equal(
      await page.evaluate(
        () =>
          window.__syncMock.calls.filter(
            (call) =>
              call.method === "POST" &&
              new URL(call.url).pathname === "/v9/attempts",
          ).length,
      ),
      0,
    );

    await childFrame.locator("[data-shortcut-fixture]").evaluateAll(
      (elements) => elements.forEach((element) => element.remove()),
    );

    assert.deepEqual((await azureSpeechCalls(page))[0], {
      method: "POST",
      url: azureSpeechUrl,
      authorization: "Bearer test-azure-speech-token",
      headers: {
        Authorization: "Bearer test-azure-speech-token",
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": azureSpeechOutputFormat,
      },
      body: expectedSpeechSSML(
        "問題文。これは動作確認用の問題文です.。これは改行後の問題文です.",
        "+100%",
      ),
    });
    assert.equal(await speechTokenCallCount(page), 1);
    assert.equal(
      await page.locator("#kakomonn-reader-copy").innerText(),
      "回答後にコピー",
    );
    assert.equal(
      await page.locator("#kakomonn-reader-copy").isDisabled(),
      true,
    );
    assert.equal(await page.evaluate(() => window.__copiedTexts.length), 0);

    await markAnswerResult(childFrame, "incorrect");
    assert.deepEqual(
      await childFrame.locator("#js-answer-result-box").evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          background: style.backgroundColor,
          color: style.color,
        };
      }),
      {
        background: "rgb(139, 47, 47)",
        color: "rgb(255, 255, 255)",
      },
    );
    await page.waitForFunction(
      () =>
        window.__syncMock.attemptCount === 1 &&
        document.querySelector("#kakomonn-reader-next").disabled === false,
    );
    assert.deepEqual(
      await childFrame.evaluate(() => ({
        commentaryDisplay: getComputedStyle(
          document.querySelector(".sect_commentary"),
        ).display,
        phase: document.documentElement.dataset.kakomonnReaderPhase ?? null,
      })),
      { commentaryDisplay: "block", phase: null },
    );
    await page.waitForFunction(
      (url) =>
        window.__syncMock.calls.filter((call) => call.url === url).length === 2,
      azureSpeechUrl,
    );
    await page.waitForFunction(
      () => window.__audioPlayCalls >= 2 && window.__audioInstance?.src === "",
    );
    assert.equal(
      (await azureSpeechCalls(page))[1].body,
      expectedSpeechSSML("不正解.", "+70%"),
    );
    assert.equal(await speechTokenCallCount(page), 1);

    const stateCallsAfterAnswer = await page.evaluate(() =>
      window.__syncMock.calls.filter(
        (call) => new URL(call.url).pathname === "/v9/state",
      ).length,
    );
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForTimeout(100);
    assert.equal(
      await page.evaluate(() =>
        window.__syncMock.calls.filter(
          (call) => new URL(call.url).pathname === "/v9/state",
        ).length,
      ),
      stateCallsAfterAnswer,
    );
    assert.equal(
      await page.locator("#kakomonn-reader-copy").innerText(),
      "Markdownをコピー",
    );
    assert.equal(
      await page.locator("#kakomonn-reader-copy").isDisabled(),
      false,
    );
    await page.keyboard.press("y");
    await page.keyboard.press("y");
    assert.equal(await page.evaluate(() => window.__copiedTexts.length), 1);
    assert.equal(
      await page.evaluate(() => window.__copiedTexts[0]),
      expectedCopiedMarkdown,
    );
    await page.waitForFunction(
      () => {
        const copyButton = document.querySelector("#kakomonn-reader-copy");
        return (
          copyButton.textContent === "Markdownをコピー" &&
          copyButton.disabled === false
        );
      },
      null,
      { timeout: 5_000 },
    );
    await page.evaluate(() => {
      window.__clipboardWriteFails = true;
    });
    await page.locator("#kakomonn-reader-copy").click();
    await page.waitForFunction(
      () => document.querySelector("#kakomonn-reader-error-dialog")?.open === true,
    );
    assert.equal(
      await page.locator("#kakomonn-reader-error-title").innerText(),
      "クリップボードへコピーできません",
    );
    assert.match(
      await page.locator("#kakomonn-reader-error-detail").innerText(),
      /^context=clipboard-write/,
    );
    assert.equal(await page.evaluate(() => window.__copiedTexts.length), 1);
    await page.locator("#kakomonn-reader-error-close").click();
    await page.evaluate(() => {
      window.__clipboardWriteFails = false;
    });
    await childFrame.evaluate(() => {
      document
        .querySelectorAll("#js-commentary-wrap > .item")[1]
        .querySelector(".text")
        .remove();
    });
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-copy").textContent ===
        "コピー対象を取得不可",
    );
    const nextQuestionButton = page.locator("#kakomonn-reader-next");
    assert.equal(await nextQuestionButton.innerText(), "次の問題へ");
    assert.equal(await nextQuestionButton.isDisabled(), false);
    await childFrame.locator("input[name='answer']").first().focus();
    await page.keyboard.press("Enter");
    assert.equal(
      await page.evaluate(
        () =>
          window.__syncMock.calls.filter(
            (call) =>
              call.method === "POST" &&
              new URL(call.url).pathname === "/v9/attempts",
          ).length,
      ),
      1,
    );
    assert.equal(
      await page.evaluate(
        () =>
          window.__syncMock.calls.filter(
            (call) =>
              call.method === "POST" &&
              new URL(call.url).pathname === "/v9/attempts",
          ).length,
      ),
      1,
    );
    await page.waitForFunction(
      ({ pendingAttemptKey, nextURL }) =>
        window.__getGMValue(pendingAttemptKey) === null &&
        document.querySelector("#kakomonn-reader-frame")?.contentWindow
          ?.location.href === nextURL,
      {
        pendingAttemptKey: PENDING_ATTEMPT_KEY,
        nextURL: "https://chushoks.kakomonn.com/questions/45125",
      },
    );

    const stateCallsBeforeResume = await page.evaluate(() =>
      window.__syncMock.calls.filter(
        (call) => new URL(call.url).pathname === "/v9/state",
      ).length,
    );
    await page.evaluate(() => {
      window.__syncMock.stabilityDays = 7;
      window.__syncMock.attemptCount = 7;
      window.__syncMock.attemptedQuestionCount = 7;
      window.__syncMock.todayAttemptedQuestionCount = 7;
      window.__syncMock.dueCardsCompleted = true;
      window.__syncMock.dueCardsRemaining = 0;
      window.dispatchEvent(new Event("focus"));
    });
    await page.waitForTimeout(100);
    assert.equal(
      await page.evaluate(() =>
        window.__syncMock.calls.filter(
          (call) => new URL(call.url).pathname === "/v9/state",
        ).length,
      ),
      stateCallsBeforeResume,
    );
    assert.equal(await page.locator("#kakomonn-reader-controls").count(), 0);

    assert.deepEqual(errors, []);

    await assertIncorrectSkip(context, script);
    await runCorrectFeedbackCase(context, script);
    await runCorrectFeedbackVariantCase(context, script, {
      badge: "RARE",
      displayText: "Nice! That's Right!!",
      randomValues: [11],
      rarity: "rare",
      speechText: "Nice! That's right!",
      waveSize: 32_678,
    });
    await runCorrectFeedbackVariantCase(context, script, {
      badge: "SUPER RARE",
      displayText: "Amazing! That's Right!!",
      randomValues: [1],
      rarity: "super-rare",
      speechText: "Amazing! That's right!",
      waveSize: 37_970,
    });
    await runCorrectFeedbackVariantCase(context, script, {
      badge: "SSR",
      displayText: "Legendary! That's Right!!",
      randomValues: [65_000, 0],
      rarity: "ssr",
      speechText: "Legendary! That's right!",
      waveSize: 45_026,
    });
    await runQueuedCorrectFeedbackVariantCase(context, script);
    await runCorrectCelebrationFeedbackCase(context, script);

    const speechShortcutPage = await context.newPage();
    const speechShortcutErrors = await preparePage(
      speechShortcutPage,
      "audio-manual",
    );
    const speechShortcutFrame = await loadMockQuestion(
      speechShortcutPage,
      script,
    );
    await speechShortcutPage.waitForFunction(
      () => window.__audioPlayCalls >= 2 && window.__audioInstance?.paused === false,
    );
    const speechShortcutInput = speechShortcutFrame.locator(
      "#shortcut-text-input",
    );
    const pauseCallsBeforeInput = await speechShortcutPage.evaluate(
      () => window.__audioPauseCalls,
    );
    await speechShortcutInput.focus();
    await speechShortcutPage.keyboard.type("n ");
    assert.equal(await speechShortcutInput.inputValue(), "n ");
    assert.equal(await speechShortcutPage.evaluate(() => window.__audioInstance.paused), false);
    assert.equal(
      await speechShortcutPage.evaluate(() => window.__audioPauseCalls),
      pauseCallsBeforeInput,
    );

    await speechShortcutFrame.locator("input[name='answer']").first().focus();
    const playCallsBeforePause = await speechShortcutPage.evaluate(
      () => window.__audioPlayCalls,
    );
    await speechShortcutPage.keyboard.press("Space");
    assert.equal(await speechShortcutPage.evaluate(() => window.__audioInstance.paused), true);
    assert.equal(
      await speechShortcutPage.evaluate(() => window.__audioPauseCalls),
      pauseCallsBeforeInput + 1,
    );
    assert.equal(
      await speechShortcutPage.locator("#kakomonn-reader-skip").count(),
      0,
    );

    await speechShortcutPage.keyboard.press("Space");
    await speechShortcutPage.waitForFunction(
      (expected) => window.__audioPlayCalls === expected && window.__audioInstance?.paused === false,
      playCallsBeforePause + 1,
    );
    assert.equal(
      await speechShortcutPage.evaluate(() => window.__audioPlayCalls),
      playCallsBeforePause + 1,
    );

    await speechShortcutPage.keyboard.press("s");
    assert.equal(
      await speechShortcutFrame.locator(".problem_detail > ul.list > li").nth(1).evaluate(
        (choice) => choice.classList.contains("is-active"),
      ),
      true,
    );
    assert.equal(
      await speechShortcutPage.evaluate(() => window.__audioPauseCalls),
      pauseCallsBeforeInput + 1,
    );
    await speechShortcutPage.waitForTimeout(150);
    assert.equal(await speechShortcutPage.evaluate(() => window.__audioInstance.paused), false);
    assert.deepEqual(speechShortcutErrors, []);
    await speechShortcutPage.close();

    const gestureRetryPage = await context.newPage();
    const gestureRetryErrors = await preparePage(
      gestureRetryPage,
      "audio-gesture-required",
    );
    const gestureRetryFrame = await loadMockQuestion(gestureRetryPage, script);
    await gestureRetryPage.waitForFunction(
      () => document.querySelector("#kakomonn-reader-error-dialog")?.open === true,
    );
    assert.equal(
      await gestureRetryPage.locator("#kakomonn-reader-error-title").innerText(),
      "読み上げを開始できません",
    );
    assert.equal((await azureSpeechCalls(gestureRetryPage)).length, 0);
    assert.equal(await speechTokenCallCount(gestureRetryPage), 0);
    await gestureRetryPage.locator("#kakomonn-reader-error-close").click();
    await gestureRetryPage.waitForFunction(
      (url) =>
        window.__syncMock.calls.filter((call) => call.url === url).length === 1 &&
        window.__audioInstance?.src === "",
      azureSpeechUrl,
    );
    assert.equal(
      (await azureSpeechCalls(gestureRetryPage))[0].body,
      expectedSpeechSSML(
        "問題文。これは動作確認用の問題文です.。これは改行後の問題文です.",
        "+100%",
      ),
    );
    assert.equal(await speechTokenCallCount(gestureRetryPage), 1);
    assert.deepEqual(gestureRetryErrors, []);
    await gestureRetryPage.close();

    const delayedSyncPage = await context.newPage();
    const delayedSyncErrors = await preparePage(
      delayedSyncPage,
      "audio",
    );
    await delayedSyncPage.evaluate(() => {
      window.__syncMock.holdNextRequest = true;
    });
    await loadMockQuestion(delayedSyncPage, script);
    await delayedSyncPage.waitForFunction(
      () => window.__syncMock.releaseHeldRequest !== null,
    );
    assert.equal((await azureSpeechCalls(delayedSyncPage)).length, 0);
    assert.equal(await speechTokenCallCount(delayedSyncPage), 0);
    await delayedSyncPage.evaluate(() => window.__syncMock.releaseHeldRequest());
    await delayedSyncPage.waitForFunction(
      (url) =>
        window.__syncMock.calls.filter((call) => call.url === url).length === 1,
      azureSpeechUrl,
    );
    await delayedSyncPage.waitForFunction(
      () => window.__audioInstance?.src === "",
    );
    assert.equal(
      await delayedSyncPage.locator("#kakomonn-reader-start").count(),
      0,
    );
    assert.equal((await azureSpeechCalls(delayedSyncPage)).length, 1);
    assert.equal(await speechTokenCallCount(delayedSyncPage), 1);
    assert.deepEqual(delayedSyncErrors, []);
    await delayedSyncPage.close();

    const setupPage = await context.newPage();
    const setupErrors = await preparePage(setupPage, "none", {
      configured: false,
    });
    await setupPage.addScriptTag({ content: script });
    await setupPage.waitForSelector("#kakomonn-reader-sync-settings", {
      state: "visible",
    });
    assert.equal(await setupPage.locator("#kakomonn-reader-sync-settings-cancel").count(), 0);
    await setupPage.locator("#kakomonn-reader-sync-token").focus();
    await setupPage.keyboard.type("qwert asdfg n gg yy xz ");
    assert.equal(
      await setupPage.locator("#kakomonn-reader-sync-token").inputValue(),
      "qwert asdfg n gg yy xz ",
    );
    await setupPage.locator("#kakomonn-reader-sync-token").fill("test-sync-token");
    await setupPage.keyboard.press("Enter");
    await setupPage.waitForSelector("#kakomonn-reader-sync-settings", {
      state: "hidden",
    });
    assert.equal(await setupPage.locator("#kakomonn-reader-controls").count(), 0);
    assert.equal(
      await setupPage.evaluate(
        (key) => window.__getGMValue(key),
        SYNC_TOKEN_KEY,
      ),
      "test-sync-token",
    );
    assert.deepEqual(setupErrors, []);
    await setupPage.close();

    const failedSetupPage = await context.newPage();
    const failedSetupErrors = await preparePage(failedSetupPage, "none", {
      configured: false,
    });
    await failedSetupPage.addScriptTag({ content: script });
    await failedSetupPage.waitForSelector("#kakomonn-reader-sync-settings", {
      state: "visible",
    });
    await failedSetupPage.evaluate(() => {
      window.__syncMock.failNextSetValue = true;
    });
    await failedSetupPage
      .locator("#kakomonn-reader-sync-token")
      .fill("test-sync-token");
    await failedSetupPage
      .locator("#kakomonn-reader-sync-settings-save")
      .click();
    await failedSetupPage.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-sync-settings-error")
          .textContent.startsWith("学習記録を同期できません."),
    );
    assert.equal(
      await failedSetupPage.locator("#kakomonn-reader-sync-settings").isVisible(),
      true,
    );
    assert.equal(
      await failedSetupPage.evaluate(
        (key) => window.__getGMValue(key),
        SYNC_TOKEN_KEY,
      ),
      null,
    );
    assert.equal(
      await failedSetupPage.locator("#kakomonn-reader-start").count(),
      0,
    );
    assert.equal(
      await failedSetupPage.locator("#kakomonn-reader-next").isVisible(),
      true,
    );
    assert.deepEqual(failedSetupErrors, []);
    await failedSetupPage.close();

    const unsupportedPage = await context.newPage();
    const unsupportedErrors = await preparePage(
      unsupportedPage,
      "none",
    );
    await unsupportedPage.addScriptTag({ content: script });
    await unsupportedPage.waitForFunction(
      () => document.querySelector("#kakomonn-reader-error-dialog")?.open === true,
    );
    assert.equal(
      await unsupportedPage.locator("#kakomonn-reader-error-title").innerText(),
      "読み上げを利用できません",
    );
    assert.equal(
      await unsupportedPage.locator("#kakomonn-reader-start").count(),
      0,
    );
    assert.equal(
      await unsupportedPage.locator("#kakomonn-reader-next").isVisible(),
      true,
    );
    assert.equal(
      await unsupportedPage.evaluate(() => typeof window.Audio),
      "undefined",
    );
    assert.equal((await azureSpeechCalls(unsupportedPage)).length, 0);
    assert.equal(await speechTokenCallCount(unsupportedPage), 0);
    assert.deepEqual(unsupportedErrors, []);

    const rejectedRuntimeCases = [
      { userAgent: windowsEdgeUserAgent },
      { userAgent: windowsFirefoxUserAgent },
      { userAgent: iosChromeUserAgent },
      { userAgent: chromeUserAgent, scriptHandler: "Userscripts" },
      { userAgent: chromeUserAgent, missingAPI: "GM" },
      { userAgent: chromeUserAgent, missingAPI: "GM_info" },
      { userAgent: chromeUserAgent, missingAPI: "getValue" },
      { userAgent: chromeUserAgent, missingAPI: "setValue" },
      { userAgent: chromeUserAgent, missingAPI: "deleteValue" },
      { userAgent: chromeUserAgent, missingAPI: "xmlHttpRequest" },
      { userAgent: chromeUserAgent, missingAPI: "setClipboard" },
    ];
    for (const runtimeCase of rejectedRuntimeCases) {
      await assertRuntimeRejected(browser, script, runtimeCase);
    }

    const iosContext = await browser.newContext({
      userAgent: iosUserAgent,
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      hasTouch: true,
      isMobile: true,
    });
    const iosPage = await iosContext.newPage();
    const iosErrors = await preparePage(iosPage, "audio");
    const iosFrame = await loadMockQuestion(iosPage, script);
    assert.equal(await iosPage.locator("#kakomonn-reader-start").count(), 0);
    const firstAnswer = iosFrame.locator("input[name='answer']").first();
    assert.equal(await firstAnswer.isChecked(), false);
    await iosPage.waitForFunction(
      (url) =>
        window.__syncMock.calls.filter((call) => call.url === url).length === 1,
      azureSpeechUrl,
    );
    await iosPage.waitForFunction(
      () => window.__audioInstance?.src === "",
    );
    assert.deepEqual((await azureSpeechCalls(iosPage))[0], {
      method: "POST",
      url: azureSpeechUrl,
      authorization: "Bearer test-azure-speech-token",
      headers: {
        Authorization: "Bearer test-azure-speech-token",
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": azureSpeechOutputFormat,
      },
      body: expectedSpeechSSML(
        "問題文。これは動作確認用の問題文です.。これは改行後の問題文です.",
        "+100%",
      ),
    });
    assert.equal(await speechTokenCallCount(iosPage), 1);
    await firstAnswer.tap();
    assert.equal(await firstAnswer.isChecked(), true);
    await markAnswerResult(iosFrame, "incorrect");
    await iosPage.waitForFunction(
      (url) =>
        window.__syncMock.calls.filter((call) => call.url === url).length === 2,
      azureSpeechUrl,
    );
    await iosPage.waitForFunction(
      () => window.__audioInstance?.src === "",
    );
    assert.equal(
      (await azureSpeechCalls(iosPage))[1].body,
      expectedSpeechSSML("不正解.", "+70%"),
    );
    assert.equal(await speechTokenCallCount(iosPage), 1);
    await iosPage.evaluate(() => { window.__syncMock.nextAttemptStabilityDaysDelta = 31; });
    await iosPage.locator("#kakomonn-reader-next").tap();
    await iosFrame.waitForURL(
      "https://chushoks.kakomonn.com/questions/45125",
    );
    const iosStateCallsBeforeResume = await iosPage.evaluate(() =>
      window.__syncMock.calls.filter(
        (call) => new URL(call.url).pathname === "/v9/state",
      ).length,
    );
    await iosPage.evaluate(() => {
      window.__syncMock.stabilityDays = 6;
      window.__syncMock.attemptCount = 6;
      window.__syncMock.attemptedQuestionCount = 6;
      window.__syncMock.todayAttemptedQuestionCount = 6;
      window.__syncMock.dueCardsCompleted = true;
      window.__syncMock.dueCardsRemaining = 0;
      window.dispatchEvent(new Event("focus"));
    });
    await iosPage.waitForTimeout(100);
    assert.equal(
      await iosPage.evaluate(() =>
        window.__syncMock.calls.filter(
          (call) => new URL(call.url).pathname === "/v9/state",
        ).length,
      ),
      iosStateCallsBeforeResume,
    );
    assert.equal(await iosPage.locator("#kakomonn-reader-controls").count(), 0);
    assert.equal(
      await iosPage.evaluate(
        () =>
          window.__syncMock.calls.filter(
            (call) =>
              call.method === "POST" &&
              new URL(call.url).pathname === "/v9/attempts",
          ).length,
      ),
      1,
    );
    assert.deepEqual(iosErrors, []);

    const iosGestureRetryPage = await iosContext.newPage();
    const iosGestureRetryErrors = await preparePage(
      iosGestureRetryPage,
      "audio-gesture-required",
    );
    const iosGestureRetryFrame = await loadMockQuestion(
      iosGestureRetryPage,
      script,
    );
    await iosGestureRetryPage.waitForFunction(
      () => document.querySelector("#kakomonn-reader-error-dialog")?.open === true,
    );
    assert.equal((await azureSpeechCalls(iosGestureRetryPage)).length, 0);
    assert.equal(await speechTokenCallCount(iosGestureRetryPage), 0);
    await iosGestureRetryPage.locator("#kakomonn-reader-error-close").tap();
    await iosGestureRetryPage.waitForFunction(
      (url) =>
        window.__syncMock.calls.filter((call) => call.url === url).length === 1,
      azureSpeechUrl,
    );
    await iosGestureRetryPage.waitForFunction(
      () => window.__audioInstance?.src === "",
    );
    assert.equal(await speechTokenCallCount(iosGestureRetryPage), 1);
    assert.deepEqual(iosGestureRetryErrors, []);
    await iosContext.close();
  } finally {
    await browser.close();
  }

  console.log("smoke test passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
