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
  <p>これは動作確認用の解説です.</p>
  <a href="#report">（訂正依頼・報告はこちら）</a>
  <button id="next" type="button">次の問題へ</button>
`;

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
    });
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
      () => document.querySelector("#kakomonn-reader-next").disabled === false,
    );

    await childFrame.locator("#next").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-count").textContent ===
        "1/100",
    );

    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }

  console.log("smoke test passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
