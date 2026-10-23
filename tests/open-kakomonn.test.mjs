import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from 'node:vm';

import chromeDevTools from "../scripts/chrome-devtools.cjs";
import windowsChromeProfile from "../scripts/windows-chrome-profile.cjs";
import chromeTampermonkey from '../kakomonn-reader/tests/support/chrome_tampermonkey.js';

const { approveTampermonkeyChange, waitForTampermonkeyRuntime, readStoredUserscriptState, TAMPERMONKEY_EXTENSION_ID } = chromeTampermonkey;

for (const label of ['変更', 'Modify', '更新', 'Update', 'インストール', 'Install', '再インストール', 'Reinstall']) {
  test(`approves Tampermonkey's ${label} prompt without clicking unrelated controls`, async () => {
    const clicked = [];
    const page = (url, buttons) => ({
      url: () => url,
      getByRole: (role, { name }) => {
        assert.equal(role, 'button');
        const matches = buttons.filter(button => name.test(button.label));
        return {
          count: async () => matches.length,
          nth: index => ({
            isVisible: async () => matches[index].visible,
            click: async () => { clicked.push(matches[index].label); },
          }),
        };
      },
    });
    const buttons = [
      { label, visible: false },
      { label: 'Cancel', visible: true },
      { label: `${label} unrelated`, visible: true },
      { label, visible: true },
    ];
    await approveTampermonkeyChange({ pages: () => [
      page('https://example.com/ask.html?aid=unrelated', buttons),
      page(`chrome-extension://${TAMPERMONKEY_EXTENSION_ID}/options.html`, buttons),
      page('chrome-extension://unrelated/ask.html?aid=unrelated', buttons),
      page(`chrome-extension://${TAMPERMONKEY_EXTENSION_ID}/ask.html?aid=fixture`, buttons),
    ] });
    assert.deepEqual(clicked, [label]);
  });
}

test('userscript verification compares exact source rather than trusting an embedded fingerprint', async () => {
  const source = '// @name Reader fixture\nconst BUILD_FINGERPRINT = "a";\nconst css = `  \n`;\n';
  const records = { '!extdb.@meta#test': { value: { uuid: 'test', name: 'Reader fixture', enabled: true, evilness: 0 } },
    '!extdb.@source#test': { value: source } };
  const page = { evaluate: (fn, argument) => runInNewContext(`(${fn.toString()})(argument)`, {
    argument, chrome: { storage: { local: { get: async () => records } } },
  }) };
  const initial = await readStoredUserscriptState(page, 'Reader fixture', source);
  assert.equal(initial.count, 1);
  assert.equal(initial.sourceIsCurrent, true);
  assert.equal(initial.reviewed, true);
  records['!extdb.@source#test'].value = source.replace('  \n', '\n');
  assert.equal((await readStoredUserscriptState(page, 'Reader fixture', source)).sourceIsCurrent, false);
  records['!extdb.@meta#test'].value.evilness = 12;
  assert.equal((await readStoredUserscriptState(page, 'Reader fixture', source)).reviewed, false);
  records['!extdb.@meta#duplicate'] = records['!extdb.@meta#test'];
  assert.equal((await readStoredUserscriptState(page, 'Reader fixture', source)).count, 2);
});

for (const scenario of [
  { name: 'activates user scripts and wakes a dormant runtime', active: false },
  { name: 'preserves already active user scripts', active: true },
  { name: 'rejects a disabled extension', state: 'DISABLED', error: /must be enabled/ },
  { name: 'rejects unavailable user script access', enabled: false, error: /must be enabled/ },
  { name: 'propagates Chrome configuration errors', updateError: true, error: /configuration rejected/ },
  { name: 'verifies the result of enabling user scripts', unchanged: true, error: /did not enable/ },
  { name: 'verifies the actual loaded extension runtime', wrongRuntime: true, error: /runtime unavailable/ },
]) {
  test(`Tampermonkey provisioning ${scenario.name}`, async () => {
    let active = scenario.active ?? false;
    let updates = 0;
    const chrome = { developerPrivate: {
      getExtensionInfo: async id => {
        assert.equal(id, TAMPERMONKEY_EXTENSION_ID);
        return { state: scenario.state ?? 'ENABLED', userScriptsAccess: { isEnabled: scenario.enabled ?? true, isActive: active } };
      },
      updateExtensionConfiguration: async update => {
        assert.equal(JSON.stringify(update), JSON.stringify({ extensionId: TAMPERMONKEY_EXTENSION_ID, userScriptsAccess: true }));
        updates++;
        if (scenario.updateError) throw new Error('configuration rejected');
        if (!scenario.unchanged) active = true;
      },
    }, runtime: { id: scenario.wrongRuntime ? 'unrelated' : TAMPERMONKEY_EXTENSION_ID }, storage: { local: { get() {} } } };
    const evaluate = (fn, arg) => runInNewContext(`(${fn.toString()})(argument)`, { chrome, argument: arg });
    const pages = [];
    const context = { newPage: async () => {
      const page = { closed: false, goto: async url => { page.url = url; },
        evaluate, waitForFunction: async (fn, arg, options) => {
          assert.equal(options.timeout, 60_000);
          if (!evaluate(fn, arg)) throw new Error('runtime unavailable');
        }, close: async () => { page.closed = true; } };
      pages.push(page);
      return page;
    } };
    if (scenario.error) {
      await assert.rejects(waitForTampermonkeyRuntime(context), scenario.error);
      assert.equal(pages.every(page => page.closed), true);
    } else {
      const page = await waitForTampermonkeyRuntime(context);
      assert.equal(pages[0].url, 'chrome://extensions/');
      assert.equal(pages[0].closed, true);
      assert.equal(page.url, `chrome-extension://${TAMPERMONKEY_EXTENSION_ID}/options.html#nav=settings`);
      assert.equal(page.closed, false);
      assert.equal(updates, scenario.active ? 0 : 1);
    }
  });
}
import {
  CHROME_AUTOPLAY_ARGUMENT,
  CHROME_BOOTSTRAP_URL,
  CHROME_HIDE_CRASH_RESTORE_BUBBLE_ARGUMENT,
  CHROME_REMOTE_DEBUGGING_ARGUMENT,
  KAKOMONN_OPEN_URL,
  ensureKakomonnBrowser,
  openKakomonnURL,
  readUserscriptIdentity,
  resolveKakomonnLaunch,
} from "../scripts/open-kakomonn.mjs";

const {
  prepareKakomonnPage,
  readDevToolsActivePort,
  tampermonkeyReadyExpression,
  waitForDevToolsActivePort,
  waitForKakomonnLaunch,
} = chromeDevTools;
const { inspectDedicatedChrome, inspectDedicatedChromePowerShell, stopDedicatedChromePowerShell } =
  windowsChromeProfile;

const SYSTEM_ENVIRONMENT = {
  LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
  ProgramFiles: "C:\\Program Files",
  KAKOMONN_SYNC_TOKEN: "process-token-must-not-be-forwarded",
  SystemRoot: "C:\\Windows",
};
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE_PATH = "C:\\Users\\tester\\AppData\\Local\\kakomonn-chrome-e2e";
const USERSCRIPT_IDENTITY = Object.freeze({
  name: "Reader fixture",
  namespace: "test.reader",
});
const TAMPERMONKEY_READY_EXPRESSION = tampermonkeyReadyExpression(USERSCRIPT_IDENTITY);
const EMPTY_PROFILE_STATE = Object.freeze({
  autoplayAllowed: false,
  processCount: 0,
  remoteDebuggingEnabled: false,
  rootProcessCount: 0,
});

test("runs browser and URL phases in separate sequential processes", () => {
  const packageJSON = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(
    packageJSON.scripts["open:kakomonn"],
    "npm run open:kakomonn:browser && npm run open:kakomonn:url",
  );
  assert.equal(
    packageJSON.scripts["open:kakomonn:browser"],
    "node --use-system-ca scripts/open-kakomonn.mjs browser",
  );
  assert.equal(
    packageJSON.scripts["open:kakomonn:url"],
    "node --use-system-ca scripts/open-kakomonn.mjs url",
  );
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

  const launch = await ensureKakomonnBrowser({
    configuration: {},
    inspectProfile(userDataDir, options) {
      profileInspections.push({ options, userDataDir });
      return EMPTY_PROFILE_STATE;
    },
    platform: "win32",
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
  assert.deepEqual(removals, [
    {
      filePath: `${PROFILE_PATH}\\DevToolsActivePort`,
      options: { force: true },
    },
  ]);
  assert.deepEqual(launch, {
    arguments: calls[0][1],
    browserStarted: true,
    devToolsPort: 9222,
    executablePath: CHROME_PATH,
    userDataDir: PROFILE_PATH,
  });
});

test("keeps an already warm compatible Chrome process", async () => {
  let spawnCalled = false;
  let stopCalled = false;
  const result = await ensureKakomonnBrowser({
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
  assert.equal(stopCalled, false);
  assert.equal(result.browserStarted, false);
  assert.equal(result.devToolsPort, 9333);
});

test("prepares a new page in the separate URL phase", async () => {
  let prepared = false;
  const result = await openKakomonnURL({
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
    stat: expectedStat,
    systemEnvironment: SYSTEM_ENVIRONMENT,
  });
  assert.equal(prepared, true);
  assert.equal(result.applicationOpened, true);
  assert.equal(result.targetId, "warm-target");
});

test("rejects the URL phase unless the dedicated Chrome is ready", async () => {
  let prepared = false;
  await assert.rejects(
    openKakomonnURL({
      configuration: {},
      inspectProfile: () => EMPTY_PROFILE_STATE,
      platform: "win32",
      async prepareBrowser() {
        prepared = true;
      },
      stat: expectedStat,
      systemEnvironment: SYSTEM_ENVIRONMENT,
    }),
    /Dedicated Chrome is not ready for the application URL/,
  );
  assert.equal(prepared, false);
});

test("restarts an incompatible Chrome process without opening the application", async () => {
  const operations = [];
  await ensureKakomonnBrowser({
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
  assert.deepEqual(operations, ["inspect", "stop", "remove-port", "spawn", "wait-port"]);
});

test("does not launch when a required dedicated Chrome restart fails", async () => {
  let spawnCalled = false;
  await assert.rejects(
    async () =>
      ensureKakomonnBrowser({
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
      ensureKakomonnBrowser({
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
  const standardProfile = "C:\\Users\\tester\\AppData\\Local\\Google\\Chrome\\User Data\\Default";
  let inspected = false;
  await assert.rejects(
    async () =>
      ensureKakomonnBrowser({
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
  assert.equal(calls[0].executable, "mise.exe");
  assert.deepEqual(calls[0].args.slice(0, 3), ["exec", "--", "pwsh"]);
  assert.deepEqual(calls[0].args.slice(-6), [
    "-UserDataDir",
    PROFILE_PATH,
    "-AutoplayArgument",
    CHROME_AUTOPLAY_ARGUMENT,
    "-RemoteDebuggingArgument",
    CHROME_REMOTE_DEBUGGING_ARGUMENT,
  ]);
  assert.equal(
    Object.keys(calls[0].options.env).some((key) => key.startsWith("KAKOMONN_")),
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
    () =>
      readDevToolsActivePort(PROFILE_PATH, {
        existsSync: () => true,
        readFileSync: () => "not-a-port\n",
      }),
    /is invalid/,
  );
});

test("waits for the dedicated port and live CDP endpoint after Chrome hands off successfully", async () => {
  let reads = 0;
  const port = await waitForDevToolsActivePort(
    PROFILE_PATH,
    { exitCode: 0 },
    {
      delayImpl: async () => {},
      readPort: () => {
        reads += 1;
        if (reads === 1) throw new Error("not ready yet");
        return 49152;
      },
      fetchImpl: async url => {
        assert.equal(url, 'http://127.0.0.1:49152/json/version');
        return Response.json({ webSocketDebuggerUrl: 'ws://127.0.0.1:49152/devtools/browser/ready' });
      },
    },
  );
  assert.equal(port, 49152);
  assert.equal(reads, 2);
});

test('a published Chrome port is not ready until a live matching browser endpoint responds', async () => {
  const endpoints = [];
  const port = await waitForDevToolsActivePort(PROFILE_PATH, { exitCode: null }, {
    delayImpl: async () => {},
    readPort: () => endpoints.length === 0 ? 49000 : 49152,
    fetchImpl: async url => {
      endpoints.push(url);
      if (endpoints.length === 1) throw new TypeError('ECONNREFUSED');
      if (endpoints.length === 2) return new Response('', { status: 503 });
      if (endpoints.length === 3) return Response.json({
        webSocketDebuggerUrl: 'ws://127.0.0.1:49000/devtools/browser/stale',
      });
      return Response.json({ webSocketDebuggerUrl: 'ws://127.0.0.1:49152/devtools/browser/ready' });
    },
  });
  assert.equal(port, 49152);
  assert.deepEqual(endpoints, ['http://127.0.0.1:49000/json/version',
    ...Array(3).fill('http://127.0.0.1:49152/json/version')]);
});

test('a port file with no reachable CDP endpoint fails at the startup deadline', async () => {
  let elapsed = 0;
  await assert.rejects(waitForDevToolsActivePort(PROFILE_PATH, { exitCode: null }, {
    now: () => elapsed,
    timeoutMs: 200,
    delayImpl: async () => { elapsed += 100; },
    readPort: () => 49152,
    fetchImpl: async () => { throw new TypeError('ECONNREFUSED'); },
  }), /remote debugging did not start: ECONNREFUSED/);
});

test("a successful Chrome exit without a dedicated port still fails", async () => {
  await assert.rejects(
    waitForDevToolsActivePort(PROFILE_PATH, { exitCode: 0 }, { timeoutMs: 0 }),
    /remote debugging did not start/,
  );
});

test("reads the launcher userscript identity from the canonical metadata", () => {
  assert.deepEqual(
    readUserscriptIdentity({
      readFile: () =>
        [
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

test("uses Playwright to prewarm Tampermonkey and leaves the application page open", async () => {
  const events = [];
  const bootstrap = {
    goto: async url => events.push(url),
    evaluate: async expression => {
      assert.equal(expression, TAMPERMONKEY_READY_EXPRESSION);
      return { error: null, scriptCount: 1 };
    },
    close: async () => events.push("close-bootstrap"),
  };
  const application = {
    goto: async url => events.push(url),
    waitForFunction: async () => ({ jsonValue: async () => JSON.stringify({ state: "ready" }), dispose: async () => {} }),
  };
  let pages = 0;
  const result = await prepareKakomonnPage(9222, {
    connect: async endpoint => {
      assert.equal(endpoint, "http://127.0.0.1:9222");
      return {
        contexts: () => [{
          newPage: async () => ++pages === 1 ? bootstrap : application,
          newCDPSession: async () => ({
            send: async method => {
              assert.equal(method, "Target.getTargetInfo");
              return { targetInfo: { targetId: "application" } };
            }, detach: async () => {},
          }),
        }],
        close: async () => events.push("disconnect"),
      };
    },
    openURL: KAKOMONN_OPEN_URL,
    tampermonkeyExtensionId: "tampermonkey-beta",
    userscriptIdentity: USERSCRIPT_IDENTITY,
  });
  assert.deepEqual(result, { port: 9222, targetId: "application" });
  assert.deepEqual(events, [
    "chrome-extension://tampermonkey-beta/options.html#nav=settings",
    KAKOMONN_OPEN_URL, "close-bootstrap", "disconnect",
  ]);
});

test("closes the bootstrap and disconnects without opening the app if Tampermonkey is unavailable", async () => {
  const events = [];
  await assert.rejects(prepareKakomonnPage(9222, {
    connect: async () => ({
      contexts: () => [{ newPage: async () => ({
        goto: async () => {},
        evaluate: async () => ({ error: "not enabled", scriptCount: 1 }),
        close: async () => events.push("close"),
      }) }],
      close: async () => events.push("disconnect"),
    }),
    openURL: KAKOMONN_OPEN_URL,
    tampermonkeyExtensionId: "tampermonkey-beta",
    userscriptIdentity: USERSCRIPT_IDENTITY,
  }), /transport is not ready/);
  assert.deepEqual(events, ["close", "disconnect"]);
});

test("retries only transient bridge failures and preserves terminal states", async () => {
  for (const terminal of ["ready", "empty", "unauthorized"]) {
    let step = 0;
    const page = {
      waitForFunction: async () => ({
        jsonValue: async () => JSON.stringify(step === 0 ? { state: "error", code: "network_error" } : { state: terminal }),
        dispose: async () => {},
      }),
      waitForTimeout: async () => {},
      reload: async () => { step += 1; },
    };
    assert.equal(await waitForKakomonnLaunch(page), terminal);
    assert.equal(step, 1);
  }
  await assert.rejects(waitForKakomonnLaunch({
    waitForFunction: async () => ({
      jsonValue: async () => JSON.stringify({ state: "error", code: "invalid_response" }), dispose: async () => {},
    }),
  }), /invalid_response/);
});
