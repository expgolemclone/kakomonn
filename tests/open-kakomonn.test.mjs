import assert from "node:assert/strict";
import test from "node:test";

import chromeDevTools from "../scripts/chrome-devtools.cjs";
import windowsChromeProfile from "../scripts/windows-chrome-profile.cjs";
import {
  CHROME_AUTOPLAY_ARGUMENT,
  CHROME_BOOTSTRAP_URL,
  CHROME_HIDE_CRASH_RESTORE_BUBBLE_ARGUMENT,
  CHROME_REMOTE_DEBUGGING_ARGUMENT,
  KAKOMONN_OPEN_URL,
  openKakomonn,
  readUserscriptIdentity,
  resolveKakomonnLaunch,
} from "../scripts/open-kakomonn.mjs";

const {
  prepareKakomonnPage,
  readDevToolsActivePort,
  tampermonkeyReadyExpression,
  waitForDevToolsActivePort,
} = chromeDevTools;
const {
  inspectDedicatedChrome,
  inspectDedicatedChromePowerShell,
  stopDedicatedChromePowerShell,
} = windowsChromeProfile;

const SYSTEM_ENVIRONMENT = {
  LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
  ProgramFiles: "C:\\Program Files",
  KAKOMONN_SYNC_TOKEN: "process-token-must-not-be-forwarded",
  SystemRoot: "C:\\Windows",
};
const CHROME_PATH =
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE_PATH =
  "C:\\Users\\tester\\AppData\\Local\\kakomonn-chrome-e2e";
const USERSCRIPT_IDENTITY = Object.freeze({
  name: "Reader fixture",
  namespace: "test.reader",
});
const TAMPERMONKEY_READY_EXPRESSION =
  tampermonkeyReadyExpression(USERSCRIPT_IDENTITY);
const EMPTY_PROFILE_STATE = Object.freeze({
  autoplayAllowed: false,
  processCount: 0,
  remoteDebuggingEnabled: false,
  rootProcessCount: 0,
});

function expectedStat(candidatePath) {
  if (candidatePath === CHROME_PATH) {
    return { isDirectory: () => false, isFile: () => true };
  }
  if (candidatePath === PROFILE_PATH) {
    return { isDirectory: () => true, isFile: () => false };
  }
  const error = new Error(`Missing fixture: ${candidatePath}`);
  error.code = "ENOENT";
  throw error;
}

test("resolves a dedicated Chrome bootstrap that cannot open the application URL", () => {
  const launch = resolveKakomonnLaunch({
    configuration: {},
    platform: "win32",
    stat: expectedStat,
    systemEnvironment: SYSTEM_ENVIRONMENT,
  });

  assert.deepEqual(launch, {
    arguments: [
      `--user-data-dir=${PROFILE_PATH}`,
      CHROME_HIDE_CRASH_RESTORE_BUBBLE_ARGUMENT,
      CHROME_AUTOPLAY_ARGUMENT,
      CHROME_REMOTE_DEBUGGING_ARGUMENT,
      CHROME_BOOTSTRAP_URL,
    ],
    executablePath: CHROME_PATH,
    userDataDir: PROFILE_PATH,
  });
});

test("starts only the browser when the dedicated profile is cold", async () => {
  const calls = [];
  let unrefCallCount = 0;
  const profileInspections = [];
  const preparations = [];
  const removals = [];
  const spawnProcess = (...arguments_) => {
    calls.push(arguments_);
    return {
      exitCode: null,
      unref() {
        unrefCallCount += 1;
      },
    };
  };

  const launch = await openKakomonn({
    configuration: {},
    inspectProfile(userDataDir, options) {
      profileInspections.push({ options, userDataDir });
      return EMPTY_PROFILE_STATE;
    },
    platform: "win32",
    async prepareBrowser() {
      preparations.push("unexpected");
      throw new Error("cold Chrome must not create an application target");
    },
    removeFile(filePath, options) {
      removals.push({ filePath, options });
    },
    spawnProcess,
    stat: expectedStat,
    systemEnvironment: SYSTEM_ENVIRONMENT,
    async waitForDevToolsPort(userDataDir, browserProcess) {
      assert.equal(userDataDir, PROFILE_PATH);
      assert.equal(browserProcess.exitCode, null);
      return 9222;
    },
  });

  assert.deepEqual(profileInspections, [
    {
      options: { systemEnvironment: SYSTEM_ENVIRONMENT },
      userDataDir: PROFILE_PATH,
    },
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], CHROME_PATH);
  assert.deepEqual(calls[0][1], [
    `--user-data-dir=${PROFILE_PATH}`,
    CHROME_HIDE_CRASH_RESTORE_BUBBLE_ARGUMENT,
    CHROME_AUTOPLAY_ARGUMENT,
    CHROME_REMOTE_DEBUGGING_ARGUMENT,
    CHROME_BOOTSTRAP_URL,
  ]);
  assert.equal(calls[0][1].includes(KAKOMONN_OPEN_URL), false);
  assert.deepEqual(calls[0][2], {
    detached: true,
    env: {
      LOCALAPPDATA: SYSTEM_ENVIRONMENT.LOCALAPPDATA,
      ProgramFiles: SYSTEM_ENVIRONMENT.ProgramFiles,
      SystemRoot: SYSTEM_ENVIRONMENT.SystemRoot,
    },
    stdio: "ignore",
  });
  assert.equal(unrefCallCount, 1);
  assert.deepEqual(removals, [{
    filePath: `${PROFILE_PATH}\\DevToolsActivePort`,
    options: { force: true },
  }]);
  assert.deepEqual(preparations, []);
  assert.deepEqual(launch, {
    arguments: calls[0][1],
    applicationOpened: false,
    coldStart: true,
    devToolsPort: 9222,
    executablePath: CHROME_PATH,
    targetId: null,
    userDataDir: PROFILE_PATH,
  });
});

test("prepares a new page in an already warm compatible Chrome process", async () => {
  let stopCalled = false;
  let spawnCalled = false;
  let prepared = false;
  const result = await openKakomonn({
    configuration: {},
    inspectProfile() {
      return {
        autoplayAllowed: true,
        processCount: 8,
        remoteDebuggingEnabled: true,
        rootProcessCount: 1,
      };
    },
    platform: "win32",
    async prepareBrowser(port) {
      assert.equal(port, 9333);
      prepared = true;
      return { targetId: "warm-target" };
    },
    readDevToolsPort(userDataDir) {
      assert.equal(userDataDir, PROFILE_PATH);
      return 9333;
    },
    spawnProcess() {
      spawnCalled = true;
      return { unref() {} };
    },
    stat: expectedStat,
    stopProfile() {
      stopCalled = true;
    },
    systemEnvironment: SYSTEM_ENVIRONMENT,
  });
  assert.equal(spawnCalled, false);
  assert.equal(prepared, true);
  assert.equal(stopCalled, false);
  assert.equal(result.applicationOpened, true);
  assert.equal(result.coldStart, false);
  assert.equal(result.targetId, "warm-target");
});

test("restarts an incompatible Chrome process without opening the application", async () => {
  const operations = [];
  await openKakomonn({
    configuration: {},
    inspectProfile() {
      operations.push("inspect");
      return {
        autoplayAllowed: false,
        processCount: 8,
        remoteDebuggingEnabled: false,
        rootProcessCount: 1,
      };
    },
    platform: "win32",
    async prepareBrowser() {
      throw new Error("restarted Chrome must stop before app preparation");
    },
    removeFile() {
      operations.push("remove-port");
    },
    spawnProcess() {
      operations.push("spawn");
      return { exitCode: null, unref() {} };
    },
    stat: expectedStat,
    stopProfile(userDataDir, options) {
      operations.push("stop");
      assert.equal(userDataDir, PROFILE_PATH);
      assert.deepEqual(options, { systemEnvironment: SYSTEM_ENVIRONMENT });
    },
    systemEnvironment: SYSTEM_ENVIRONMENT,
    async waitForDevToolsPort() {
      operations.push("wait-port");
      return 9444;
    },
  });
  assert.deepEqual(operations, [
    "inspect",
    "stop",
    "remove-port",
    "spawn",
    "wait-port",
  ]);
});

test("does not launch when a required dedicated Chrome restart fails", async () => {
  let spawnCalled = false;
  await assert.rejects(
    async () =>
      openKakomonn({
        configuration: {},
        inspectProfile: () => ({
          autoplayAllowed: false,
          processCount: 1,
          remoteDebuggingEnabled: false,
          rootProcessCount: 1,
        }),
        platform: "win32",
        spawnProcess() {
          spawnCalled = true;
          return { unref() {} };
        },
        stat: expectedStat,
        stopProfile() {
          throw new Error("restart failed");
        },
        systemEnvironment: SYSTEM_ENVIRONMENT,
      }),
    /restart failed/,
  );
  assert.equal(spawnCalled, false);
});

test("does not launch when the dedicated Chrome process cannot be inspected", async () => {
  let spawnCalled = false;
  await assert.rejects(
    async () =>
      openKakomonn({
        configuration: {},
        inspectProfile() {
          throw new Error("inspection failed");
        },
        platform: "win32",
        spawnProcess() {
          spawnCalled = true;
          return { unref() {} };
        },
        stat: expectedStat,
        systemEnvironment: SYSTEM_ENVIRONMENT,
      }),
    /inspection failed/,
  );
  assert.equal(spawnCalled, false);
});

test("uses configured Chrome paths", () => {
  const configuredChrome = "D:\\Chrome\\chrome.exe";
  const configuredProfile = "D:\\KakomonnProfile";
  const launch = resolveKakomonnLaunch({
    configuration: {
      KAKOMONN_CHROME_EXECUTABLE: configuredChrome,
      KAKOMONN_CHROME_USER_DATA_DIR: configuredProfile,
    },
    platform: "win32",
    stat(candidatePath) {
      if (candidatePath === configuredChrome) {
        return { isDirectory: () => false, isFile: () => true };
      }
      if (candidatePath === configuredProfile) {
        return { isDirectory: () => true, isFile: () => false };
      }
      throw new Error(`Unexpected path: ${candidatePath}`);
    },
    systemEnvironment: SYSTEM_ENVIRONMENT,
  });

  assert.equal(launch.executablePath, configuredChrome);
  assert.equal(launch.userDataDir, configuredProfile);
  assert.equal(launch.arguments.at(-1), CHROME_BOOTSTRAP_URL);
  assert.equal(launch.arguments.includes(KAKOMONN_OPEN_URL), false);
});

test("rejects unsupported platforms and missing system paths", () => {
  assert.throws(
    () =>
      resolveKakomonnLaunch({
        configuration: {},
        platform: "linux",
        stat: expectedStat,
        systemEnvironment: SYSTEM_ENVIRONMENT,
      }),
    /requires Windows/,
  );
  assert.throws(
    () =>
      resolveKakomonnLaunch({
        configuration: {},
        platform: "win32",
        stat: expectedStat,
        systemEnvironment: {
          LOCALAPPDATA: SYSTEM_ENVIRONMENT.LOCALAPPDATA,
        },
      }),
    /ProgramFiles is not set/,
  );
  assert.throws(
    () =>
      resolveKakomonnLaunch({
        configuration: {},
        platform: "win32",
        stat: expectedStat,
        systemEnvironment: {
          ProgramFiles: SYSTEM_ENVIRONMENT.ProgramFiles,
        },
      }),
    /LOCALAPPDATA is not set/,
  );
});

test("rejects missing and incorrectly typed Chrome paths", () => {
  assert.throws(
    () =>
      resolveKakomonnLaunch({
        configuration: {},
        platform: "win32",
        stat(candidatePath) {
          if (candidatePath === CHROME_PATH) {
            const error = new Error("missing");
            error.code = "ENOENT";
            throw error;
          }
          return expectedStat(candidatePath);
        },
        systemEnvironment: SYSTEM_ENVIRONMENT,
      }),
    /Chrome executable was not found/,
  );
  assert.throws(
    () =>
      resolveKakomonnLaunch({
        configuration: {},
        platform: "win32",
        stat(candidatePath) {
          if (candidatePath === PROFILE_PATH) {
            return { isDirectory: () => false, isFile: () => true };
          }
          return expectedStat(candidatePath);
        },
        systemEnvironment: SYSTEM_ENVIRONMENT,
      }),
    /Dedicated Chrome profile has an unexpected type/,
  );
});

test("rejects the standard Chrome profile before inspecting processes", async () => {
  const standardProfile =
    "C:\\Users\\tester\\AppData\\Local\\Google\\Chrome\\User Data\\Default";
  let inspected = false;
  await assert.rejects(
    async () =>
      openKakomonn({
        configuration: {
          KAKOMONN_CHROME_USER_DATA_DIR: standardProfile,
        },
        inspectProfile() {
          inspected = true;
          return EMPTY_PROFILE_STATE;
        },
        platform: "win32",
        stat(candidatePath) {
          if (candidatePath === CHROME_PATH) {
            return { isDirectory: () => false, isFile: () => true };
          }
          if (candidatePath === standardProfile) {
            return { isDirectory: () => true, isFile: () => false };
          }
          throw new Error(`Unexpected path: ${candidatePath}`);
        },
        systemEnvironment: SYSTEM_ENVIRONMENT,
      }),
    /must be outside the standard Chrome user data directory/,
  );
  assert.equal(inspected, false);
});

test("inspects the exact Chrome profile through a sanitized PowerShell call", () => {
  const calls = [];
  const state = inspectDedicatedChrome(PROFILE_PATH, {
    spawnSyncImpl(executable, args, options) {
      calls.push({ args, executable, options });
      return {
        status: 0,
        stderr: "",
        stdout: JSON.stringify({
          autoplayAllowed: true,
          processCount: 7,
          remoteDebuggingEnabled: true,
          rootProcessCount: 1,
        }),
      };
    },
    systemEnvironment: SYSTEM_ENVIRONMENT,
  });
  assert.deepEqual(state, {
    autoplayAllowed: true,
    processCount: 7,
    remoteDebuggingEnabled: true,
    rootProcessCount: 1,
  });
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].executable,
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  );
  assert.deepEqual(calls[0].args.slice(-6), [
    "-UserDataDir",
    PROFILE_PATH,
    "-AutoplayArgument",
    CHROME_AUTOPLAY_ARGUMENT,
    "-RemoteDebuggingArgument",
    CHROME_REMOTE_DEBUGGING_ARGUMENT,
  ]);
  assert.equal(
    Object.keys(calls[0].options.env).some((key) =>
      key.startsWith("KAKOMONN_"),
    ),
    false,
  );
});

test("matches normalized Chrome profile paths in PowerShell", () => {
  assert.match(inspectDedicatedChromePowerShell, /autoplayAllowed/);
  assert.match(stopDedicatedChromePowerShell, /Get-DedicatedChromeProcesses/);
  assert.match(stopDedicatedChromePowerShell, /Dedicated Chrome processes did not exit/);
  assert.doesNotMatch(stopDedicatedChromePowerShell, /taskkill/i);
});

test("reads and validates the exact dedicated Chrome DevTools port", () => {
  assert.equal(
    readDevToolsActivePort(PROFILE_PATH, {
      existsSync: () => true,
      readFileSync: () => "49152\n/browser-id\n",
    }),
    49152,
  );
  assert.throws(
    () => readDevToolsActivePort(PROFILE_PATH, { existsSync: () => false }),
    /is not ready/,
  );
  assert.throws(
    () => readDevToolsActivePort(PROFILE_PATH, {
      existsSync: () => true,
      readFileSync: () => "not-a-port\n",
    }),
    /is invalid/,
  );
});

test("reads the launcher userscript identity from the canonical metadata", () => {
  assert.deepEqual(
    readUserscriptIdentity({
      readFile: () => [
        "// ==UserScript==",
        "// @name         Reader fixture",
        "// @namespace    test.reader",
        "// ==/UserScript==",
      ].join("\n"),
    }),
    USERSCRIPT_IDENTITY,
  );
  assert.throws(
    () => readUserscriptIdentity({ readFile: () => "// @name duplicate\n" }),
    /exactly one @namespace/,
  );
});

test("does not continue when cold Chrome exits before DevTools is ready", async () => {
  await assert.rejects(
    waitForDevToolsActivePort(
      PROFILE_PATH,
      { exitCode: 9 },
      { delayImpl: async () => {}, timeoutMs: 1 },
    ),
    /exited before remote debugging started: 9/,
  );
});

test("prewarms Tampermonkey before creating the fixed application target", async () => {
  const operations = [];
  let currentURL = "about:blank";
  const session = {
    close() {
      operations.push("disconnect");
    },
    async command(method, params) {
      operations.push({ method, params });
      if (method === "Runtime.evaluate") {
        if (params.expression !== TAMPERMONKEY_READY_EXPRESSION) {
          return {
            result: {
              value: { href: currentURL, readyState: "complete" },
            },
          };
        }
        return {
          result: { value: { error: null, scriptCount: 1 } },
        };
      }
      if (method === "Page.navigate") {
        currentURL = params.url;
      }
      return {};
    },
    async waitForEvent(method) {
      operations.push({ event: method });
    },
  };
  const result = await prepareKakomonnPage(9222, {
    async closeTarget(port, targetId) {
      operations.push({ closeTarget: targetId, port });
    },
    async connectSession(webSocketDebuggerUrl) {
      assert.equal(webSocketDebuggerUrl, "ws://prepared-target");
      return session;
    },
    async createTarget(port, url) {
      operations.push({ createTarget: url, port });
      return {
        id: "application-target",
        type: "page",
        url,
        webSocketDebuggerUrl: "ws://application-target",
      };
    },
    openURL: KAKOMONN_OPEN_URL,
    target: {
      id: "prepared-target",
      type: "page",
      url: CHROME_BOOTSTRAP_URL,
      webSocketDebuggerUrl: "ws://prepared-target",
    },
    tampermonkeyExtensionId: "tampermonkey-beta",
    userscriptIdentity: USERSCRIPT_IDENTITY,
  });
  assert.deepEqual(result, { port: 9222, targetId: "application-target" });
  const navigations = operations.filter(
    (operation) => operation?.method === "Page.navigate",
  );
  assert.deepEqual(
    navigations.map((operation) => operation.params.url),
    [
      "chrome-extension://tampermonkey-beta/options.html#nav=settings",
    ],
  );
  const evaluationIndex = operations.findIndex(
    (operation) =>
      operation?.method === "Runtime.evaluate" &&
      operation.params.expression === TAMPERMONKEY_READY_EXPRESSION,
  );
  assert.equal(evaluationIndex > operations.indexOf(navigations[0]), true);
  const applicationTargetIndex = operations.findIndex(
    (operation) => operation?.createTarget === KAKOMONN_OPEN_URL,
  );
  assert.equal(evaluationIndex < applicationTargetIndex, true);
  assert.deepEqual(operations[applicationTargetIndex + 1], {
    closeTarget: "prepared-target",
    port: 9222,
  });
  assert.match(TAMPERMONKEY_READY_EXPRESSION, /chrome\.storage\.local\.get/);
  assert.equal(operations.at(-1), "disconnect");
});

test("closes the bootstrap target without opening the app when Tampermonkey is not ready", async () => {
  const navigations = [];
  const closedTargets = [];
  let currentURL = "about:blank";
  await assert.rejects(
    prepareKakomonnPage(9222, {
      async closeTarget(port, targetId) {
        closedTargets.push({ port, targetId });
      },
      async connectSession() {
        return {
          close() {},
          async command(method, params) {
            if (method === "Page.navigate") {
              navigations.push(params.url);
              currentURL = params.url;
              return {};
            }
            if (method === "Runtime.evaluate") {
              if (params.expression !== TAMPERMONKEY_READY_EXPRESSION) {
                return {
                  result: {
                    value: { href: currentURL, readyState: "complete" },
                  },
                };
              }
              return {
                result: {
                  value: {
                    error: "The userscript is not ready",
                    scriptCount: 0,
                  },
                },
              };
            }
            return {};
          },
          async waitForEvent() {},
        };
      },
      async createTarget() {
        return {
          id: "failed-target",
          type: "page",
          webSocketDebuggerUrl: "ws://failed-target",
        };
      },
      openURL: KAKOMONN_OPEN_URL,
      tampermonkeyExtensionId: "tampermonkey-beta",
      userscriptIdentity: USERSCRIPT_IDENTITY,
    }),
    /transport is not ready/,
  );
  assert.deepEqual(navigations, [
    "chrome-extension://tampermonkey-beta/options.html#nav=settings",
  ]);
  assert.deepEqual(closedTargets, [{ port: 9222, targetId: "failed-target" }]);
});
