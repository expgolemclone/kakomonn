import assert from "node:assert/strict";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  KAKOMONN_CONFIGURATION_KEYS,
  REPOSITORY_ENV_PATH,
  kakomonnFreeEnvironment,
  readKakomonnConfiguration,
  requireKakomonnConfiguration,
} = require("../scripts/kakomonn-config.cjs");

test("native workspaces read the registered repository's durable configuration without copying it", () => {
  const { repositoryPath } = require(path.join(os.homedir(), "local-repository-map", "repository-map.mjs"));
  const expected = path.join(repositoryPath("expgolemclone/kakomonn"), ".env");
  assert.equal(REPOSITORY_ENV_PATH, expected);
  let observed;
  readKakomonnConfiguration({
    existsSync(file) { observed = file; return false; },
    readFileSync() { assert.fail("absent configuration must not be read"); },
  });
  assert.equal(observed, expected);
});

function configurationFrom(contents) {
  return readKakomonnConfiguration({
    envFilePath: "C:\\workspace\\kakomonn\\.env",
    existsSync: () => true,
    readFileSync: () => contents,
  });
}

test("reads only supported non-empty Kakomonn settings from .env", () => {
  assert.deepEqual(
    configurationFrom(
      [
        "# Kakomonn configuration",
        'KAKOMONN_SYNC_TOKEN="token-from-file"',
        "KAKOMONN_CHROME_USER_DATA_DIR='C:\\\\profiles\\\\kakomonn'",
        "KAKOMONN_READER_SCRIPT_PATH=",
        "OTHER=value",
      ].join("\n"),
    ),
    {
      KAKOMONN_SYNC_TOKEN: "token-from-file",
      KAKOMONN_CHROME_USER_DATA_DIR: "C:\\\\profiles\\\\kakomonn",
    },
  );
});

test("returns an empty frozen configuration when .env is absent", () => {
  const configuration = readKakomonnConfiguration({
    envFilePath: "C:\\workspace\\kakomonn\\.env",
    existsSync: () => false,
  });
  assert.deepEqual(configuration, {});
  assert.equal(Object.isFrozen(configuration), true);
});

test("rejects duplicate and unsupported Kakomonn settings", () => {
  assert.throws(
    () => configurationFrom("KAKOMONN_SYNC_TOKEN=first\nKAKOMONN_SYNC_TOKEN=second\n"),
    /Duplicate Kakomonn configuration key: KAKOMONN_SYNC_TOKEN/,
  );
  assert.throws(
    () => configurationFrom("KAKOMONN_UNKNOWN_SETTING=value\n"),
    /Unsupported Kakomonn configuration key: KAKOMONN_UNKNOWN_SETTING/,
  );
});

test("requires configured values without consulting process environment", () => {
  const original = process.env.KAKOMONN_SYNC_TOKEN;
  process.env.KAKOMONN_SYNC_TOKEN = "stale-process-token";
  try {
    const configuration = configurationFrom("KAKOMONN_SYNC_TOKEN=token-from-file\n");
    assert.equal(
      requireKakomonnConfiguration(configuration, "KAKOMONN_SYNC_TOKEN"),
      "token-from-file",
    );
    assert.throws(
      () => requireKakomonnConfiguration({}, "KAKOMONN_SYNC_TOKEN"),
      /KAKOMONN_SYNC_TOKEN is not set in/,
    );
  } finally {
    if (original === undefined) {
      delete process.env.KAKOMONN_SYNC_TOKEN;
    } else {
      process.env.KAKOMONN_SYNC_TOKEN = original;
    }
  }
});

test("removes every Kakomonn setting from child environments", () => {
  assert.deepEqual(
    kakomonnFreeEnvironment({
      KAKOMONN_SYNC_TOKEN: "secret",
      KAKOMONN_CHROME_EXECUTABLE: "chrome.exe",
      PATH: "system-path",
    }),
    { PATH: "system-path" },
  );
  assert.equal(KAKOMONN_CONFIGURATION_KEYS.length, 5);
});
