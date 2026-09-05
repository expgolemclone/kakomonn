const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { webkit } = require("playwright");
const {
  kakomonnFreeEnvironment,
  readKakomonnConfiguration,
} = require("../../scripts/kakomonn-config.cjs");
const {
  installSyncMock,
  SYNC_API_ORIGIN,
} = require("./sync_mock");
const {
  installReaderInChildFrames,
} = require("./support/frame_reader");

const projectRoot = path.resolve(__dirname, "..");
const defaultScriptPath = path.join(projectRoot, "kakomonn-reader.user.js");
const currentQuestionURL = "https://chushoks.kakomonn.com/questions/86956";
const nextQuestionURL = "https://chushoks.kakomonn.com/questions/86957";
const reportedQuestionIds = ["48443", "45047"];
const nextQuestionLauncherURL =
  "https://chushoks.kakomonn.com/createques#kakomonn-next";
const iosUserAgent =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 " +
  "Mobile/15E148 Safari/604.1";
const kakomonnConfiguration = readKakomonnConfiguration();

const fixtureBody = `
  <header class="l-header">元サイトヘッダー</header>
  <div class="problem_detail">
    <p class="when">
      中小企業診断士試験 令和2年度（2020年） 問19（経済学・経済政策 問19）
      <span><a href="#report">（訂正依頼・報告はこちら）</a></span>
    </p>
    <div class="ttl">
      WebKit動作確認用の問題文です.<br>
      記号 *強調* と &lt;タグ&gt;を含みます.
    </div>
    <div class="zoomin">
      <img
        src="https://cdn.example.test/webkit-question.png"
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
  </div>
  <div id="js-answer-result-box"></div>
  <h2>この過去問の解説</h2>
  <div id="js-commentary-wrap">
    <div class="item">
      <p class="none_text" id="explanation-lock">
        解説は問題に回答すると表示されます。
      </p>
      <p class="num"><span>01</span></p>
      <div class="text" id="explanation" hidden>
        <div class="expound-top">
          <p>WebKit動作確認用の解説です.</p>
          <figure>
            <img
              src="https://cdn.example.test/webkit-explanation-1.png"
              alt="解説図"
            >
          </figure>
        </div>
      </div>
    </div>
    <div class="advertisement-label">Advertisement</div>
    <div class="advertisement-box"></div>
    <div class="item">
      <p class="none_text">
        解説は問題に回答すると表示されます。
      </p>
      <p class="num"><span>02</span></p>
      <div class="text" hidden>
        <div class="expound-top">
          <p>WebKit二つ目の解説です.</p>
          <figure>
            <img src="https://cdn.example.test/webkit-explanation-2.png">
          </figure>
          <figure>
            <img
              src="https://cdn.example.test/webkit-explanation-1.png"
              alt="重複画像"
            >
          </figure>
          <table>
            <tr><th>式</th><th>単位</th></tr>
            <tr>
              <td>Y<sub>0</sub></td>
              <td>1,000m<sup>2</sup></td>
            </tr>
          </table>
          <p>Markdown記号 * と [ ] を含みます.</p>
          <p>---<br>===<br>~~取消~~</p>
        </div>
      </div>
    </div>
  </div>
  <button type="button">次の問題へ</button>
  <p class="next">
    <a id="next" href="${nextQuestionURL}">次の問題（問5）へ</a>
  </p>
`;

const expectedCopiedMarkdown = `# 中小企業診断士試験 令和2年度（2020年） 問19（経済学・経済政策 問19）

## 問題文

WebKit動作確認用の問題文です.

記号 \\*強調\\* と &lt;タグ&gt;を含みます.

![問題文の画像](https://cdn.example.test/webkit-question.png)

### 選択肢

- 選択肢1
- 選択肢2

### 自分の回答

選択肢2: 選択肢2

## 解説

### 解説 01

WebKit動作確認用の解説です.

![解説図](https://cdn.example.test/webkit-explanation-1.png)

### 解説 02

WebKit二つ目の解説です.

![解説画像 1](https://cdn.example.test/webkit-explanation-2.png)

| 式 | 単位 |
| --- | --- |
| Y<sub>0</sub> | 1,000m<sup>2</sup> |

Markdown記号 \\* と \\[ \\] を含みます.

\\---
\\===
\\~\\~取消\\~\\~`;

async function prepareLauncherPage(
  context,
  script,
  { syncOptions = {}, mutateMock = null } = {},
) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(nextQuestionLauncherURL);
  await page.evaluate(() => {
    window.__launcherDocumentSentinel = "same-document";
  });
  await installSyncMock(page, syncOptions);
  if (mutateMock !== null) {
    await page.evaluate(mutateMock);
  }
  await page.addScriptTag({ content: script });
  return { errors, page };
}

async function installCorrectFeedbackRandom(page, values) {
  await page.evaluate((queuedValues) => {
    const queue = [...queuedValues];
    const nativeGetRandomValues = Crypto.prototype.getRandomValues;
    Object.defineProperty(Crypto.prototype, "getRandomValues", {
      configurable: true,
      value(target) {
        if (target instanceof Uint16Array && target.length === 1) {
          if (queue.length === 0) {
            throw new Error("correct feedback random queue was exhausted");
          }
          target[0] = queue.shift();
          return target;
        }
        return nativeGetRandomValues.call(this, target);
      },
    });
  }, values);
}

async function waitForLauncherState(page, errors, expectedState) {
  try {
    await page.waitForFunction(
      (state) =>
        document.querySelector("#kakomonn-next-question-panel")?.dataset
          .state === state,
      expectedState,
    );
  } catch (error) {
    error.launcherDiagnostics = await page.evaluate(() => ({
      body: document.body.innerText,
      state: document.querySelector("#kakomonn-next-question-panel")?.dataset
        .state,
      status: document.querySelector("#next-question-status")?.textContent,
    }));
    error.pageErrors = errors;
    throw error;
  }
}

async function assertLauncherFailure(
  context,
  script,
  {
    expectedState,
    expectedStatus,
    expectedTitle,
    syncOptions = {},
    mutateMock = null,
  },
) {
  const { errors, page } = await prepareLauncherPage(context, script, {
    syncOptions,
    mutateMock,
  });
  try {
    await waitForLauncherState(page, errors, expectedState);
    await page.locator("#next-question-retry").waitFor({ state: "visible" });
    assert.equal(
      await page.locator("#next-question-status").innerText(),
      expectedStatus,
    );
    assert.equal(
      await page.locator("#kakomonn-next-question-title").innerText(),
      expectedTitle,
    );
    assert.equal(
      await page.locator("#kakomonn-next-question-panel").getAttribute("data-state"),
      expectedState,
    );
    assert.equal(
      await page.locator("#kakomonn-next-question-panel").getAttribute("aria-busy"),
      "false",
    );
    const layout = await page.evaluate(() => {
      const panel = document.querySelector("#kakomonn-next-question-panel");
      const retry = document.querySelector("#next-question-retry");
      const panelRect = panel.getBoundingClientRect();
      const retryRect = retry.getBoundingClientRect();
      return {
        horizontalOverflow:
          document.documentElement.scrollWidth > window.innerWidth,
        panelInsideViewport:
          panelRect.left >= 0 && panelRect.right <= window.innerWidth,
        retryHeight: retryRect.height,
      };
    });
    assert.equal(layout.horizontalOverflow, false, JSON.stringify(layout));
    assert.equal(layout.panelInsideViewport, true, JSON.stringify(layout));
    assert.equal(layout.retryHeight >= 44, true, JSON.stringify(layout));
    assert.equal(page.url(), nextQuestionLauncherURL);
    assert.equal(await page.locator("#kakomonn-reader-shell").count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

async function assertLauncherRequiresSettings(
  context,
  script,
  { syncOptions = {}, mutateMock = null } = {},
) {
  const { errors, page } = await prepareLauncherPage(context, script, {
    syncOptions,
    mutateMock,
  });
  try {
    await page
      .locator("#kakomonn-reader-sync-settings")
      .waitFor({ state: "visible" });
    assert.equal(page.url(), nextQuestionLauncherURL);
    assert.equal(await page.locator("#kakomonn-reader-shell").count(), 1);
    assert.equal(await page.locator("#kakomonn-reader-sync-settings-button").count(), 0);
    assert.equal(await page.locator("#kakomonn-reader-sync-settings-cancel").count(), 0);
    assert.equal(
      await page.locator("#kakomonn-next-question-launcher").count(),
      0,
    );
    assert.equal(
      await page.evaluate(() => window.__launcherDocumentSentinel),
      "same-document",
    );
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

async function assertEarlyFrameReadyNavigation(browser, script) {
  const context = await browser.newContext({
    userAgent: iosUserAgent,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
  });

  try {
    for (const questionId of reportedQuestionIds) {
      const questionURL =
        `https://chushoks.kakomonn.com/questions/${questionId}`;
      const slowResourceURL =
        `https://cdn.example.test/slow-frame-${questionId}.png`;
      const page = await context.newPage();
      const pageErrors = [];
      let releaseSlowResource = null;
      let slowResourceRequested = false;
      page.on("pageerror", (error) => pageErrors.push(String(error)));
      await page.route(slowResourceURL, async (route) => {
        slowResourceRequested = true;
        await new Promise((resolve) => {
          releaseSlowResource = resolve;
        });
        await route.abort("aborted").catch(() => {});
      });
      await page.route("https://chushoks.kakomonn.com/**", (route) => {
        const request = route.request();
        const isChildNavigation = request.frame().parentFrame() !== null;
        const body =
          isChildNavigation && request.url() === questionURL
            ? `<!doctype html><html><head>` +
              `<meta charset="utf-8">` +
              `<meta name="viewport" content="width=device-width">` +
              `</head><body>${fixtureBody}` +
              `<img id="slow-frame-resource" src="${slowResourceURL}">` +
              `</body></html>`
            : `<!doctype html><html><head>` +
              `<meta charset="utf-8">` +
              `<meta name="viewport" content="width=device-width">` +
              `</head><body></body></html>`;
        return route.fulfill({
          body,
          contentType: "text/html; charset=utf-8",
          status: 200,
        });
      });

      try {
        await page.goto(questionURL, { waitUntil: "domcontentloaded" });
        await page.evaluate(() => {
          Object.defineProperty(window, "Audio", {
            configurable: true,
            value: undefined,
          });
          window.__copiedTexts = [];
          Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
              async write(items) {
                const blob = await items[0].getType("text/plain");
                window.__copiedTexts.push(await blob.text());
              },
            },
          });
        });
        await installSyncMock(page, { nextQuestionId: "86957" });
        await page.addScriptTag({ content: script });
        await page.locator("#kakomonn-reader-frame").waitFor({
          state: "attached",
        });
        const questionFrame = page.frames().find(
          (candidate) =>
            candidate !== page.mainFrame() && candidate.url() === questionURL,
        );
        assert.notEqual(questionFrame, undefined);
        await questionFrame.waitForLoadState("domcontentloaded");
        assert.equal(slowResourceRequested, true);
        assert.equal(
          await questionFrame.evaluate(() => document.readyState),
          "interactive",
        );
        assert.equal(
          await questionFrame.locator("#kakomonn-reader-dark-mode").count(),
          0,
        );

        if (questionId === reportedQuestionIds[0]) {
          await page.evaluate((href) => {
            window.postMessage(
              { href, type: "kakomonn-reader:frame-ready" },
              location.origin,
            );
            const frame = document.querySelector("#kakomonn-reader-frame");
            window.dispatchEvent(new MessageEvent("message", {
              data: { href, type: "kakomonn-reader:frame-ready" },
              origin: "https://invalid.example",
              source: frame.contentWindow,
            }));
          }, questionURL);
          await questionFrame.evaluate((href) => {
            window.parent.postMessage(
              {
                extra: true,
                href,
                type: "kakomonn-reader:frame-ready",
              },
              location.origin,
            );
            window.parent.postMessage(
              {
                href: `${location.origin}/questions/99999`,
                type: "kakomonn-reader:frame-ready",
              },
              location.origin,
            );
          }, questionURL);
          await page.waitForTimeout(100);
          assert.equal(
            await questionFrame.locator("#kakomonn-reader-dark-mode").count(),
            0,
          );
        }

        await questionFrame.addScriptTag({ content: script });
        await questionFrame.locator("#kakomonn-reader-dark-mode").waitFor({
          state: "attached",
        });
        assert.equal(
          await questionFrame.evaluate(() => document.readyState),
          "interactive",
        );
        await page.waitForFunction(
          () =>
            window.__syncMock.calls.some(
              (call) => new URL(call.url).pathname === "/v10/state",
            ),
        );
        await page.waitForFunction(
          () =>
            document.querySelector("#kakomonn-reader-error-dialog")?.open ===
            true,
        );
        assert.equal(
          await page.locator("#kakomonn-reader-error-title").innerText(),
          "読み上げを利用できません",
        );
        await page.evaluate(() => {
          const dialog = document.querySelector(
            "#kakomonn-reader-error-dialog",
          );
          if (dialog?.open) {
            dialog.close();
          }
        });
        await questionFrame.locator("label").first().tap();
        await questionFrame.locator(".problem_detail button").tap();
        await questionFrame.evaluate(() => {
          document
            .querySelector("#js-answer-result-box")
            .classList.add("is-correct");
          for (const lock of document.querySelectorAll(
            "#js-commentary-wrap > .item > .none_text",
          )) {
            lock.hidden = true;
          }
          for (const explanation of document.querySelectorAll(
            "#js-commentary-wrap > .item > .text",
          )) {
            explanation.hidden = false;
          }
        });
        try {
          await page.waitForFunction(
            (expectedURL) =>
              document.querySelector("#kakomonn-reader-frame")?.contentWindow
                ?.location.href === expectedURL,
            nextQuestionURL,
          );
        } catch (error) {
          error.readerDiagnostics = await page.evaluate(() => ({
            calls: window.__syncMock.calls.map((call) => ({
              body: call.body,
              method: call.method,
              path: new URL(call.url).pathname,
            })),
            copiedTextCount: window.__copiedTexts.length,
            errorDialog: {
              code: document.querySelector("#kakomonn-reader-error-code")
                ?.textContent,
              open: document.querySelector("#kakomonn-reader-error-dialog")
                ?.open,
              title: document.querySelector("#kakomonn-reader-error-title")
                ?.textContent,
            },
            frameURL: document.querySelector("#kakomonn-reader-frame")
              ?.contentWindow?.location.href,
            resultClass: document
              .querySelector("#kakomonn-reader-frame")
              ?.contentDocument?.querySelector("#js-answer-result-box")
              ?.className,
          }));
          throw error;
        }
        const attemptCalls = await page.evaluate(() =>
          window.__syncMock.calls.filter(
            (call) =>
              call.method === "POST" &&
              new URL(call.url).pathname === "/v10/attempts",
          ),
        );
        assert.equal(attemptCalls.length, 1);
        assert.equal(attemptCalls[0].body.questionId, questionId);
        assert.equal(attemptCalls[0].body.answerResult, "correct");
        assert.deepEqual(pageErrors, []);
      } finally {
        releaseSlowResource?.();
        await page.close();
      }
    }
  } finally {
    await context.close();
  }
}

async function main() {
  const configuredScriptPath =
    kakomonnConfiguration.KAKOMONN_READER_SCRIPT_PATH;
  if (!configuredScriptPath) {
    execFileSync("python3", ["build.py"], {
      cwd: projectRoot,
      env: kakomonnFreeEnvironment(),
      stdio: "inherit",
    });
  }
  const scriptPath = configuredScriptPath
    ? path.resolve(configuredScriptPath)
    : defaultScriptPath;
  const script = fs.readFileSync(scriptPath, "utf8");
  const browser = await webkit.launch({
    env: kakomonnFreeEnvironment(),
    headless: true,
  });

  try {
    const context = await browser.newContext({
      userAgent: iosUserAgent,
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      hasTouch: true,
      isMobile: true,
    });
    await installReaderInChildFrames(context, script);
    await context.route(`${SYNC_API_ORIGIN}/**`, (route) => route.abort());
    await context.route("https://chushoks.kakomonn.com/**", (route) =>
      route.fulfill({
        contentType: "text/html; charset=utf-8",
        body:
          "<!doctype html><html><head>" +
          '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">' +
          "</head><body></body></html>",
      }),
    );

    const noNextLauncher = await prepareLauncherPage(context, script, {
      syncOptions: { nextQuestionId: null },
    });
    try {
      await waitForLauncherState(
        noNextLauncher.page,
        noNextLauncher.errors,
        "empty",
      );
      await noNextLauncher.page.locator("#next-question-retry").waitFor({
        state: "visible",
      });
      assert.equal(
        await noNextLauncher.page.locator("#next-question-status").innerText(),
        "時間を置いてから, 学習状況をもう一度確認してください.",
      );
      assert.equal(
        await noNextLauncher.page
          .locator("#kakomonn-next-question-title")
          .innerText(),
        "今解く問題はありません",
      );
      assert.equal(
        await noNextLauncher.page
          .locator("#kakomonn-next-question-panel")
          .getAttribute("data-state"),
        "empty",
      );
      assert.equal(
        await noNextLauncher.page
          .locator("#next-question-status")
          .getAttribute("role"),
        "status",
      );
      assert.deepEqual(
        await noNextLauncher.page.evaluate(() =>
          window.__syncMock.calls.map((call) => ({
            authorization: call.authorization,
            method: call.method,
            url: call.url,
          })),
        ),
        [
          {
            authorization: "Bearer test-sync-token",
            method: "GET",
            url: `${SYNC_API_ORIGIN}/v10/next?site=chushoks.kakomonn.com`,
          },
        ],
      );
      assert.deepEqual(noNextLauncher.errors, []);
    } finally {
      await noNextLauncher.page.close();
    }

    await assertLauncherRequiresSettings(context, script, {
      syncOptions: { configured: false },
    });
    await assertLauncherRequiresSettings(context, script, {
      mutateMock: () => {
        window.__syncMock.token = "server-token";
      },
    });

    const retryLauncher = await prepareLauncherPage(context, script, {
      syncOptions: { nextQuestionId: "86957" },
      mutateMock: () => {
        window.__syncMock.failNextRequest = true;
      },
    });
    await waitForLauncherState(
      retryLauncher.page,
      retryLauncher.errors,
      "service-error",
    );
    await retryLauncher.page.locator("#next-question-retry").click();
    await retryLauncher.page.waitForURL(nextQuestionURL);
    assert.equal(
      await retryLauncher.page.evaluate(() => window.__launcherDocumentSentinel),
      "same-document",
    );
    assert.equal(
      await retryLauncher.page.locator("#kakomonn-reader-shell").count(),
      1,
    );
    assert.deepEqual(
      await retryLauncher.page.evaluate(() =>
        window.__syncMock.calls.map((call) => new URL(call.url).pathname),
      ),
      ["/v10/next", "/v10/next"],
    );
    assert.deepEqual(retryLauncher.errors, []);
    await retryLauncher.page.close();

    const stalledLauncher = await context.newPage();
    const stalledLauncherErrors = [];
    stalledLauncher.on("pageerror", (error) =>
      stalledLauncherErrors.push(String(error)),
    );
    await stalledLauncher.goto(nextQuestionLauncherURL);
    await stalledLauncher.clock.install();
    await installSyncMock(stalledLauncher, {
      nextQuestionId: "86957",
    });
    await stalledLauncher.evaluate(() => {
      window.__syncMock.holdNextRequest = true;
    });
    await stalledLauncher.addScriptTag({ content: script });
    await stalledLauncher
      .locator("#kakomonn-next-question-panel[data-state='loading']")
      .waitFor();
    await stalledLauncher.clock.fastForward(60_000);
    await stalledLauncher
      .locator("#kakomonn-next-question-panel[data-state='service-error']")
      .waitFor();
    assert.equal(
      await stalledLauncher.locator("#kakomonn-next-question-title").innerText(),
      "同期に時間がかかっています",
    );
    assert.equal(
      await stalledLauncher.locator("#next-question-status").innerText(),
      "通信状態を確認してから, もう一度試してください.",
    );
    assert.deepEqual(
      await stalledLauncher.evaluate(() => ({
        abortedRequestCount: window.__syncMock.abortedRequestCount,
        callCount: window.__syncMock.calls.length,
        heldRequestPending: window.__syncMock.releaseHeldRequest !== null,
      })),
      {
        abortedRequestCount: 1,
        callCount: 1,
        heldRequestPending: false,
      },
    );
    await stalledLauncher.locator("#next-question-retry").click();
    await stalledLauncher.clock.runFor(1);
    await stalledLauncher.waitForURL(nextQuestionURL);
    assert.deepEqual(stalledLauncherErrors, []);
    await stalledLauncher.close();

    await assertLauncherFailure(context, script, {
      expectedState: "service-error",
      expectedTitle: "問題一覧を同期できません",
      expectedStatus:
        "問題画面で問題一覧を同期してから, もう一度試してください.",
      syncOptions: { nextError: "catalog_missing" },
    });
    await assertLauncherFailure(context, script, {
      expectedState: "service-error",
      expectedTitle: "同期サービスを利用できません",
      expectedStatus:
        "同期APIの応答を確認できませんでした. 時間を置いて, もう一度試してください.",
      syncOptions: { nextQuestionId: "invalid" },
    });

    const settingsEntryPage = await context.newPage();
    const settingsEntryErrors = [];
    settingsEntryPage.on("pageerror", (error) =>
      settingsEntryErrors.push(String(error)),
    );
    await settingsEntryPage.goto(currentQuestionURL);
    await installSyncMock(settingsEntryPage, {
      configured: false,
      nextQuestionId: "86957",
    });
    await settingsEntryPage.evaluate(() => {
      window.__settingsDocumentSentinel = "same-document";
    });
    await settingsEntryPage.addScriptTag({ content: script });
    await settingsEntryPage
      .locator("#kakomonn-reader-sync-settings")
      .waitFor({ state: "visible" });
    await settingsEntryPage.waitForFunction(
      () => document.activeElement?.id === "kakomonn-reader-sync-token",
    );
    assert.equal(await settingsEntryPage.locator("#kakomonn-reader-sync-settings-cancel").count(), 0);
    const settingsLayout = await settingsEntryPage.evaluate(() => {
      const panel = document.querySelector("#kakomonn-reader-sync-settings-panel");
      const input = document.querySelector("#kakomonn-reader-sync-token");
      const save = document.querySelector("#kakomonn-reader-sync-settings-save");
      const panelRect = panel.getBoundingClientRect();
      return {
        horizontalOverflow:
          document.documentElement.scrollWidth > window.innerWidth,
        inputHeight: input.getBoundingClientRect().height,
        panelInsideViewport:
          panelRect.left >= 0 && panelRect.right <= window.innerWidth,
        saveHeight: save.getBoundingClientRect().height,
      };
    });
    assert.equal(
      settingsLayout.horizontalOverflow,
      false,
      JSON.stringify(settingsLayout),
    );
    assert.equal(
      settingsLayout.panelInsideViewport,
      true,
      JSON.stringify(settingsLayout),
    );
    assert.equal(
      settingsLayout.inputHeight >= 44,
      true,
      JSON.stringify(settingsLayout),
    );
    assert.equal(
      settingsLayout.saveHeight >= 44,
      true,
      JSON.stringify(settingsLayout),
    );
    await settingsEntryPage.evaluate(() => {
      window.__syncMock.holdNextSetValue = true;
    });
    await settingsEntryPage
      .locator("#kakomonn-reader-sync-token")
      .fill("test-sync-token");
    await settingsEntryPage
      .locator("#kakomonn-reader-sync-settings-save")
      .click();
    await settingsEntryPage.waitForFunction(
      () => window.__syncMock.releaseHeldSetValue !== null,
    );
    assert.equal(settingsEntryPage.url(), currentQuestionURL);
    await settingsEntryPage.evaluate(() =>
      window.__syncMock.releaseHeldSetValue(),
    );
    await settingsEntryPage.waitForSelector("#kakomonn-reader-sync-settings", {
      state: "hidden",
    });
    assert.equal(settingsEntryPage.url(), currentQuestionURL);
    assert.equal(
      await settingsEntryPage.evaluate(() => window.__settingsDocumentSentinel),
      "same-document",
    );
    assert.equal(
      await settingsEntryPage.locator("#kakomonn-reader-shell").count(),
      1,
    );
    assert.deepEqual(settingsEntryErrors, []);
    await settingsEntryPage.close();

    const successfulLauncher = await prepareLauncherPage(context, script, {
      syncOptions: { nextQuestionId: "86957" },
    });
    await successfulLauncher.page.waitForURL(nextQuestionURL);
    await successfulLauncher.page.waitForFunction(
      (expectedURL) =>
        document.querySelector("#kakomonn-reader-frame")?.contentWindow
          ?.location.href === expectedURL,
      nextQuestionURL,
    );
    assert.equal(
      await successfulLauncher.page.evaluate(
        () => window.__launcherDocumentSentinel,
      ),
      "same-document",
    );
    assert.equal(
      await successfulLauncher.page.locator("#kakomonn-reader-sync-settings-button").count(),
      0,
    );
    assert.deepEqual(successfulLauncher.errors, []);
    await successfulLauncher.page.close();

    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    await page.goto(currentQuestionURL);
    await page.evaluate(() => {
      Object.defineProperty(window, "Audio", {
        configurable: true,
        value: undefined,
      });
      window.__copiedTexts = [];
      window.__pageClipboardWrites = [];
      window.__clipboardWriteFails = false;
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          async write(items) {
            if (window.__clipboardWriteFails) {
              throw new Error("mock clipboard write failed");
            }
            const blob = await items[0].getType("text/plain");
            const value = await blob.text();
            window.__copiedTexts.push(value);
            window.__pageClipboardWrites.push(value);
          },
        },
      });
    });
    await installSyncMock(page, {
      nextQuestionId: "86957",
    });
    await page.addScriptTag({ content: script });
    await page.locator("#kakomonn-reader-frame").waitFor({ state: "attached" });

    const childFrame = page
      .frames()
      .find((candidate) => candidate !== page.mainFrame());
    assert.notEqual(childFrame, undefined);
    await childFrame.evaluate((html) => {
      document.body.innerHTML = html;
      Object.defineProperty(document.querySelector("#next"), "getClientRects", {
        configurable: true,
        value: () => [],
      });
    }, fixtureBody);
    await page.waitForFunction(
      () => window.__syncMock.calls.some((call) => new URL(call.url).pathname === "/v10/state"),
    );
    await page.waitForTimeout(1_000);
    await page.evaluate(() => {
      window.__readerPopstateCount = 0;
      window.addEventListener("popstate", () => {
        window.__readerPopstateCount += 1;
      });
    });
    if (await page.locator("#kakomonn-reader-error-dialog").getAttribute("open") !== null) {
      await page.locator("#kakomonn-reader-error-close").click();
    }
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      assert.deepEqual(
        await page.evaluate(() => {
          const shell = document.querySelector("#kakomonn-reader-shell");
          const frame = document.querySelector("#kakomonn-reader-frame");
          const progress = document.querySelector("#kakomonn-reader-time-limit");
          const shellRect = shell.getBoundingClientRect();
          const frameRect = frame.getBoundingClientRect();
          const progressRect = progress.getBoundingClientRect();
          return {
            frameFillsShell:
              Math.abs(frameRect.top - shellRect.top) <= 1 &&
              Math.abs(frameRect.right - shellRect.right) <= 1 &&
              Math.abs(frameRect.bottom - shellRect.bottom) <= 1 &&
              Math.abs(frameRect.left - shellRect.left) <= 1,
            noHorizontalOverflow:
              shell.scrollWidth <= shell.clientWidth,
            shellFillsViewport:
              Math.abs(shellRect.top) <= 1 &&
              Math.abs(shellRect.right - innerWidth) <= 1 &&
              Math.abs(shellRect.bottom - innerHeight) <= 1 &&
              shellRect.height > 0,
            timeBarOverlay:
              Math.abs(progressRect.top - shellRect.top) <= 1 &&
              Math.abs(progressRect.left - shellRect.left) <= 1 &&
              Math.abs(progressRect.right - shellRect.right) <= 1 &&
              Math.abs(progressRect.height - 4) <= 1,
          };
        }),
        {
          frameFillsShell: true,
          noHorizontalOverflow: true,
          shellFillsViewport: true,
          timeBarOverlay: true,
        },
        JSON.stringify(viewport),
      );
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert.deepEqual(
      await childFrame.evaluate(() => {
        const choiceImage = document.createElement("img");
        document
          .querySelector(".problem_detail > ul.list > li > div")
          .appendChild(choiceImage);
        const result = {
          bodyBackground: getComputedStyle(document.body).backgroundColor,
          choiceBackground: getComputedStyle(
            document.querySelector(".problem_detail > ul.list > li > div")
          ).backgroundColor,
          colorScheme: getComputedStyle(document.documentElement).colorScheme,
          imageFilters: [
            choiceImage,
            document.querySelector(".problem_detail > .zoomin img"),
            document.querySelector("#js-commentary-wrap > .item .text img"),
          ].map((image) => getComputedStyle(image).filter),
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
        choiceImage.remove();
        return result;
      }),
      {
        bodyBackground: "rgb(11, 13, 16)",
        choiceBackground: "rgb(29, 35, 43)",
        colorScheme: "dark",
        imageFilters: Array(3).fill("invert(1) hue-rotate(180deg)"),
        problemBackground: "rgb(21, 25, 30)",
        siteHeaderDisplay: "none",
        styleCount: 1,
        toggleCount: 0,
      },
    );

    assert.equal(await page.locator("#kakomonn-reader-next").count(), 0);
    assert.equal(await page.locator("#kakomonn-reader-copy").count(), 0);
    assert.equal(await page.locator("#kakomonn-reader-actions").count(), 0);
    assert.equal(await childFrame.getByRole("button", { name: "次の問題へ" }).isHidden(), true);
    assert.equal(await childFrame.locator("#next").isHidden(), true);
    assert.equal(await page.evaluate(() => window.__copiedTexts.length), 0);

    await page.evaluate(() => {
      window.__clipboardWriteFails = true;
    });
    await childFrame.locator("input[name='answer']").nth(1).tap();
    await childFrame.getByRole("button", { name: "解答する" }).tap();
    await childFrame.evaluate(() => {
      document
        .querySelector("#js-answer-result-box")
        .classList.add("is-wrong");
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
    await page.waitForFunction(
      () => document.querySelector("#kakomonn-reader-error-dialog")?.open === true,
    );
    assert.equal(
      await page.locator("#kakomonn-reader-error-title").innerText(),
      "クリップボードへコピーできません",
    );
    assert.equal(
      await page.locator("#kakomonn-reader-error-retry").innerText(),
      "コピーを再試行",
    );
    assert.equal(
      await page.locator("#kakomonn-reader-error-retry").isVisible(),
      true,
    );
    assert.equal(await page.evaluate(() => window.__copiedTexts.length), 0);
    assert.equal(
      await page.evaluate(() => window.__pageClipboardWrites.length),
      0,
    );
    assert.deepEqual(
      await page.evaluate(() => window.__syncMock.clipboardWrites),
      [],
    );
    await page.evaluate(() => {
      window.__clipboardWriteFails = false;
    });
    await page.locator("#kakomonn-reader-error-retry").tap();
    await page.waitForFunction(
      () =>
        window.__copiedTexts.length === 1 &&
        window.__readerPopstateCount >= 1 &&
        history.state?.entryType === "current",
    );
    assert.equal(
      await page.evaluate(() => window.__copiedTexts[0]),
      expectedCopiedMarkdown,
    );
    assert.deepEqual(
      await page.evaluate(() => window.__pageClipboardWrites),
      [expectedCopiedMarkdown],
    );
    assert.equal(
      (await page.evaluate(() => window.__copiedTexts[0])).split(
        "https://cdn.example.test/webkit-explanation-1.png"
      ).length - 1,
      1,
    );
    await page.evaluate(() => history.forward());
    await childFrame.waitForURL(nextQuestionURL);
    assert.equal(
      await page.evaluate(
        () =>
          window.__syncMock.calls.filter(
            (call) =>
              call.method === "POST" &&
              new URL(call.url).pathname === "/v10/attempts",
          ).length,
      ),
      1,
    );
    assert.deepEqual(pageErrors, []);

    const correctPage = await context.newPage();
    const correctPageErrors = [];
    correctPage.on("pageerror", (error) =>
      correctPageErrors.push(String(error)),
    );
    await correctPage.goto(currentQuestionURL);
    await correctPage.evaluate(() => {
      Object.defineProperty(window, "Audio", {
        configurable: true,
        value: undefined,
      });
      window.__copiedTexts = [];
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          async write(items) {
            const blob = await items[0].getType("text/plain");
            window.__copiedTexts.push(await blob.text());
          },
        },
      });
    });
    await installSyncMock(correctPage, { nextQuestionId: "86957" });
    await installCorrectFeedbackRandom(correctPage, [111]);
    await correctPage.addScriptTag({ content: script });
    await correctPage.waitForFunction(
      (expectedURL) =>
        document.querySelector("#kakomonn-reader-frame")?.contentWindow
          ?.location.href === expectedURL,
      currentQuestionURL,
    );
    const correctFrame = correctPage
      .frames()
      .find(
        (candidate) =>
          candidate !== correctPage.mainFrame() &&
          candidate.url() === currentQuestionURL,
      );
    assert.notEqual(correctFrame, undefined);
    await correctFrame.evaluate((html) => {
      document.body.innerHTML = html;
    }, fixtureBody);
    await correctPage.waitForFunction(
      () => window.__syncMock.calls.some((call) => new URL(call.url).pathname === "/v10/state"),
    );
    await correctPage.waitForTimeout(1_000);
    await correctPage.evaluate(() => {
      window.__readerPopstateCount = 0;
      window.addEventListener("popstate", () => {
        window.__readerPopstateCount += 1;
      });
    });
    if (await correctPage.locator("#kakomonn-reader-error-dialog").getAttribute("open") !== null) {
      await correctPage.locator("#kakomonn-reader-error-close").click();
    }
    await correctPage.evaluate(() => {
      window.__syncMock.holdNextRequest = true;
    });
    await correctFrame.locator("input[name='answer']").first().tap();
    await correctFrame.getByRole("button", { name: "解答する" }).tap();
    await correctFrame.evaluate(() => {
      document
        .querySelector("#js-answer-result-box")
        .classList.add("is-correct");
      for (const lock of document.querySelectorAll(
        "#js-commentary-wrap > .item > .none_text",
      )) {
        lock.hidden = true;
      }
      for (const explanation of document.querySelectorAll(
        "#js-commentary-wrap > .item > .text",
      )) {
        explanation.hidden = false;
      }
    });
    await correctFrame.waitForSelector(".kakomonn-reader-correct-feedback");
    assert.deepEqual(
      await correctFrame.locator(".kakomonn-reader-correct-feedback").evaluate(
        (element) => {
          const rect = element.getBoundingClientRect();
          return {
            badge: element.querySelector(
              ".kakomonn-reader-correct-feedback-badge",
            )?.textContent,
            message: element.querySelector(
              ".kakomonn-reader-correct-feedback-message",
            )?.textContent,
            pointerEvents: getComputedStyle(element).pointerEvents,
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
        badge: "NORMAL",
        message: "That's Right!!",
        pointerEvents: "none",
        rarity: "normal",
        withinViewport: true,
      },
    );
    await correctPage.waitForFunction(
      () => window.__syncMock.releaseHeldRequest !== null,
    );
    await correctPage.evaluate(() => window.__syncMock.releaseHeldRequest());
    await correctPage.waitForFunction(
      (expectedURL) =>
        window.__copiedTexts.length === 1 &&
        document.querySelector("#kakomonn-reader-frame")?.contentWindow
          ?.location.href === expectedURL &&
        history.state?.entryType === "current",
      nextQuestionURL,
    );
    await correctFrame.waitForURL(nextQuestionURL);
    assert.deepEqual(correctPageErrors, []);
    await correctPage.close();
    await context.close();
    await assertEarlyFrameReadyNavigation(browser, script);
  } finally {
    await browser.close();
  }

  console.log("kakomonn WebKit mobile smoke test passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
