const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const {
  kakomonnFreeEnvironment,
  readKakomonnConfiguration,
} = require("../../scripts/kakomonn-config.cjs");
const { installSyncMock } = require("./sync_mock");
const {
  assertMarkdownCopy,
  MARKDOWN_CHOICES,
  MARKDOWN_INCORRECT_ANSWER_SUMMARY,
  MARKDOWN_INCORRECT_ANSWER_TEXT,
  MARKDOWN_EXPLANATION_IMAGE_URLS: markdownExplanationImageURLs,
  MARKDOWN_EXPLANATION_PREFIXES: markdownExplanationPrefixes,
  MARKDOWN_QUESTION_HEADING: markdownQuestionHeading,
  MARKDOWN_QUESTION_IMAGE_URLS: markdownQuestionImageURLs,
  MARKDOWN_QUESTION_TEXT: markdownQuestionText,
  MARKDOWN_QUESTION_URL: markdownQuestionUrl,
  normalizeContent,
} = require("./support/markdown_copy_fixture");

const projectRoot = path.resolve(__dirname, "..");
const scriptPath = path.join(projectRoot, "kakomonn-reader.user.js");
const chromeUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/150.0.0.0 Safari/537.36";
const kakomonnConfiguration = readKakomonnConfiguration();
const fixedQuestionUrl = "https://chushoks.kakomonn.com/questions/86956";
const fixedNextQuestionUrl = "https://chushoks.kakomonn.com/questions/86957";
const randomScheduledQuestionUrl =
  "https://chushoks.kakomonn.com/questions/45125";
const crossDomainQuestionUrls = [
  "https://nurse.kakomonn.com/questions/84233",
  "https://ktjoho.kakomonn.com/questions/87404",
  "https://kyosai.kakomonn.com/questions/51358",
];
const imageChoiceQuestionUrl =
  "https://chushoks.kakomonn.com/questions/73379";
const reportedCopyQuestionUrl =
  "https://chushoks.kakomonn.com/questions/73497";
const createQuestionUrl = "https://chushoks.kakomonn.com/createques";
const randomQuestionUrl = "https://chushoks.kakomonn.com/questions";
const readerReadyTimeout = 30_000;
const darkModeImageFilter = "invert(1) hue-rotate(180deg)";
const answerShortcutKeys = "qwert";
const pageErrorLocationPrefix = "__KAKOMONN_PAGE_ERROR_LOCATION__";
const readerSourceURL = "kakomonn-reader.user.js";

function formatPageError(error) {
  return (
    error?.stack ||
    error?.message ||
    error?.name ||
    String(error) ||
    "Unknown page error"
  );
}

function collectPageErrors(page) {
  const pageErrors = [];
  const pageErrorLocations = [];
  page.on("pageerror", (error) => pageErrors.push(formatPageError(error)));
  page.on("console", (message) => {
    if (!message.text().startsWith(pageErrorLocationPrefix)) {
      return;
    }
    pageErrorLocations.push(
      JSON.parse(message.text().slice(pageErrorLocationPrefix.length)),
    );
  });
  return { pageErrorLocations, pageErrors };
}

function assertNoReaderPageErrors(pageErrors, pageErrorLocations, details = {}) {
  const readerPageErrors = pageErrorLocations.filter(
    ({ filename }) =>
      filename === readerSourceURL || filename.endsWith(`/${readerSourceURL}`),
  );
  const unlocatedPageErrors = pageErrors.filter(
    (pageError) =>
      !pageErrorLocations.some(
        ({ message }) =>
          pageError.includes(message) || message.includes(pageError),
      ),
  );
  assert.deepEqual(
    { readerPageErrors, unlocatedPageErrors },
    { readerPageErrors: [], unlocatedPageErrors: [] },
    JSON.stringify({ ...details, pageErrorLocations }),
  );
}

function collectSameOriginPaths(html, pageURL, pattern, allowSearch = false) {
  const pageOrigin = new URL(pageURL).origin;
  const paths = new Set();
  for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const url = new URL(match[1], pageURL);
    if (
      url.origin === pageOrigin &&
      (allowSearch || url.search === "") &&
      url.hash === "" &&
      pattern.test(url.pathname)
    ) {
      paths.add(url.pathname);
    }
  }
  return paths;
}

async function injectReader(page, script) {
  await page.evaluate(
    ({ source, sourceURL }) => {
      Object.defineProperty(window, "Audio", {
        configurable: true,
        value: undefined,
      });
      (0, eval)(`${source}\n//# sourceURL=${sourceURL}`);
    },
    { source: script, sourceURL: readerSourceURL },
  );
}

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
    () =>
      window.__syncMock?.calls.some(
        (call) => new URL(call.url).pathname === "/v9/state",
      ) === true,
    null,
    { timeout: readerReadyTimeout },
  );
  await page.waitForTimeout(1_500);
  await dismissReaderErrorForTest(page);
}

async function dismissReaderErrorForTest(page) {
  await page.locator("#kakomonn-reader-error-dialog").evaluate((dialog) => {
    if (dialog.open) dialog.close();
  });
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
    assert.equal(
      choiceIndex < answerShortcutKeys.length,
      true,
      `keyboard shortcut is unavailable for choice ${choiceIndex + 1}`,
    );
    const displayedChoice = frame
      .locator(".problem_detail > ul.list > li")
      .first();
    await answerInputs.first().focus();
    await page.keyboard.press("a");
    assert.equal(
      await displayedChoice.evaluate((choice) =>
        choice.classList.contains("is-active"),
      ),
      true,
    );
    await page.keyboard.press("a");
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
    await page.keyboard.press("z");
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-frame")?.contentWindow
          .scrollY === 100,
    );
    await page.keyboard.press("x");
    await page.waitForFunction(
      () =>
        document.querySelector("#kakomonn-reader-frame")?.contentWindow
          .scrollY === 0,
    );

    await page.locator("#kakomonn-reader-frame").focus();
    await page.keyboard.press(answerShortcutKeys[choiceIndex]);
  } else {
    assert.equal(inputMethod, "click");
    await frame
      .locator(".problem_detail ul.check > li > label")
      .nth(choiceIndex)
      .click();
  }
  assert.equal(await answerInput.isChecked(), true);
  if (inputMethod === "keyboard") {
    await page.keyboard.press("Enter");
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

  await dismissReaderErrorForTest(page);
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

async function readStoredStabilityDays(page) {
  return page.evaluate(() => window.__syncMock?.stabilityDays ?? null);
}

async function readStoredAttemptCount(page) {
  return page.evaluate(() => window.__syncMock?.attemptCount ?? null);
}

async function blockThirdPartyAds(context) {
  await context.addInitScript((prefix) => {
    window.addEventListener("error", (event) => {
      console.debug(
        `${prefix}${JSON.stringify({
          column: event.colno,
          filename: event.filename,
          line: event.lineno,
          message: event.message,
        })}`,
      );
    });
  }, pageErrorLocationPrefix);
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

async function runLiveCatalogCrawlCase(browser, script) {
  const context = await browser.newContext({ userAgent: chromeUserAgent });
  await blockThirdPartyAds(context);
  const page = await context.newPage();
  const { pageErrorLocations, pageErrors } = collectPageErrors(page);
  const catalogPageTasks = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.hostname !== "chushoks.kakomonn.com" || !/^\/list1\/\d+$/.test(url.pathname)) {
      return;
    }
    const requestedPage = Number(url.searchParams.get("page"));
    if (!Number.isSafeInteger(requestedPage) || requestedPage < 1) {
      return;
    }
    catalogPageTasks.push(
      response.text().then((html) => {
        const marker = html.match(/全(\d+)ページ中(\d+)ページ目です[。.]/);
        assert.notEqual(marker, null, `catalog page marker missing: ${url.href}`);
        return {
          listPath: url.pathname,
          requestedPage,
          totalPages: Number(marker[1]),
          currentPage: Number(marker[2]),
          questionIds: [...collectSameOriginPaths(
            html,
            url.href,
            /^\/questions\/\d+$/,
          )].map((questionPath) => questionPath.slice("/questions/".length)),
        };
      }),
    );
  });

  try {
    const createQuestionResponse = await context.request.get(createQuestionUrl);
    assert.equal(createQuestionResponse.ok(), true);
    const createQuestionHTML = await createQuestionResponse.text();
    const catalogIndexPaths = collectSameOriginPaths(
      createQuestionHTML,
      createQuestionUrl,
      /^\/list$/,
    );
    assert.deepEqual([...catalogIndexPaths], ["/list"]);
    const catalogIndexURL = new URL([...catalogIndexPaths][0], createQuestionUrl);
    const catalogIndexResponse = await context.request.get(catalogIndexURL.href);
    assert.equal(catalogIndexResponse.ok(), true);
    const expectedListPaths = collectSameOriginPaths(
      await catalogIndexResponse.text(),
      catalogIndexURL.href,
      /^\/list1\/\d+$/,
      true,
    );
    for (const listPath of collectSameOriginPaths(
      createQuestionHTML,
      createQuestionUrl,
      /^\/list1\/\d+$/,
      true,
    )) {
      expectedListPaths.add(listPath);
    }
    assert.equal(expectedListPaths.size > 0, true);

    const response = await page.goto(fixedQuestionUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    assert.notEqual(response, null);
    assert.equal(response.ok(), true, `live page returned HTTP ${response.status()}`);
    await page.getByText("解答する", { exact: true }).waitFor({
      state: "visible",
      timeout: readerReadyTimeout,
    });
    await page.evaluate(() => localStorage.clear());
    await installSyncMock(page, { catalogQuestionCount: null });
    await injectReader(page, script);

    await page.waitForFunction(
      () => window.__syncMock.calls.some((call) => new URL(call.url).pathname === "/v9/questions"),
      null,
      { timeout: 180_000 },
    );
    const catalogCall = await page.evaluate(() =>
      window.__syncMock.calls.find((call) => new URL(call.url).pathname === "/v9/questions"),
    );
    assert.equal(Array.isArray(catalogCall.body.questionIds), true);
    assert.equal(catalogCall.body.expectedGeneration, 0);

    const catalogPages = await Promise.all(catalogPageTasks);
    assert.equal(catalogPages.length > 0, true);
    const groups = new Map();
    for (const pageInfo of catalogPages) {
      assert.equal(pageInfo.currentPage, pageInfo.requestedPage);
      assert.equal(pageInfo.totalPages >= pageInfo.currentPage, true);
      assert.equal(pageInfo.questionIds.length > 0, true);
      const group = groups.get(pageInfo.listPath) ?? { totalPages: pageInfo.totalPages, pages: new Set() };
      assert.equal(group.totalPages, pageInfo.totalPages);
      group.pages.add(pageInfo.currentPage);
      groups.set(pageInfo.listPath, group);
    }
    assert.deepEqual(
      [...groups.keys()].sort(),
      [...expectedListPaths].sort(),
      "live catalog index and crawled lists differ",
    );
    for (const [listPath, group] of groups) {
      assert.deepEqual(
        [...group.pages].sort((left, right) => left - right),
        Array.from({ length: group.totalPages }, (_value, index) => index + 1),
        `incomplete live catalog crawl: ${listPath}`,
      );
    }
    const observedQuestionIds = [...new Set(
      catalogPages.flatMap(({ questionIds }) => questionIds),
    )].sort((left, right) => Number(left) - Number(right));
    assert.deepEqual(
      catalogCall.body.questionIds,
      observedQuestionIds,
      "live catalog pages and uploaded question IDs differ",
    );
    console.log(JSON.stringify({
      phase: "catalog-crawl",
      listCount: groups.size,
      questionCount: observedQuestionIds.length,
      status: "passed",
    }));
    assertNoReaderPageErrors(pageErrors, pageErrorLocations, {
      questionURL: fixedQuestionUrl,
    });
  } finally {
    await context.close();
  }
}

async function runCase(
  browser,
  script,
  {
    answerText,
    expectedBanner,
    expectedResultClass,
    attemptStabilityDaysDelta,
    inputMethod = "click",
  },
) {
  const context = await browser.newContext({ userAgent: chromeUserAgent });
  await blockThirdPartyAds(context);
  const page = await context.newPage();
  const { pageErrorLocations, pageErrors } = collectPageErrors(page);

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
    await installSyncMock(page, { nextQuestionId: "86957" });
    await injectReader(page, script);

    console.log(JSON.stringify({ phase: "script-injected", answerText }));
    const frame = await getQuestionFrame(page);
    await waitForSyncReady(page);
    assert.equal(await page.locator("#kakomonn-reader-controls").count(), 0);
    assert.deepEqual(
      await frame.locator("body").evaluate((body) => {
        const documentNode = body.ownerDocument;
        return {
          bodyBackground: getComputedStyle(body).backgroundColor,
          bodyColor: getComputedStyle(body).color,
          problemBackground: getComputedStyle(
            documentNode.querySelector(".problem_detail")
          ).backgroundColor,
          siteHeaderDisplay: getComputedStyle(
            documentNode.querySelector("header.l-header")
          ).display,
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
        siteHeaderDisplay: "none",
        styleCount: 1,
        toggleCount: 0,
      },
    );
    await page.waitForFunction(
      () => {
        const documentNode = document.querySelector(
          "#kakomonn-reader-frame",
        )?.contentDocument;
        const problemHeading = documentNode?.querySelector(
          ".sect_problem > .ttl_box03 > h2.main",
        );
        return (
          documentNode?.documentElement.dataset.kakomonnReaderPhase ===
            "question" &&
          problemHeading?.textContent.trim() === "問題" &&
          Math.abs(problemHeading.getBoundingClientRect().top) <= 1
        );
      },
      null,
      { timeout: readerReadyTimeout },
    );
    const initialPresentation = await frame.locator("body").evaluate((body) => {
      const documentNode = body.ownerDocument;
      return {
        answerDisplay: getComputedStyle(
          documentNode.querySelector(".answer-right"),
        ).display,
        commentaryDisplay: getComputedStyle(
          documentNode.querySelector(".sect_commentary"),
        ).display,
        explanationExists:
          documentNode.querySelector("#js-commentary-wrap .text") !== null,
        scrollY: documentNode.defaultView.scrollY,
      };
    });
    assert.deepEqual(
      {
        answerDisplay: initialPresentation.answerDisplay,
        commentaryDisplay: initialPresentation.commentaryDisplay,
        explanationExists: initialPresentation.explanationExists,
      },
      {
        answerDisplay: "none",
        commentaryDisplay: "none",
        explanationExists: true,
      },
    );
    assert.equal(initialPresentation.scrollY > 0, true);

    await page.evaluate((delta) => {
      window.__syncMock.nextAttemptStabilityDaysDelta = delta;
    }, attemptStabilityDaysDelta);
    await submitAnswer(page, frame, answerText, inputMethod);
    console.log(JSON.stringify({ phase: "answer-submitted", answerText }));
    await frame.getByText(expectedBanner, { exact: true }).waitFor({
      state: "visible",
      timeout: 15_000,
    });
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

    if (expectedResultClass === "is-correct") {
      await page.waitForFunction(
        (expectedUrl) =>
          location.href === expectedUrl &&
          document.querySelector("#kakomonn-reader-frame")?.contentWindow
            .location.href === expectedUrl,
        fixedNextQuestionUrl,
        { timeout: 15_000 },
      );
      console.log(JSON.stringify({ phase: "next-automatic", answerText }));
    } else {
      await page.waitForFunction(
        () =>
          window.__syncMock.attemptCount === 1 &&
          document.querySelector("#kakomonn-reader-next")?.disabled === false &&
          document.querySelector("#kakomonn-reader-time-limit")?.dataset.phase ===
            "explanation",
        null,
        { timeout: 15_000 },
      );
      assert.equal(
        await frame.locator("body").evaluate(() => location.href),
        fixedQuestionUrl,
      );
      await clickNextQuestion(page, frame, fixedNextQuestionUrl);
      console.log(JSON.stringify({ phase: "next-clicked", answerText }));
    }
    assert.equal(
      await page.evaluate(() =>
        window.__syncMock.calls.filter(
          (call) => new URL(call.url).pathname === "/v9/attempts",
        ).length,
      ),
      1,
    );
    assert.equal(
      await page.evaluate(() =>
        window.__syncMock.calls.some(
          (call) => new URL(call.url).pathname === "/v9/next",
        ),
      ),
      false,
    );

    const expectedTodayStabilityDaysDelta = attemptStabilityDaysDelta;

    assert.equal(await readStoredStabilityDays(page), expectedTodayStabilityDaysDelta);
    assertNoReaderPageErrors(pageErrors, pageErrorLocations, {
      questionURL: fixedQuestionUrl,
    });
    console.log(
      JSON.stringify({
        answerText,
        expectedBanner,
        expectedTodayStabilityDaysDelta,
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
        errorTitle: await page.locator("#kakomonn-reader-error-title").textContent().catch(() => null),
        errorDetail: await page.locator("#kakomonn-reader-error-detail").textContent().catch(() => null),
        nextButton: await page.locator("#kakomonn-reader-next").evaluate((button) => ({
          disabled: button.disabled,
          text: button.textContent,
        })).catch(() => null),
        resultClasses: await page.locator("#kakomonn-reader-frame").evaluate((frame) => [
          ...(frame.contentDocument?.querySelector("#js-answer-result-box")?.classList ?? []),
        ]).catch(() => null),
        storedStabilityDays: await readStoredStabilityDays(page).catch(() => null),
        syncCalls: await page.evaluate(() => window.__syncMock?.calls ?? []).catch(() => []),
        pageErrorLocations,
        pageErrors,
      }),
    );
    throw error;
  } finally {
    await context.close();
  }
}

async function runRandomNavigationCase(browser, script) {
  const context = await browser.newContext({ userAgent: chromeUserAgent });
  await blockThirdPartyAds(context);
  const page = await context.newPage();
  const { pageErrorLocations, pageErrors } = collectPageErrors(page);

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
    await installSyncMock(page, { nextQuestionId: "45125" });
    await injectReader(page, script);

    const frame = await getQuestionFrame(page);
    await waitForSyncReady(page);

    const initialQuestion = (
      await frame.locator(".problem_detail .when").innerText()
    ).replace(/\s+/g, " ").trim();
    const initialFrameUrl = await frame.locator("body").evaluate(() => location.href);
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

    let nextQuestionUrl = null;
    if (!isCorrect) {
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
      [nextQuestionUrl] = nextQuestionUrls;
      assert.match(
        new URL(nextQuestionUrl).pathname,
        /^\/questions\/next\/\d+$/,
      );
      await page.waitForFunction(
        () => {
          const button = document.querySelector("#kakomonn-reader-next");
          return button?.disabled === false && button.textContent === "次の問題へ";
        },
        null,
        { timeout: 15_000 },
      );
      await dismissReaderErrorForTest(page);
      await frame.getByRole("link", { name: "次の問題へ", exact: true }).click();
    }
    await page.waitForFunction(
      (expectedUrl) =>
        location.href === expectedUrl &&
        document.querySelector("#kakomonn-reader-frame")?.contentWindow.location
          .href === expectedUrl,
      randomScheduledQuestionUrl,
      { timeout: 30_000 },
    );
    assert.notEqual(
      await frame.locator("body").evaluate(() => location.href),
      initialFrameUrl,
    );

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
      () => window.__syncMock?.attemptCount === 1,
      null,
      { timeout: 10_000 },
    );
    assert.equal(await readStoredAttemptCount(page), 1);
    assert.equal(await readStoredStabilityDays(page), 0);
    assertNoReaderPageErrors(pageErrors, pageErrorLocations, {
      questionURL: createQuestionUrl,
    });
    console.log(
      JSON.stringify({
        phase: "random-navigation",
        initialQuestion,
        nextQuestion,
        nextQuestionUrl,
        navigation: isCorrect ? "automatic" : "manual",
        isCorrect,
        status: "passed",
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        phase: "random-failed",
        pageUrl: page.url(),
        errorTitle: await page.locator("#kakomonn-reader-error-title").textContent().catch(() => null),
        errorDetail: await page.locator("#kakomonn-reader-error-detail").textContent().catch(() => null),
        frameUrl: await page
          .locator("#kakomonn-reader-frame")
          .evaluate((frame) => frame.contentWindow?.location.href ?? null)
          .catch(() => null),
        nextButton: await page
          .locator("#kakomonn-reader-next")
          .evaluate((button) => ({ disabled: button.disabled, text: button.textContent }))
          .catch(() => null),
        resultClasses: await page
          .locator("#kakomonn-reader-frame")
          .evaluate((frame) => [
            ...(frame.contentDocument?.querySelector("#js-answer-result-box")?.classList ?? []),
          ])
          .catch(() => null),
        storedStabilityDays: await readStoredStabilityDays(page).catch(() => null),
        storedAttemptCount: await readStoredAttemptCount(page).catch(
          () => null,
        ),
        syncCallPaths: await page
          .evaluate(() =>
            window.__syncMock?.calls.map((call) => new URL(call.url).pathname) ?? [],
          )
          .catch(() => null),
        pageErrorLocations,
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
    userAgent: chromeUserAgent,
  });
  await blockThirdPartyAds(context);
  const page = await context.newPage();
  const { pageErrorLocations, pageErrors } = collectPageErrors(page);

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
    await injectReader(page, script);

    const frame = await getQuestionFrame(page);
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
      MARKDOWN_CHOICES,
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

    await submitAnswer(page, frame, MARKDOWN_INCORRECT_ANSWER_TEXT);
    await frame.getByText("残念...", { exact: true }).waitFor({
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
    await dismissReaderErrorForTest(page);
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

    assertMarkdownCopy({
      answerSummary: MARKDOWN_INCORRECT_ANSWER_SUMMARY,
      choices,
      copiedMarkdown,
      explanationContents,
      questionText,
    });
    assertNoReaderPageErrors(pageErrors, pageErrorLocations, {
      questionURL: markdownQuestionUrl,
    });
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
        errorTitle: await page.locator("#kakomonn-reader-error-title").textContent().catch(() => null),
        errorDetail: await page.locator("#kakomonn-reader-error-detail").textContent().catch(() => null),
        pageErrorLocations,
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
    userAgent: chromeUserAgent,
  });
  await blockThirdPartyAds(context);
  const page = await context.newPage();
  const { pageErrorLocations, pageErrors } = collectPageErrors(page);

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
    await injectReader(page, script);

    const frame = await getQuestionFrame(page);
    await waitForSyncReady(page);
    const incorrectAnswerText = await frame
      .locator(".problem_detail ul.list > li")
      .nth(1)
      .innerText();
    await submitAnswer(
      page,
      frame,
      incorrectAnswerText,
    );
    await frame.getByText("残念...", { exact: true }).waitFor({
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
    await dismissReaderErrorForTest(page);
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
    assertNoReaderPageErrors(pageErrors, pageErrorLocations, {
      questionURL: reportedCopyQuestionUrl,
    });
  } finally {
    await context.close();
  }
}

async function runImageChoiceInversionCase(browser, script) {
  const context = await browser.newContext({ userAgent: chromeUserAgent });
  await blockThirdPartyAds(context);
  const page = await context.newPage();
  const { pageErrorLocations, pageErrors } = collectPageErrors(page);

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
    await injectReader(page, script);

    const frame = await getQuestionFrame(page);
    const choiceImages = frame.locator(
      ".problem_detail > ul.list > li img",
    );
    assert.equal(await choiceImages.count(), 4);
    assert.deepEqual(
      await darkModeImageFilters(choiceImages),
      Array(4).fill(darkModeImageFilter),
    );
    assertNoReaderPageErrors(pageErrors, pageErrorLocations, {
      questionURL: imageChoiceQuestionUrl,
    });
  } finally {
    await context.close();
  }
}

async function runCrossDomainActivationCase(browser, script) {
  for (const questionURL of crossDomainQuestionUrls) {
    const context = await browser.newContext({ userAgent: chromeUserAgent });
    await blockThirdPartyAds(context);
    const page = await context.newPage();
    const { pageErrorLocations, pageErrors } = collectPageErrors(page);
    try {
      console.log(JSON.stringify({ phase: "cross-domain-goto", questionURL }));
      const response = await page.goto(questionURL, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      assert.notEqual(response, null);
      assert.equal(response.ok(), true, `${questionURL} returned ${response.status()}`);
      await page.getByText("解答する", { exact: true }).waitFor({
        state: "visible",
        timeout: readerReadyTimeout,
      });
      await page.evaluate(() => localStorage.clear());
      const site = new URL(questionURL).hostname;
      await installSyncMock(page, { site });
      await injectReader(page, script);

      const frame = await getQuestionFrame(page);
      await waitForSyncReady(page);
      await page.locator("#kakomonn-reader-time-limit").waitFor({
        state: "visible",
      });
      assert.equal(
        await page.locator("#kakomonn-reader-time-limit").getAttribute("data-phase"),
        "question"
      );
      assert.equal(
        await frame.locator(".problem_detail > .when").count(),
        1,
        `question metadata must be unique on ${site}`
      );
      const stateSites = await page.evaluate(() =>
        window.__syncMock.calls
          .filter((call) => new URL(call.url).pathname === "/v9/state")
          .map((call) => new URL(call.url).searchParams.get("site"))
      );
      assert.equal(stateSites.length >= 1, true);
      assert.equal(stateSites.every((requestedSite) => requestedSite === site), true);
      assertNoReaderPageErrors(pageErrors, pageErrorLocations, { questionURL });
    } finally {
      await context.close();
    }
  }
}

async function main() {
  const script = fs.readFileSync(scriptPath, "utf8");
  const executablePath =
    kakomonnConfiguration.KAKOMONN_CHROMIUM_EXECUTABLE;
  const browser = await chromium.launch({
    env: kakomonnFreeEnvironment(),
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: executablePath ? ["--no-sandbox"] : [],
  });
  try {
    await runLiveCatalogCrawlCase(browser, script);
    await runCase(browser, script, {
      answerText: "輸入の減少は、GDPを増加させる。",
      expectedBanner: "正解！素晴らしいです",
      expectedResultClass: "is-correct",
      attemptStabilityDaysDelta: 31,
      inputMethod: "keyboard",
    });
    await runCase(browser, script, {
      answerText: "GDPは、フローとストックの混合概念である。",
      expectedBanner: "残念...",
      expectedResultClass: "is-wrong",
      attemptStabilityDaysDelta: 0,
      inputMethod: "keyboard",
    });
    await runRandomNavigationCase(browser, script);
    await runImageChoiceInversionCase(browser, script);
    await runMarkdownCopyCase(browser, script);
    await runReportedCopyCase(browser, script);
    await runCrossDomainActivationCase(browser, script);
  } finally {
    await browser.close();
  }

  console.log("live site e2e test passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
