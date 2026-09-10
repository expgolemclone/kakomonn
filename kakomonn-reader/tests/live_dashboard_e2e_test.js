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
  configureSyncToken,
  extractBuildFingerprint,
} = require("./live_sync_e2e_test");
const userscriptPath = path.resolve(__dirname, "..", "kakomonn-reader.user.js");
const repositoryEnvPath = path.resolve(__dirname, "..", "..", ".env");

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
  const userscript = fs.readFileSync(userscriptPath, "utf8");
  const expectedBuildFingerprint = extractBuildFingerprint(userscript);
  const chrome = await launchChromeWithCurrentUserscript({
    configuration,
    userDataDir,
    userscriptPath,
  });
  let setupPage = null;
  let dashboardPage = null;
  try {
    setupPage = await chrome.context.newPage();
    await setupPage.goto(CURRENT_QUESTION_URL, {
      timeout: 60_000,
      waitUntil: "domcontentloaded",
    });
    const configured = await configureSyncToken(
      setupPage,
      token,
      expectedBuildFingerprint,
    );
    assert.equal(configured.settingsOpen, false);
    await setupPage.close();
    setupPage = null;

    dashboardPage = await chrome.context.newPage();
    await dashboardPage.goto(`${DEFAULT_SYNC_API_ORIGIN}/`, {
      timeout: 60_000,
      waitUntil: "domcontentloaded",
    });
    await dashboardPage.locator("#dashboard").waitFor({
      state: "visible",
      timeout: 30_000,
    });
    assert.equal(
      await dashboardPage.locator("html").getAttribute(
        "data-kakomonn-dashboard-bridge-state",
      ),
      "ready",
    );
    assert.match(
      await dashboardPage.locator("#site-select").inputValue(),
      /^[a-z0-9-]+\.kakomonn\.com$/,
    );
    assert.equal(
      await dashboardPage.locator("#auth-token, #settings-dialog").count(),
      0,
    );
    assert.equal(
      await dashboardPage.evaluate(() =>
        localStorage.getItem("kakomonn-dashboard.sync-token")),
      null,
    );
    assert.equal(
      await dashboardPage.locator("html").evaluate(
        (element, secret) => element.outerHTML.includes(secret),
        token,
      ),
      false,
    );
    console.log(JSON.stringify({
      browser: "Google Chrome with Tampermonkey Beta",
      buildFingerprint: expectedBuildFingerprint,
      dashboardURL: dashboardPage.url(),
      status: "passed",
    }));
  } finally {
    if (setupPage !== null) await setupPage.close().catch(() => null);
    if (dashboardPage !== null) await dashboardPage.close().catch(() => null);
    await chrome.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
