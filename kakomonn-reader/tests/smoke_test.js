const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { chromium } = require("playwright");
const {
  installSyncMock,
  SYNC_API_ORIGIN,
  SYNC_TOKEN_KEY,
} = require("./sync_mock");

const projectRoot = path.resolve(__dirname, "..");
const scriptPath = path.join(projectRoot, "kakomonn-reader.user.js");
const edgeUserAgent =
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
const azureSpeechUrl =
  "https://japaneast.tts.speech.microsoft.com/cognitiveservices/v1";
const azureSpeechVoiceName = "ja-JP-NanamiNeural";
const azureSpeechOutputFormat = "audio-24khz-48kbitrate-mono-mp3";
const edgeSpeechVoiceName = "Microsoft Ayumi - Japanese (Japan)";

function expectedSpeechSSML(text, rate) {
  return (
    '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ja-JP">' +
    `<voice name="${azureSpeechVoiceName}">` +
    `<prosody rate="${rate}">${text}</prosody>` +
    "</voice></speak>"
  );
}

const mockBody = `
  <div id="meta">中小企業診断士試験 令和6年度 第1問</div>
  <p>これは動作確認用の問題文です.</p>
  <div><label><input type="radio" name="answer">選択肢1</label></div>
  <div><label><input type="radio" name="answer">選択肢2</label></div>
  <button type="button">解答する</button>
  <p id="correct-result" hidden>正解！素晴らしいです</p>
  <p id="incorrect-result" hidden>残念...</p>
  <h2>この過去問の解説</h2>
  <div>解答結果</div>
  <div id="js-answer-result-box"></div>
  <p id="explanation-lock">解説は問題に回答すると<br>表示されます。</p>
  <p id="explanation" hidden>これは動作確認用の解説です.</p>
  <a href="#report">（訂正依頼・報告はこちら）</a>
  <button id="next" type="button">次の問題へ</button>
`;

async function preparePage(page, speechMode, syncOptions = {}) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.setContent("<!doctype html><html><body></body></html>");
  await page.evaluate(({ mode, voiceName }) => {
    if (
      ![
        "none",
        "edge",
        "edge-delayed-voice",
        "edge-empty-voices",
        "edge-gesture-required",
        "edge-missing-voice",
        "edge-no-web-speech",
        "ios",
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
    window.__readerStatusHistory = [];
    const recordReaderStatus = () => {
      const status = document.querySelector(
        "#kakomonn-reader-status",
      )?.textContent;
      const history = window.__readerStatusHistory;
      if (status && history[history.length - 1] !== status) {
        history.push(status);
      }
    };
    window.__readerStatusObserver = new MutationObserver(recordReaderStatus);
    window.__readerStatusObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        async writeText(value) {
          window.__copiedTexts.push(value);
        },
      },
    });

    class FakeAudio {
      constructor() {
        this.src = "";
        this.onplay = null;
        this.onended = null;
        this.onerror = null;
      }

      canPlayType(type) {
        return type === "audio/mpeg" ? "probably" : "";
      }

      pause() {}

      load() {}

      play() {
        if (this.src.startsWith("data:audio/wav")) {
          return Promise.resolve();
        }
        window.setTimeout(() => {
          this.onplay?.();
          window.setTimeout(() => this.onended?.(), 100);
        }, 0);
        return Promise.resolve();
      }
    }

    window.__edgeSpeechCalls = [];

    if (mode === "none") {
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
      return;
    }

    if (mode === "edge-no-web-speech") {
      Object.defineProperty(window, "Audio", {
        configurable: true,
        value: FakeAudio,
      });
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

    if (
      mode === "edge" ||
      mode === "edge-delayed-voice" ||
      mode === "edge-empty-voices" ||
      mode === "edge-gesture-required" ||
      mode === "edge-missing-voice"
    ) {
      class FakeSpeechSynthesisUtterance {
        constructor(text) {
          this.text = text;
          this.voice = null;
          this.lang = "";
          this.rate = 1;
          this.onstart = null;
          this.onend = null;
          this.onerror = null;
        }
      }

      const createVoice = (name, localService, isDefault) => ({
        name,
        lang: "ja-JP",
        voiceURI: name,
        localService,
        default: isDefault,
      });
      const voices =
        mode === "edge-missing-voice"
          ? [
              createVoice(
                "Microsoft Haruka - Japanese (Japan)",
                true,
                true,
              ),
              createVoice(voiceName, false, false),
            ]
          : [
              createVoice(
                "Microsoft Haruka - Japanese (Japan)",
                true,
                true,
              ),
              createVoice(voiceName, true, false),
            ];
      let activeUtterance = null;
      let voicesReady = mode !== "edge-delayed-voice";
      const voicesNeverLoad = mode === "edge-empty-voices";
      let voiceLoadScheduled = false;
      let gestureRequired = mode === "edge-gesture-required";
      const listeners = new Set();
      const synthesis = {
        getVoices() {
          if (voicesNeverLoad) {
            return [];
          }
          if (!voicesReady && !voiceLoadScheduled) {
            voiceLoadScheduled = true;
            window.setTimeout(() => {
              voicesReady = true;
              for (const listener of [...listeners]) {
                listener();
              }
            }, 50);
          }
          return voicesReady ? voices : [];
        },
        speak(utterance) {
          activeUtterance = utterance;
          if (gestureRequired) {
            gestureRequired = false;
            window.setTimeout(() => {
              if (activeUtterance === utterance) {
                utterance.onerror?.({ error: "not-allowed" });
              }
            }, 0);
            return;
          }
          window.__edgeSpeechCalls.push({
            text: utterance.text,
            voiceName: utterance.voice?.name ?? "",
            voiceURI: utterance.voice?.voiceURI ?? "",
            lang: utterance.lang,
            rate: utterance.rate,
          });
          window.setTimeout(() => {
            if (activeUtterance !== utterance) {
              return;
            }
            utterance.onstart?.();
            window.setTimeout(() => {
              if (activeUtterance !== utterance) {
                return;
              }
              activeUtterance = null;
              utterance.onend?.();
            }, 100);
          }, 0);
        },
        cancel() {
          activeUtterance = null;
        },
        addEventListener(type, listener) {
          if (type === "voiceschanged") {
            listeners.add(listener);
          }
        },
        removeEventListener(type, listener) {
          if (type === "voiceschanged") {
            listeners.delete(listener);
          }
        },
      };
      Object.defineProperty(window, "Audio", {
        configurable: true,
        value: FakeAudio,
      });
      Object.defineProperty(window, "speechSynthesis", {
        configurable: true,
        value: synthesis,
      });
      Object.defineProperty(window, "SpeechSynthesisUtterance", {
        configurable: true,
        value: FakeSpeechSynthesisUtterance,
      });
      return;
    }

    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      configurable: true,
      value: undefined,
    });

    Object.defineProperty(window, "Audio", {
      configurable: true,
      value: FakeAudio,
    });
  }, { mode: speechMode, voiceName: edgeSpeechVoiceName });

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
    },
    mockBody,
  );
  await page.waitForTimeout(900);
  return childFrame;
}

async function markAnswerCorrect(childFrame) {
  await childFrame.evaluate(() => {
    document.querySelector("#correct-result").hidden = false;
    document.querySelector("#js-answer-result-box").classList.add("is-correct");
    document.querySelector("#explanation-lock").hidden = true;
    document.querySelector("#explanation").hidden = false;
  });
}

async function azureSpeechCalls(page) {
  return page.evaluate(
    (url) => window.__syncMock.calls.filter((call) => call.url === url),
    azureSpeechUrl,
  );
}

async function edgeSpeechCalls(page) {
  return page.evaluate(() => window.__edgeSpeechCalls);
}

async function speechTokenCallCount(page) {
  return page.evaluate(
    () =>
      window.__syncMock.calls.filter(
        (call) => new URL(call.url).pathname === "/v1/speech-token",
      ).length,
  );
}

async function main() {
  execFileSync("python3", ["build.py"], {
    cwd: projectRoot,
    stdio: "inherit",
  });

  const script = fs.readFileSync(scriptPath, "utf8");
  assert.equal(script.includes("// @version"), false);
  assert.equal(script.includes(SYNC_API_ORIGIN), true);
  assert.equal(
    script.includes(`// @connect      ${new URL(SYNC_API_ORIGIN).host}`),
    true,
  );

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ userAgent: edgeUserAgent });
    const page = await context.newPage();
    const errors = await preparePage(page, "edge");
    const childFrame = await loadMockQuestion(page, script);
    assert.equal(await page.evaluate(() => typeof window.Audio), "function");
    assert.equal(
      await page.locator("#kakomonn-reader-count").innerText(),
      "0問,次は50問",
    );
    assert.equal(
      await page.locator("#kakomonn-reader-start").count(),
      0,
    );
    assert.equal(
      await page.locator("#kakomonn-reader-next").isVisible(),
      true,
    );
    assert.equal(
      await page.locator("#kakomonn-reader-copy").isVisible(),
      true,
    );
    await page.waitForFunction(
      () =>
        window.__readerStatusHistory.includes("問題文 1/1") &&
        document.querySelector("#kakomonn-reader-status").textContent ===
          "問題文完了",
    );
    await page.waitForFunction(
      () => document.querySelector("#kakomonn-reader-next").disabled === false,
    );

    assert.deepEqual((await edgeSpeechCalls(page))[0], {
      text: "問題文。これは動作確認用の問題文です.",
      voiceName: edgeSpeechVoiceName,
      voiceURI: edgeSpeechVoiceName,
      lang: "ja-JP",
      rate: 1.8,
    });
    assert.equal((await azureSpeechCalls(page)).length, 0);
    assert.equal(await speechTokenCallCount(page), 0);

    await markAnswerCorrect(childFrame);
    await page.waitForFunction(
      () => window.__edgeSpeechCalls.length === 2,
    );
    await page.waitForFunction(
      () =>
        window.__readerStatusHistory.includes("解説 1/1") &&
        document.querySelector("#kakomonn-reader-status").textContent ===
          "解説完了",
    );
    assert.deepEqual((await edgeSpeechCalls(page))[1], {
      text: "解説。これは動作確認用の解説です.",
      voiceName: edgeSpeechVoiceName,
      voiceURI: edgeSpeechVoiceName,
      lang: "ja-JP",
      rate: 1.5,
    });
    assert.equal((await azureSpeechCalls(page)).length, 0);
    assert.equal(await speechTokenCallCount(page), 0);

    await page.evaluate(() => {
      window.__syncMock.holdNextRequest = true;
      window.__syncMock.failNextRequest = true;
      window.dispatchEvent(new Event("focus"));
    });
    await page.waitForFunction(
      () => window.__syncMock.releaseHeldRequest !== null,
    );
    assert.equal(
      await page.locator("#kakomonn-reader-copy").innerText(),
      "問題・解説をコピー",
    );
    assert.equal(
      await page.locator("#kakomonn-reader-copy").isDisabled(),
      false,
    );
    await page.evaluate(() => window.__syncMock.releaseHeldRequest());
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-status").textContent ===
        "正解数を同期できません.再試行してください",
    );
    assert.equal(
      await page.locator("#kakomonn-reader-copy").innerText(),
      "問題・解説をコピー",
    );
    assert.equal(
      await page.locator("#kakomonn-reader-copy").isDisabled(),
      false,
    );
    await page.locator("#kakomonn-reader-copy").click();
    assert.equal(await page.evaluate(() => window.__copiedTexts.length), 1);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-next").textContent ===
        "次の問題へ",
    );

    await childFrame.locator("#next").focus();
    await page.evaluate(() => {
      window.__syncMock.holdNextRequest = true;
    });
    const nextQuestionButton = page.locator("#kakomonn-reader-next");
    const nextQuestionButtonBox = await nextQuestionButton.boundingBox();
    assert.notEqual(nextQuestionButtonBox, null);
    await page.mouse.click(
      nextQuestionButtonBox.x + nextQuestionButtonBox.width / 2,
      nextQuestionButtonBox.y + nextQuestionButtonBox.height / 2,
    );
    await page.waitForFunction(
      () => window.__syncMock.releaseHeldRequest !== null,
    );
    assert.equal(await nextQuestionButton.innerText(), "正解数を同期中");
    assert.equal(await nextQuestionButton.isDisabled(), false);
    assert.equal(
      await page.evaluate(
        () =>
          window.__syncMock.calls.filter(
            (call) =>
              call.method === "POST" &&
              new URL(call.url).pathname === "/v1/correct",
          ).length,
      ),
      0,
    );
    await page.evaluate(() => window.__syncMock.releaseHeldRequest());
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-count").textContent ===
        "1問,次は50問",
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
      1,
    );

    await page.evaluate(() => {
      window.__syncMock.count = 7;
      window.__syncMock.holdNextRequest = true;
      window.dispatchEvent(new Event("focus"));
    });
    await page.waitForFunction(
      () => window.__syncMock.releaseHeldRequest !== null,
    );
    assert.equal(
      await page.locator("#kakomonn-reader-sync-settings-button").isDisabled(),
      true,
    );
    await page.evaluate(() => window.__syncMock.releaseHeldRequest());
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-count").textContent ===
        "7問,次は50問",
    );
    assert.equal(
      await page.locator("#kakomonn-reader-sync-settings-button").isDisabled(),
      false,
    );

    assert.deepEqual(errors, []);

    const gestureRetryPage = await context.newPage();
    const gestureRetryErrors = await preparePage(
      gestureRetryPage,
      "edge-gesture-required",
    );
    const gestureRetryFrame = await loadMockQuestion(gestureRetryPage, script);
    await gestureRetryPage.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-status").textContent ===
        "画面をクリックすると読み上げます",
    );
    assert.equal((await edgeSpeechCalls(gestureRetryPage)).length, 0);
    assert.equal((await azureSpeechCalls(gestureRetryPage)).length, 0);
    assert.equal(await speechTokenCallCount(gestureRetryPage), 0);
    await gestureRetryFrame.locator("input[name='answer']").first().click();
    await gestureRetryPage.waitForFunction(
      () =>
        window.__edgeSpeechCalls.length === 1 &&
        document.querySelector("#kakomonn-reader-status").textContent ===
          "問題文完了",
    );
    assert.equal((await azureSpeechCalls(gestureRetryPage)).length, 0);
    assert.equal(await speechTokenCallCount(gestureRetryPage), 0);
    assert.deepEqual(gestureRetryErrors, []);
    await gestureRetryPage.close();

    const delayedSyncPage = await context.newPage();
    const delayedSyncErrors = await preparePage(
      delayedSyncPage,
      "edge-delayed-voice",
    );
    await delayedSyncPage.evaluate(() => {
      window.__syncMock.holdNextRequest = true;
    });
    await loadMockQuestion(delayedSyncPage, script);
    await delayedSyncPage.waitForFunction(
      () => window.__syncMock.releaseHeldRequest !== null,
    );
    assert.equal(
      (await edgeSpeechCalls(delayedSyncPage)).length,
      0,
    );
    assert.equal((await azureSpeechCalls(delayedSyncPage)).length, 0);
    assert.equal(await speechTokenCallCount(delayedSyncPage), 0);
    await delayedSyncPage.evaluate(() => window.__syncMock.releaseHeldRequest());
    await delayedSyncPage.waitForFunction(
      () => window.__edgeSpeechCalls.length === 1,
    );
    await delayedSyncPage.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-status").textContent ===
        "問題文完了",
    );
    assert.equal(
      await delayedSyncPage.locator("#kakomonn-reader-start").count(),
      0,
    );
    assert.equal((await azureSpeechCalls(delayedSyncPage)).length, 0);
    assert.equal(await speechTokenCallCount(delayedSyncPage), 0);
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
    assert.equal(
      await setupPage.locator("#kakomonn-reader-count").innerText(),
      "--問,次は50問",
    );
    await setupPage.locator("#kakomonn-reader-sync-token").fill("test-sync-token");
    await setupPage.locator("#kakomonn-reader-sync-settings-save").click();
    await setupPage.waitForSelector("#kakomonn-reader-sync-settings", {
      state: "hidden",
    });
    assert.equal(
      await setupPage.locator("#kakomonn-reader-count").innerText(),
      "0問,次は50問",
    );
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
          .textContent === "正解数を同期できません.",
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
      "edge-no-web-speech",
    );
    await unsupportedPage.addScriptTag({ content: script });
    await unsupportedPage.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-status").textContent ===
        "読み上げ非対応",
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
      "function",
    );
    assert.equal((await edgeSpeechCalls(unsupportedPage)).length, 0);
    assert.equal((await azureSpeechCalls(unsupportedPage)).length, 0);
    assert.equal(await speechTokenCallCount(unsupportedPage), 0);
    assert.deepEqual(unsupportedErrors, []);

    const chromeContext = await browser.newContext({
      userAgent: chromeUserAgent,
    });
    const chromePage = await chromeContext.newPage();
    const chromeErrors = await preparePage(chromePage, "edge");
    await chromePage.addScriptTag({ content: script });
    await chromePage.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-status").textContent ===
        "読み上げ非対応",
    );
    assert.equal(
      await chromePage.locator("#kakomonn-reader-start").count(),
      0,
    );
    assert.deepEqual(chromeErrors, []);
    await chromeContext.close();

    const missingVoicePage = await context.newPage();
    const missingVoiceErrors = await preparePage(
      missingVoicePage,
      "edge-missing-voice",
    );
    await missingVoicePage.addScriptTag({ content: script });
    await missingVoicePage.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-status").textContent ===
        "Edgeのローカル日本語音声が見つかりません",
    );
    assert.equal((await edgeSpeechCalls(missingVoicePage)).length, 0);
    assert.equal((await azureSpeechCalls(missingVoicePage)).length, 0);
    assert.equal(await speechTokenCallCount(missingVoicePage), 0);
    assert.deepEqual(missingVoiceErrors, []);
    await missingVoicePage.close();

    const emptyVoicesPage = await context.newPage();
    const emptyVoicesErrors = await preparePage(
      emptyVoicesPage,
      "edge-empty-voices",
    );
    await emptyVoicesPage.addScriptTag({ content: script });
    await emptyVoicesPage.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-status").textContent ===
        "Edgeのローカル日本語音声が見つかりません",
    );
    assert.equal((await edgeSpeechCalls(emptyVoicesPage)).length, 0);
    assert.equal((await azureSpeechCalls(emptyVoicesPage)).length, 0);
    assert.equal(await speechTokenCallCount(emptyVoicesPage), 0);
    assert.deepEqual(emptyVoicesErrors, []);
    await emptyVoicesPage.close();

    const iosContext = await browser.newContext({ userAgent: iosUserAgent });
    const iosPage = await iosContext.newPage();
    const iosErrors = await preparePage(iosPage, "ios", {
      userscriptsPromise: true,
    });
    const iosFrame = await loadMockQuestion(iosPage, script);
    await iosPage.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-status").textContent ===
        "画面をタップすると読み上げます",
    );
    assert.equal(await iosPage.locator("#kakomonn-reader-start").count(), 0);
    assert.equal((await azureSpeechCalls(iosPage)).length, 0);
    const firstAnswer = iosFrame.locator("input[name='answer']").first();
    await firstAnswer.click();
    assert.equal(await firstAnswer.isChecked(), true);
    await iosPage.waitForFunction(
      (url) =>
        window.__syncMock.calls.filter((call) => call.url === url).length === 1,
      azureSpeechUrl,
    );
    await iosPage.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-status").textContent ===
        "問題文完了",
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
        "問題文。これは動作確認用の問題文です.",
        "+80%",
      ),
    });
    assert.equal(await speechTokenCallCount(iosPage), 1);
    await markAnswerCorrect(iosFrame);
    await iosPage.waitForFunction(
      (url) =>
        window.__syncMock.calls.filter((call) => call.url === url).length === 2,
      azureSpeechUrl,
    );
    await iosPage.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-status").textContent ===
        "解説完了",
    );
    assert.equal(
      (await azureSpeechCalls(iosPage))[1].body,
      expectedSpeechSSML(
        "解説。これは動作確認用の解説です.",
        "+50%",
      ),
    );
    assert.equal(await speechTokenCallCount(iosPage), 1);
    await iosFrame.locator("#next").click();
    await iosPage.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-count").textContent ===
        "1問,次は50問",
    );
    await iosPage.evaluate(() => {
      window.__syncMock.count = 6;
      window.dispatchEvent(new Event("focus"));
    });
    await iosPage.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-count").textContent ===
        "6問,次は50問",
    );
    assert.equal(
      await iosPage.evaluate(
        () =>
          window.__syncMock.calls.filter(
            (call) =>
              call.method === "POST" &&
              new URL(call.url).pathname === "/v1/correct",
          ).length,
      ),
      1,
    );
    assert.deepEqual(iosErrors, []);
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
