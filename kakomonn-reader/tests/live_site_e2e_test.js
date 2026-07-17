const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { installSyncMock } = require("./sync_mock");

const projectRoot = path.resolve(__dirname, "..");
const scriptPath = path.join(projectRoot, "kakomonn-reader.user.js");
const questionUrl = "https://chushoks.kakomonn.com/questions/86956";

async function getQuestionFrame(page) {
  await page.locator("#kakomonn-reader-frame").waitFor({ state: "attached" });
  const frame = page.locator("#kakomonn-reader-frame").contentFrame();
  await frame.locator("body").waitFor({ state: "visible" });
  await frame.getByText("解答する", { exact: true }).waitFor({ state: "visible" });
  return frame;
}

async function waitForReaderReady(page) {
  await page.waitForFunction(
    () =>
      document.querySelector("#kakomonn-reader-status")?.textContent ===
      "読み上げ非対応",
    null,
    { timeout: 15_000 },
  );
}

async function submitAnswer(frame, answerText) {
  const normalize = (value) => value.replace(/\s+/g, "").trim();
  const choiceTexts = await frame
    .locator(".problem_detail ul.list > li")
    .allInnerTexts();
  const choiceIndex = choiceTexts.findIndex(
    (choiceText) => normalize(choiceText) === normalize(answerText),
  );
  assert.notEqual(choiceIndex, -1, `answer choice was not found: ${answerText}`);

  const answerInputs = frame.locator(
    ".problem_detail ul.check input[name='intAnswerData']",
  );
  assert.equal(await answerInputs.count(), choiceTexts.length);

  const answerInput = answerInputs.nth(choiceIndex);
  await frame
    .locator(".problem_detail ul.check > li > label")
    .nth(choiceIndex)
    .click({ force: true });
  assert.equal(await answerInput.isChecked(), true);
  await frame.locator("#send_exam_btn").click({ force: true });

  console.log(
    JSON.stringify({
      phase: "selection",
      answerText,
      choiceIndex,
      answerValue: await answerInput.getAttribute("value"),
    }),
  );
}

async function clickNextQuestion(frame) {
  const clickedControl = await frame.locator("body").evaluate((body) => {
    const view = body.ownerDocument.defaultView;
    const isVisible = (element) => {
      const style = view.getComputedStyle(element);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        element.getClientRects().length > 0
      );
    };
    const normalize = (value) => value.replace(/\s+/g, "").trim();
    const nextQuestionControl = [
      ...body.querySelectorAll(
        "a, button, input[type='button'], input[type='submit']",
      ),
    ]
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

    if (nextQuestionControl === undefined) {
      return null;
    }

    const descriptor = {
      tag: nextQuestionControl.tagName,
      id: nextQuestionControl.id,
      className: nextQuestionControl.className,
      label: normalize(nextQuestionControl.innerText),
    };
    nextQuestionControl.click();
    return descriptor;
  });
  assert.notEqual(clickedControl, null, "visible next-question control was not found");
  console.log(JSON.stringify({ phase: "next-control", clickedControl }));
}

async function readStoredCount(page) {
  return page.evaluate(() => window.__syncMock?.count ?? null);
}

async function blockThirdPartyAds(context) {
  await context.route("**/*", async (route) => {
    const hostname = new URL(route.request().url()).hostname;
    const isAdRequest =
      hostname.endsWith(".googlesyndication.com") ||
      hostname.endsWith(".doubleclick.net") ||
      hostname === "anymind360.com" ||
      hostname.endsWith(".anymind360.com");

    if (isAdRequest) {
      await route.abort();
      return;
    }

    await route.continue();
  });
}

async function runCase(browser, script, { answerText, expectedBanner, expectedCount }) {
  const context = await browser.newContext();
  await blockThirdPartyAds(context);
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
    await installSyncMock(page);
    await page.evaluate((source) => {
      (0, eval)(source);
    }, script);

    console.log(JSON.stringify({ phase: "script-injected", answerText }));
    const frame = await getQuestionFrame(page);
    await page.locator("#kakomonn-reader-count").waitFor({ state: "visible" });
    await waitForReaderReady(page);
    assert.equal(
      await page.locator("#kakomonn-reader-count").innerText(),
      "0問,次は50問",
    );

    await submitAnswer(frame, answerText);
    console.log(JSON.stringify({ phase: "answer-submitted", answerText }));
    await frame.getByText(expectedBanner, { exact: true }).waitFor({
      state: "visible",
      timeout: 15_000,
    });
    const expectedResultClass = expectedCount === 1 ? "is-correct" : "is-wrong";
    const resultClasses =
      (await frame.locator("#js-answer-result-box").getAttribute("class")) ?? "";
    assert.equal(resultClasses.split(/\s+/).includes(expectedResultClass), true);

    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-next")?.disabled === false,
      null,
      { timeout: 15_000 },
    );

    await clickNextQuestion(frame);
    console.log(JSON.stringify({ phase: "next-clicked", answerText }));

    if (expectedCount === 1) {
      await page.waitForFunction(
        () =>
          document.querySelector("#kakomonn-reader-count")?.textContent ===
          "1問,次は50問",
        null,
        { timeout: 10_000 },
      );
    } else {
      await page.waitForTimeout(1_500);
      assert.equal(
        await page.locator("#kakomonn-reader-count").innerText(),
        "0問,次は50問",
      );
    }

    assert.equal(await readStoredCount(page), expectedCount);
    assert.deepEqual(pageErrors, []);
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
        statusText: await page.locator("#kakomonn-reader-status").textContent().catch(() => null),
        storedCount: await readStoredCount(page).catch(() => null),
        syncCalls: await page.evaluate(() => window.__syncMock?.calls ?? []).catch(() => []),
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
