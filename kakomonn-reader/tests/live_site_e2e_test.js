const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { installSyncMock } = require("./sync_mock");

const projectRoot = path.resolve(__dirname, "..");
const scriptPath = path.join(projectRoot, "kakomonn-reader.user.js");
const fixedQuestionUrl = "https://chushoks.kakomonn.com/questions/86956";
const fixedNextQuestionUrl = "https://chushoks.kakomonn.com/questions/86957";
const imageChoiceQuestionUrl =
  "https://chushoks.kakomonn.com/questions/73379";
const markdownQuestionUrl = "https://chushoks.kakomonn.com/questions/54914";
const reportedCopyQuestionUrl =
  "https://chushoks.kakomonn.com/questions/73497";
const markdownQuestionHeading =
  "中小企業診断士試験 令和2年度（2020年） 問19（経済学・経済政策 問19）";
const markdownQuestionText =
  "農業保護を目的とした農家への補助金政策の効果を考える。下図において、Dは農産物の需要曲線、Sは補助金交付前の農産物の供給曲線、S’は補助金交付後の農産物の供給曲線である。政府は、農産物1単位当たりEFまたはHGの補助金を交付する。この図に関する記述として、最も適切なものの組み合わせを下記の解答群から選べ。 a 政府が交付した補助金は四角形ACFEである。 b 補助金の交付によって、消費者の余剰は四角形ABGEだけ増加する。 c 補助金の交付によって、総余剰は三角形EFGだけ増加する。 d 補助金の交付によって、農家の余剰は四角形BCFGだけ増加する。";
const markdownExplanationPrefixes = [
  "ミクロ経済学における余剰分析が政府の介入",
  "補助金政策の効果を踏まえた余剰分析です",
  "余剰分析問題です",
];
const markdownQuestionImageURLs = [
  "https://s3.ap-northeast-1.amazonaws.com/img.kakomonn.com/images/question/chushoks/2020/A17.jpg",
];
const markdownExplanationImageURLs = [
  "https://s3.ap-northeast-1.amazonaws.com/img.kakomonn.com/images/cl/expound/chushoks/44914/gP0GXvEGxcXBlXqlyfyR_403736.webp",
  "https://s3.ap-northeast-1.amazonaws.com/img.kakomonn.com/images/cl/expound/chushoks/44914/TOoIgrKbHDVDGDV30wx8_403736.webp",
  "https://s3.ap-northeast-1.amazonaws.com/img.kakomonn.com/images/cl/expound/chushoks/44914/vp82EPWKAlXtoun1ZLsK_403736.webp",
];
const createQuestionUrl = "https://chushoks.kakomonn.com/createques";
const randomQuestionUrl = "https://chushoks.kakomonn.com/questions";
const readerReadyTimeout = 30_000;
const darkModeImageFilter = "invert(1) hue-rotate(180deg)";

async function getQuestionFrame(page) {
  await page.locator("#kakomonn-reader-frame").waitFor({ state: "attached" });
  const frame = page.locator("#kakomonn-reader-frame").contentFrame();
  await frame.locator("body").waitFor({ state: "visible" });
  await frame.getByText("解答する", { exact: true }).waitFor({ state: "visible" });
  await frame.locator("#kakomonn-reader-dark-mode").waitFor({
    state: "attached",
    timeout: readerReadyTimeout,
  });
  return frame;
}

async function darkModeImageFilters(locator) {
  return locator.evaluateAll((elements) =>
    elements.map((element) => getComputedStyle(element).filter),
  );
}

async function waitForSyncReady(page) {
  await page.waitForFunction(
    () => {
      const status = document.querySelector(
        "#kakomonn-reader-status",
      )?.textContent;
      return status === "待機中" || status === "読み上げ非対応";
    },
    null,
    { timeout: readerReadyTimeout },
  );
}

async function submitAnswer(page, frame, answerText, inputMethod = "click") {
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
  if (inputMethod === "keyboard") {
    const displayedChoice = frame
      .locator(".problem_detail > ul.list > li")
      .first();
    await answerInputs.first().focus();
    await page.keyboard.press("q");
    assert.equal(
      await displayedChoice.evaluate((choice) =>
        choice.classList.contains("is-active"),
      ),
      true,
    );
    await page.keyboard.press("q");
    assert.equal(
      await displayedChoice.evaluate((choice) =>
        choice.classList.contains("is-active"),
      ),
      false,
    );

    assert.equal(
      await frame.locator("body").evaluate(() =>
        document.scrollingElement.scrollHeight > window.innerHeight + 100),
      true,
    );
    await frame.locator("body").evaluate(() => window.scrollTo(0, 0));
    await page.keyboard.press("j");
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-frame")?.contentWindow
          .scrollY === 100,
    );
    await page.keyboard.press("k");
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-frame")?.contentWindow
          .scrollY === 0,
    );

    await page.locator("#kakomonn-reader-sync-settings-button").focus();
    await page.keyboard.press(choiceIndex === 9 ? "0" : String(choiceIndex + 1));
  } else {
    assert.equal(inputMethod, "click");
    await frame
      .locator(".problem_detail ul.check > li > label")
      .nth(choiceIndex)
      .click();
  }
  assert.equal(await answerInput.isChecked(), true);
  if (inputMethod === "keyboard") {
    await page.keyboard.press("Space");
  } else {
    await frame.locator("#send_exam_btn").click();
  }

  console.log(
    JSON.stringify({
      phase: "selection",
      answerText,
      choiceIndex,
      answerValue: await answerInput.getAttribute("value"),
    }),
  );
}

async function clickNextQuestion(page, frame, expectedNextUrl) {
  const initialFrameUrl = await frame
    .locator("body")
    .evaluate(() => location.href);
  assert.equal(
    await frame
      .getByRole("button", { name: "次の問題へ", exact: true })
      .innerText(),
    "次の問題へ",
  );

  await page.locator("#kakomonn-reader-next").click();
  await page.waitForFunction(
    (expectedUrl) =>
      location.href === expectedUrl &&
      document.querySelector("#kakomonn-reader-frame")?.contentWindow.location
        .href === expectedUrl,
    expectedNextUrl,
  );
  const nextFrameUrl = await frame
    .locator("body")
    .evaluate(() => location.href);
  assert.equal(nextFrameUrl, expectedNextUrl);
  assert.notEqual(nextFrameUrl, initialFrameUrl);
  console.log(
    JSON.stringify({
      phase: "next-navigation",
      initialFrameUrl,
      nextFrameUrl,
    }),
  );
}

async function readStoredCount(page) {
  return page.evaluate(() => window.__syncMock?.count ?? null);
}

async function readStoredAnsweredCount(page) {
  return page.evaluate(() => window.__syncMock?.answeredCount ?? null);
}

function normalizeContent(value) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function compactCopiedContent(markdown) {
  return markdown
    .replace(/^!\[[^\]]*]\([^)]+\)$/gm, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/\\([*_`\[\]#>+-])/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/<\/?(?:sup|sub)>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, "");
}

async function blockThirdPartyAds(context) {
  await context.route("**/*", async (route) => {
    const hostname = new URL(route.request().url()).hostname;
    const isAdRequest =
      hostname.endsWith(".googlesyndication.com") ||
      hostname.endsWith(".doubleclick.net") ||
      hostname === "googletagmanager.com" ||
      hostname.endsWith(".googletagmanager.com") ||
      hostname === "anymind360.com" ||
      hostname.endsWith(".anymind360.com") ||
      hostname === "geniee.jp" ||
      hostname.endsWith(".geniee.jp");

    if (isAdRequest) {
      await route.abort();
      return;
    }

    await route.continue();
  });
}

async function runCase(
  browser,
  script,
  { answerText, expectedBanner, expectedCount, inputMethod = "click" },
) {
  const context = await browser.newContext();
  await blockThirdPartyAds(context);
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  try {
    console.log(JSON.stringify({ phase: "goto", answerText }));
    const response = await page.goto(fixedQuestionUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    assert.notEqual(response, null);
    assert.equal(
      response.ok(),
      true,
      `live page returned HTTP ${response.status()}`,
    );
    await page.getByText("解答する", { exact: true }).waitFor({ state: "visible" });

    await page.evaluate(() => localStorage.clear());
    await installSyncMock(page);
    await page.evaluate((source) => {
      (0, eval)(source);
    }, script);

    console.log(JSON.stringify({ phase: "script-injected", answerText }));
    const frame = await getQuestionFrame(page);
    await page.locator("#kakomonn-reader-count").waitFor({ state: "visible" });
    await waitForSyncReady(page);
    assert.equal(
      await page.locator("#kakomonn-reader-count").innerText(),
      "0問,次は50問",
    );
    assert.deepEqual(
      await frame.locator("body").evaluate((body) => {
        const documentNode = body.ownerDocument;
        return {
          bodyBackground: getComputedStyle(body).backgroundColor,
          bodyColor: getComputedStyle(body).color,
          problemBackground: getComputedStyle(
            documentNode.querySelector(".problem_detail")
          ).backgroundColor,
          styleCount: documentNode.querySelectorAll(
            "#kakomonn-reader-dark-mode"
          ).length,
          toggleCount: documentNode.querySelectorAll(
            "[data-kakomonn-reader-dark-toggle]"
          ).length,
        };
      }),
      {
        bodyBackground: "rgb(11, 13, 16)",
        bodyColor: "rgb(243, 244, 246)",
        problemBackground: "rgb(21, 25, 30)",
        styleCount: 1,
        toggleCount: 0,
      },
    );

    await submitAnswer(page, frame, answerText, inputMethod);
    console.log(JSON.stringify({ phase: "answer-submitted", answerText }));
    await frame.getByText(expectedBanner, { exact: true }).waitFor({
      state: "visible",
      timeout: 15_000,
    });
    const expectedResultClass = expectedCount === 1 ? "is-correct" : "is-wrong";
    const resultClasses =
      (await frame.locator("#js-answer-result-box").getAttribute("class")) ?? "";
    assert.equal(resultClasses.split(/\s+/).includes(expectedResultClass), true);
    const semanticResultColor = await frame
      .locator("#js-answer-result-box")
      .evaluate((element, resultClass) => {
        const style = getComputedStyle(element, "::before");
        return resultClass === "is-correct"
          ? style.borderTopColor
          : style.backgroundColor;
      }, expectedResultClass);
    assert.equal(
      semanticResultColor,
      expectedResultClass === "is-correct"
        ? "rgb(82, 225, 182)"
        : "rgb(232, 146, 146)",
    );

    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-next")?.disabled === false,
      null,
      { timeout: 15_000 },
    );

    await clickNextQuestion(page, frame, fixedNextQuestionUrl);
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

async function runRandomNavigationCase(browser, script) {
  const context = await browser.newContext();
  await blockThirdPartyAds(context);
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  try {
    console.log(JSON.stringify({ phase: "random-goto" }));
    const response = await page.goto(createQuestionUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    assert.notEqual(response, null);
    assert.equal(
      response.ok(),
      true,
      `live page returned HTTP ${response.status()}`,
    );
    const createQuestionForm = page.locator("#new_create_ques_form");
    await createQuestionForm.waitFor({ state: "visible" });
    assert.equal(
      await createQuestionForm
        .locator('input[name="aryCreateCategory[]"]')
        .first()
        .evaluate((input) => {
          input.checked = true;
          input.dispatchEvent(new Event("change", { bubbles: true }));
          return input.checked;
        }),
      true,
    );
    assert.equal(
      await createQuestionForm.locator("#box-random").evaluate((input) => {
        input.checked = true;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return input.checked;
      }),
      true,
    );
    await createQuestionForm
      .locator('input[name="maxCreateNumber"]')
      .fill("2");
    await Promise.all([
      page.waitForURL(randomQuestionUrl, { timeout: 30_000 }),
      createQuestionForm.locator("a.question_all").click(),
    ]);
    await page
      .getByText("解答する", { exact: true })
      .waitFor({ state: "visible" });

    await page.evaluate(() => localStorage.clear());
    await installSyncMock(page);
    await page.evaluate((source) => {
      (0, eval)(source);
    }, script);

    const frame = await getQuestionFrame(page);
    await page.locator("#kakomonn-reader-count").waitFor({ state: "visible" });
    await waitForSyncReady(page);

    const initialQuestion = (
      await frame.locator(".problem_detail .when").innerText()
    ).replace(/\s+/g, " ").trim();
    const firstAnswer = await frame
      .locator(".problem_detail ul.list > li")
      .first()
      .innerText();
    await submitAnswer(page, frame, firstAnswer);
    await frame
      .locator(
        "#js-answer-result-box.is-correct, #js-answer-result-box.is-wrong",
      )
      .waitFor({ state: "visible", timeout: 15_000 });

    const resultClasses = (
      (await frame.locator("#js-answer-result-box").getAttribute("class")) ?? ""
    ).split(/\s+/);
    const isCorrect = resultClasses.includes("is-correct");
    assert.notEqual(isCorrect, resultClasses.includes("is-wrong"));

    const nextQuestionUrls = await frame.locator("a[href]").evaluateAll(
      (links) =>
        links
          .filter(
            (link) =>
              (link.innerText || link.textContent || "")
                .replace(/\s+/g, "")
                .trim() === "次の問題へ",
          )
          .map((link) => link.href),
    );
    assert.equal(nextQuestionUrls.length, 1);
    const [nextQuestionUrl] = nextQuestionUrls;
    assert.match(
      new URL(nextQuestionUrl).pathname,
      /^\/questions\/next\/\d+$/,
    );

    await page.waitForFunction(
      () => document.querySelector("#kakomonn-reader-next")?.disabled === false,
      null,
      { timeout: 15_000 },
    );
    await clickNextQuestion(page, frame, nextQuestionUrl);

    await page.waitForFunction(
      (previousQuestion) => {
        const question = document
          .querySelector("#kakomonn-reader-frame")
          ?.contentDocument?.querySelector(".problem_detail .when")
          ?.textContent?.replace(/\s+/g, " ")
          .trim();
        return Boolean(question && question !== previousQuestion);
      },
      initialQuestion,
      { timeout: 30_000 },
    );
    const nextQuestion = (
      await frame.locator(".problem_detail .when").innerText()
    ).replace(/\s+/g, " ").trim();
    assert.notEqual(nextQuestion, initialQuestion);

    await page.waitForFunction(
      () => window.__syncMock?.answeredCount === 1,
      null,
      { timeout: 10_000 },
    );
    assert.equal(await readStoredAnsweredCount(page), 1);
    assert.equal(await readStoredCount(page), isCorrect ? 1 : 0);
    assert.deepEqual(pageErrors, []);
    console.log(
      JSON.stringify({
        phase: "random-navigation",
        initialQuestion,
        nextQuestion,
        nextQuestionUrl,
        isCorrect,
        status: "passed",
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        phase: "random-failed",
        pageUrl: page.url(),
        countText: await page
          .locator("#kakomonn-reader-count")
          .textContent()
          .catch(() => null),
        statusText: await page
          .locator("#kakomonn-reader-status")
          .textContent()
          .catch(() => null),
        storedCount: await readStoredCount(page).catch(() => null),
        storedAnsweredCount: await readStoredAnsweredCount(page).catch(
          () => null,
        ),
        pageErrors,
      }),
    );
    throw error;
  } finally {
    await context.close();
  }
}

async function runMarkdownCopyCase(browser, script) {
  const context = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
  });
  await blockThirdPartyAds(context);
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  try {
    console.log(JSON.stringify({ phase: "markdown-copy-goto" }));
    const response = await page.goto(markdownQuestionUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    assert.notEqual(response, null);
    assert.equal(
      response.ok(),
      true,
      `live page returned HTTP ${response.status()}`,
    );
    await page
      .getByText("解答する", { exact: true })
      .waitFor({ state: "visible" });

    await page.evaluate(() => localStorage.clear());
    await installSyncMock(page, { systemClipboard: true });
    await page.evaluate((source) => {
      (0, eval)(source);
    }, script);

    const frame = await getQuestionFrame(page);
    await page.locator("#kakomonn-reader-count").waitFor({ state: "visible" });
    await waitForSyncReady(page);

    const heading = await frame
      .locator(".problem_detail > .when")
      .evaluate((element) =>
        Array.from(element.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.nodeValue || "")
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
      );
    assert.equal(heading, markdownQuestionHeading);
    const questionText = normalizeContent(
      await frame.locator(".problem_detail > .ttl").innerText(),
    );
    assert.equal(questionText, markdownQuestionText);

    const choices = await frame
      .locator(".problem_detail > ul.list > li")
      .allInnerTexts();
    assert.deepEqual(
      choices.map((choice) => choice.replace(/\s+/g, " ").trim()),
      ["a と b", "a と c", "b と c", "b と d"],
    );

    const questionImageURLs = await frame
      .locator(".problem_detail > .zoomin img[src]")
      .evaluateAll((images) => images.map((image) => image.src));
    assert.deepEqual(questionImageURLs, markdownQuestionImageURLs);
    assert.deepEqual(
      await darkModeImageFilters(
        frame.locator(".problem_detail > .zoomin img[src]"),
      ),
      markdownQuestionImageURLs.map(() => darkModeImageFilter),
    );

    await submitAnswer(page, frame, "b と d");
    await frame.getByText("正解！素晴らしいです", { exact: true }).waitFor({
      state: "visible",
      timeout: 15_000,
    });
    const explanationTexts = frame.locator(
      "#js-commentary-wrap > .item > .text",
    );
    await explanationTexts.last().waitFor({
      state: "visible",
      timeout: 15_000,
    });
    assert.equal(await explanationTexts.count(), 3);
    const explanationNumbers = await frame
      .locator("#js-commentary-wrap > .item > .num")
      .allInnerTexts();
    assert.deepEqual(
      explanationNumbers.map((number) => number.trim()),
      ["01", "02", "03"],
    );
    const explanationContents = (
      await explanationTexts.allInnerTexts()
    ).map(normalizeContent);
    for (let index = 0; index < markdownExplanationPrefixes.length; index += 1) {
      assert.equal(
        explanationContents[index].startsWith(
          markdownExplanationPrefixes[index],
        ),
        true,
      );
    }

    const explanationImageURLs = await frame
      .locator("#js-commentary-wrap > .item .text img[src]")
      .evaluateAll((images) => images.map((image) => image.src));
    assert.deepEqual(
      explanationImageURLs,
      markdownExplanationImageURLs,
    );
    assert.deepEqual(
      await darkModeImageFilters(
        frame.locator("#js-commentary-wrap > .item .text img[src]"),
      ),
      markdownExplanationImageURLs.map(() => darkModeImageFilter),
    );

    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-copy")?.textContent ===
        "Markdownをコピー",
      null,
      { timeout: 15_000 },
    );
    const clipboardNonce = `kakomonn-copy-before-${Date.now()}`;
    await page.evaluate(
      (value) => navigator.clipboard.writeText(value),
      clipboardNonce,
    );
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      clipboardNonce,
    );
    await page.locator("#kakomonn-reader-copy").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-copy")?.textContent ===
        "コピー済み",
      null,
      { timeout: 15_000 },
    );
    const copiedMarkdown = (
      await page.evaluate(() => navigator.clipboard.readText())
    ).replace(/\r\n/g, "\n");
    assert.notEqual(copiedMarkdown, clipboardNonce);

    assert.equal(
      copiedMarkdown.startsWith(`# ${markdownQuestionHeading}\n\n`),
      true,
    );
    assert.equal(copiedMarkdown.includes("\n\n## 問題文\n\n"), true);
    assert.equal(copiedMarkdown.includes("\n\n### 選択肢\n\n"), true);
    assert.equal(
      copiedMarkdown.includes(
        "\n\n### 自分の回答\n\n選択肢4: b と d\n\n",
      ),
      true,
    );
    assert.equal(copiedMarkdown.includes("\n\n## 解説\n\n"), true);
    for (const choice of choices) {
      assert.equal(
        copiedMarkdown.includes(`- ${choice.replace(/\s+/g, " ").trim()}`),
        true,
      );
    }
    const compactMarkdown = compactCopiedContent(copiedMarkdown);
    assert.equal(
      compactMarkdown.includes(questionText.replace(/\s+/g, "")),
      true,
    );
    for (const explanationContent of explanationContents) {
      assert.equal(
        compactMarkdown.includes(
          explanationContent.replace(/\s+/g, ""),
        ),
        true,
      );
    }

    const expectedImageURLs = [
      ...markdownQuestionImageURLs,
      ...markdownExplanationImageURLs,
    ];
    const copiedImageURLs = Array.from(
      copiedMarkdown.matchAll(/!\[[^\]]*]\((https:\/\/[^)]+)\)/g),
      (match) => match[1],
    );
    assert.deepEqual(copiedImageURLs, expectedImageURLs);
    for (const imageURL of expectedImageURLs) {
      assert.equal(copiedMarkdown.split(imageURL).length - 1, 1);
    }

    assert.equal(copiedMarkdown.includes("訂正依頼・報告はこちら"), false);
    assert.equal(copiedMarkdown.includes("参考になった数"), false);
    assert.equal(copiedMarkdown.includes("Advertisement"), false);
    assert.deepEqual(pageErrors, []);
    console.log(
      JSON.stringify({
        phase: "markdown-copy",
        heading,
        questionImages: questionImageURLs.length,
        explanationImages: explanationImageURLs.length,
        status: "passed",
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        phase: "markdown-copy-failed",
        pageUrl: page.url(),
        copyButtonText: await page
          .locator("#kakomonn-reader-copy")
          .textContent()
          .catch(() => null),
        statusText: await page
          .locator("#kakomonn-reader-status")
          .textContent()
          .catch(() => null),
        pageErrors,
      }),
    );
    throw error;
  } finally {
    await context.close();
  }
}

async function runReportedCopyCase(browser, script) {
  const context = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
  });
  await blockThirdPartyAds(context);
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  try {
    const response = await page.goto(reportedCopyQuestionUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    assert.notEqual(response, null);
    assert.equal(
      response.ok(),
      true,
      `live page returned HTTP ${response.status()}`,
    );
    await page
      .getByText("解答する", { exact: true })
      .waitFor({ state: "visible" });

    await page.evaluate(() => localStorage.clear());
    await installSyncMock(page, { systemClipboard: true });
    await page.evaluate((source) => {
      (0, eval)(source);
    }, script);

    const frame = await getQuestionFrame(page);
    await waitForSyncReady(page);
    await submitAnswer(
      page,
      frame,
      "再生債務者に対して売買契約に基づき継続的給付の義務を負う双務契約の相手方は、再生手続開始決定の申立て前の給付に係る再生債権について、弁済がないことを理由として、再生手続開始後は、その義務の履行を拒むことができない。",
    );
    await frame.getByText("正解！素晴らしいです", { exact: true }).waitFor({
      state: "visible",
      timeout: 15_000,
    });
    const explanationTexts = frame.locator(
      "#js-commentary-wrap > .item > .text",
    );
    await explanationTexts.last().waitFor({
      state: "visible",
      timeout: 15_000,
    });
    assert.equal(await explanationTexts.count(), 2);

    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-copy")?.textContent ===
        "Markdownをコピー",
      null,
      { timeout: 15_000 },
    );
    await page.locator("#kakomonn-reader-copy").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-copy")?.textContent ===
        "コピー済み",
      null,
      { timeout: 15_000 },
    );
    const copiedMarkdown = await page.evaluate(() =>
      navigator.clipboard.readText(),
    );
    assert.equal(
      copiedMarkdown.startsWith(
        "# 中小企業診断士試験 令和5年度（2023年） 問145（経営法務 問10）",
      ),
      true,
    );
    assert.equal(copiedMarkdown.includes("### 解説 01"), true);
    assert.equal(copiedMarkdown.includes("### 解説 02"), true);
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
}

async function runImageChoiceInversionCase(browser, script) {
  const context = await browser.newContext();
  await blockThirdPartyAds(context);
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  try {
    const response = await page.goto(imageChoiceQuestionUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    assert.notEqual(response, null);
    assert.equal(
      response.ok(),
      true,
      `live page returned HTTP ${response.status()}`,
    );
    await page
      .getByText("解答する", { exact: true })
      .waitFor({ state: "visible" });

    await page.evaluate(() => localStorage.clear());
    await installSyncMock(page);
    await page.evaluate((source) => {
      (0, eval)(source);
    }, script);

    const frame = await getQuestionFrame(page);
    const choiceImages = frame.locator(
      ".problem_detail > ul.list > li img",
    );
    assert.equal(await choiceImages.count(), 4);
    assert.deepEqual(
      await darkModeImageFilters(choiceImages),
      Array(4).fill(darkModeImageFilter),
    );
    assert.deepEqual(pageErrors, []);
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
      inputMethod: "keyboard",
    });
    await runCase(browser, script, {
      answerText: "GDPは、フローとストックの混合概念である。",
      expectedBanner: "残念...",
      expectedCount: 0,
    });
    await runRandomNavigationCase(browser, script);
    await runImageChoiceInversionCase(browser, script);
    await runMarkdownCopyCase(browser, script);
    await runReportedCopyCase(browser, script);
  } finally {
    await browser.close();
  }

  console.log("live site e2e test passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
