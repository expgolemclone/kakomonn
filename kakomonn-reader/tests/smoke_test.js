const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { chromium } = require("playwright");
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

function expectedSpeechSSML(text, rate) {
  return (
    '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ja-JP">' +
    `<voice name="${azureSpeechVoiceName}">` +
    `<prosody rate="${rate}">${text}</prosody>` +
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
    let gestureRequired = mode === "audio-gesture-required";
    const manualPlayback = mode === "audio-manual";
    window.__audioPauseCalls = 0;
    window.__audioPlayCalls = 0;

    class FakeAudio {
      constructor() {
        this.src = "";
        this.onplay = null;
        this.onended = null;
        this.onerror = null;
        this.paused = true;
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

async function markAnswerCorrect(childFrame) {
  await childFrame.evaluate(() => {
    document.querySelector("#correct-result").hidden = false;
    document.querySelector("#js-answer-result-box").classList.add("is-correct");
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
  });
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
        (call) => new URL(call.url).pathname === "/v7/speech-token",
      ).length,
  );
}

async function assertIncorrectSkip(context, script, inputMethod) {
  const page = await context.newPage();
  const errors = await preparePage(page, "none");
  const frame = await loadMockQuestion(page, script);
  try {
    await page.waitForFunction(
      () => document.querySelector("#kakomonn-reader-skip")?.disabled === false,
    );
    await frame.evaluate(() => {
      document.querySelector("#next")?.remove();
      document.querySelector("#scroll-next")?.remove();
    });
    if (inputMethod === "keyboard") {
      await frame.locator("input[name='answer']").first().focus();
      await page.keyboard.press("n");
    } else {
      await page.locator("#kakomonn-reader-skip").click();
    }
    await page.waitForFunction(
      () => window.__syncMock.attemptCount === 1,
    );
    const calls = await page.evaluate(() => ({
      attempts: window.__syncMock.calls.filter(
        (call) => new URL(call.url).pathname === "/v7/attempts",
      ),
      next: window.__syncMock.calls.filter(
        (call) => new URL(call.url).pathname === "/v7/next",
      ),
    }));
    assert.equal(calls.attempts.length, 1);
    assert.equal(calls.attempts[0].body.questionId, "45124");
    assert.equal(calls.attempts[0].body.answerResult, "incorrect");
    assert.equal(calls.next.length, 1);
    assert.equal(
      new URL(calls.next[0].url).searchParams.get("excludeQuestionId"),
      "45124",
    );
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
    stdio: "inherit",
  });

  const script = fs.readFileSync(scriptPath, "utf8");
  assert.equal(script.includes("// @version"), false);
  assert.equal(script.includes(SYNC_API_ORIGIN), true);
  assert.equal(
    script.includes(`// @connect      ${new URL(SYNC_API_ORIGIN).host}`),
    true,
  );
  assert.equal(script.includes("speechSynthesis"), false);
  assert.equal(script.includes("SpeechSynthesisUtterance"), false);
  assert.equal(script.includes("Microsoft Ayumi"), false);

  const browser = await chromium.launch({ headless: true });
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
    assert.equal(
      await page.locator("#kakomonn-reader-learning-metrics").innerText(),
      "todayStabilityDaysDelta 0日",
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
    assert.equal(
      await page.locator("#kakomonn-reader-skip").innerText(),
      "スキップ",
    );
    assert.equal(
      await page
        .locator("#kakomonn-reader-skip")
        .getAttribute("aria-keyshortcuts"),
      "N",
    );
    assert.equal(
      await page.locator("#kakomonn-reader-skip").getAttribute("title"),
      "ショートカット: n",
    );
    const readerLayout = await page.evaluate(() => {
      const controls = document
        .querySelector("#kakomonn-reader-controls")
        .getBoundingClientRect();
      const frame = document
        .querySelector("#kakomonn-reader-frame")
        .getBoundingClientRect();
      const actions = document
        .querySelector("#kakomonn-reader-actions")
        .getBoundingClientRect();
      return {
        actionsTop: actions.top,
        controlsBottom: controls.bottom,
        frameBottom: frame.bottom,
        frameTop: frame.top,
      };
    });
    assert.equal(
      readerLayout.frameTop >= readerLayout.controlsBottom,
      true,
      JSON.stringify(readerLayout),
    );
    assert.equal(
      readerLayout.frameBottom <= readerLayout.actionsTop,
      true,
      JSON.stringify(readerLayout),
    );
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
        panelBackground: "rgb(29, 35, 43)",
        panelColor: "rgb(243, 244, 246)",
        rootBackground: "rgb(11, 13, 16)",
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
      () =>
        window.__readerStatusHistory.includes("問題文 1/1") &&
        document.querySelector("#kakomonn-reader-status").textContent ===
          "問題文完了",
    );
    assert.equal(
      await page.locator("#kakomonn-reader-next").isDisabled(),
      true,
    );
    const answerInputs = childFrame.locator("input[name='answer']");
    const displayChoices = childFrame.locator(
      ".problem_detail > ul.list > li",
    );
    await page.locator("#kakomonn-reader-sync-settings-button").focus();

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
              new URL(call.url).pathname === "/v7/attempts",
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

    await markAnswerCorrect(childFrame);
    assert.deepEqual(
      await childFrame.locator("#js-answer-result-box").evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          background: style.backgroundColor,
          color: style.color,
        };
      }),
      {
        background: "rgb(24, 121, 78)",
        color: "rgb(255, 255, 255)",
      },
    );
    await page.waitForFunction(
      () => document.querySelector("#kakomonn-reader-next").disabled === false,
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
      () =>
        window.__readerStatusHistory.includes("解説 1/1") &&
        document.querySelector("#kakomonn-reader-status").textContent ===
          "解説完了",
    );
    assert.equal(
      (await azureSpeechCalls(page))[1].body,
      expectedSpeechSSML(
        "解説。これは動作確認用の解説です.。これは二つ目の解説です.",
        "+70%",
      ),
    );
    assert.equal(await speechTokenCallCount(page), 1);

    await page.evaluate(() => {
      window.__syncMock.timeoutNextRequest = true;
      window.dispatchEvent(new Event("focus"));
    });
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-status").textContent ===
        "学習記録の同期がタイムアウトしました.再試行してください",
      null,
      { timeout: 20_000 },
    );
    assert.equal(
      await page.locator("#kakomonn-reader-next").innerText(),
      "同期を再試行",
    );
    assert.equal(
      await page.locator("#kakomonn-reader-next").isDisabled(),
      false,
    );
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-next").textContent ===
        "次の問題へ",
    );

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
      "Markdownをコピー",
    );
    assert.equal(
      await page.locator("#kakomonn-reader-copy").isDisabled(),
      false,
    );
    await page.evaluate(() => window.__syncMock.releaseHeldRequest());
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-status").textContent ===
        "学習記録を同期できません.再試行してください",
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
      () =>
        window.__readerStatusHistory.includes(
          "クリップボードへコピーできません",
        ),
    );
    assert.equal(await page.evaluate(() => window.__copiedTexts.length), 1);
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
    await page.evaluate(() => {
      window.__syncMock.holdNextRequest = true;
      window.dispatchEvent(new Event("focus"));
    });
    const nextQuestionButton = page.locator("#kakomonn-reader-next");
    await page.waitForFunction(
      () => window.__syncMock.releaseHeldRequest !== null,
    );
    assert.equal(await nextQuestionButton.innerText(), "学習記録を同期中");
    assert.equal(await nextQuestionButton.isDisabled(), true);
    await childFrame.locator("input[name='answer']").first().focus();
    await page.keyboard.press("Enter");
    assert.equal(
      await page.evaluate(
        () =>
          window.__syncMock.calls.filter(
            (call) =>
              call.method === "POST" &&
              new URL(call.url).pathname === "/v7/attempts",
          ).length,
      ),
      0,
    );
    await page.evaluate(() => window.__syncMock.releaseHeldRequest());
    await page.waitForFunction(
      () => document.querySelector("#kakomonn-reader-next").disabled === false,
    );
    await childFrame.locator("input[name='answer']").first().focus();
    await page.keyboard.press("Enter");
    try {
      await page.waitForFunction(
        () =>
          document.querySelector("#kakomonn-reader-learning-metrics").textContent ===
          "todayStabilityDaysDelta 31日",
      );
    } catch (error) {
      error.readerState = await page.evaluate(() => ({
        count: document.querySelector("#kakomonn-reader-learning-metrics")?.textContent,
        status: document.querySelector("#kakomonn-reader-status")?.textContent,
        calls: window.__syncMock.calls,
        server: {
          stabilityDays: window.__syncMock.stabilityDays,
          attempts: window.__syncMock.attemptCount,
        },
      }));
      throw error;
    }
    assert.equal(
      await page.evaluate(
        () =>
          window.__syncMock.calls.filter(
            (call) =>
              call.method === "POST" &&
              new URL(call.url).pathname === "/v7/attempts",
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

    await page.evaluate(() => {
      window.__syncMock.stabilityDays = 7;
      window.__syncMock.attemptCount = 7;
      window.__syncMock.attemptedQuestionCount = 7;
      window.__syncMock.todayAttemptedQuestionCount = 7;
      window.__syncMock.todayStabilityDaysDelta = 7;
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
        document.querySelector("#kakomonn-reader-learning-metrics").textContent ===
        "todayStabilityDaysDelta 7日",
    );
    assert.equal(
      await page.locator("#kakomonn-reader-sync-settings-button").isDisabled(),
      false,
    );

    assert.deepEqual(errors, []);

    await assertIncorrectSkip(context, script, "keyboard");
    await assertIncorrectSkip(context, script, "button");

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
      () =>
        document.querySelector("#kakomonn-reader-status").textContent ===
        "問題文 1/1",
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
    assert.equal(
      await speechShortcutPage.locator("#kakomonn-reader-status").innerText(),
      "問題文 1/1",
    );
    assert.equal(
      await speechShortcutPage.evaluate(() => window.__audioPauseCalls),
      pauseCallsBeforeInput,
    );

    await speechShortcutFrame.locator("input[name='answer']").first().focus();
    const playCallsBeforePause = await speechShortcutPage.evaluate(
      () => window.__audioPlayCalls,
    );
    await speechShortcutPage.keyboard.press("Space");
    assert.equal(
      await speechShortcutPage.locator("#kakomonn-reader-status").innerText(),
      "読み上げ一時停止",
    );
    assert.equal(
      await speechShortcutPage.evaluate(() => window.__audioPauseCalls),
      pauseCallsBeforeInput + 1,
    );
    assert.equal(
      await speechShortcutPage.locator("#kakomonn-reader-skip").isVisible(),
      true,
    );

    await speechShortcutPage.keyboard.press("Space");
    await speechShortcutPage.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-status").textContent ===
        "問題文 1/1",
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
    assert.equal(
      await speechShortcutPage.locator("#kakomonn-reader-status").innerText(),
      "問題文 1/1",
    );
    assert.deepEqual(speechShortcutErrors, []);
    await speechShortcutPage.close();

    const gestureRetryPage = await context.newPage();
    const gestureRetryErrors = await preparePage(
      gestureRetryPage,
      "audio-gesture-required",
    );
    const gestureRetryFrame = await loadMockQuestion(gestureRetryPage, script);
    await gestureRetryPage.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-status").textContent ===
        "画面をクリックまたはタップすると読み上げます",
    );
    assert.equal((await azureSpeechCalls(gestureRetryPage)).length, 0);
    assert.equal(await speechTokenCallCount(gestureRetryPage), 0);
    await gestureRetryFrame.locator("input[name='answer']").first().click();
    await gestureRetryPage.waitForFunction(
      (url) =>
        window.__syncMock.calls.filter((call) => call.url === url).length === 1 &&
        document.querySelector("#kakomonn-reader-status").textContent ===
          "問題文完了",
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
      () =>
        document.querySelector("#kakomonn-reader-status").textContent ===
        "問題文完了",
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
    assert.equal(
      await setupPage.locator("#kakomonn-reader-learning-metrics").innerText(),
      "todayStabilityDaysDelta --日",
    );
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
    assert.equal(
      await setupPage.locator("#kakomonn-reader-learning-metrics").innerText(),
      "todayStabilityDaysDelta 0日",
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
          .textContent === "学習記録を同期できません.",
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
    await iosPage.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-status").textContent ===
        "画面をクリックまたはタップすると読み上げます",
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
        "問題文。これは動作確認用の問題文です.。これは改行後の問題文です.",
        "+100%",
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
        "解説。これは動作確認用の解説です.。これは二つ目の解説です.",
        "+70%",
      ),
    );
    assert.equal(await speechTokenCallCount(iosPage), 1);
    await iosPage.evaluate(() => { window.__syncMock.nextAttemptStabilityDaysDelta = 31; });
    await iosPage.locator("#kakomonn-reader-next").tap();
    await iosFrame.waitForURL(
      "https://chushoks.kakomonn.com/questions/45125",
    );
    await iosPage.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-learning-metrics").textContent ===
        "todayStabilityDaysDelta 31日",
    );
    await iosPage.evaluate(() => {
      window.__syncMock.stabilityDays = 6;
      window.__syncMock.attemptCount = 6;
      window.__syncMock.attemptedQuestionCount = 6;
      window.__syncMock.todayAttemptedQuestionCount = 6;
      window.__syncMock.todayStabilityDaysDelta = 6;
      window.dispatchEvent(new Event("focus"));
    });
    await iosPage.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-learning-metrics").textContent ===
        "todayStabilityDaysDelta 6日",
    );
    assert.equal(
      await iosPage.evaluate(
        () =>
          window.__syncMock.calls.filter(
            (call) =>
              call.method === "POST" &&
              new URL(call.url).pathname === "/v7/attempts",
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
