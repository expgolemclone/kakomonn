const fs = require("node:fs");
const path = require("node:path");

const DEVTOOLS_ACTIVE_PORT_FILE = "DevToolsActivePort";
const DEVTOOLS_HOST = "127.0.0.1";
const DEVTOOLS_TIMEOUT_MS = 30_000;
const TAMPERMONKEY_BETA_EXTENSION_ID = "gcalenpjmijncebpfijmoaglllgpjagf";

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function activePortPath(userDataDir) {
  return path.join(userDataDir, DEVTOOLS_ACTIVE_PORT_FILE);
}

function readDevToolsActivePort(
  userDataDir,
  {
    existsSync = fs.existsSync,
    readFileSync = fs.readFileSync,
  } = {},
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
  {
    delayImpl = delay,
    readPort = readDevToolsActivePort,
    timeoutMs = DEVTOOLS_TIMEOUT_MS,
  } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (Number.isInteger(browserProcess.exitCode)) {
      throw new Error(
        `Google Chrome exited before remote debugging started: ${browserProcess.exitCode}`,
      );
    }
    try {
      return readPort(userDataDir);
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

async function createPageTarget(
  port,
  url = "about:blank",
  {
    fetchImpl = fetch,
  } = {},
) {
  const response = await fetchImpl(
    devToolsURL(port, `/json/new?${encodeURIComponent(url)}`),
    { method: "PUT", signal: AbortSignal.timeout(DEVTOOLS_TIMEOUT_MS) },
  );
  const target = await readJsonResponse(response, "Chrome page creation");
  if (
    target?.type !== "page" ||
    typeof target.id !== "string" ||
    typeof target.webSocketDebuggerUrl !== "string"
  ) {
    throw new Error("Chrome page creation returned an invalid target");
  }
  return target;
}

async function closePageTarget(
  port,
  targetId,
  {
    fetchImpl = fetch,
  } = {},
) {
  const response = await fetchImpl(
    devToolsURL(port, `/json/close/${encodeURIComponent(targetId)}`),
    { signal: AbortSignal.timeout(DEVTOOLS_TIMEOUT_MS) },
  );
  if (!response.ok) {
    await response.arrayBuffer().catch(() => null);
    throw new Error(`Chrome page close failed with HTTP ${response.status}`);
  }
}

class DevToolsSession {
  constructor(webSocket, timeoutMs) {
    this.webSocket = webSocket;
    this.timeoutMs = timeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    webSocket.addEventListener("message", (event) => this.onMessage(event));
  }

  onMessage(event) {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (Number.isSafeInteger(message.id)) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) {
        pending.reject(
          new Error(
            `Chrome DevTools ${pending.method} failed: ${message.error.message ?? "unknown error"}`,
          ),
        );
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }
    const listeners = this.listeners.get(message.method);
    if (!listeners) {
      return;
    }
    this.listeners.delete(message.method);
    for (const listener of listeners) {
      clearTimeout(listener.timeout);
      listener.resolve(message.params ?? {});
    }
  }

  command(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Chrome DevTools ${method} timed out`));
      }, this.timeoutMs);
      this.pending.set(id, { method, reject, resolve, timeout });
      this.webSocket.send(JSON.stringify({ id, method, params }));
    });
  }

  waitForEvent(method) {
    return new Promise((resolve, reject) => {
      const listener = {
        reject,
        resolve,
        timeout: setTimeout(() => {
          const listeners = this.listeners.get(method) ?? [];
          this.listeners.set(
            method,
            listeners.filter((candidate) => candidate !== listener),
          );
          reject(new Error(`Chrome DevTools ${method} timed out`));
        }, this.timeoutMs),
      };
      const listeners = this.listeners.get(method) ?? [];
      listeners.push(listener);
      this.listeners.set(method, listeners);
    });
  }

  close() {
    this.webSocket.close();
  }
}

async function connectDevToolsSession(
  webSocketDebuggerUrl,
  {
    timeoutMs = DEVTOOLS_TIMEOUT_MS,
    WebSocketImpl = globalThis.WebSocket,
  } = {},
) {
  if (typeof WebSocketImpl !== "function") {
    throw new Error("The Node.js WebSocket API is unavailable");
  }
  const webSocket = new WebSocketImpl(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      webSocket.close();
      reject(new Error("Chrome DevTools connection timed out"));
    }, timeoutMs);
    webSocket.addEventListener("open", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
    webSocket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("Chrome DevTools connection failed"));
    }, { once: true });
  });
  return new DevToolsSession(webSocket, timeoutMs);
}

async function readPageState(session) {
  const evaluated = await session.command("Runtime.evaluate", {
    expression:
      "({ href: location.href, readyState: document.readyState })",
    returnByValue: true,
  });
  if (evaluated.exceptionDetails) {
    throw new Error("Chrome page state evaluation failed");
  }
  const state = evaluated.result?.value;
  if (
    typeof state?.href !== "string" ||
    typeof state?.readyState !== "string"
  ) {
    throw new Error("Chrome page state evaluation returned invalid data");
  }
  return state;
}

async function navigateAndWait(
  session,
  url,
  {
    delayImpl = delay,
    timeoutMs = DEVTOOLS_TIMEOUT_MS,
  } = {},
) {
  const previousURL = (await readPageState(session)).href;
  await navigate(session, url);
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const state = await readPageState(session);
      if (
        state.href !== previousURL &&
        state.readyState !== "loading" &&
        !state.href.startsWith("chrome-error://")
      ) {
        return state;
      }
    } catch (error) {
      lastError = error;
    }
    await delayImpl(50);
  }
  throw new Error(
    `Chrome navigation did not become ready: ${lastError?.message ?? url}`,
  );
}

async function navigate(session, url) {
  const result = await session.command("Page.navigate", { url });
  if (result.errorText) {
    throw new Error(`Chrome navigation failed: ${result.errorText}`);
  }
  return result;
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

async function prepareKakomonnPage(
  port,
  {
    connectSession = connectDevToolsSession,
    createTarget = createPageTarget,
    closeTarget = closePageTarget,
    openURL,
    target: suppliedTarget = null,
    tampermonkeyExtensionId,
    userscriptIdentity,
  },
) {
  const target = suppliedTarget ?? await createTarget(port);
  let session = null;
  let applicationTarget = null;
  try {
    session = await connectSession(target.webSocketDebuggerUrl);
    await session.command("Page.enable");
    await navigateAndWait(
      session,
      `chrome-extension://${tampermonkeyExtensionId}/options.html#nav=settings`,
    );
    const evaluated = await session.command("Runtime.evaluate", {
      awaitPromise: true,
      expression: tampermonkeyReadyExpression(userscriptIdentity),
      returnByValue: true,
    });
    if (evaluated.exceptionDetails) {
      throw new Error("Tampermonkey readiness evaluation failed");
    }
    const readiness = evaluated.result?.value;
    if (
      readiness?.error !== null ||
      readiness?.scriptCount !== 1
    ) {
      throw new Error(
        `Tampermonkey transport is not ready: ${readiness?.error ?? "invalid readiness response"}`,
      );
    }
    applicationTarget = await createTarget(port, openURL);
    await closeTarget(port, target.id);
    return Object.freeze({ port, targetId: applicationTarget.id });
  } catch (error) {
    if (applicationTarget !== null) {
      await closeTarget(port, applicationTarget.id).catch(() => null);
    }
    await closeTarget(port, target.id).catch(() => null);
    throw error;
  } finally {
    session?.close();
  }
}

module.exports = {
  DEVTOOLS_ACTIVE_PORT_FILE,
  DEVTOOLS_TIMEOUT_MS,
  TAMPERMONKEY_BETA_EXTENSION_ID,
  activePortPath,
  closePageTarget,
  connectDevToolsSession,
  createPageTarget,
  navigate,
  navigateAndWait,
  readPageState,
  tampermonkeyReadyExpression,
  prepareKakomonnPage,
  readDevToolsActivePort,
  waitForDevToolsActivePort,
};
