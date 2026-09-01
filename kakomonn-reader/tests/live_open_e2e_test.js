const assert = require("node:assert/strict");
const fs = require("node:fs");
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

async function readLearningMetrics(token) {
  const query = new URLSearchParams({ site });
  const response = await fetch(`${DEFAULT_SYNC_API_ORIGIN}/v9/state?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.site, site);
  return body.learningMetrics;
}

async function main() {
  const { openKakomonn } = await import("../../scripts/open-kakomonn.mjs");
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
  const baselineMetrics = await readLearningMetrics(token);

  const setupChrome = await launchChromeWithCurrentUserscript({
    configuration,
    userDataDir,
    userscriptPath,
  });
  let setupPage = null;
  let page = null;
  try {
    setupPage = await setupChrome.context.newPage();
    await setupPage.goto(CURRENT_QUESTION_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    const configuredState = await configureSyncToken(
      setupPage,
      token,
      expectedBuildFingerprint,
    );
    assert.equal(configuredState.settingsOpen, false);
    assert.equal(configuredState.topControlsPresent, false);
    const launch = await openKakomonn({ configuration });
    assert.equal(launch.applicationOpened, true);
    assert.equal(launch.coldStart, false);
    await setupPage.close();
    setupPage = null;
    page = await waitUntil(
      "the production open bridge tab",
      async () => setupChrome.context.pages().find((candidate) => {
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
      "a scheduled question from the warm production launch",
      async () => {
        const state = await readReaderState(page);
        const launcher = await page.evaluate(() => ({
          state:
            document.querySelector("#kakomonn-next-question-panel")?.dataset.state ?? null,
          title:
            document.querySelector("#kakomonn-next-question-title")?.textContent ?? null,
        }));
        if (launcher.state === "service-error") {
          return { kind: "service-error", launcher, state };
        }
        if (
          state.buildFingerprint === expectedBuildFingerprint &&
          /^https:\/\/chushoks\.kakomonn\.com\/questions\/\d+$/.test(
            state.outerURL,
          ) &&
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

    const finalMetrics = await readLearningMetrics(token);
    assert.deepEqual(
      finalMetrics,
      baselineMetrics,
      "prewarmed open must not mutate learning metrics",
    );
    console.log(JSON.stringify({
      browser: "Google Chrome with Tampermonkey Beta",
      browserStart: "warm browser with prewarmed transport",
      buildFingerprint: expectedBuildFingerprint,
      scheduledQuestionURL: outcome.state.outerURL,
      startURL: openURL,
      status: "passed",
    }));
  } catch (error) {
    const diagnostics = page === null
      ? { page: null }
      : await page.evaluate(() => ({
          bridgeError:
            document.querySelector("#open-error-detail")?.textContent ?? null,
          bridgeState:
            document.documentElement.dataset.kakomonnReaderBridgeState ?? null,
          buildFingerprint:
            document.querySelector("#kakomonn-reader-shell")?.dataset.buildFingerprint ?? null,
          launcherState:
            document.querySelector("#kakomonn-next-question-panel")?.dataset.state ?? null,
          title: document.title,
          url: location.href,
        })).catch((diagnosticError) => ({
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
    await setupChrome.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
