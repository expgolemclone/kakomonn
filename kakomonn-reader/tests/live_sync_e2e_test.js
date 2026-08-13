const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  installUserscript,
  launchDedicatedEdge,
  readEdgeUserDataDir,
  resolveSyncToken,
} = require("./support/edge_tampermonkey");

const userscriptPath = path.resolve(
  __dirname,
  "..",
  "kakomonn-reader.user.js",
);
const repositoryEnvPath = path.resolve(__dirname, "..", "..", ".env");
const syncApiOrigin =
  "https://kakomonn-sync.expgolem-lab.workers.dev";
const currentQuestionUrl = "https://chushoks.kakomonn.com/questions/86956";
const correctAnswerText = "輸入の減少は、GDPを増加させる。";
const expectedMarkdownHeading =
  "# 中小企業診断士試験 令和7年度（2025年） 問4（経済学・経済政策 問4）";
const edgeViewport = { height: 900, width: 1440 };
const edgeViewportTolerancePx = 1;
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
    /\bEdg\/\d+/,
    "The remote-debugging target must be Microsoft Edge",
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

function windowsPowerShellExecutable() {
  if (process.platform !== "win32") {
    throw new Error("The real clipboard E2E requires Windows");
  }
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot) {
    throw new Error("SystemRoot is not set");
  }
  const executable = path.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  if (!fs.existsSync(executable)) {
    throw new Error(`Windows PowerShell was not found: ${executable}`);
  }
  return executable;
}

function powerShellEnvironment(environment = {}) {
  const childEnvironment = { ...process.env, ...environment };
  delete childEnvironment.KAKOMONN_SYNC_TOKEN;
  return childEnvironment;
}

function runWindowsPowerShell(command, environment = {}) {
  const result = spawnSync(
    windowsPowerShellExecutable(),
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
    {
      encoding: "utf8",
      env: powerShellEnvironment(environment),
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    },
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `Windows clipboard command failed: ${result.stderr.trim()}`,
    );
  }
  return result.stdout.replace(/\r\n/g, "\n").trimEnd();
}

function prepareClipboardNonce() {
  const nonce = `kakomonn-live-e2e-${randomUUID()}`;
  runWindowsPowerShell(
    "Set-Clipboard -Value $env:KAKOMONN_E2E_CLIPBOARD_NONCE",
    { KAKOMONN_E2E_CLIPBOARD_NONCE: nonce },
  );
  return nonce;
}

function readWindowsClipboard() {
  return runWindowsPowerShell("Get-Clipboard -Raw");
}

function assertSyncState(state) {
  assert.equal(state.site, "chushoks.kakomonn.com");
  assert.match(state.today, /^\d{4}-\d{2}-\d{2}$/);
  const metrics = state.learningMetrics;
  assert.equal(metrics !== null && typeof metrics === "object", true);
  assert.equal(Number.isSafeInteger(metrics.stabilityDays), true);
  assert.equal(metrics.stabilityDays >= 0, true);
  assert.equal(Number.isSafeInteger(metrics.todayStabilityDaysDelta), true);
  assert.equal(Number.isSafeInteger(metrics.attemptedQuestionCount), true);
  assert.equal(metrics.attemptedQuestionCount >= 0, true);
  assert.equal(Number.isSafeInteger(metrics.todayAttemptedQuestionCount), true);
  assert.equal(metrics.todayAttemptedQuestionCount >= 0, true);
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
  const response = await fetch(`${syncApiOrigin}/v7/state?${query}`, {
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
      const next = document.querySelector("#kakomonn-reader-next");
      const settings = document.querySelector("#kakomonn-reader-sync-settings");
      const settingsButton = document.querySelector("#kakomonn-reader-sync-settings-button");
      const frameStyle = frame ? getComputedStyle(frame) : null;
      return {
        actionsPresent: Boolean(document.querySelector("#kakomonn-reader-actions")),
        buildFingerprint: shell?.dataset.buildFingerprint ?? null,
        count: document.querySelector("#kakomonn-reader-learning-metrics")?.textContent ?? null,
        frameURL: frame?.contentWindow?.location?.href ?? null,
        frameClientHeight: frame?.clientHeight ?? null,
        frameClientWidth: frame?.clientWidth ?? null,
        frameComputedHeight: frameStyle?.height ?? null,
        frameComputedWidth: frameStyle?.width ?? null,
        frameHeightAttribute: frame?.getAttribute("height") ?? null,
        frameStyleAttribute: frame?.getAttribute("style") ?? null,
        frameWidthAttribute: frame?.getAttribute("width") ?? null,
        nextDisabled: next?.disabled ?? null,
        nextText: next?.textContent ?? null,
        outerURL: location.href,
        scriptHandler: shell?.dataset.scriptHandler ?? null,
        settingsButtonDisabled: settingsButton?.disabled ?? null,
        settingsHidden: settings?.hidden ?? null,
        status: document.querySelector("#kakomonn-reader-status")?.textContent ?? null,
        shellClientHeight: shell?.clientHeight ?? null,
        shellClientWidth: shell?.clientWidth ?? null,
        userAgent: navigator.userAgent
      };
    }`,
  );
}

async function configureSyncToken(
  page,
  token,
  baseline,
  expectedBuildFingerprint,
) {
  const ready = await waitUntil(
    "the installed Tampermonkey userscript",
    async () => {
      const state = await readReaderState(page);
      return state.actionsPresent &&
        state.outerURL === currentQuestionUrl &&
        state.frameURL === currentQuestionUrl
        ? state
        : null;
    },
    60_000,
  );
  assert.equal(ready.outerURL, currentQuestionUrl);
  assert.equal(ready.frameURL, currentQuestionUrl);
  assertRuntimeIdentity(ready, expectedBuildFingerprint);

  if (ready.settingsHidden) {
    await waitUntil("the enabled sync settings button", async () => {
      const state = await readReaderState(page);
      return state.settingsButtonDisabled === false ? state : null;
    });
    await page
      .locator("#kakomonn-reader-sync-settings-button")
      .evaluate((button) => button.click());
    await waitUntil("the open sync settings panel", async () => {
      const state = await readReaderState(page);
      return state.settingsHidden === false ? state : null;
    });
  }

  await page.getByRole("textbox", { name: "同期トークン" }).fill(token);
  await page
    .getByRole("button", { name: "確認して保存" })
    .evaluate((button) => button.click());

  const expectedCount = `stabilityDays ${baseline.learningMetrics.stabilityDays.toLocaleString("ja-JP")}日 / todayAttemptedQuestionCount ${baseline.learningMetrics.todayAttemptedQuestionCount}問`;
  return waitUntil("the production sync baseline", async () => {
    const state = await readReaderState(page);
    return state.settingsHidden && state.count === expectedCount ? state : null;
  });
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
    .evaluate((label) => label.click());

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
    .evaluate((button) => button.click());

  await waitUntil("the real site correct result", async () =>
    evaluate(
      page,
      `() => document
        .querySelector("#kakomonn-reader-frame")
        .contentDocument
        .querySelector("#js-answer-result-box")
        ?.classList.contains("is-correct") === true`,
    ),
  );
}

async function copyMarkdownInRealEdge(page) {
  const clipboardNonce = prepareClipboardNonce();
  await waitUntil("the ready Markdown copy button", async () =>
    evaluate(
      page,
      `() => {
        const button = document.querySelector("#kakomonn-reader-copy");
        return button?.disabled === false &&
          button.textContent === "Markdownをコピー";
      }`,
    ),
  );
  await page
    .locator("#kakomonn-reader-copy")
    .evaluate((button) => button.click());
  await waitUntil("the successful real clipboard copy", async () =>
    evaluate(
      page,
      `() => document
        .querySelector("#kakomonn-reader-copy")
        ?.textContent === "コピー済み"`,
    ),
  );

  const copiedMarkdown = readWindowsClipboard();
  assert.notEqual(copiedMarkdown, clipboardNonce);
  assert.equal(copiedMarkdown.includes(clipboardNonce), false);
  assert.equal(copiedMarkdown.split("\n")[0], expectedMarkdownHeading);
  assert.equal(copiedMarkdown.includes(correctAnswerText), true);
  assert.equal(
    copiedMarkdown.includes(
      `\n\n### 自分の回答\n\n選択肢5: ${correctAnswerText}\n\n`,
    ),
    true,
  );
  assert.match(copiedMarkdown, /^## 解説$/m);
}

async function clickNextQuestion(page) {
  await waitUntil("the enabled next question button", async () => {
    const state = await readReaderState(page);
    return state.nextDisabled === false && state.nextText === "次の問題へ"
      ? state
      : null;
  });
  const hitTest = await evaluate(
    page,
    `() => {
      const button = document.querySelector("#kakomonn-reader-next");
      const rect = button.getBoundingClientRect();
      const target = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2
      );
      return {
        targetId: target?.id ?? null,
      };
    }`,
  );
  assert.equal(hitTest.targetId, "kakomonn-reader-next", JSON.stringify(hitTest));
  const nextClick = await evaluate(
    page,
    `() => {
      let clicked = false;
      const button = document.querySelector("#kakomonn-reader-next");
      button.addEventListener(
        "click",
        () => {
          clicked = true;
        },
        true
      );
      button.click();
      return { clicked };
    }`,
  );
  assert.equal(
    nextClick.clicked,
    true,
    JSON.stringify(nextClick),
  );

  return waitUntil("the scheduled next question or primary KPI celebration", async () => {
    const outerURL = await evaluate(page, "() => location.href");
    if (
      outerURL.startsWith(
        "https://kakomonn-congratulations.expgolem-lab.workers.dev/",
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
      state.outerURL === currentQuestionUrl ||
      !/^https:\/\/chushoks\.kakomonn\.com\/questions\/\d+$/.test(
        state.outerURL,
      ) ||
      !/^stabilityDays \d+日 \/ todayAttemptedQuestionCount \d+問$/.test(state.count ?? "")
    ) {
      return null;
    }
    return { kind: "question", state };
  });
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
    height: Math.round(edgeViewport.height * devicePixelRatio),
    width: Math.round(edgeViewport.width * devicePixelRatio),
  });
  const actualViewport = await evaluate(
    page,
    `() => ({
      height: window.innerHeight,
      width: window.innerWidth
    })`,
  );
  assert.equal(
    Math.abs(actualViewport.height - edgeViewport.height) <=
      edgeViewportTolerancePx &&
      Math.abs(actualViewport.width - edgeViewport.width) <=
        edgeViewportTolerancePx,
    true,
    JSON.stringify({ actualViewport, edgeViewport }),
  );
}

async function main() {
  const token = await resolveSyncToken({ envFilePath: repositoryEnvPath });
  const userDataDir = readEdgeUserDataDir({ envFilePath: repositoryEnvPath });
  const expectedBuildFingerprint = readExpectedBuildFingerprint();
  const baseline = await requestSyncState(token);
  const edge = await launchDedicatedEdge({ userDataDir });
  let page = null;
  try {
    await installUserscript(edge.context, userscriptPath);
    page = await edge.context.newPage();
    await page.goto(currentQuestionUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await resizeToExactViewport(page);

    const configuredState = await configureSyncToken(
      page,
      token,
      baseline,
      expectedBuildFingerprint,
    );
    assert.equal(
      configuredState.count,
      `stabilityDays ${baseline.learningMetrics.stabilityDays.toLocaleString("ja-JP")}日 / todayAttemptedQuestionCount ${baseline.learningMetrics.todayAttemptedQuestionCount}問`,
    );
    await submitCorrectAnswer(page);
    await copyMarkdownInRealEdge(page);
    const navigationResult = await clickNextQuestion(page);
    const finalState = await requestSyncState(token);
    assert.equal(finalState.today, baseline.today);
    let frameUrl = null;
    if (navigationResult.kind === "question") {
      frameUrl = navigationResult.state.frameURL;
      assert.equal(
        navigationResult.state.count,
        `stabilityDays ${finalState.learningMetrics.stabilityDays.toLocaleString("ja-JP")}日 / todayAttemptedQuestionCount ${finalState.learningMetrics.todayAttemptedQuestionCount}問`,
      );
    } else {
      const celebrationURL = new URL(navigationResult.outerURL);
      assert.deepEqual([...celebrationURL.searchParams.keys()].sort(), [
        "dailyStabilityDaysDeltaGoal",
        "date",
        "site",
        "todayStabilityDaysDelta",
      ]);
      assert.equal(celebrationURL.searchParams.get("site"), finalState.site);
      assert.equal(celebrationURL.searchParams.get("date"), finalState.today);
      assert.equal(
        Number(celebrationURL.searchParams.get("todayStabilityDaysDelta")),
        finalState.learningMetrics.todayStabilityDaysDelta,
      );
      assert.equal(
        Number.isSafeInteger(
          Number(celebrationURL.searchParams.get("dailyStabilityDaysDeltaGoal")),
        ) &&
          Number(celebrationURL.searchParams.get("dailyStabilityDaysDeltaGoal")) >= 1,
        true,
      );
    }
    console.log(
      JSON.stringify({
        browser: "Microsoft Edge with Tampermonkey",
        buildFingerprint: expectedBuildFingerprint,
        frameUrl,
        markdownHeading: expectedMarkdownHeading,
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
    await edge.close();
  }
}

module.exports = {
  assertRuntimeIdentity,
  extractBuildFingerprint,
  resizeToExactViewport,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
