const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const DEVTOOLS_ACTIVE_PORT_FILE = "DevToolsActivePort";
const DEVTOOLS_HOST = "127.0.0.1";
const DEVTOOLS_TIMEOUT_MS = 30_000;
const LAUNCH_RETRY_DELAY_MS = 250;
const TAMPERMONKEY_BETA_EXTENSION_ID = "gcalenpjmijncebpfijmoaglllgpjagf";
const TRANSIENT_BRIDGE_ERRORS = new Set([
  "runtime_unavailable",
  "storage_unavailable",
  "network_error",
  "request_aborted",
  "request_timeout",
]);

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function activePortPath(userDataDir) {
  return path.join(userDataDir, DEVTOOLS_ACTIVE_PORT_FILE);
}

function readDevToolsActivePort(
  userDataDir,
  { existsSync = fs.existsSync, readFileSync = fs.readFileSync } = {},
) {
  const filePath = activePortPath(userDataDir);
  if (!existsSync(filePath)) {
    throw new Error("Google Chrome remote debugging is not ready");
  }
  const [portText] = readFileSync(filePath, "utf8").trim().split(/\r?\n/);
  if (!/^\d+$/.test(portText)) {
    throw new Error("Google Chrome remote debugging port is invalid");
  }
  const port = Number(portText);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Google Chrome remote debugging port is invalid");
  }
  return port;
}

async function waitForDevToolsActivePort(
  userDataDir,
  browserProcess,
  { delayImpl = delay, fetchImpl = fetch, now = Date.now,
    readPort = readDevToolsActivePort, timeoutMs = DEVTOOLS_TIMEOUT_MS } = {},
) {
  const deadline = now() + timeoutMs;
  let lastError = null;
  while (now() < deadline) {
    // Chrome can hand off to another process and exit successfully on Windows.
    if (Number.isInteger(browserProcess.exitCode) && browserProcess.exitCode !== 0) {
      throw new Error(
        `Google Chrome exited before remote debugging started: ${browserProcess.exitCode}`,
      );
    }
    try {
      const port = readPort(userDataDir);
      // The file alone is not readiness: startup can publish a port before its
      // HTTP endpoint is usable. Both launchers share this actual CDP handshake.
      const response = await fetchImpl(devToolsURL(port, '/json/version'), {
        signal: AbortSignal.timeout(Math.max(1, deadline - now())),
      });
      const version = await readJsonResponse(response, 'Chrome remote debugging readiness');
      const socket = new URL(version.webSocketDebuggerUrl);
      if (socket.protocol !== 'ws:' || socket.hostname !== DEVTOOLS_HOST ||
          socket.port !== String(port) || !socket.pathname.startsWith('/devtools/browser/')) {
        throw new Error('Chrome remote debugging returned an invalid browser endpoint');
      }
      return port;
    } catch (error) {
      lastError = error;
    }
    await delayImpl(100);
  }
  throw new Error(
    `Google Chrome remote debugging did not start: ${lastError?.message ?? "unknown error"}`,
  );
}

function devToolsURL(port, pathname) {
  return `http://${DEVTOOLS_HOST}:${port}${pathname}`;
}

async function readJsonResponse(response, label) {
  if (!response.ok) {
    await response.arrayBuffer().catch(() => null);
    throw new Error(`${label} failed with HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${label} returned invalid JSON`, { cause: error });
  }
}

function tampermonkeyReadyExpression(userscriptIdentity) {
  const expectedName = JSON.stringify(userscriptIdentity.name);
  const expectedNamespace = JSON.stringify(userscriptIdentity.namespace);
  return String.raw`(async () => {
  if (typeof chrome !== "object" || typeof chrome.storage !== "object") {
    return { error: "Tampermonkey storage is unavailable", scriptCount: 0 };
  }
  try {
    const records = await chrome.storage.local.get(null);
    const scripts = Object.entries(records).filter(
      ([key, record]) =>
        key.startsWith("!extdb.@meta#") &&
        !record?.value?.deleted &&
        record?.value?.name === ${expectedName} &&
        record?.value?.namespace === ${expectedNamespace}
    );
    if (scripts.length !== 1) {
      return {
        error: "The dedicated profile must contain exactly one userscript",
        scriptCount: scripts.length,
      };
    }
    const metadata = scripts[0][1].value;
    const source = records["!extdb.@source#" + metadata.uuid]?.value;
    if (
      metadata.enabled !== true ||
      metadata.evilness !== 0 ||
      source === undefined
    ) {
      return { error: "The userscript is not ready", scriptCount: 1 };
    }
    return { error: null, scriptCount: 1 };
  } catch (error) {
    return { error: String(error), scriptCount: 0 };
  }
})()`;
}

async function waitForKakomonnLaunch(page, { timeoutMs = DEVTOOLS_TIMEOUT_MS } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const handle = await page.waitForFunction(() => {
      const bridgeState = document.documentElement.dataset.kakomonnReaderBridgeState;
      const bridgeError = document.documentElement.dataset.kakomonnReaderBridgeError;
      const openError = document.querySelector("#open-error-detail")?.textContent;
      if (/^https:\/\/chushoks\.kakomonn\.com\/questions\/\d+$/.test(location.href)) {
        return JSON.stringify({ state: "ready" });
      }
      if (["ready", "empty", "unauthorized", "error"].includes(bridgeState)) {
        return JSON.stringify({ state: bridgeState, code: bridgeError });
      }
      if (openError?.includes("code=reader_ready_timeout")) {
        return JSON.stringify({ state: "error", code: "reader_ready_timeout" });
      }
      return false;
    }, null, { timeout: Math.max(1, deadline - Date.now()) });
    const result = JSON.parse(await handle.jsonValue());
    await handle.dispose();
    if (result.state !== "error") return result.state;
    if (!TRANSIENT_BRIDGE_ERRORS.has(result.code) && result.code !== "reader_ready_timeout") {
      throw new Error(`Kakomonn reader bridge failed: ${result.code}`);
    }
    if (Date.now() + LAUNCH_RETRY_DELAY_MS >= deadline) break;
    await page.waitForTimeout(LAUNCH_RETRY_DELAY_MS);
    await page.reload({ waitUntil: "domcontentloaded", timeout: Math.max(1, deadline - Date.now()) });
  }
  throw new Error("Kakomonn reader bridge did not become ready");
}

async function prepareKakomonnPage(port, {
  connect = chromium.connectOverCDP.bind(chromium),
  openURL,
  tampermonkeyExtensionId,
  userscriptIdentity,
}) {
  const browser = await connect(devToolsURL(port, ""), { timeout: DEVTOOLS_TIMEOUT_MS });
  const context = browser.contexts()[0];
  let bootstrap;
  try {
    if (!context) throw new Error("Dedicated Chrome has no browser context");
    bootstrap = await context.newPage();
    await bootstrap.goto(
      `chrome-extension://${tampermonkeyExtensionId}/options.html#nav=settings`,
      { waitUntil: "domcontentloaded", timeout: DEVTOOLS_TIMEOUT_MS },
    );
    const readiness = await bootstrap.evaluate(tampermonkeyReadyExpression(userscriptIdentity));
    if (readiness?.error !== null || readiness?.scriptCount !== 1) {
      throw new Error(`Tampermonkey transport is not ready: ${readiness?.error ?? 'invalid readiness response'}`);
    }
    const application = await context.newPage();
    await application.goto(openURL, { waitUntil: "domcontentloaded", timeout: DEVTOOLS_TIMEOUT_MS });
    await bootstrap.close();
    bootstrap = null;
    await waitForKakomonnLaunch(application);
    const session = await context.newCDPSession(application);
    const { targetInfo } = await session.send("Target.getTargetInfo");
    await session.detach();
    return Object.freeze({ port, targetId: targetInfo.targetId });
  } finally {
    await bootstrap?.close();
    // Closing a connectOverCDP client disconnects without terminating Chrome.
    await browser.close();
  }
}

module.exports = {
  DEVTOOLS_ACTIVE_PORT_FILE,
  DEVTOOLS_TIMEOUT_MS,
  TAMPERMONKEY_BETA_EXTENSION_ID,
  activePortPath,
  tampermonkeyReadyExpression,
  waitForKakomonnLaunch,
  prepareKakomonnPage,
  readDevToolsActivePort,
  waitForDevToolsActivePort,
};
