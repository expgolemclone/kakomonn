const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  assertRuntimeIdentity,
  dedicatedEdgeWindowPowerShell,
  extractBuildFingerprint,
  isRemoteDebugApprovalRejection,
  readEdgeUserDataDir,
  readSyncToken,
  remoteDebugApprovalEnvironment,
  remoteDebugApprovalPowerShell,
} = require("./live_sync_e2e_test");

const fingerprint = "a".repeat(64);
const validRuntime = {
  buildFingerprint: fingerprint,
  scriptHandler: "Tampermonkey",
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
};

test("accepts the exact Edge, Tampermonkey, and build identity", () => {
  assert.doesNotThrow(() => assertRuntimeIdentity(validRuntime, fingerprint));
});

test("rejects a non-Edge remote-debugging target", () => {
  assert.throws(
    () =>
      assertRuntimeIdentity(
        {
          ...validRuntime,
          userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0 Safari/537.36",
        },
        fingerprint,
      ),
    /must be Microsoft Edge/,
  );
});

test("rejects a userscript injected by another script handler", () => {
  assert.throws(
    () =>
      assertRuntimeIdentity(
        { ...validRuntime, scriptHandler: "Userscripts" },
        fingerprint,
      ),
    /must be injected by Tampermonkey/,
  );
});

test("rejects a stale installed userscript", () => {
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
  assert.throws(() => extractBuildFingerprint("const BUILD_FINGERPRINT = 'x';"), /found 0/);
  assert.throws(
    () =>
      extractBuildFingerprint(
        `const BUILD_FINGERPRINT = "${fingerprint}";\nconst BUILD_FINGERPRINT = "${fingerprint}";`,
      ),
    /found 2/,
  );
});

test("uses the process sync token without loading an env file", () => {
  const token = "a".repeat(32);
  let loaded = false;
  assert.equal(
    readSyncToken({
      environment: { KAKOMONN_SYNC_TOKEN: token },
      loadEnvironmentFile: () => {
        loaded = true;
      },
    }),
    token,
  );
  assert.equal(loaded, false);
});

test("loads the repository env file when the process token is absent", () => {
  const token = "b".repeat(32);
  const environment = {};
  const envFilePath = "C:\\workspace\\kakomonn\\.env";
  let loadedPath = "";
  assert.equal(
    readSyncToken({
      environment,
      envFilePath,
      loadEnvironmentFile: (candidatePath) => {
        loadedPath = candidatePath;
        environment.KAKOMONN_SYNC_TOKEN = token;
      },
    }),
    token,
  );
  assert.equal(loadedPath, envFilePath);
});

test("rejects a missing or invalid sync token after env loading", () => {
  assert.throws(
    () =>
      readSyncToken({
        environment: {},
        loadEnvironmentFile: () => {},
      }),
    /must contain the deployed secret token/,
  );
  assert.throws(
    () =>
      readSyncToken({
        environment: { KAKOMONN_SYNC_TOKEN: "invalid token" },
        loadEnvironmentFile: () => {
          throw new Error("must not load");
        },
      }),
    /must contain the deployed secret token/,
  );
});

test("retries only an explicit remote-debugging approval rejection", () => {
  assert.equal(
    isRemoteDebugApprovalRejection(
      new Error("Cause: Unexpected server response: 403"),
    ),
    true,
  );
  assert.equal(
    isRemoteDebugApprovalRejection(
      new Error("Cause: Unexpected server response: 500"),
    ),
    false,
  );
  assert.equal(
    isRemoteDebugApprovalRejection(new Error("MCP request timed out")),
    false,
  );
});

test("requires an explicit dedicated Edge user data directory", () => {
  assert.throws(
    () =>
      readEdgeUserDataDir({
        environment: {
          LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
        },
        existsSync: () => true,
        platform: "win32",
      }),
    /KAKOMONN_EDGE_USER_DATA_DIR must point to a dedicated/,
  );
});

test("rejects the standard Edge user data directory and its profiles", () => {
  const localAppData = "C:\\Users\\tester\\AppData\\Local";
  const standardUserDataDir = path.join(
    localAppData,
    "Microsoft",
    "Edge",
    "User Data",
  );
  for (const configuredPath of [
    standardUserDataDir,
    path.join(standardUserDataDir, "Default"),
  ]) {
    assert.throws(
      () =>
        readEdgeUserDataDir({
          environment: {
            KAKOMONN_EDGE_USER_DATA_DIR: configuredPath,
            LOCALAPPDATA: localAppData,
          },
          existsSync: () => true,
          platform: "win32",
        }),
      /must be outside the standard Edge user data directory/,
    );
  }
});

test("accepts a dedicated Edge E2E user data directory with remote debugging", () => {
  const dedicatedUserDataDir =
    "C:\\Users\\tester\\AppData\\Local\\kakomonn-edge-e2e";
  assert.equal(
    readEdgeUserDataDir({
      environment: {
        KAKOMONN_EDGE_USER_DATA_DIR: dedicatedUserDataDir,
        LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
      },
      existsSync: (candidatePath) =>
        candidatePath ===
        path.join(dedicatedUserDataDir, "DevToolsActivePort"),
      platform: "win32",
    }),
    path.resolve(dedicatedUserDataDir),
  );
});

test("automates approval only in the configured dedicated Edge profile", () => {
  const userDataDir =
    "C:\\Users\\tester\\AppData\\Local\\kakomonn-edge-e2e";
  const environment = remoteDebugApprovalEnvironment(
    userDataDir,
    12_345,
    {
      KAKOMONN_SYNC_TOKEN: "must-not-reach-powershell",
      SystemRoot: "C:\\Windows",
    },
  );

  assert.equal(environment.KAKOMONN_E2E_EDGE_USER_DATA_DIR, userDataDir);
  assert.equal(environment.KAKOMONN_E2E_APPROVAL_TIMEOUT_MS, "12345");
  assert.equal(environment.KAKOMONN_SYNC_TOKEN, undefined);
  assert.match(remoteDebugApprovalPowerShell, /--user-data-dir=/);
  assert.match(remoteDebugApprovalPowerShell, /"許可"/);
  assert.match(remoteDebugApprovalPowerShell, /"MdTextButton"/);
  assert.match(remoteDebugApprovalPowerShell, /InvokePattern/);
  assert.match(remoteDebugApprovalPowerShell, /BoundingRectangle/);
  assert.match(
    remoteDebugApprovalPowerShell,
    /Multiple remote debugging approval buttons were found/,
  );
  assert.match(dedicatedEdgeWindowPowerShell, /--user-data-dir=/);
  assert.match(dedicatedEdgeWindowPowerShell, /--new-window/);
  assert.match(
    dedicatedEdgeWindowPowerShell,
    /edge:\/\/inspect\/#remote-debugging/,
  );
  assert.match(dedicatedEdgeWindowPowerShell, /MainWindowHandle/);
  assert.match(dedicatedEdgeWindowPowerShell, /WindowStyle = "Normal"/);
});
