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
  const frame = page.locator("#kakomonn-reader-frame").contentFrame();
  await frame.locator("body").waitFor({ state: "visible" });
  await frame.getByText("解答する", { exact: true }).waitFor({ state: "visible" });
  return frame;
}

async function submitAnswer(frame, answerText) {
  const selection = await frame.locator("body").evaluate((body, text) => {
    const isVisible = (element) => {
      const style = element.ownerDocument.defaultView.getComputedStyle(element);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        element.getClientRects().length > 0
      );
    };
    const normalize = (value) => value.replace(/\s+/g, "").trim();
    const radios = [...body.querySelectorAll('input[type="radio"]')].filter(isVisible);
    const radio = radios.find((candidate) => {
      const label = candidate.closest("label");
      return label !== null && normalize(label.innerText).includes(normalize(text));
    });
    if (radio === undefined) {
      return {
        selected: false,
        visibleRadioLabels: radios.map((candidate) =>
          normalize(candidate.closest("label")?.innerText ?? ""),
        ),
      };
    }
    radio.click();

    const answerControl = [...body.querySelectorAll("a, button, input[type='button'], input[type='submit']")]
      .filter(isVisible)
      .find((control) =>
        normalize(
          control.innerText ||
            control.textContent ||
            control.value ||
            control.getAttribute("aria-label") ||
            "",
        ) === "解答する",
      );
    if (answerControl === undefined) {
      return { selected: true, submitted: false };
    }
    answerControl.click();
    return { selected: true, submitted: true };
  }, answerText);

  assert.equal(selection.selected, true, JSON.stringify(selection));
  assert.equal(selection.submitted, true, JSON.stringify(selection));
}

async function clickNextQuestion(frame) {
  const clicked = await frame.locator("body").evaluate((body) => {
    const isVisible = (element) => {
      const style = element.ownerDocument.defaultView.getComputedStyle(element);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        element.getClientRects().length > 0
      );
    };
    const normalize = (value) => value.replace(/\s+/g, "").trim();
    const control = [...body.querySelectorAll("a, button, input[type='button'], input[type='submit']")]
      .filter(isVisible)
      .find((candidate) => {
        const label = normalize(
          candidate.innerText ||
            candidate.textContent ||
            candidate.value ||
            candidate.getAttribute("aria-label") ||
            "",
        );
        return label === "次の問題へ" || /^次の問題[（(]問\d+[）)]へ$/.test(label);
      });
    if (control === undefined) {
      return false;
    }
    control.click();
    return true;
  });
  assert.equal(clicked, true, "visible next-question control was not found");
}

async function readStoredCount(page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw).count;
  }, countKey);
}

async function runCase(browser, script, { answerText, expectedBanner, expectedCount }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  try {
    console.log(JSON.stringify({ phase: "goto", answerText }));
    const response = await page.goto(questionUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    assert.notEqual(response, null);
    assert.equal(response.ok(), true, `live page returned HTTP ${response.status()}`);
    await page.getByText("解答する", { exact: true }).waitFor({ state: "visible" });

    await page.evaluate(() => localStorage.clear());
    await page.evaluate((source) => {
      (0, eval)(source);
    }, script);

    console.log(JSON.stringify({ phase: "script-injected", answerText }));
    const frame = await getQuestionFrame(page);
    await page.locator("#kakomonn-reader-count").waitFor({ state: "visible" });
    assert.equal(await page.locator("#kakomonn-reader-count").innerText(), "0/50");

    await submitAnswer(frame, answerText);
    console.log(JSON.stringify({ phase: "answer-submitted", answerText }));
    await frame.getByText(expectedBanner, { exact: true }).waitFor({
      state: "visible",
      timeout: 15_000,
    });

    await clickNextQuestion(frame);
    console.log(JSON.stringify({ phase: "next-clicked", answerText }));

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
    console.log(
      JSON.stringify({
        answerText,
        expectedBanner,
        expectedCount,
        pageErrors,
        status: "passed",
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        phase: "failed",
        answerText,
        pageUrl: page.url(),
        countText: await page.locator("#kakomonn-reader-count").textContent().catch(() => null),
        pageErrors,
      }),
    );
    throw error;
  } finally {
    await context.close();
  }
}

async function main() {
  const script = fs.readFileSync(scriptPath, "utf8");
  const browser = await chromium.launch({ headless: true });
  try {
    await runCase(browser, script, {
      answerText: "輸入の減少は、GDPを増加させる。",
      expectedBanner: "正解！素晴らしいです",
      expectedCount: 1,
    });
    await runCase(browser, script, {
      answerText: "GDPは、フローとストックの混合概念である。",
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
