const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const { chromium } = require("playwright");

const TAMPERMONKEY_EXTENSION_ID = "dhdgffkkebhmkfjojejmpbldmpobfkfo";
const SYNC_TOKEN_KEY = "kakomonn-reader.sync-token";
const SYNC_TOKEN_PATTERN = /^[0-9a-f]{64}$/i;
const DEFAULT_SYNC_API_ORIGIN =
  "https://kakomonn-sync.expgolem-lab.workers.dev";
const DEFAULT_EDGE_E2E_DIRECTORY_NAME = "kakomonn-edge-e2e";

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function platformPath(platform = process.platform) {
  return platform === "win32" ? path.win32 : path;
}

function defaultEdgeUserDataDir(
  environment = process.env,
  platform = process.platform,
) {
  const pathApi = platformPath(platform);
  if (platform === "win32") {
    const localAppData = environment.LOCALAPPDATA;
    if (!localAppData) {
      throw new Error("LOCALAPPDATA is not set");
    }
    return pathApi.join(localAppData, "Microsoft", "Edge", "User Data");
  }
  if (platform === "darwin") {
    return pathApi.join(
      os.homedir(),
      "Library",
      "Application Support",
      "Microsoft Edge",
    );
  }
  return pathApi.join(os.homedir(), ".config", "microsoft-edge");
}

function defaultChromeUserDataDir(
  environment = process.env,
  platform = process.platform,
) {
  const pathApi = platformPath(platform);
  if (platform === "win32") {
    const localAppData = environment.LOCALAPPDATA;
    if (!localAppData) {
      throw new Error("LOCALAPPDATA is not set");
    }
    return pathApi.join(localAppData, "Google", "Chrome", "User Data");
  }
  if (platform === "darwin") {
    return pathApi.join(
      os.homedir(),
      "Library",
      "Application Support",
      "Google",
      "Chrome",
    );
  }
  return pathApi.join(os.homedir(), ".config", "google-chrome");
}

function defaultEdgeE2EUserDataDir(
  environment = process.env,
  platform = process.platform,
) {
  const pathApi = platformPath(platform);
  if (platform === "win32") {
    const localAppData = environment.LOCALAPPDATA;
    if (!localAppData) {
      throw new Error("LOCALAPPDATA is not set");
    }
    return pathApi.join(localAppData, DEFAULT_EDGE_E2E_DIRECTORY_NAME);
  }
  return pathApi.join(os.tmpdir(), DEFAULT_EDGE_E2E_DIRECTORY_NAME);
}

function isSameOrDescendantPath(parentPath, candidatePath, pathApi = path) {
  const relative = pathApi.relative(parentPath, candidatePath);
  return (
    relative === "" ||
    (!relative.startsWith(`..${pathApi.sep}`) &&
      relative !== ".." &&
      !pathApi.isAbsolute(relative))
  );
}

function readEdgeUserDataDir({
  environment = process.env,
  envFilePath,
  existsSync = fs.existsSync,
  readFileSync = fs.readFileSync,
  platform = process.platform,
} = {}) {
  const pathApi = platformPath(platform);
  const configuredPath =
    environment.KAKOMONN_EDGE_USER_DATA_DIR ??
    readEnvAssignment(envFilePath, "KAKOMONN_EDGE_USER_DATA_DIR", {
      existsSync,
      readFileSync,
    }) ??
    defaultEdgeE2EUserDataDir(environment, platform);
  if (configuredPath === "") {
    throw new Error("KAKOMONN_EDGE_USER_DATA_DIR must not be empty");
  }
  const userDataDir = pathApi.resolve(configuredPath);
  const standardUserDataDir = pathApi.resolve(
    defaultEdgeUserDataDir(environment, platform),
  );
  if (isSameOrDescendantPath(standardUserDataDir, userDataDir, pathApi)) {
    throw new Error(
      "KAKOMONN_EDGE_USER_DATA_DIR must be outside the standard Edge user data directory",
    );
  }
  if (!existsSync(userDataDir)) {
    throw new Error(
      `The dedicated Edge E2E user data directory was not found: ${userDataDir}`,
    );
  }
  return userDataDir;
}

function readEnvAssignment(
  envFilePath,
  key,
  {
    existsSync = fs.existsSync,
    readFileSync = fs.readFileSync,
  } = {},
) {
  if (!envFilePath || !existsSync(envFilePath)) {
    return null;
  }
  const contents = readFileSync(envFilePath, "utf8");
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = contents.match(
    new RegExp(`^${escapedKey}\\s*=\\s*(.*)$`, "m"),
  );
  if (!match) {
    return null;
  }
  let value = match[1].trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1);
  }
  return value;
}

function readConfiguredToken({
  environment = process.env,
  envFilePath,
  existsSync = fs.existsSync,
  readFileSync = fs.readFileSync,
} = {}) {
  const processToken = environment.KAKOMONN_SYNC_TOKEN ?? "";
  if (processToken !== "") {
    return { source: "process environment", token: processToken };
  }
  const token = readEnvAssignment(envFilePath, "KAKOMONN_SYNC_TOKEN", {
    existsSync,
    readFileSync,
  });
  if (token === null) {
    return null;
  }
  return { source: envFilePath, token };
}

function assertTokenShape(token, source) {
  if (!SYNC_TOKEN_PATTERN.test(token)) {
    throw new Error(
      `KAKOMONN_SYNC_TOKEN from ${source} must be a 64-character hexadecimal token`,
    );
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

function listProfileDirectories(userDataRoot, {
  existsSync = fs.existsSync,
  readdirSync = fs.readdirSync,
} = {}) {
  if (!existsSync(userDataRoot)) {
    return [];
  }
  return readdirSync(userDataRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        (entry.name === "Default" || /^Profile \d+$/.test(entry.name)),
    )
    .map((entry) => path.join(userDataRoot, entry.name));
}

function discoverTampermonkeyStorageDirectories({
  environment = process.env,
  platform = process.platform,
  dedicatedUserDataDir = defaultEdgeE2EUserDataDir(environment, platform),
  existsSync = fs.existsSync,
  readdirSync = fs.readdirSync,
} = {}) {
  const roots = [
    dedicatedUserDataDir,
    defaultEdgeUserDataDir(environment, platform),
    defaultChromeUserDataDir(environment, platform),
  ];
  const directories = new Set();
  for (const root of roots) {
    for (const profileDirectory of listProfileDirectories(root, {
      existsSync,
      readdirSync,
    })) {
      const storageDirectory = path.join(
        profileDirectory,
        "Local Extension Settings",
        TAMPERMONKEY_EXTENSION_ID,
      );
      if (existsSync(storageDirectory)) {
        directories.add(storageDirectory);
      }
    }
  }
  return [...directories];
}

function readDirectoryBuffers(directory, {
  readdirSync = fs.readdirSync,
  readFileSync = fs.readFileSync,
} = {}) {
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
  {
    fetchImpl = fetch,
    syncApiOrigin = DEFAULT_SYNC_API_ORIGIN,
  } = {},
) {
  const response = await fetchImpl(`${syncApiOrigin}/v7/sites`, {
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
  const current = existsSync(envFilePath)
    ? readFileSync(envFilePath, "utf8")
    : "";
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
  environment = process.env,
  envFilePath,
  readConfigured = readConfiguredToken,
  readDedicatedUserDataDir = readEdgeUserDataDir,
  discoverStorageDirectories = discoverTampermonkeyStorageDirectories,
  scanCandidates = scanStoredSyncTokenCandidates,
  validateToken = validateSyncToken,
  saveToken = writeEnvToken,
} = {}) {
  assert.ok(envFilePath, "envFilePath is required");
  const configured = readConfigured({ environment, envFilePath });
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
    environment,
    envFilePath,
  });
  const storageDirectories = discoverStorageDirectories({
    environment,
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
    throw new Error(
      "No production sync token was found in Edge or Chrome Tampermonkey storage",
    );
  }
  if (distinctValidTokens.length > 1) {
    throw new Error(
      "Multiple production sync tokens were found in Edge or Chrome Tampermonkey storage",
    );
  }
  saveToken(envFilePath, distinctValidTokens[0]);
  environment.KAKOMONN_SYNC_TOKEN = distinctValidTokens[0];
  return distinctValidTokens[0];
}

function windowsPowerShellExecutable(environment = process.env) {
  if (process.platform !== "win32") {
    throw new Error("The Edge Tampermonkey E2E requires Windows");
  }
  const systemRoot = environment.SystemRoot;
  if (!systemRoot) {
    throw new Error("SystemRoot is not set");
  }
  return path.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
}

function secretFreeEnvironment(environment = process.env) {
  const childEnvironment = { ...environment };
  delete childEnvironment.KAKOMONN_SYNC_TOKEN;
  return childEnvironment;
}

const stopDedicatedEdgePowerShell = String.raw`
$ErrorActionPreference = "SilentlyContinue"
$userDataDir = [System.IO.Path]::GetFullPath(
  $env:KAKOMONN_E2E_EDGE_USER_DATA_DIR
)
$plainArgument = "--user-data-dir=$userDataDir"
$quotedArgument = '--user-data-dir="' + $userDataDir + '"'
$processes = @(
  Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" |
    Where-Object {
      $_.CommandLine -and (
        $_.CommandLine.Contains($plainArgument) -or
        $_.CommandLine.Contains($quotedArgument)
      )
    }
)
$rootProcessIds = @(
  $processes |
    Where-Object { -not $_.CommandLine.Contains("--type=") } |
    ForEach-Object { $_.ProcessId }
)
foreach ($processId in $rootProcessIds) {
  Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Milliseconds 500
foreach ($process in $processes) {
  Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}
exit 0
`;

function stopDedicatedEdge(userDataDir, {
  spawnSyncImpl = spawnSync,
  environment = process.env,
} = {}) {
  const result = spawnSyncImpl(
    windowsPowerShellExecutable(environment),
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      stopDedicatedEdgePowerShell,
    ],
    {
      encoding: "utf8",
      env: secretFreeEnvironment({
        ...environment,
        KAKOMONN_E2E_EDGE_USER_DATA_DIR: userDataDir,
      }),
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    },
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Failed to stop the dedicated Edge profile: ${result.stderr.trim()}`);
  }
}

function edgeExecutablePath(environment = process.env) {
  const configured = environment.KAKOMONN_EDGE_EXECUTABLE ?? "";
  if (configured !== "") {
    return path.resolve(configured);
  }
  const programFilesX86 = environment["ProgramFiles(x86)"];
  if (!programFilesX86) {
    throw new Error("ProgramFiles(x86) is not set");
  }
  return path.join(
    programFilesX86,
    "Microsoft",
    "Edge",
    "Application",
    "msedge.exe",
  );
}

function locateTampermonkeyExtension(userDataDir, {
  existsSync = fs.existsSync,
  readdirSync = fs.readdirSync,
} = {}) {
  const extensionRoot = path.join(
    userDataDir,
    "Default",
    "Extensions",
    TAMPERMONKEY_EXTENSION_ID,
  );
  if (!existsSync(extensionRoot)) {
    throw new Error(
      "Tampermonkey must be installed in the dedicated Edge E2E profile",
    );
  }
  const versions = readdirSync(extensionRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
  if (versions.length === 0) {
    throw new Error(
      "Tampermonkey must be installed in the dedicated Edge E2E profile",
    );
  }
  return path.join(extensionRoot, versions[0]);
}

function edgeLaunchArguments(userDataDir, extensionPath) {
  return [
    `--user-data-dir=${userDataDir}`,
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    "--remote-debugging-port=0",
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

async function waitForActivePort(activePortPath, browserProcess, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(activePortPath)) {
      const [port] = fs.readFileSync(activePortPath, "utf8").trim().split(/\r?\n/);
      if (/^\d+$/.test(port)) {
        return Number(port);
      }
    }
    if (browserProcess.exitCode !== null) {
      throw new Error(
        `Microsoft Edge exited before remote debugging started: ${browserProcess.exitCode}`,
      );
    }
    await delay(100);
  }
  throw new Error("Microsoft Edge remote debugging did not start");
}

async function launchDedicatedEdge({
  environment = process.env,
  userDataDir = readEdgeUserDataDir({ environment }),
} = {}) {
  const executablePath = edgeExecutablePath(environment);
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Microsoft Edge was not found: ${executablePath}`);
  }
  const extensionPath = locateTampermonkeyExtension(userDataDir);
  stopDedicatedEdge(userDataDir, { environment });
  const activePortPath = path.join(userDataDir, "DevToolsActivePort");
  fs.rmSync(activePortPath, { force: true });
  const browserProcess = spawn(
    executablePath,
    edgeLaunchArguments(userDataDir, extensionPath),
    {
      env: secretFreeEnvironment(environment),
      stdio: "ignore",
      windowsHide: true,
    },
  );
  const port = await waitForActivePort(activePortPath, browserProcess);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const contexts = browser.contexts();
  assert.equal(contexts.length, 1, "The dedicated Edge profile must expose one context");
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
          await Promise.race([
            session.send("Browser.close").catch(() => null),
            delay(3_000),
          ]);
        }
      }
      let exited = await waitForProcessExit(browserProcess, 3_000);
      if (!exited && !browserProcess.killed) {
        browserProcess.kill();
        exited = await waitForProcessExit(browserProcess, 3_000);
      }
      if (!exited) {
        stopDedicatedEdge(userDataDir, { environment });
      }
    },
  };
}

async function installUserscript(context, userscriptPath) {
  if (!fs.existsSync(userscriptPath)) {
    throw new Error(`Built userscript was not found: ${userscriptPath}`);
  }
  const userscriptSource = fs.readFileSync(userscriptPath, "utf8");
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
  const initialPages = new Set(context.pages());
  const settingsPage = await context.newPage();
  await settingsPage.goto(
    `chrome-extension://${TAMPERMONKEY_EXTENSION_ID}/options.html#nav=settings`,
    { waitUntil: "domcontentloaded", timeout: 30_000 },
  );
  const userScriptsPermission = await settingsPage.evaluate(async () => {
    if (typeof chrome.userScripts === "undefined") {
      return "disabled";
    }
    try {
      await chrome.userScripts.getScripts();
      return "enabled";
    } catch {
      return "disabled";
    }
  });
  if (userScriptsPermission !== "enabled") {
    throw new Error(
      "Tampermonkey requires Allow User Scripts in the dedicated Edge profile",
    );
  }
  const configurationMode = settingsPage
    .locator("select")
    .filter({ has: settingsPage.locator('option[value="50"]') })
    .filter({ has: settingsPage.locator('option[value="0"]') });
  await configurationMode.waitFor({ state: "visible", timeout: 30_000 });
  if ((await configurationMode.inputValue()) !== "100") {
    await configurationMode.selectOption("100");
  }
  const contentMode = settingsPage
    .locator("select")
    .filter({ has: settingsPage.locator('option[value="userscripts-dynamic"]') });
  await contentMode.waitFor({ state: "visible", timeout: 30_000 });
  if ((await contentMode.inputValue()) !== "userscripts-dynamic") {
    await contentMode.selectOption("userscripts-dynamic");
    const securitySection = contentMode.locator("xpath=ancestor::table[1]");
    const saveButton = securitySection.getByRole("button", {
      name: /^(保存|Save)$/,
    });
    await saveButton.waitFor({ state: "visible", timeout: 10_000 });
    await saveButton.click();
    await delay(2_000);
  }

  const utilityPage = await context.newPage();
  await utilityPage.goto(
    `chrome-extension://${TAMPERMONKEY_EXTENSION_ID}/options.html#nav=utils`,
    { waitUntil: "domcontentloaded", timeout: 30_000 },
  );
  const fileInput = utilityPage.locator('input[type="file"]');
  await fileInput.waitFor({ state: "attached", timeout: 30_000 });
  await fileInput.setInputFiles(userscriptPath);

  const deadline = Date.now() + 30_000;
  let clicked = false;
  while (!clicked && Date.now() < deadline) {
    for (const page of context.pages()) {
      if (
        !page.url().startsWith(
          `chrome-extension://${TAMPERMONKEY_EXTENSION_ID}/ask.html`,
        )
      ) {
        continue;
      }
      const controls = page.getByRole("button", {
        name: /^(インストール|更新|再インストール|上書き|変更|Install|Update|Reinstall|Overwrite|Modify)$/,
      });
      for (let index = 0; index < (await controls.count()); index += 1) {
        const control = controls.nth(index);
        if (await control.isVisible().catch(() => false)) {
          await control.click();
          clicked = true;
          break;
        }
      }
      if (clicked) {
        break;
      }
    }
    if (!clicked) {
      await delay(250);
    }
  }
  if (!clicked) {
    throw new Error("Tampermonkey did not show the userscript install confirmation");
  }
  const sourceUpdateDeadline = Date.now() + 30_000;
  let sourceUpdated = false;
  while (!sourceUpdated && Date.now() < sourceUpdateDeadline) {
    sourceUpdated = await utilityPage.evaluate(async (expectedFingerprint) => {
      const records = await chrome.storage.local.get(null);
      return Object.entries(records).some(
        ([key, record]) =>
          key.startsWith("!extdb.@source#") &&
          JSON.stringify(record?.value ?? "").includes(expectedFingerprint),
      );
    }, buildFingerprint);
    if (!sourceUpdated) {
      await delay(250);
    }
  }
  if (!sourceUpdated) {
    throw new Error("Tampermonkey did not save the current userscript source");
  }
  await delay(1_000);

  await utilityPage.goto(
    `chrome-extension://${TAMPERMONKEY_EXTENSION_ID}/options.html#nav=dashboard`,
    { waitUntil: "domcontentloaded", timeout: 30_000 },
  );
  const scriptRow = utilityPage
    .locator("tr.scripttr")
    .filter({ hasText: userscriptName });
  await scriptRow.waitFor({ state: "visible", timeout: 30_000 });
  const enabledCheckbox = scriptRow.locator('input[type="checkbox"]');
  const requiresReview = await utilityPage.evaluate(async (expectedName) => {
    const records = await chrome.storage.local.get(null);
    const metadata = Object.entries(records).find(
      ([key, record]) =>
        key.startsWith("!extdb.@meta#") &&
        !record?.value?.deleted &&
        record?.value?.name === expectedName,
    )?.[1]?.value;
    return metadata?.evilness !== 0;
  }, userscriptName);
  if (!(await enabledCheckbox.isChecked()) && requiresReview) {
    await scriptRow.locator('[title="編集"],[title="Edit"]').click();
    await utilityPage.waitForURL(/\+editor$/, { timeout: 10_000 });
    const editor = utilityPage.locator(".CodeMirror:visible");
    await editor.waitFor({ state: "visible", timeout: 10_000 });
    await editor.evaluate((node) => {
      const codeMirror = node.CodeMirror;
      codeMirror.setValue(`${codeMirror.getValue()}\n`);
    });
    const fileMenus = utilityPage.getByText(/^(ファイル|File)$/, {
      exact: true,
    });
    let fileMenuClicked = false;
    for (let index = 0; index < (await fileMenus.count()); index += 1) {
      const fileMenu = fileMenus.nth(index);
      if (await fileMenu.isVisible()) {
        await fileMenu.click();
        fileMenuClicked = true;
        break;
      }
    }
    if (!fileMenuClicked) {
      throw new Error("Tampermonkey editor File menu was not visible");
    }
    await utilityPage
      .locator("tr.entry:visible")
      .filter({ hasText: /^(保存|Save).*Ctrl-S$/ })
      .click();

    const modificationDeadline = Date.now() + 30_000;
    let modificationConfirmed = false;
    while (!modificationConfirmed && Date.now() < modificationDeadline) {
      for (const page of context.pages()) {
        const controls = page.getByRole("button", {
          name: /^(変更|Modify)$/,
        });
        for (let index = 0; index < (await controls.count()); index += 1) {
          const control = controls.nth(index);
          if (await control.isVisible().catch(() => false)) {
            await control.click();
            modificationConfirmed = true;
            break;
          }
        }
        if (modificationConfirmed) {
          break;
        }
      }
      if (!modificationConfirmed) {
        await delay(250);
      }
    }
    if (!modificationConfirmed) {
      throw new Error(
        "Tampermonkey did not show the userscript modification confirmation",
      );
    }
    await delay(5_000);
    await utilityPage.goto(
      `chrome-extension://${TAMPERMONKEY_EXTENSION_ID}/options.html#nav=dashboard`,
      { waitUntil: "domcontentloaded", timeout: 30_000 },
    );
    const verifiedRow = utilityPage
      .locator("tr.scripttr")
      .filter({ hasText: userscriptName });
    await verifiedRow.waitFor({ state: "visible", timeout: 30_000 });
    const verifiedCheckbox = verifiedRow.locator('input[type="checkbox"]');
    if (!(await verifiedCheckbox.isChecked())) {
      await verifiedCheckbox.click();
      await delay(1_000);
    }
    assert.equal(
      await verifiedCheckbox.isChecked(),
      true,
      "Tampermonkey did not enable the reviewed userscript",
    );
  }
  await utilityPage.goto(
    `chrome-extension://${TAMPERMONKEY_EXTENSION_ID}/options.html#nav=dashboard`,
    { waitUntil: "domcontentloaded", timeout: 30_000 },
  );
  const enabledRow = utilityPage
    .locator("tr.scripttr")
    .filter({ hasText: userscriptName });
  await enabledRow.waitFor({ state: "visible", timeout: 30_000 });
  const finalCheckbox = enabledRow.locator('input[type="checkbox"]');
  if (!(await finalCheckbox.isChecked())) {
    await finalCheckbox.click();
    await delay(1_000);
  }
  assert.equal(
    await finalCheckbox.isChecked(),
    true,
    "Tampermonkey did not enable the current userscript",
  );
  for (const page of context.pages()) {
    if (!initialPages.has(page)) {
      await page.close().catch(() => null);
    }
  }
}

module.exports = {
  DEFAULT_SYNC_API_ORIGIN,
  SYNC_TOKEN_KEY,
  TAMPERMONKEY_EXTENSION_ID,
  assertTokenShape,
  defaultChromeUserDataDir,
  defaultEdgeE2EUserDataDir,
  defaultEdgeUserDataDir,
  discoverTampermonkeyStorageDirectories,
  edgeLaunchArguments,
  extractSyncTokenCandidates,
  installUserscript,
  isSameOrDescendantPath,
  launchDedicatedEdge,
  listProfileDirectories,
  locateTampermonkeyExtension,
  readConfiguredToken,
  readDirectoryBuffers,
  readEdgeUserDataDir,
  resolveSyncToken,
  scanStoredSyncTokenCandidates,
  secretFreeEnvironment,
  stopDedicatedEdgePowerShell,
  validateSyncToken,
  writeEnvToken,
};
