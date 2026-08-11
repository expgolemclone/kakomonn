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
    });
    await installSyncMock(page, {
      nextQuestionId: "86957",
      userscriptsPromise: true,
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
      () =>
        document.querySelector("#kakomonn-reader-count")?.textContent ===
        "定着 0問",
    );
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
        styleCount: 1,
        toggleCount: 0,
      },
    );

    const nextButton = page.locator("#kakomonn-reader-next");
    const copyButton = page.locator("#kakomonn-reader-copy");
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-copy")?.textContent ===
        "回答後にコピー",
    );
    assert.equal(await nextButton.innerText(), "次の問題へ");
    assert.equal(await nextButton.isDisabled(), true);
    assert.equal(await copyButton.innerText(), "回答後にコピー");
    assert.equal(await copyButton.isDisabled(), true);
    assert.equal(await page.evaluate(() => window.__copiedTexts.length), 0);

    await childFrame.evaluate(() => {
      document
        .querySelector("#js-answer-result-box")
        .classList.add("is-correct");
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
      () => document.querySelector("#kakomonn-reader-next")?.disabled === false,
    );
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-copy")?.textContent ===
        "コピー対象を取得不可",
    );
    assert.equal(await copyButton.isDisabled(), true);
    await childFrame.evaluate(() => {
      document.querySelectorAll("input[name='answer']")[1].checked = true;
      document.querySelector("#js-answer-result-box").classList.add(
        "selected-answer-ready",
      );
    });
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-copy")?.textContent ===
          "Markdownをコピー",
    );
    await copyButton.tap();
    assert.equal(
      await page.evaluate(() => window.__copiedTexts[0]),
      expectedCopiedMarkdown,
    );
    assert.equal(
      (await page.evaluate(() => window.__copiedTexts[0])).split(
        "https://cdn.example.test/webkit-explanation-1.png"
      ).length - 1,
      1,
    );
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-copy")?.textContent ===
        "Markdownをコピー",
      null,
      { timeout: 5_000 },
    );
    await childFrame.evaluate(() => {
      const inputs = document.querySelectorAll("input[name='answer']");
      inputs[0].type = "checkbox";
      inputs[0].checked = true;
      document.querySelector("#js-answer-result-box").classList.add(
        "multiple-answers-selected",
      );
    });
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-copy")?.textContent ===
        "コピー対象を取得不可",
    );
    assert.equal(await copyButton.isDisabled(), true);
    await childFrame.evaluate(() => {
      const inputs = document.querySelectorAll("input[name='answer']");
      inputs[0].type = "radio";
      inputs[0].checked = false;
      inputs[1].checked = true;
      document.querySelector("#js-answer-result-box").classList.add(
        "single-answer-restored",
      );
    });
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-copy")?.textContent ===
        "Markdownをコピー",
    );
    await childFrame.evaluate(() => {
      document.querySelector(".problem_detail > ul.check > li").remove();
    });
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-copy")?.textContent ===
        "コピー対象を取得不可",
    );
    assert.equal(await copyButton.isDisabled(), true);
    await childFrame.evaluate(() => {
      document.querySelector(".problem_detail > ul.check").insertAdjacentHTML(
        "afterbegin",
        '<li><label><input type="radio" name="answer">1</label></li>',
      );
    });
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-copy")?.textContent ===
        "Markdownをコピー",
      null,
      { timeout: 5_000 },
    );
    await page.evaluate(() => {
      window.__clipboardWriteFails = true;
    });
    await copyButton.tap();
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-status")?.textContent ===
        "クリップボードへコピーできません",
    );
    assert.equal(await page.evaluate(() => window.__copiedTexts.length), 1);
    await page.evaluate(() => {
      window.__clipboardWriteFails = false;
    });
    await childFrame.evaluate(() => {
      document.querySelector(".problem_detail > .ttl").remove();
    });
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-copy")?.textContent ===
        "コピー対象を取得不可",
    );
    assert.equal(await copyButton.isDisabled(), true);

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
    await page.evaluate(() => { window.__syncMock.nextMasteryDelta = 1; });
    await nextButton.tap({ force: true });
    await page.waitForTimeout(250);
    const inputEvents = await page.evaluate(
      () => window.__nextButtonInputEvents,
    );
    assert.ok(
      inputEvents.some(
        (event) =>
          event.type === "pointerup" &&
          event.targetId === "kakomonn-reader-next" &&
          event.isTrusted === true &&
          event.pointerType === "touch",
      ),
      JSON.stringify({ hitTest, inputEvents }),
    );
    await childFrame.waitForURL(nextQuestionURL);
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-count")?.textContent ===
        "定着 1問",
    );
    assert.equal(
      await page.evaluate(
        () =>
          window.__syncMock.calls.filter(
            (call) =>
              call.method === "POST" &&
              new URL(call.url).pathname === "/v4/attempts",
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
