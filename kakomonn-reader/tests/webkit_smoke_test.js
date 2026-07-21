const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { webkit } = require("playwright");
const { installSyncMock } = require("./sync_mock");

const projectRoot = path.resolve(__dirname, "..");
const defaultScriptPath = path.join(projectRoot, "kakomonn-reader.user.js");
const currentQuestionURL = "https://chushoks.kakomonn.com/questions/86956";
const nextQuestionURL = "https://chushoks.kakomonn.com/questions/86957";
const iosUserAgent =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 " +
  "Mobile/15E148 Safari/604.1";

const fixtureBody = `
  <div id="meta">中小企業診断士試験 令和7年度 第4問</div>
  <p>WebKit動作確認用の問題文です.</p>
  <div id="js-answer-result-box"></div>
  <h2>この過去問の解説</h2>
  <p id="explanation-lock">解説は問題に回答すると表示されます.</p>
  <p id="explanation" hidden>WebKit動作確認用の解説です.</p>
  <button type="button">次の問題へ</button>
  <p class="next">
    <a id="next" href="${nextQuestionURL}">次の問題（問5）へ</a>
  </p>
`;

async function main() {
  const configuredScriptPath = process.env.KAKOMONN_READER_SCRIPT_PATH;
  if (!configuredScriptPath) {
    execFileSync("python3", ["build.py"], {
      cwd: projectRoot,
      stdio: "inherit",
    });
  }
  const scriptPath = configuredScriptPath
    ? path.resolve(configuredScriptPath)
    : defaultScriptPath;
  const script = fs.readFileSync(scriptPath, "utf8");
  const browser = await webkit.launch({ headless: true });

  try {
    const context = await browser.newContext({
      userAgent: iosUserAgent,
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    await page.route("https://chushoks.kakomonn.com/**", (route) =>
      route.fulfill({
        contentType: "text/html; charset=utf-8",
        body:
          "<!doctype html><html><head>" +
          '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">' +
          "</head><body></body></html>",
      }),
    );
    await page.goto(currentQuestionURL);
    await page.evaluate(() => {
      Object.defineProperty(window, "Audio", {
        configurable: true,
        value: undefined,
      });
    });
    await installSyncMock(page, { userscriptsPromise: true });
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
      () =>
        document.querySelector("#kakomonn-reader-count")?.textContent ===
        "0問,次は50問",
    );

    const nextButton = page.locator("#kakomonn-reader-next");
    assert.equal(await nextButton.innerText(), "次の問題へ");
    assert.equal(await nextButton.isDisabled(), true);

    await childFrame.evaluate(() => {
      document
        .querySelector("#js-answer-result-box")
        .classList.add("is-correct");
      document.querySelector("#explanation-lock").hidden = true;
      document.querySelector("#explanation").hidden = false;
    });
    await page.waitForFunction(
      () => document.querySelector("#kakomonn-reader-next")?.disabled === false,
    );

    const hitTest = await nextButton.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const target = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      return {
        buttonRect: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        },
        targetTag: target?.tagName ?? null,
        targetId: target?.id ?? null,
        targetOuterHTML: target?.outerHTML ?? null,
      };
    });
    assert.equal(hitTest.targetId, "kakomonn-reader-next", hitTest);
    await page.evaluate(() => {
      window.__nextButtonInputEvents = [];
      for (const eventName of ["pointerup", "click"]) {
        document.addEventListener(
          eventName,
          (event) => {
            window.__nextButtonInputEvents.push({
              type: event.type,
              targetId: event.target?.id || null,
              targetTag: event.target?.tagName || null,
              isTrusted: event.isTrusted,
              pointerType: event.pointerType || null,
            });
          },
          true,
        );
      }
    });
    await page.touchscreen.tap(
      hitTest.buttonRect.left + hitTest.buttonRect.width / 2,
      hitTest.buttonRect.top + hitTest.buttonRect.height / 2,
    );
    await page.waitForTimeout(250);
    const inputEvents = await page.evaluate(
      () => window.__nextButtonInputEvents,
    );
    assert.ok(
      inputEvents.some(
        (event) =>
          event.type === "click" &&
          event.targetId === "kakomonn-reader-next" &&
          event.isTrusted === true,
      ),
      JSON.stringify({ hitTest, inputEvents }),
    );
    await childFrame.waitForURL(nextQuestionURL);
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-count")?.textContent ===
        "1問,次は50問",
    );
    assert.equal(
      await page.evaluate(
        () =>
          window.__syncMock.calls.filter(
            (call) =>
              call.method === "POST" &&
              new URL(call.url).pathname === "/v2/answers",
          ).length,
      ),
      1,
    );
    assert.deepEqual(pageErrors, []);
    await context.close();
  } finally {
    await browser.close();
  }

  console.log("kakomonn WebKit mobile smoke test passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
