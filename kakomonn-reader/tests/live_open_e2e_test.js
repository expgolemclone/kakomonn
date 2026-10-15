const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { readKakomonnConfiguration } = require("../../scripts/kakomonn-config.cjs");
const { inspectDedicatedChrome } = require("../../scripts/windows-chrome-profile.cjs");
const {
  CURRENT_QUESTION_URL,
  DEFAULT_SYNC_API_ORIGIN,
  connectDedicatedChrome,
  launchChromeWithCurrentUserscript,
  readChromeUserDataDir,
  resolveSyncToken,
} = require("./support/chrome_tampermonkey");
const {
  assertRuntimeIdentity,
  configureSyncToken,
  extractBuildFingerprint,
  readReaderState,
  waitUntil,
} = require("./live_sync_e2e_test");

const userscriptPath = path.resolve(__dirname, "..", "kakomonn-reader.user.js");
const repositoryEnvPath = path.resolve(__dirname, "..", "..", ".env");
const openURL = `${DEFAULT_SYNC_API_ORIGIN}/open`;
const site = "chushoks.kakomonn.com";

async function readLearningState(token) {
  const query = new URLSearchParams({ site });
  const response = await fetch(`${DEFAULT_SYNC_API_ORIGIN}/v12/state?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.site, site);
  assert.match(body.today, /^\d{4}-\d{2}-\d{2}$/);
  return body;
}

function nextCalendarDate(date) {
  const nextDate = new Date(`${date}T00:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  return nextDate.toISOString().slice(0, 10);
}

async function readLearningActivity(token, date) {
  const query = new URLSearchParams({ date, site });
  const response = await fetch(`${DEFAULT_SYNC_API_ORIGIN}/v12/daily-details?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.site, site);
  assert.equal(body.date, date);
  return body.tables;
}

async function readLearningActivities(token, dates) {
  return Promise.all(
    dates.map(async (date) => ({
      activity: await readLearningActivity(token, date),
      date,
    })),
  );
}

async function main() {
  const { ensureKakomonnBrowser, openKakomonnURL } = await import("../../scripts/open-kakomonn.mjs");
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
  const userscript = fs.readFileSync(userscriptPath, "utf8");
  const expectedBuildFingerprint = extractBuildFingerprint(userscript);
  const baselineState = await readLearningState(token);
  const observedDates = [baselineState.today, nextCalendarDate(baselineState.today)];
  const baselineActivities = await readLearningActivities(token, observedDates);

  const setupChrome = await launchChromeWithCurrentUserscript({
    configuration,
    userDataDir,
    userscriptPath,
  });
  let activeChrome = null;
  let setupPage = null;
  let page = null;
  try {
    setupPage = await setupChrome.context.newPage();
    await setupPage.goto(CURRENT_QUESTION_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    const configuredState = await configureSyncToken(setupPage, token, expectedBuildFingerprint);
    assert.equal(configuredState.settingsOpen, false);
    assert.equal(configuredState.topControlsPresent, false);
    await setupPage.close();
    setupPage = null;
    await setupChrome.close();
    const browserLaunch = await ensureKakomonnBrowser({ configuration });
    assert.equal(browserLaunch.browserStarted, true);
    activeChrome = await connectDedicatedChrome({
      port: browserLaunch.devToolsPort,
      userDataDir,
    });
    const launch = await openKakomonnURL({ configuration });
    assert.equal(launch.applicationOpened, true);
    page = await waitUntil(
      "the production open bridge tab",
      async () =>
        activeChrome.context.pages().find((candidate) => {
          try {
            const url = new URL(candidate.url());
            return url.href === openURL || url.hostname === site;
          } catch {
            return false;
          }
        }) ?? null,
      30_000,
    );
    const outcome = await waitUntil(
      "a scheduled question from the cold production launch",
      async () => {
        const state = await readReaderState(page);
        const launcher = await page.evaluate(() => ({
          state: document.querySelector("#kakomonn-next-question-panel")?.dataset.state ?? null,
          title: document.querySelector("#kakomonn-next-question-title")?.textContent ?? null,
        }));
        if (launcher.state === "service-error") {
          return { kind: "service-error", launcher, state };
        }
        if (
          state.buildFingerprint === expectedBuildFingerprint &&
          /^https:\/\/chushoks\.kakomonn\.com\/questions\/\d+$/.test(state.outerURL) &&
          state.frameURL === state.outerURL
        ) {
          return { kind: "ready", launcher, state };
        }
        return null;
      },
      60_000,
    );
    assert.notEqual(
      outcome.kind,
      "service-error",
      JSON.stringify({
        launcher: outcome.launcher,
        state: outcome.state,
      }),
    );
    assertRuntimeIdentity(outcome.state, expectedBuildFingerprint);
    assert.equal(outcome.state.errorOpen, false);
    assert.equal(outcome.state.settingsOpen, false);
    assert.equal(outcome.state.topControlsPresent, false);

    const finalState = await readLearningState(token);
    assert.equal(
      observedDates.includes(finalState.today),
      true,
      "cold open exceeded its observed learning dates",
    );
    const finalActivities = await readLearningActivities(token, observedDates);
    for (const [index, finalEntry] of finalActivities.entries()) {
      const baselineEntry = baselineActivities[index];
      assert.equal(finalEntry.date, baselineEntry.date);
      assert.deepEqual(
        finalEntry.activity.attempts,
        baselineEntry.activity.attempts,
        "cold open must not record attempts",
      );
      assert.deepEqual(
        finalEntry.activity.stability_history,
        baselineEntry.activity.stability_history,
        "cold open must not change stability history",
      );
      const baselineStudyTimeMs = baselineEntry.activity.study_time_daily[0]?.study_time_ms ?? 0;
      const finalStudyTimeMs = finalEntry.activity.study_time_daily[0]?.study_time_ms ?? 0;
      assert.equal(
        finalStudyTimeMs >= baselineStudyTimeMs,
        true,
        "cold open must not reduce study time",
      );
    }
    assert.equal(
      finalState.learningMetrics.todayStudyTimeMs >
        baselineState.learningMetrics.todayStudyTimeMs,
      true,
      "foreground question time must be recorded",
    );
    console.log(
      JSON.stringify({
        browser: "Google Chrome with Tampermonkey Beta",
        browserStart: "cold browser with bounded bridge retry",
        buildFingerprint: expectedBuildFingerprint,
        scheduledQuestionURL: outcome.state.outerURL,
        startURL: openURL,
        studyTimeDeltaMs:
          finalState.learningMetrics.todayStudyTimeMs -
          baselineState.learningMetrics.todayStudyTimeMs,
        status: "passed",
      }),
    );
  } catch (error) {
    const diagnostics =
      page === null
        ? { page: null }
        : await page
            .evaluate(() => ({
              bridgeError: document.querySelector("#open-error-detail")?.textContent ?? null,
              bridgeState: document.documentElement.dataset.kakomonnReaderBridgeState ?? null,
              buildFingerprint:
                document.querySelector("#kakomonn-reader-shell")?.dataset.buildFingerprint ?? null,
              launcherState:
                document.querySelector("#kakomonn-next-question-panel")?.dataset.state ?? null,
              title: document.title,
              url: location.href,
            }))
            .catch((diagnosticError) => ({
              error: String(diagnosticError),
              url: page.url(),
            }));
    throw new Error(`${error.message} Diagnostics: ${JSON.stringify(diagnostics)}`, {
      cause: error,
    });
  } finally {
    if (setupPage !== null) {
      await setupPage.close().catch(() => null);
    }
    await activeChrome?.close();
    await setupChrome.close();
  }
  assert.equal(
    inspectDedicatedChrome(userDataDir).processCount,
    0,
    "live open must finish dedicated Chrome cleanup before returning",
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
