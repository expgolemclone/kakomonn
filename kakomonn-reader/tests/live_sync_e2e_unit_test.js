const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  assertRuntimeIdentity,
  extractBuildFingerprint,
} = require("./live_sync_e2e_test");
const {
  SYNC_TOKEN_KEY,
  TAMPERMONKEY_EXTENSION_ID,
  chromeLaunchArguments,
  discoverTampermonkeyStorageDirectories,
  extractSyncTokenCandidates,
  locateTampermonkeyExtension,
  readConfiguredToken,
  readChromeUserDataDir,
  resolveSyncToken,
  secretFreeEnvironment,
  stopDedicatedChromePowerShell,
  writeEnvToken,
} = require("./support/chrome_tampermonkey");

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
          userAgent:
            "Mozilla/5.0 (X11; Linux x86_64) Chrome/151.0.0.0 Safari/537.36",
        },
        fingerprint,
      ),
    /must run on Windows/,
  );
});

test("rejects another userscript handler or a stale build", () => {
  assert.throws(
    () =>
      assertRuntimeIdentity(
        { ...validRuntime, scriptHandler: "Userscripts" },
        fingerprint,
      ),
    /must be injected by Tampermonkey/,
  );
  assert.throws(
    () =>
      assertRuntimeIdentity(
        { ...validRuntime, buildFingerprint: "b".repeat(64) },
        fingerprint,
      ),
    /userscript is stale/,
  );
});

test("extracts exactly one generated build fingerprint", () => {
  assert.equal(
    extractBuildFingerprint(`const BUILD_FINGERPRINT = "${fingerprint}";`),
    fingerprint,
  );
  assert.throws(
    () => extractBuildFingerprint("const BUILD_FINGERPRINT = 'x';"),
    /found 0/,
  );
  assert.throws(
    () =>
      extractBuildFingerprint(
        `const BUILD_FINGERPRINT = "${fingerprint}";\nconst BUILD_FINGERPRINT = "${fingerprint}";`,
      ),
    /found 2/,
  );
});

test("reads the process token before the ignored env file", () => {
  const token = "b".repeat(64);
  let envRead = false;
  assert.deepEqual(
    readConfiguredToken({
      environment: { KAKOMONN_SYNC_TOKEN: token },
      envFilePath: "C:\\workspace\\kakomonn\\.env",
      existsSync: () => {
        envRead = true;
        return true;
      },
    }),
    { source: "process environment", token },
  );
  assert.equal(envRead, false);
});

test("reads quoted and unquoted tokens from the ignored env file", () => {
  const token = "c".repeat(64);
  for (const value of [token, `"${token}"`, `'${token}'`]) {
    assert.deepEqual(
      readConfiguredToken({
        environment: {},
        envFilePath: "C:\\workspace\\kakomonn\\.env",
        existsSync: () => true,
        readFileSync: () => `OTHER=value\nKAKOMONN_SYNC_TOKEN=${value}\n`,
      }),
      { source: "C:\\workspace\\kakomonn\\.env", token },
    );
  }
});

test("extracts only 64-character hexadecimal candidates from relevant storage", () => {
  const token = "d".repeat(64);
  const unrelatedHash = "e".repeat(64);
  assert.deepEqual(
    extractSyncTokenCandidates([
      Buffer.from(`${SYNC_TOKEN_KEY}\0${token}\0${unrelatedHash}`),
    ]),
    new Set([token, unrelatedHash]),
  );
  assert.deepEqual(
    extractSyncTokenCandidates([Buffer.from(token)]),
    new Set(),
  );
});

test("discovers token storage only in dedicated and standard Chrome profiles", () => {
  const localAppData = "C:\\Users\\tester\\AppData\\Local";
  const dedicated = path.win32.join(localAppData, "kakomonn-chrome-e2e");
  const standard = path.win32.join(
    localAppData,
    "Google",
    "Chrome",
    "User Data",
  );
  const roots = [];
  const directories = discoverTampermonkeyStorageDirectories({
    dedicatedUserDataDir: dedicated,
    environment: { LOCALAPPDATA: localAppData },
    existsSync: () => true,
    platform: "win32",
    readdirSync: (directory) => {
      roots.push(directory);
      return [{ isDirectory: () => true, name: "Default" }];
    },
  });
  assert.deepEqual(roots, [dedicated, standard]);
  assert.deepEqual(
    directories,
    [dedicated, standard].map((root) =>
      path.win32.join(
        root,
        "Default",
        "Local Extension Settings",
        TAMPERMONKEY_EXTENSION_ID,
      ),
    ),
  );
});

test("locates Tampermonkey when the dedicated profile has other extensions", () => {
  const userDataDir = "C:\\profiles\\kakomonn-chrome-e2e";
  const extensionsRoot = path.win32.join(
    userDataDir,
    "Default",
    "Extensions",
  );
  const tampermonkeyRoot = path.win32.join(
    extensionsRoot,
    TAMPERMONKEY_EXTENSION_ID,
  );
  const entry = (name) => ({ isDirectory: () => true, name });
  assert.equal(
    locateTampermonkeyExtension(userDataDir, {
      existsSync: () => true,
      readdirSync: (directory) =>
        directory === extensionsRoot
          ? [entry(TAMPERMONKEY_EXTENSION_ID), entry("other-extension")]
          : [entry("5.4.1_0")],
    }),
    path.win32.join(tampermonkeyRoot, "5.4.1_0"),
  );
  assert.throws(() =>
    locateTampermonkeyExtension(userDataDir, {
      existsSync: () => true,
      readdirSync: (directory) =>
        directory === extensionsRoot
          ? [entry("other-extension")]
          : [entry("5.4.1_0")],
    }),
  );
});

test("validates a configured token without scanning browser storage", async () => {
  const token = "f".repeat(64);
  let scanned = false;
  assert.equal(
    await resolveSyncToken({
      envFilePath: "C:\\workspace\\kakomonn\\.env",
      readConfigured: () => ({ source: "test", token }),
      discoverStorageDirectories: () => {
        scanned = true;
        return [];
      },
      validateToken: async (candidate) => candidate === token,
    }),
    token,
  );
  assert.equal(scanned, false);
});

test("does not replace a configured token rejected by production", async () => {
  const token = "1".repeat(64);
  let scanned = false;
  await assert.rejects(
    resolveSyncToken({
      envFilePath: "C:\\workspace\\kakomonn\\.env",
      readConfigured: () => ({ source: "test", token }),
      discoverStorageDirectories: () => {
        scanned = true;
        return [];
      },
      validateToken: async () => false,
    }),
    (error) => {
      assert.match(error.message, /was rejected by production/);
      assert.equal(error.message.includes(token), false);
      return true;
    },
  );
  assert.equal(scanned, false);
});

test("saves the one production-valid browser token", async () => {
  const validToken = "2".repeat(64);
  const invalidToken = "3".repeat(64);
  let saved = null;
  const environment = {};
  assert.equal(
    await resolveSyncToken({
      environment,
      envFilePath: "C:\\workspace\\kakomonn\\.env",
      readConfigured: () => null,
      readDedicatedUserDataDir: () => "dedicated-profile",
      discoverStorageDirectories: ({ dedicatedUserDataDir }) => {
        assert.equal(dedicatedUserDataDir, "dedicated-profile");
        return ["dedicated-chrome-storage", "standard-chrome-storage"];
      },
      scanCandidates: ({ storageDirectories }) => {
        assert.deepEqual(storageDirectories, [
          "dedicated-chrome-storage",
          "standard-chrome-storage",
        ]);
        return new Set([invalidToken, validToken]);
      },
      validateToken: async (candidate) => candidate === validToken,
      saveToken: (filePath, token) => {
        saved = { filePath, token };
      },
    }),
    validToken,
  );
  assert.deepEqual(saved, {
    filePath: "C:\\workspace\\kakomonn\\.env",
    token: validToken,
  });
  assert.equal(environment.KAKOMONN_SYNC_TOKEN, validToken);
});

test("rejects missing or conflicting production-valid browser tokens", async () => {
  const firstToken = "4".repeat(64);
  const secondToken = "5".repeat(64);
  const baseOptions = {
    envFilePath: "C:\\workspace\\kakomonn\\.env",
    readConfigured: () => null,
    readDedicatedUserDataDir: () => "dedicated-profile",
    discoverStorageDirectories: () => ["storage"],
  };
  await assert.rejects(
    resolveSyncToken({
      ...baseOptions,
      scanCandidates: () => new Set([firstToken]),
      validateToken: async () => false,
    }),
    /No production sync token/,
  );
  await assert.rejects(
    resolveSyncToken({
      ...baseOptions,
      scanCandidates: () => new Set([firstToken, secondToken]),
      validateToken: async () => true,
    }),
    /Multiple production sync tokens/,
  );
});

test("updates only the token assignment in the ignored env file", () => {
  const oldToken = "6".repeat(64);
  const newToken = "7".repeat(64);
  const files = new Map([
    ["C:\\workspace\\kakomonn\\.env", `OTHER=value\r\nKAKOMONN_SYNC_TOKEN=${oldToken}\r\n`],
  ]);
  writeEnvToken("C:\\workspace\\kakomonn\\.env", newToken, {
    existsSync: (filePath) => files.has(filePath),
    readFileSync: (filePath) => files.get(filePath),
    writeFileSync: (filePath, contents) => files.set(filePath, contents),
    renameSync: (source, destination) => {
      files.set(destination, files.get(source));
      files.delete(source);
    },
  });
  assert.equal(
    files.get("C:\\workspace\\kakomonn\\.env"),
    `OTHER=value\r\nKAKOMONN_SYNC_TOKEN=${newToken}\r\n`,
  );
});

test("defaults to the dedicated Chrome E2E profile", () => {
  const localAppData = "C:\\Users\\tester\\AppData\\Local";
  assert.equal(
    readChromeUserDataDir({
      environment: { LOCALAPPDATA: localAppData },
      existsSync: () => true,
      platform: "win32",
    }),
    path.win32.join(localAppData, "kakomonn-chrome-e2e"),
  );
});

test("reads the Chrome E2E profile from the ignored env file", () => {
  const localAppData = "C:\\Users\\tester\\AppData\\Local";
  const envFilePath = "C:\\workspace\\kakomonn\\.env";
  const envProfile = "C:\\profiles\\from-env-file";
  const processProfile = "C:\\profiles\\from-process";
  const readOptions = {
    envFilePath,
    existsSync: () => true,
    platform: "win32",
    readFileSync: () =>
      `OTHER=value\nKAKOMONN_CHROME_USER_DATA_DIR="${envProfile}"\n`,
  };
  assert.equal(
    readChromeUserDataDir({
      ...readOptions,
      environment: { LOCALAPPDATA: localAppData },
    }),
    envProfile,
  );
  assert.equal(
    readChromeUserDataDir({
      ...readOptions,
      environment: {
        KAKOMONN_CHROME_USER_DATA_DIR: processProfile,
        LOCALAPPDATA: localAppData,
      },
    }),
    processProfile,
  );
});

test("rejects the standard Chrome profile and accepts an explicit dedicated profile", () => {
  const localAppData = "C:\\Users\\tester\\AppData\\Local";
  const standard = path.win32.join(
    localAppData,
    "Google",
    "Chrome",
    "User Data",
  );
  assert.throws(
    () =>
      readChromeUserDataDir({
        environment: {
          KAKOMONN_CHROME_USER_DATA_DIR: path.win32.join(standard, "Default"),
          LOCALAPPDATA: localAppData,
        },
        existsSync: () => true,
        platform: "win32",
      }),
    /must be outside the standard Chrome user data directory/,
  );
  const dedicated = path.win32.join(localAppData, "kakomonn-chrome-e2e");
  assert.equal(
    readChromeUserDataDir({
      environment: {
        KAKOMONN_CHROME_USER_DATA_DIR: dedicated,
        LOCALAPPDATA: localAppData,
      },
      existsSync: () => true,
      platform: "win32",
    }),
    dedicated,
  );
});

test("launches the dedicated Chrome profile minimized", () => {
  const args = chromeLaunchArguments("C:\\profiles\\kakomonn-chrome-e2e");
  assert.equal(args.includes("--start-minimized"), true);
  assert.equal(args.some((argument) => argument.startsWith("--headless")), false);
  assert.equal(args.includes("--remote-debugging-port=0"), true);
  assert.equal(args.some((argument) => argument.startsWith("--load-extension")), false);
  assert.equal(
    args.some((argument) => argument.startsWith("--disable-extensions-except")),
    false,
  );
  assert.doesNotMatch(stopDedicatedChromePowerShell, /UIAutomation|許可/);
});

test("does not pass the production token to browser subprocesses", () => {
  assert.deepEqual(
    secretFreeEnvironment({
      KEEP: "value",
      KAKOMONN_SYNC_TOKEN: "must-not-reach-browser",
    }),
    { KEEP: "value" },
  );
});
