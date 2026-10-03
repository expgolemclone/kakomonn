const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const {
  kakomonnFreeEnvironment,
  readKakomonnConfiguration,
} = require("../../../scripts/kakomonn-config.cjs");
const {
  TAMPERMONKEY_BETA_EXTENSION_ID,
  waitForDevToolsActivePort,
} = require("../../../scripts/chrome-devtools.cjs");
const {
  CHROME_AUTOPLAY_ARGUMENT,
  CHROME_REMOTE_DEBUGGING_ARGUMENT,
  stopDedicatedChrome,
  stopDedicatedChromePowerShell,
} = require("../../../scripts/windows-chrome-profile.cjs");

const { chromium } = require("playwright");

const TAMPERMONKEY_EXTENSION_ID = TAMPERMONKEY_BETA_EXTENSION_ID;
const LEGACY_TAMPERMONKEY_EXTENSION_ID = "dhdgffkkebhmkfjojejmpbldmpobfkfo";
const SYNC_TOKEN_KEY = "kakomonn-reader.sync-token";
const SYNC_TOKEN_PATTERN = /^[0-9a-f]{64}$/i;
const DEFAULT_SYNC_API_ORIGIN = "https://kakomonn-sync.kakomonn.workers.dev";
const CURRENT_QUESTION_URL = "https://chushoks.kakomonn.com/questions/86956";
const DEFAULT_CHROME_E2E_DIRECTORY_NAME = "kakomonn-chrome-e2e";

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function platformPath(platform = process.platform) {
  return platform === "win32" ? path.win32 : path;
}

function defaultChromeUserDataDir(environment = process.env, platform = process.platform) {
  const pathApi = platformPath(platform);
  if (platform === "win32") {
    const localAppData = environment.LOCALAPPDATA;
    if (!localAppData) {
      throw new Error("LOCALAPPDATA is not set");
    }
    return pathApi.join(localAppData, "Google", "Chrome", "User Data");
  }
  if (platform === "darwin") {
    return pathApi.join(os.homedir(), "Library", "Application Support", "Google", "Chrome");
  }
  return pathApi.join(os.homedir(), ".config", "google-chrome");
}

function defaultChromeE2EUserDataDir(environment = process.env, platform = process.platform) {
  const pathApi = platformPath(platform);
  if (platform === "win32") {
    const localAppData = environment.LOCALAPPDATA;
    if (!localAppData) {
      throw new Error("LOCALAPPDATA is not set");
    }
    return pathApi.join(localAppData, DEFAULT_CHROME_E2E_DIRECTORY_NAME);
  }
  return pathApi.join(os.tmpdir(), DEFAULT_CHROME_E2E_DIRECTORY_NAME);
}

function isSameOrDescendantPath(parentPath, candidatePath, pathApi = path) {
  const relative = pathApi.relative(parentPath, candidatePath);
  return (
    relative === "" ||
    (!relative.startsWith(`..${pathApi.sep}`) && relative !== ".." && !pathApi.isAbsolute(relative))
  );
}

function readChromeUserDataDir({
  configuration,
  systemEnvironment = process.env,
  envFilePath,
  existsSync = fs.existsSync,
  readFileSync = fs.readFileSync,
  platform = process.platform,
} = {}) {
  const pathApi = platformPath(platform);
  const kakomonnConfiguration =
    configuration ?? readKakomonnConfiguration({ envFilePath, existsSync, readFileSync });
  const configuredPath =
    kakomonnConfiguration.KAKOMONN_CHROME_USER_DATA_DIR ??
    defaultChromeE2EUserDataDir(systemEnvironment, platform);
  const userDataDir = pathApi.resolve(configuredPath);
  const standardUserDataDir = pathApi.resolve(
    defaultChromeUserDataDir(systemEnvironment, platform),
  );
  if (isSameOrDescendantPath(standardUserDataDir, userDataDir, pathApi)) {
    throw new Error(
      "KAKOMONN_CHROME_USER_DATA_DIR must be outside the standard Chrome user data directory",
    );
  }
  return userDataDir;
}

function readConfiguredToken({
  configuration,
  envFilePath,
  existsSync = fs.existsSync,
  readFileSync = fs.readFileSync,
} = {}) {
  const kakomonnConfiguration =
    configuration ?? readKakomonnConfiguration({ envFilePath, existsSync, readFileSync });
  const token = kakomonnConfiguration.KAKOMONN_SYNC_TOKEN;
  if (token === undefined) {
    return null;
  }
  return { source: envFilePath, token };
}

function assertTokenShape(token, source) {
  if (!SYNC_TOKEN_PATTERN.test(token)) {
    throw new Error(`KAKOMONN_SYNC_TOKEN from ${source} must be a 64-character hexadecimal token`);
  }
}

function extractSyncTokenCandidates(buffers) {
  const keyBytes = Buffer.from(SYNC_TOKEN_KEY);
  if (!buffers.some((buffer) => buffer.includes(keyBytes))) {
    return new Set();
  }
  const candidates = new Set();
  for (const buffer of buffers) {
    const text = buffer.toString("latin1");
    for (const match of text.matchAll(/[0-9a-f]{64}/gi)) {
      candidates.add(match[0]);
    }
  }
  return candidates;
}

function listProfileDirectories(
  userDataRoot,
  { existsSync = fs.existsSync, readdirSync = fs.readdirSync } = {},
) {
  if (!existsSync(userDataRoot)) {
    return [];
  }
  return readdirSync(userDataRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && (entry.name === "Default" || /^Profile \d+$/.test(entry.name)),
    )
    .map((entry) => path.join(userDataRoot, entry.name));
}

function discoverTampermonkeyStorageDirectories({
  environment = process.env,
  platform = process.platform,
  dedicatedUserDataDir = defaultChromeE2EUserDataDir(environment, platform),
  existsSync = fs.existsSync,
  readdirSync = fs.readdirSync,
} = {}) {
  const roots = [dedicatedUserDataDir, defaultChromeUserDataDir(environment, platform)];
  const directories = new Set();
  for (const root of roots) {
    for (const profileDirectory of listProfileDirectories(root, {
      existsSync,
      readdirSync,
    })) {
      for (const extensionId of [TAMPERMONKEY_EXTENSION_ID, LEGACY_TAMPERMONKEY_EXTENSION_ID]) {
        const storageDirectory = path.join(
          profileDirectory,
          "Local Extension Settings",
          extensionId,
        );
        if (existsSync(storageDirectory)) {
          directories.add(storageDirectory);
        }
      }
    }
  }
  return [...directories];
}

function readDirectoryBuffers(
  directory,
  { readdirSync = fs.readdirSync, readFileSync = fs.readFileSync } = {},
) {
  const buffers = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    try {
      buffers.push(readFileSync(path.join(directory, entry.name)));
    } catch (error) {
      if (error?.code !== "EBUSY" && error?.code !== "EACCES") {
        throw error;
      }
    }
  }
  return buffers;
}

function scanStoredSyncTokenCandidates({
  storageDirectories,
  readBuffers = readDirectoryBuffers,
} = {}) {
  const candidates = new Set();
  for (const storageDirectory of storageDirectories) {
    const buffers = readBuffers(storageDirectory);
    for (const candidate of extractSyncTokenCandidates(buffers)) {
      candidates.add(candidate);
    }
  }
  return candidates;
}

async function validateSyncToken(
  token,
  { fetchImpl = fetch, syncApiOrigin = DEFAULT_SYNC_API_ORIGIN } = {},
) {
  const response = await fetchImpl(`${syncApiOrigin}/v12/sites`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  await response.arrayBuffer().catch(() => null);
  return response.status === 200;
}

function writeEnvToken(
  envFilePath,
  token,
  {
    existsSync = fs.existsSync,
    readFileSync = fs.readFileSync,
    writeFileSync = fs.writeFileSync,
    renameSync = fs.renameSync,
  } = {},
) {
  const current = existsSync(envFilePath) ? readFileSync(envFilePath, "utf8") : "";
  const newline = current.includes("\r\n") ? "\r\n" : "\n";
  const assignment = `KAKOMONN_SYNC_TOKEN=${token}`;
  let next;
  if (/^KAKOMONN_SYNC_TOKEN\s*=.*$/m.test(current)) {
    next = current.replace(/^KAKOMONN_SYNC_TOKEN\s*=.*$/m, assignment);
  } else if (current === "") {
    next = `${assignment}${newline}`;
  } else {
    next = `${current}${current.endsWith("\n") ? "" : newline}${assignment}${newline}`;
  }
  const temporaryPath = `${envFilePath}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, next, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, envFilePath);
}

async function resolveSyncToken({
  configuration,
  systemEnvironment = process.env,
  envFilePath,
  readConfigured = readConfiguredToken,
  readDedicatedUserDataDir = readChromeUserDataDir,
  discoverStorageDirectories = discoverTampermonkeyStorageDirectories,
  scanCandidates = scanStoredSyncTokenCandidates,
  validateToken = validateSyncToken,
  saveToken = writeEnvToken,
} = {}) {
  assert.ok(envFilePath, "envFilePath is required");
  const kakomonnConfiguration = configuration ?? readKakomonnConfiguration({ envFilePath });
  const configured = readConfigured({
    configuration: kakomonnConfiguration,
    envFilePath,
  });
  if (configured !== null) {
    assertTokenShape(configured.token, configured.source);
    if (!(await validateToken(configured.token))) {
      throw new Error(
        `KAKOMONN_SYNC_TOKEN from ${configured.source} was rejected by production. The secret was not rotated`,
      );
    }
    return configured.token;
  }

  const dedicatedUserDataDir = readDedicatedUserDataDir({
    configuration: kakomonnConfiguration,
    systemEnvironment,
    envFilePath,
  });
  const storageDirectories = discoverStorageDirectories({
    environment: systemEnvironment,
    dedicatedUserDataDir,
  });
  const candidates = scanCandidates({ storageDirectories });
  const validTokens = [];
  for (const candidate of candidates) {
    if (await validateToken(candidate)) {
      validTokens.push(candidate);
    }
  }
  const distinctValidTokens = [...new Set(validTokens)];
  if (distinctValidTokens.length === 0) {
    throw new Error("No production sync token was found in Chrome Tampermonkey storage");
  }
  if (distinctValidTokens.length > 1) {
    throw new Error("Multiple production sync tokens were found in Chrome Tampermonkey storage");
  }
  saveToken(envFilePath, distinctValidTokens[0]);
  return distinctValidTokens[0];
}

function chromeExecutablePath(
  configuration = readKakomonnConfiguration(),
  systemEnvironment = process.env,
) {
  const configured = configuration.KAKOMONN_CHROME_EXECUTABLE;
  if (configured !== undefined) {
    return path.resolve(configured);
  }
  const programFiles = systemEnvironment.ProgramFiles;
  if (!programFiles) {
    throw new Error("ProgramFiles is not set");
  }
  return path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe");
}

function locateTampermonkeyExtension(
  userDataDir,
  { existsSync = fs.existsSync, readdirSync = fs.readdirSync } = {},
) {
  const extensionsRoot = path.join(userDataDir, "Default", "Extensions");
  if (!existsSync(extensionsRoot)) {
    throw new Error("Tampermonkey Beta must be installed in the dedicated Chrome E2E profile");
  }
  const extensionIds = readdirSync(extensionsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (!extensionIds.includes(TAMPERMONKEY_EXTENSION_ID)) {
    throw new Error("Tampermonkey Beta must be installed in the dedicated Chrome E2E profile");
  }
  const extensionRoot = path.join(extensionsRoot, TAMPERMONKEY_EXTENSION_ID);
  const versions = readdirSync(extensionRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
  if (versions.length === 0) {
    throw new Error("Tampermonkey Beta must be installed in the dedicated Chrome E2E profile");
  }
  return path.join(extensionRoot, versions[0]);
}

async function waitForTampermonkeyExtension(userDataDir, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return locateTampermonkeyExtension(userDataDir);
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }
  throw new Error(
    `Chrome policy did not install Tampermonkey Beta in the dedicated profile: ${lastError?.message ?? "unknown error"}`,
  );
}

function chromeLaunchArguments(userDataDir) {
  return [
    `--user-data-dir=${userDataDir}`,
    CHROME_AUTOPLAY_ARGUMENT,
    CHROME_REMOTE_DEBUGGING_ARGUMENT,
    "--start-minimized",
    "--force-device-scale-factor=1",
    "--window-size=1440,900",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--no-default-browser-check",
    "--no-first-run",
    "about:blank",
  ];
}

function waitForProcessExit(browserProcess, timeoutMs) {
  if (browserProcess.exitCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      browserProcess.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    function onExit() {
      clearTimeout(timeout);
      resolve(true);
    }
    browserProcess.once("exit", onExit);
  });
}

async function launchDedicatedChrome({
  configuration = readKakomonnConfiguration(),
  systemEnvironment = process.env,
  userDataDir,
} = {}) {
  const resolvedUserDataDir =
    userDataDir ?? readChromeUserDataDir({ configuration, systemEnvironment });
  const executablePath = chromeExecutablePath(configuration, systemEnvironment);
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Google Chrome was not found: ${executablePath}`);
  }
  fs.mkdirSync(resolvedUserDataDir, { recursive: true });
  stopDedicatedChrome(resolvedUserDataDir, { systemEnvironment });
  const activePortPath = path.join(resolvedUserDataDir, "DevToolsActivePort");
  fs.rmSync(activePortPath, { force: true });
  const browserProcess = spawn(executablePath, chromeLaunchArguments(resolvedUserDataDir), {
    env: kakomonnFreeEnvironment(systemEnvironment),
    stdio: "ignore",
    windowsHide: true,
  });
  try {
    const port = await waitForDevToolsActivePort(resolvedUserDataDir, browserProcess);
    await waitForTampermonkeyExtension(resolvedUserDataDir);
    return await connectDedicatedChrome({
      browserProcess,
      port,
      systemEnvironment,
      userDataDir: resolvedUserDataDir,
    });
  } catch (error) {
    stopDedicatedChrome(resolvedUserDataDir, { systemEnvironment });
    throw error;
  }
}

async function connectDedicatedChrome({
  browserProcess = null,
  port,
  systemEnvironment = process.env,
  userDataDir,
}) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const contexts = browser.contexts();
  assert.equal(contexts.length, 1, "The dedicated Chrome profile must expose one context");
  let closed = false;
  return {
    browser,
    browserProcess,
    context: contexts[0],
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      const pages = contexts[0].pages();
      if (pages.length > 0) {
        const session = await contexts[0].newCDPSession(pages[0]).catch(() => null);
        if (session) {
          await Promise.race([session.send("Browser.close").catch(() => null), delay(3_000)]);
        }
      }
      const exited =
        browserProcess === null ? false : await waitForProcessExit(browserProcess, 3_000);
      if (browserProcess !== null && !exited && !browserProcess.killed) {
        browserProcess.kill();
        await waitForProcessExit(browserProcess, 3_000);
      }
      // Chrome may hand off startup to another process before this child exits.
      stopDedicatedChrome(userDataDir, { systemEnvironment });
    },
  };
}

async function readStoredUserscriptState(extensionPage, userscriptName, userscriptSource) {
  return extensionPage.evaluate(
    async ({ expectedSource, expectedName }) => {
      const records = await chrome.storage.local.get(null);
      const metadataRecords = Object.entries(records).filter(
        ([key, record]) =>
          key.startsWith("!extdb.@meta#") &&
          !record?.value?.deleted &&
          record?.value?.name === expectedName,
      );
      if (metadataRecords.length !== 1) {
        return {
          count: metadataRecords.length,
          enabled: false,
          reviewed: false,
          sourceIsCurrent: false,
        };
      }
      const metadata = metadataRecords[0][1].value;
      const source = records[`!extdb.@source#${metadata.uuid}`]?.value;
      return {
        count: 1,
        enabled: metadata.enabled === true,
        reviewed: metadata.evilness === 0,
        sourceIsCurrent: source === expectedSource,
      };
    },
    { expectedSource: userscriptSource, expectedName: userscriptName },
  );
}

async function approveTampermonkeyChange(context) {
  for (const page of context.pages()) {
    if (!page.url().startsWith(`chrome-extension://${TAMPERMONKEY_EXTENSION_ID}/`)) continue;
    if (!page.url().startsWith(`chrome-extension://${TAMPERMONKEY_EXTENSION_ID}/ask.html?`)) continue;
    const controls = page.getByRole('button', { name: /^(変更|Modify|インストール|Install)$/ });
    for (let index = 0; index < await controls.count(); index++) {
      const control = controls.nth(index);
      if (await control.isVisible()) { await control.click(); break; }
    }
  }
}

async function ensureDynamicContentMode(settingsPage) {
  const contentMode = settingsPage
    .locator("select")
    .filter({ has: settingsPage.locator('option[value="userscripts"]') });
  await contentMode.waitFor({ state: "visible", timeout: 30_000 });
  if ((await contentMode.inputValue()) === "userscripts-dynamic") {
    return;
  }
  await contentMode.selectOption("userscripts-dynamic");
  const securitySection = contentMode.locator("xpath=ancestor::table[1]");
  const saveButton = securitySection.getByRole("button", {
    name: /^(保存|Save)$/,
  });
  await saveButton.waitFor({ state: "visible", timeout: 10_000 });
  await saveButton.click();
  await delay(2_000);
}

async function waitForTampermonkeyRuntime(context, timeoutMs = 60_000) {
  // A registered MV3 worker may legitimately be dormant. Verify Chrome's actual
  // extension registration and wake its runtime through the real options page.
  const accessPage = await context.newPage();
  try {
    await accessPage.goto('chrome://extensions/', { waitUntil: 'commit', timeout: timeoutMs });
    await accessPage.waitForFunction(() => typeof chrome.developerPrivate?.getExtensionInfo === 'function', null, { timeout: timeoutMs });
    await accessPage.evaluate(async extensionId => {
      const information = await chrome.developerPrivate.getExtensionInfo(extensionId);
      if (information.state !== 'ENABLED' || information.userScriptsAccess?.isEnabled !== true) {
        throw new Error('Tampermonkey Beta must be enabled and support Allow User Scripts');
      }
      if (!information.userScriptsAccess.isActive) {
        await chrome.developerPrivate.updateExtensionConfiguration({ extensionId, userScriptsAccess: true });
      }
      const verified = await chrome.developerPrivate.getExtensionInfo(extensionId);
      if (verified.userScriptsAccess?.isActive !== true) {
        throw new Error('Chrome did not enable Allow User Scripts for Tampermonkey Beta');
      }
    }, TAMPERMONKEY_EXTENSION_ID);
  } finally {
    await accessPage.close();
  }
  const settingsPage = await context.newPage();
  try {
    await settingsPage.goto(`chrome-extension://${TAMPERMONKEY_EXTENSION_ID}/options.html#nav=settings`, { waitUntil: 'commit', timeout: timeoutMs });
    await settingsPage.waitForFunction(extensionId => chrome.runtime?.id === extensionId && typeof chrome.storage?.local?.get === 'function', TAMPERMONKEY_EXTENSION_ID, { timeout: timeoutMs });
    return settingsPage;
  } catch (error) {
    await settingsPage.close();
    throw error;
  }
}

async function updateInstalledUserscript(context, userscriptPath) {
  if (!fs.existsSync(userscriptPath)) {
    throw new Error(`Built userscript was not found: ${userscriptPath}`);
  }
  // CodeMirror and Tampermonkey store text with LF line endings.
  const userscriptSource = fs.readFileSync(userscriptPath, 'utf8').replace(/\r\n?/g, '\n');
  const userscriptName = userscriptSource.match(/^\/\/ @name\s+(.+)$/m)?.[1];
  if (!userscriptName) {
    throw new Error("The built userscript must provide one @name directive");
  }
  const buildFingerprint = userscriptSource.match(
    /const BUILD_FINGERPRINT = "([0-9a-f]{64})";/,
  )?.[1];
  if (!buildFingerprint) {
    throw new Error("The built userscript must provide one build fingerprint");
  }
  const settingsPage = await waitForTampermonkeyRuntime(context);
  const configurationMode = settingsPage
    .locator("select")
    .filter({ has: settingsPage.locator('option[value="50"]') })
    .filter({ has: settingsPage.locator('option[value="0"]') });
  await configurationMode.waitFor({ state: "visible", timeout: 30_000 });
  if ((await configurationMode.inputValue()) !== "100") {
    await configurationMode.selectOption("100");
  }
  await ensureDynamicContentMode(settingsPage);

  const dashboardPage = await context.newPage();
  await dashboardPage.goto(
    `chrome-extension://${TAMPERMONKEY_EXTENSION_ID}/options.html#nav=dashboard`,
    { waitUntil: "commit", timeout: 30_000 },
  );
  await dashboardPage.waitForFunction(() => typeof chrome.storage?.local?.get === 'function', null, { timeout: 30_000 });
  const initialStoredState = await readStoredUserscriptState(dashboardPage, userscriptName, userscriptSource);
  if (initialStoredState.count > 1) {
    throw new Error(`The dedicated profile contains duplicate ${userscriptName} userscripts`);
  }
  if (!initialStoredState.sourceIsCurrent || !initialStoredState.reviewed) {
    // Import the actual built file through Tampermonkey's supported UI. The
    // editor's automatic whitespace cleanup would alter generated string data.
    const importPage = await context.newPage();
    await importPage.goto(`chrome-extension://${TAMPERMONKEY_EXTENSION_ID}/options.html#nav=utilities`, { waitUntil: 'commit', timeout: 30_000 });
    await importPage.locator('input[type="file"]').setInputFiles({
      name: path.basename(userscriptPath), mimeType: 'application/javascript', buffer: Buffer.from(userscriptSource, 'utf8'),
    });
    const sourceUpdateDeadline = Date.now() + 30_000;
    let sourceUpdated = false;
    while (!sourceUpdated && Date.now() < sourceUpdateDeadline) {
      await approveTampermonkeyChange(context);
      const storedState = await readStoredUserscriptState(dashboardPage, userscriptName, userscriptSource);
      sourceUpdated = storedState.sourceIsCurrent && storedState.reviewed;
      if (!sourceUpdated) await delay(250);
    }
    await importPage.close();
    if (!sourceUpdated) throw new Error('Tampermonkey did not import and review the exact built userscript source');
  }
  await delay(1_000);
  await dashboardPage.goto(
    `chrome-extension://${TAMPERMONKEY_EXTENSION_ID}/options.html#nav=dashboard`,
    { waitUntil: "commit", timeout: 30_000 },
  );
  const enabledRow = dashboardPage.locator("tr.scripttr").filter({ hasText: userscriptName });
  await enabledRow.waitFor({ state: "visible", timeout: 30_000 });
  let storedState = await readStoredUserscriptState(
    dashboardPage,
    userscriptName,
    userscriptSource,
  );
  assert.equal(
    storedState.count,
    1,
    `Tampermonkey must store exactly one current ${userscriptName} userscript`,
  );
  assert.equal(
    storedState.sourceIsCurrent,
    true,
    "Tampermonkey did not retain the current userscript source",
  );
  // Approve only the exact locally built source via Tampermonkey's real UI.
  // Imported storage can require review even when enabled=true is persisted.
  if (!storedState.reviewed || !storedState.enabled) {
    await enabledRow.locator('.enabler').click();
    const enableDeadline = Date.now() + 30_000;
    while ((!storedState.enabled || !storedState.reviewed) && Date.now() < enableDeadline) {
      await approveTampermonkeyChange(context);
      await delay(250);
      storedState = await readStoredUserscriptState(dashboardPage, userscriptName, userscriptSource);
    }
  }
  assert.equal(storedState.sourceIsCurrent, true, 'Tampermonkey must retain the exact reviewed source');
  assert.equal(storedState.reviewed, true, 'Tampermonkey requires review of the current userscript');
  assert.equal(storedState.enabled, true, 'Tampermonkey did not enable the current userscript');
}

async function launchChromeWithCurrentUserscript({
  configuration = readKakomonnConfiguration(),
  systemEnvironment = process.env,
  userDataDir,
  userscriptPath,
}) {
  const updateChrome = await launchDedicatedChrome({
    configuration,
    systemEnvironment,
    userDataDir,
  });
  try {
    await updateInstalledUserscript(updateChrome.context, userscriptPath);
  } finally {
    await updateChrome.close();
  }
  return launchDedicatedChrome({
    configuration,
    systemEnvironment,
    userDataDir,
  });
}

module.exports = {
  CURRENT_QUESTION_URL,
  DEFAULT_SYNC_API_ORIGIN,
  LEGACY_TAMPERMONKEY_EXTENSION_ID,
  SYNC_TOKEN_KEY,
  TAMPERMONKEY_EXTENSION_ID,
  assertTokenShape,
  defaultChromeUserDataDir,
  defaultChromeE2EUserDataDir,
  discoverTampermonkeyStorageDirectories,
  chromeLaunchArguments,
  connectDedicatedChrome,
  extractSyncTokenCandidates,
  updateInstalledUserscript,
  readStoredUserscriptState,
  waitForTampermonkeyRuntime,
  isSameOrDescendantPath,
  launchChromeWithCurrentUserscript,
  launchDedicatedChrome,
  listProfileDirectories,
  locateTampermonkeyExtension,
  readConfiguredToken,
  readDirectoryBuffers,
  readChromeUserDataDir,
  resolveSyncToken,
  scanStoredSyncTokenCandidates,
  kakomonnFreeEnvironment,
  stopDedicatedChrome,
  stopDedicatedChromePowerShell,
  validateSyncToken,
  writeEnvToken,
};
