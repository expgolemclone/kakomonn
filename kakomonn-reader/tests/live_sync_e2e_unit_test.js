const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  assertRuntimeIdentity,
  extractBuildFingerprint,
  readEdgeUserDataDir,
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
