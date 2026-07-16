const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const projectRoot = path.resolve(__dirname, "..");
const scriptPath = path.join(projectRoot, "kakomonn-reader.user.js");
const questionUrl = "https://chushoks.kakomonn.com/questions/86956";
const countKey = "kakomonn-reader.daily-count";

async function getQuestionFrame(page) {
  await page.locator("#kakomonn-reader-frame").waitFor({ state: "attached" });
  const frame = await page.locator("#kakomonn-reader-frame").contentFrame();
  if (frame === null) {
    throw new Error("question iframe was not available");
  }
  await frame.locator("body").waitFor({ state: "visible" });
  await frame.getByText("解答する", { exact: true }).waitFor({ state: "visible" });
  return frame;
}

async function clickAnswer(frame, answerNumber) {
  const radios = frame.locator('input[type="radio"]:visible');
  const radioCount = await radios.count();
  assert.equal(radioCount, 5, `expected 5 visible answer radios, got ${radioCount}`);
  await radios.nth(answerNumber - 1).check();
  await frame.getByText("解答する", { exact: true }).click();
}

async function readStoredCount(page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw).count;
  }, countKey);
}

async function runCase(browser, script, { answerNumber, expectedBanner, expectedCount }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  try {
    await page.goto(questionUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.evaluate(() => localStorage.clear());
    await page.evaluate(script);

    const frame = await getQuestionFrame(page);
    await page.locator("#kakomonn-reader-count").waitFor({ state: "visible" });
    assert.equal(await page.locator("#kakomonn-reader-count").innerText(), "0/50");

    await clickAnswer(frame, answerNumber);
    await frame.getByText(expectedBanner, { exact: true }).waitFor({ state: "visible" });

    const nextControl = frame.getByText(/次の問題(?:[（(]問\d+[）)])?へ/, { exact: true });
    await nextControl.waitFor({ state: "visible" });
    await nextControl.click();

    if (expectedCount === 1) {
      await page.waitForFunction(
        () => document.querySelector("#kakomonn-reader-count")?.textContent === "1/50",
        null,
        { timeout: 10_000 },
      );
    } else {
      await page.waitForTimeout(1_500);
      assert.equal(await page.locator("#kakomonn-reader-count").innerText(), "0/50");
    }

    assert.equal(await readStoredCount(page), expectedCount);
    assert.deepEqual(pageErrors, []);

    console.log(JSON.stringify({ answerNumber, expectedBanner, expectedCount, status: "passed" }));
  } finally {
    await context.close();
  }
}

async function main() {
  const script = fs.readFileSync(scriptPath, "utf8");
  const browser = await chromium.launch({ headless: true });
  try {
    await runCase(browser, script, {
      answerNumber: 5,
      expectedBanner: "正解！素晴らしいです",
      expectedCount: 1,
    });
    await runCase(browser, script, {
      answerNumber: 1,
      expectedBanner: "残念...",
      expectedCount: 0,
    });
  } finally {
    await browser.close();
  }

  console.log("live site e2e test passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
