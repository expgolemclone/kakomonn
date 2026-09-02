const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  readKakomonnConfiguration,
} = require("../../scripts/kakomonn-config.cjs");

const {
  CURRENT_QUESTION_URL,
  DEFAULT_SYNC_API_ORIGIN,
  launchChromeWithCurrentUserscript,
  readChromeUserDataDir,
  resolveSyncToken,
} = require("./support/chrome_tampermonkey");

const userscriptPath = path.resolve(
  __dirname,
  "..",
  "kakomonn-reader.user.js",
);
const repositoryEnvPath = path.resolve(__dirname, "..", "..", ".env");
const correctAnswerText = "輸入の減少は、GDPを増加させる。";
const chromeViewport = { height: 900, width: 1440 };
const chromeViewportTolerancePx = 1;
const buildFingerprintPattern =
  /const BUILD_FINGERPRINT = "([0-9a-f]{64})";/g;

function extractBuildFingerprint(userscript) {
  const matches = [...userscript.matchAll(buildFingerprintPattern)];
  if (matches.length !== 1) {
    throw new Error(
      `Built userscript must contain exactly one build fingerprint: found ${matches.length}`,
    );
  }
  return matches[0][1];
}

function readExpectedBuildFingerprint() {
  if (!fs.existsSync(userscriptPath)) {
    throw new Error(
      `Built userscript was not found. Run the build first: ${userscriptPath}`,
    );
  }
  return extractBuildFingerprint(fs.readFileSync(userscriptPath, "utf8"));
}

function assertRuntimeIdentity(state, expectedBuildFingerprint) {
  assert.equal(
    typeof state.userAgent,
    "string",
    "The connected browser did not expose a user agent",
  );
  assert.match(
    state.userAgent,
    /Windows NT/,
    "The remote-debugging target must run on Windows",
  );
  assert.match(
    state.userAgent,
    /\bChrome\/\d+/,
    "The remote-debugging target must be Google Chrome",
  );
  assert.doesNotMatch(
    state.userAgent,
    /\bEdg\/\d+/,
    "The remote-debugging target must not be Microsoft Edge",
  );
  assert.equal(
    state.scriptHandler,
    "Tampermonkey",
    "The userscript must be injected by Tampermonkey",
  );
  assert.equal(
    state.buildFingerprint,
    expectedBuildFingerprint,
    "The installed Tampermonkey userscript is stale. Save the latest kakomonn-reader.user.js in Tampermonkey and rerun the test",
  );
}

function assertSyncState(state) {
  assert.equal(state.site, "chushoks.kakomonn.com");
  assert.match(state.today, /^\d{4}-\d{2}-\d{2}$/);
  const metrics = state.learningMetrics;
  assert.equal(metrics !== null && typeof metrics === "object", true);
  assert.equal(Number.isSafeInteger(metrics.stabilityDays), true);
  assert.equal(metrics.stabilityDays >= 0, true);
  assert.equal(typeof metrics.dailyKpiCompleted, "boolean");
  assert.equal(typeof metrics.dueCardsCompleted, "boolean");
  assert.equal(Number.isSafeInteger(metrics.dueCardsRemaining), true);
  assert.equal(metrics.dueCardsRemaining >= 0, true);
  assert.equal(metrics.dueCardsCompleted, metrics.dueCardsRemaining === 0);
  assert.equal(Number.isSafeInteger(metrics.todayNewQuestionCount), true);
  assert.equal(metrics.todayNewQuestionCount >= 0, true);
  assert.equal(metrics.newQuestionGoal, 100);
  assert.equal(Number.isSafeInteger(metrics.newQuestionsRemaining), true);
  assert.equal(
    metrics.newQuestionsRemaining,
    Math.max(0, metrics.newQuestionGoal - metrics.todayNewQuestionCount),
  );
  assert.equal(Number.isSafeInteger(metrics.todayStabilityDaysDelta), true);
  assert.equal(Number.isSafeInteger(metrics.attemptedQuestionCount), true);
  assert.equal(metrics.attemptedQuestionCount >= 0, true);
  assert.equal(Number.isSafeInteger(metrics.todayAttemptedQuestionCount), true);
  assert.equal(metrics.todayAttemptedQuestionCount >= 0, true);
  assert.equal(
    metrics.todayCorrectRatePercent === null ||
      (Number.isSafeInteger(metrics.todayCorrectRatePercent) &&
        metrics.todayCorrectRatePercent >= 0 &&
        metrics.todayCorrectRatePercent <= 100),
    true,
  );
  assert.equal(
    state.catalog === null ||
      (Number.isSafeInteger(state.catalog?.questionCount) &&
        state.catalog.questionCount > 0 &&
        Number.isSafeInteger(state.catalog.updatedAtMs) &&
        state.catalog.updatedAtMs > 0),
    true,
  );
  return state;
}

async function requestSyncState(token) {
  const query = new URLSearchParams({ site: "chushoks.kakomonn.com" });
  const response = await fetch(`${DEFAULT_SYNC_API_ORIGIN}/v10/state?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.status, 200);
  return assertSyncState(await response.json());
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function evaluate(page, functionDeclaration) {
  return page.evaluate((source) => {
    const callback = Function(`return (${source})`)();
    return callback();
  }, functionDeclaration);
}

async function waitUntil(description, callback, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  let lastError;
  while (Date.now() < deadline) {
    try {
      lastValue = await callback();
      if (lastValue) {
        return lastValue;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }
  throw new Error(
    `Timed out waiting for ${description}. Last value: ${JSON.stringify(lastValue)}. Last error: ${String(lastError ?? "none")}`,
  );
}

async function readReaderState(page) {
  return evaluate(
    page,
    `() => {
      const shell = document.querySelector("#kakomonn-reader-shell");
      const frame = document.querySelector("#kakomonn-reader-frame");
      const settings = document.querySelector("#kakomonn-reader-sync-settings");
      const errorDialog = document.querySelector("#kakomonn-reader-error-dialog");
      const frameStyle = frame ? getComputedStyle(frame) : null;
      const resultBox = frame?.contentDocument?.querySelector("#js-answer-result-box");
      const answerResult = resultBox?.classList.contains("is-correct")
        ? "correct"
        : resultBox?.classList.contains("is-wrong")
          ? "incorrect"
          : "unknown";
      return {
        actionsPresent: Boolean(document.querySelector("#kakomonn-reader-actions")),
        answerResult,
        buildFingerprint: shell?.dataset.buildFingerprint ?? null,
        errorDetail: document.querySelector("#kakomonn-reader-error-detail")?.textContent ?? null,
        errorOpen: errorDialog?.open ?? null,
        errorTitle: document.querySelector("#kakomonn-reader-error-title")?.textContent ?? null,
        frameURL: frame?.contentWindow?.location?.href ?? null,
        frameClientHeight: frame?.clientHeight ?? null,
        frameClientWidth: frame?.clientWidth ?? null,
        frameComputedHeight: frameStyle?.height ?? null,
        frameComputedWidth: frameStyle?.width ?? null,
        frameHeightAttribute: frame?.getAttribute("height") ?? null,
        frameStyleAttribute: frame?.getAttribute("style") ?? null,
        frameWidthAttribute: frame?.getAttribute("width") ?? null,
        historyEntryType: history.state?.entryType ?? null,
        historyLength: history.length,
        outerURL: location.href,
        scriptHandler: shell?.dataset.scriptHandler ?? null,
        settingsOpen: settings?.open ?? null,
        shellClientHeight: shell?.clientHeight ?? null,
        shellClientWidth: shell?.clientWidth ?? null,
        topControlsPresent: document.querySelector("#kakomonn-reader-controls") !== null,
        userAgent: navigator.userAgent
      };
    }`,
  );
}

async function configureSyncToken(
  page,
  token,
  expectedBuildFingerprint,
) {
  const ready = await waitUntil(
    "the installed Tampermonkey userscript",
    async () => {
      const state = await readReaderState(page);
      return state.actionsPresent === false &&
        state.buildFingerprint !== null &&
        state.outerURL === CURRENT_QUESTION_URL &&
        state.frameURL === CURRENT_QUESTION_URL
        ? state
        : null;
    },
    60_000,
  );
  await delay(2_000);
  const connectionState = await readReaderState(page);
  assert.equal(ready.outerURL, CURRENT_QUESTION_URL);
  assert.equal(ready.frameURL, CURRENT_QUESTION_URL);
  assertRuntimeIdentity(ready, expectedBuildFingerprint);

  if (connectionState.settingsOpen) {
    await page.getByRole("textbox", { name: "同期トークン" }).fill(token);
    await page
      .getByRole("button", { name: "確認して保存" })
      .evaluate((button) => button.click());
  }

  return waitUntil("the production sync baseline", async () => {
    const state = await readReaderState(page);
    return state.settingsOpen === false && state.topControlsPresent === false
      ? state : null;
  });
}

async function completeStoredDestinationIfAvailable(page) {
  const initialState = await readReaderState(page);
  await page.goForward({ waitUntil: "commit", timeout: 10_000 });
  await delay(2_000);
  const advancedState = await readReaderState(page);
  if (
    advancedState.outerURL === initialState.outerURL &&
    advancedState.frameURL === initialState.frameURL
  ) {
    return false;
  }
  await waitForAutomaticTransition(page);
  await delay(1_000);
  return true;
}

async function waitForAutomaticQuestionSpeech(page, expectedBuildFingerprint) {
  const outcome = await waitUntil(
    "the automatic question speech before any page interaction",
    async () => {
      const state = await readReaderState(page);
      if (
        state.actionsPresent ||
        state.outerURL !== CURRENT_QUESTION_URL ||
        state.frameURL !== CURRENT_QUESTION_URL ||
        state.settingsOpen !== false
      ) {
        return null;
      }
      return state.errorOpen ? null : state;
    },
    60_000,
  );
  assertRuntimeIdentity(outcome, expectedBuildFingerprint);
  await delay(2_000);
  const settled = await readReaderState(page);
  return settled.errorOpen || settled.settingsOpen ? null : settled;
}

async function submitCorrectAnswer(page) {
  const answerClickTarget = await waitUntil("the visible answer 5 label", async () => {
    const clickTarget = await evaluate(
      page,
      `async () => {
      const frame = window.document
        .querySelector("#kakomonn-reader-frame");
      const frameWindow = frame.contentWindow;
      const document = frame.contentDocument;
      const input = document
        .querySelector('input[name="intAnswerData"][value="5"]');
      const label = input?.closest("label");
      if (!label) {
        return { hittable: false, innerTarget: null, outerTarget: null };
      }
      const initialRect = label.getBoundingClientRect();
      const desiredCenters = [
        frame.clientHeight - initialRect.height / 2 - 14,
        frame.clientHeight * 0.75,
        frame.clientHeight * 0.5
      ];
      let result = {
        frameClientHeight: frame.clientHeight,
        frameClientWidth: frame.clientWidth,
        hittable: false,
        innerTarget: null,
        outerTarget: null,
        scrollHeight: document.documentElement.scrollHeight,
        scrollWidth: document.documentElement.scrollWidth
      };
      for (const desiredCenter of desiredCenters) {
        const beforeScroll = label.getBoundingClientRect();
        frameWindow.scrollTo({
          left:
            frameWindow.scrollX +
            beforeScroll.left +
            beforeScroll.width / 2 -
            frame.clientWidth / 2,
          top:
            frameWindow.scrollY +
            beforeScroll.top +
            beforeScroll.height / 2 -
            desiredCenter,
          behavior: "instant"
        });
        await new Promise((resolve) =>
          frameWindow.requestAnimationFrame(() =>
            frameWindow.requestAnimationFrame(resolve)
          )
        );
        const rect = label.getBoundingClientRect();
        const innerTarget = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2
        );
        const frameRect = frame.getBoundingClientRect();
        const outerTarget = window.document.elementFromPoint(
          frameRect.left + rect.left + rect.width / 2,
          frameRect.top + rect.top + rect.height / 2
        );
        result = {
          frameClientHeight: frame.clientHeight,
          frameClientWidth: frame.clientWidth,
          hittable:
            (innerTarget === label || label.contains(innerTarget)) &&
            outerTarget === frame,
          innerTarget: innerTarget?.tagName ?? null,
          labelHeight: rect.height,
          labelLeft: rect.left,
          labelTop: rect.top,
          labelWidth: rect.width,
          outerX: frameRect.left + rect.left + rect.width / 2,
          outerY: frameRect.top + rect.top + rect.height / 2,
          outerTarget: outerTarget?.tagName ?? null,
          scrollHeight: document.documentElement.scrollHeight,
          scrollWidth: document.documentElement.scrollWidth,
          scrollX: frameWindow.scrollX,
          scrollY: frameWindow.scrollY
        };
        if (result.hittable) {
          return result;
        }
      }
      return result;
    }`,
    );
    if (!clickTarget.hittable) {
      throw new Error(JSON.stringify(clickTarget));
    }
    return clickTarget;
  });

  const frame = page.frameLocator("#kakomonn-reader-frame");
  const frameText = await frame.locator("body").innerText();
  assert.equal(frameText.includes(correctAnswerText), true);
  assert.equal(Number.isFinite(answerClickTarget.outerX), true);
  assert.equal(Number.isFinite(answerClickTarget.outerY), true);
  await frame
    .locator('input[name="intAnswerData"][value="5"]')
    .locator("xpath=ancestor::label[1]")
    .click();

  const selected = await evaluate(
    page,
    `() => document
      .querySelector("#kakomonn-reader-frame")
      .contentDocument
      .querySelector('input[name="intAnswerData"][value="5"]')
      .checked`,
  );
  assert.equal(selected, true, "The visible answer 5 control was not selected");

  await frame
    .getByRole("button", { name: "解答する", exact: true })
    .click();

  await waitUntil("the real site correct result or automatic transition", async () => {
    const state = await readReaderState(page);
    if (state.answerResult === "incorrect") {
      throw new Error("The selected real-site answer was marked incorrect");
    }
    return state.answerResult === "correct" ||
      state.outerURL !== CURRENT_QUESTION_URL ||
      state.frameURL !== CURRENT_QUESTION_URL;
  });
}

async function waitForAutomaticTransition(page) {
  return waitUntil("the scheduled next question or primary KPI celebration", async () => {
    const outerURL = await evaluate(page, "() => location.href");
    if (
      outerURL.startsWith(
        "https://kakomonn-congratulations.kakomonn.workers.dev/",
      )
    ) {
      const ready = await evaluate(
        page,
        `() => document.documentElement.dataset.state === "ready"`,
      );
      return ready ? { kind: "celebration", outerURL } : null;
    }
    const state = await readReaderState(page);
    if (
      state.outerURL !== state.frameURL ||
      state.outerURL === CURRENT_QUESTION_URL ||
      state.answerResult !== "unknown" ||
      !/^https:\/\/chushoks\.kakomonn\.com\/questions\/\d+$/.test(
        state.outerURL,
      )
    ) {
      return null;
    }
    return { kind: "question", state };
  });
}

async function waitForSynchronizedQuestionState(page, token, frameURL) {
  let lastReaderState = null;
  let lastRemoteState = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    [lastReaderState, lastRemoteState] = await Promise.all([
      readReaderState(page),
      requestSyncState(token),
    ]);
    if (
      lastReaderState.frameURL === frameURL &&
      lastReaderState.answerResult === "unknown" &&
      lastReaderState.actionsPresent === false &&
      lastReaderState.topControlsPresent === false
    ) {
      return {
        readerState: lastReaderState,
        remoteState: lastRemoteState,
      };
    }
    await delay(1_000);
  }
  throw new Error(
    `Reader and production state did not converge: ${JSON.stringify({
      lastReaderState,
      lastRemoteState,
    })}`,
  );
}

async function writeFailureDiagnostics(page) {
  const screenshotPath = path.join(
    os.tmpdir(),
    `kakomonn-live-e2e-${Date.now()}.png`,
  );
  const diagnostics = await readReaderState(page).catch((error) => ({
    error: String(error),
  }));
  await page.screenshot({ path: screenshotPath }).catch(() => null);
  console.error(JSON.stringify({ diagnostics, screenshotPath }));
}

async function resizeToExactViewport(page) {
  const devicePixelRatio = await evaluate(page, "() => window.devicePixelRatio");
  assert.equal(
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0,
    true,
    `Invalid devicePixelRatio: ${devicePixelRatio}`,
  );
  await page.setViewportSize({
    height: Math.round(chromeViewport.height * devicePixelRatio),
    width: Math.round(chromeViewport.width * devicePixelRatio),
  });
  const actualViewport = await evaluate(
    page,
    `() => ({
      height: window.innerHeight,
      width: window.innerWidth
    })`,
  );
  assert.equal(
    Math.abs(actualViewport.height - chromeViewport.height) <=
      chromeViewportTolerancePx &&
      Math.abs(actualViewport.width - chromeViewport.width) <=
        chromeViewportTolerancePx,
    true,
    JSON.stringify({ actualViewport, chromeViewport }),
  );
}

async function main() {
  const configuration = readKakomonnConfiguration({
    envFilePath: repositoryEnvPath,
  });
  const token = await resolveSyncToken({
    configuration,
    envFilePath: repositoryEnvPath,
  });
  const userDataDir = readChromeUserDataDir({
    configuration,
    envFilePath: repositoryEnvPath,
  });
  const expectedBuildFingerprint = readExpectedBuildFingerprint();
  const baseline = await requestSyncState(token);
  const chrome = await launchChromeWithCurrentUserscript({
    configuration,
    userDataDir,
    userscriptPath,
  });
  let page = null;
  try {
    page = await chrome.context.newPage();
    await page.goto(CURRENT_QUESTION_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await resizeToExactViewport(page);

    const configuredState = await configureSyncToken(
      page,
      token,
      expectedBuildFingerprint,
    );
    assert.equal(configuredState.settingsOpen, false);
    assert.equal(configuredState.topControlsPresent, false);
    await completeStoredDestinationIfAvailable(page);
    await page.close();
    page = await chrome.context.newPage();
    await page.goto(CURRENT_QUESTION_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await resizeToExactViewport(page);
    const automaticSpeechState = await waitForAutomaticQuestionSpeech(
      page,
      expectedBuildFingerprint,
    );
    assert.notEqual(automaticSpeechState, null);
    assert.equal(automaticSpeechState.topControlsPresent, false);
    await submitCorrectAnswer(page);
    const navigationResult = await waitForAutomaticTransition(page);
    let finalState;
    let synchronizedReaderState = null;
    if (navigationResult.kind === "question") {
      const synchronized = await waitForSynchronizedQuestionState(
        page,
        token,
        navigationResult.state.frameURL,
      );
      finalState = synchronized.remoteState;
      synchronizedReaderState = synchronized.readerState;
    } else {
      finalState = await requestSyncState(token);
    }
    assert.equal(finalState.today, baseline.today);
    let frameUrl = null;
    if (navigationResult.kind === "question") {
      frameUrl = navigationResult.state.frameURL;
      assert.equal(synchronizedReaderState.topControlsPresent, false);
    } else {
      const celebrationURL = new URL(navigationResult.outerURL);
      assert.deepEqual([...celebrationURL.searchParams.keys()].sort(), [
        "dailyKpiCompleted",
        "date",
        "site",
      ]);
      assert.equal(celebrationURL.searchParams.get("site"), finalState.site);
      assert.equal(celebrationURL.searchParams.get("date"), finalState.today);
      assert.equal(celebrationURL.searchParams.get("dailyKpiCompleted"), "true");
      assert.equal(finalState.learningMetrics.dailyKpiCompleted, true);
    }
    console.log(
      JSON.stringify({
        browser: "Google Chrome with Tampermonkey Beta",
        buildFingerprint: expectedBuildFingerprint,
        frameUrl,
        navigation: navigationResult.kind,
        stabilityDaysAfter: finalState.learningMetrics.stabilityDays,
        stabilityDaysBefore: baseline.learningMetrics.stabilityDays,
        status: "passed",
      }),
    );
  } catch (error) {
    if (page !== null) {
      await writeFailureDiagnostics(page).catch(() => null);
    }
    throw error;
  } finally {
    if (page !== null) {
      await page.close().catch(() => null);
    }
    await chrome.close();
  }
}

module.exports = {
  assertRuntimeIdentity,
  configureSyncToken,
  extractBuildFingerprint,
  readReaderState,
  resizeToExactViewport,
  waitUntil,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
