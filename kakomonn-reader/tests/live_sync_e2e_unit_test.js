const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { assertRuntimeIdentity, extractBuildFingerprint, isQuestionPageReady, openLaunchedQuestion, requestSyncState, withSyncApi } = require('./live_sync_e2e_test');

const { blockAdRequests } = require('./support/third_party_ads');

test('isolates third-party ads while preserving real questions, sync, speech, and clipboard reporting', async () => {
  let handler;
  await blockAdRequests({ route: async (pattern, callback) => {
    assert.equal(pattern, '**/*');
    handler = callback;
  } });
  for (const [url, expected] of [
    ['https://pagead2.googlesyndication.com/ad.js', 'abort'],
    ['https://securepubads.g.doubleclick.net/ad.js', 'abort'],
    ['https://googletagmanager.com/tag.js', 'abort'],
    ['https://cdn.anymind360.com/ad.js', 'abort'],
    ['https://geniee.jp/ad.js', 'abort'],
    ['https://chushoks.kakomonn.com/questions/86956', 'continue'],
    ['https://kakomonn-sync.kakomonn.workers.dev/v12/state', 'continue'],
    ['https://kakomonn-sync.kakomonn.workers.dev/v12/attempts', 'continue'],
    ['https://kakomonn-sync.kakomonn.workers.dev/v12/copy-failures', 'continue'],
    ['https://japaneast.tts.speech.microsoft.com/cognitiveservices/v1', 'continue'],
    ['https://doubleclick.net.example.com/ad.js', 'continue'],
  ]) {
    const actions = [];
    await handler({ request: () => ({ url: () => url }),
      abort: async () => { actions.push('abort'); },
      continue: async () => { actions.push('continue'); },
    });
    assert.deepEqual(actions, [expected], url);
  }
});

test('launches through the production bootstrap before selecting the question tab', async () => {
  const question = { url: () => 'https://chushoks.kakomonn.com/questions/86956' };
  const unrelated = [
    'about:blank', 'https://kakomonn-sync.kakomonn.workers.dev/open',
    'https://chushoks.kakomonn.com/offline',
    'https://chushoks.kakomonn.com/questions/86956?unrelated=1',
    'https://example.com/questions/86956',
  ].map(url => ({ url: () => url }));
  const events = [];
  const context = { pages: () => {
    events.push('select');
    return [...unrelated, question];
  } };
  assert.equal(await openLaunchedQuestion(context, async () => { events.push('launch'); }), question);
  assert.deepEqual(events, ['launch', 'select']);
});

test('propagates production bootstrap failures without opening a direct question tab', async () => {
  const context = { pages: () => { throw new Error('must not inspect pages after launch failure'); } };
  await assert.rejects(openLaunchedQuestion(context, async () => { throw new Error('bootstrap failed'); }), /bootstrap failed/);
});
const {
  TAMPERMONKEY_EXTENSION_ID,
  chromeLaunchArguments,
  kakomonnFreeEnvironment,
  locateTampermonkeyExtension,
  readChromeUserDataDir,
  resolveSyncToken,
  stopDedicatedChrome,
  stopDedicatedChromePowerShell,
} = require("./support/chrome_tampermonkey");

test('owns and disposes the live API fixture on success and scenario failure', async () => {
  for (const fail of [false, true]) {
    const events = [];
    const api = { async dispose() { events.push('dispose'); } };
    const factory = { async newContext(options) {
      assert.deepEqual(options, { timeout: 15_000 });
      events.push('create');
      return api;
    } };
    const run = async actual => {
      assert.equal(actual, api);
      events.push('scenario');
      if (fail) throw new Error('scenario failure');
      return 'verified';
    };
    if (fail) await assert.rejects(withSyncApi(run, factory), /scenario failure/);
    else assert.equal(await withSyncApi(run, factory), 'verified');
    assert.deepEqual(events, ['create', 'scenario', 'dispose']);
  }
});

test('uses one bounded authenticated state request without retries or redirects', async () => {
  let calls = 0;
  let disposed = 0;
  const api = { async get(url, options) {
    calls++;
    assert.equal(url, 'https://kakomonn-sync.kakomonn.workers.dev/v12/state?site=chushoks.kakomonn.com');
    assert.deepEqual(options, { headers: { Authorization: 'Bearer fixture-token' }, timeout: 15_000, maxRetries: 0, maxRedirects: 0 });
    return { status: () => 401, async dispose() { disposed++; } };
  } };
  await assert.rejects(requestSyncState(api, 'fixture-token'), /401/);
  assert.equal(calls, 1);
  assert.equal(disposed, 1);
});

test('disposes malformed state responses and propagates transport failures', async () => {
  let disposed = 0;
  const malformed = { async get() { return {
    status: () => 200,
    async json() { throw new Error('malformed production state'); },
    async dispose() { disposed++; },
  }; } };
  await assert.rejects(requestSyncState(malformed, 'fixture-token'), /malformed production state/);
  assert.equal(disposed, 1);
  let calls = 0;
  const offline = { async get() { calls++; throw new Error('connection failed'); } };
  await assert.rejects(requestSyncState(offline, 'fixture-token'), /connection failed/);
  assert.equal(calls, 1);
});

test('does not treat an offline document or a reader shell alone as a ready question', () => {
  const ready = {
    actionsPresent: false, frameHasAnswerChoices: true,
    outerURL: 'https://chushoks.kakomonn.com/questions/86956',
    frameURL: 'https://chushoks.kakomonn.com/questions/86956',
    settingsOpen: false, syncBusy: false, errorOpen: false,
  };
  assert.equal(isQuestionPageReady(ready), true);
  for (const change of [
    { frameHasAnswerChoices: false }, { frameHasAnswerChoices: undefined },
    { actionsPresent: true }, { settingsOpen: true }, { errorOpen: true },
    { syncBusy: true }, { syncBusy: undefined }, { syncBusy: null },
    { frameURL: 'https://chushoks.kakomonn.com/offline' },
    { outerURL: 'https://chushoks.kakomonn.com/questions/44369' },
  ]) assert.equal(isQuestionPageReady({ ...ready, ...change }), false);
});

const fingerprint = "a".repeat(64);
const validRuntime = {
  buildFingerprint: fingerprint,
  scriptHandler: "Tampermonkey",
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36",
};

test("accepts the exact Chrome, Tampermonkey, and build identity", () => {
  assert.doesNotThrow(() => assertRuntimeIdentity(validRuntime, fingerprint));
});

test("rejects Edge and non-Windows browser runtimes", () => {
  assert.throws(
    () =>
      assertRuntimeIdentity(
        {
          ...validRuntime,
          userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0",
        },
        fingerprint,
      ),
    /must not be Microsoft Edge/,
  );
  assert.throws(
    () =>
      assertRuntimeIdentity(
        {
          ...validRuntime,
          userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/151.0.0.0 Safari/537.36",
        },
        fingerprint,
      ),
    /must run on Windows/,
  );
});

test("rejects another userscript handler or a stale build", () => {
  assert.throws(
    () => assertRuntimeIdentity({ ...validRuntime, scriptHandler: "Userscripts" }, fingerprint),
    /must be injected by Tampermonkey/,
  );
  assert.throws(
    () => assertRuntimeIdentity({ ...validRuntime, buildFingerprint: "b".repeat(64) }, fingerprint),
    /userscript is stale/,
  );
});

test("extracts exactly one generated build fingerprint", () => {
  assert.equal(extractBuildFingerprint(`const BUILD_FINGERPRINT = "${fingerprint}";`), fingerprint);
  assert.throws(() => extractBuildFingerprint("const BUILD_FINGERPRINT = 'x';"), /found 0/);
  assert.throws(
    () =>
      extractBuildFingerprint(
        `const BUILD_FINGERPRINT = "${fingerprint}";\nconst BUILD_FINGERPRINT = "${fingerprint}";`,
      ),
    /found 2/,
  );
});

test("sync fixtures reject obsolete calculator options", () => {
  const { createSyncFixtureConfiguration } = require("./support/sync-fixture.cjs");
  assert.throws(() => createSyncFixtureConfiguration({ newQuestionGoal: 50 }), /Unknown sync fixture options: newQuestionGoal/);
});

test("live state verification rejects the same malformed states as Reader", async () => {
  const { createSyncFixtureConfiguration } = require("./support/sync-fixture.cjs");
  const baseline = createSyncFixtureConfiguration().state;
  for (const change of [
    state => { delete state.catalog.generation; },
    state => { state.today = "2026-02-30"; },
    state => { state.learningMetrics.todayAttemptedQuestionCount = 1; },
    state => { state.unexpected = true; },
  ]) {
    const state = structuredClone(baseline);
    change(state);
    let disposed = false;
    await assert.rejects(requestSyncState({
      get: async () => ({
        status: () => 200, json: async () => state,
        dispose: async () => { disposed = true; },
      }),
    }, "fixture-token"), assert.AssertionError);
    assert.equal(disposed, true);
  }
});

test("locates Tampermonkey Beta when the dedicated profile has other extensions", () => {
  const userDataDir = "C:\\profiles\\kakomonn-chrome-e2e";
  const extensionsRoot = path.win32.join(userDataDir, "Default", "Extensions");
  const tampermonkeyRoot = path.win32.join(extensionsRoot, TAMPERMONKEY_EXTENSION_ID);
  const entry = (name) => ({ isDirectory: () => true, name });
  assert.equal(
    locateTampermonkeyExtension(userDataDir, {
      existsSync: () => true,
      readdirSync: (directory) =>
        directory === extensionsRoot
          ? [entry(TAMPERMONKEY_EXTENSION_ID), entry("other-extension")]
          : [entry("5.6.6239_0")],
    }),
    path.win32.join(tampermonkeyRoot, "5.6.6239_0"),
  );
  assert.throws(() =>
    locateTampermonkeyExtension(userDataDir, {
      existsSync: () => true,
      readdirSync: (directory) =>
        directory === extensionsRoot ? [entry("other-extension")] : [entry("5.6.6239_0")],
    }),
  );
});

test("requires an explicit token and never scans or writes browser storage", async () => {
  let calls = 0;
  await assert.rejects(resolveSyncToken({
    configuration: {}, fetchImpl: async () => { calls += 1; },
  }), /is not set/);
  assert.equal(calls, 0);
  const token = "f".repeat(64);
  assert.equal(await resolveSyncToken({
    configuration: { KAKOMONN_SYNC_TOKEN: token },
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://kakomonn-sync.kakomonn.workers.dev/v12/sites");
      assert.equal(options.headers.Authorization, `Bearer ${token}`);
      calls += 1;
      return { status: 200, arrayBuffer: async () => new ArrayBuffer(0) };
    },
  }), token);
  await assert.rejects(resolveSyncToken({
    configuration: { KAKOMONN_SYNC_TOKEN: token },
    fetchImpl: async () => ({ status: 401, arrayBuffer: async () => new ArrayBuffer(0) }),
  }), /rejected by production/);
});

test("defaults to the dedicated Chrome E2E profile", () => {
  const localAppData = "C:\\Users\\tester\\AppData\\Local";
  assert.equal(
    readChromeUserDataDir({
      configuration: {},
      systemEnvironment: { LOCALAPPDATA: localAppData },
      existsSync: () => true,
      platform: "win32",
    }),
    path.win32.join(localAppData, "kakomonn-chrome-e2e"),
  );
});

test("reads the Chrome E2E profile from the ignored TOML configuration", () => {
  const localAppData = "C:\\Users\\tester\\AppData\\Local";
  const configurationFilePath = "C:\\workspace\\kakomonn\\kakomonn.toml";
  const envProfile = "C:\\profiles\\from-env-file";
  const processProfile = "C:\\profiles\\from-process";
  const readOptions = {
    configurationFilePath,
    existsSync: () => true,
    platform: "win32",
    readFileSync: () => `KAKOMONN_CHROME_USER_DATA_DIR = ${JSON.stringify(envProfile)}\n`,
  };
  assert.equal(
    readChromeUserDataDir({
      ...readOptions,
      systemEnvironment: { LOCALAPPDATA: localAppData },
    }),
    envProfile,
  );
  assert.equal(
    readChromeUserDataDir({
      ...readOptions,
      systemEnvironment: {
        KAKOMONN_CHROME_USER_DATA_DIR: processProfile,
        LOCALAPPDATA: localAppData,
      },
    }),
    envProfile,
  );
});

test("rejects the standard Chrome profile and accepts an explicit dedicated profile", () => {
  const localAppData = "C:\\Users\\tester\\AppData\\Local";
  const standard = path.win32.join(localAppData, "Google", "Chrome", "User Data");
  assert.throws(
    () =>
      readChromeUserDataDir({
        configuration: {
          KAKOMONN_CHROME_USER_DATA_DIR: path.win32.join(standard, "Default"),
        },
        systemEnvironment: { LOCALAPPDATA: localAppData },
        existsSync: () => true,
        platform: "win32",
      }),
    /must be outside the standard Chrome user data directory/,
  );
  const dedicated = path.win32.join(localAppData, "kakomonn-chrome-e2e");
  assert.equal(
    readChromeUserDataDir({
      configuration: { KAKOMONN_CHROME_USER_DATA_DIR: dedicated },
      systemEnvironment: { LOCALAPPDATA: localAppData },
      existsSync: () => true,
      platform: "win32",
    }),
    dedicated,
  );
});

test("launches the dedicated Chrome profile minimized", () => {
  const args = chromeLaunchArguments("C:\\profiles\\kakomonn-chrome-e2e");
  assert.equal(args.includes("--start-minimized"), true);
  assert.equal(args.includes("--autoplay-policy=no-user-gesture-required"), true);
  assert.equal(
    args.some((argument) => argument.startsWith("--headless")),
    false,
  );
  assert.equal(args.includes("--remote-debugging-port=0"), true);
  assert.equal(
    args.some((argument) => argument.startsWith("--load-extension")),
    false,
  );
  assert.equal(
    args.some((argument) => argument.startsWith("--disable-extensions-except")),
    false,
  );
  assert.equal(args.at(-1), "about:blank");
  assert.equal(args.includes("https://kakomonn-sync.kakomonn.workers.dev/open"), false);
  assert.doesNotMatch(stopDedicatedChromePowerShell, /UIAutomation|許可/);
});

test("passes the dedicated Chrome profile as a PowerShell argument", () => {
  const calls = [];
  const userDataDir = "C:\\profiles\\kakomonn-chrome-e2e";
  stopDedicatedChrome(userDataDir, {
    systemEnvironment: {
      KAKOMONN_SYNC_TOKEN: "must-not-reach-powershell",
      SystemRoot: "C:\\Windows",
    },
    spawnSyncImpl: (executable, args, options) => {
      calls.push({ args, executable, options });
      return { status: 0, stderr: "" };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, "mise.exe");
  assert.deepEqual(calls[0].args.slice(0, 3), ["exec", "--", "pwsh"]);
  assert.match(calls[0].args[calls[0].args.indexOf("-Command") + 1], /^& \{/);
  assert.deepEqual(calls[0].args.slice(-2), ["-UserDataDir", userDataDir]);
  assert.deepEqual(calls[0].options.env, { SystemRoot: "C:\\Windows" });
});

test("does not pass any Kakomonn settings to browser subprocesses", () => {
  assert.deepEqual(
    kakomonnFreeEnvironment({
      KEEP: "value",
      KAKOMONN_CHROME_EXECUTABLE: "must-not-reach-browser",
      KAKOMONN_SYNC_TOKEN: "must-not-reach-browser",
    }),
    { KEEP: "value" },
  );
});
