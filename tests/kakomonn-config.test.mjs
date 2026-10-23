import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  KAKOMONN_CONFIGURATION_KEYS,
  REPOSITORY_CONFIGURATION_PATH,
  kakomonnFreeEnvironment,
  readKakomonnConfiguration,
  requireKakomonnConfiguration,
} = require("../scripts/kakomonn-config.cjs");

function configurationFrom(contents) {
  return readKakomonnConfiguration({
    existsSync: () => true,
    readFileSync: () => contents,
  });
}

test("configuration is relative to its source, not the working directory", () => {
  assert.equal(REPOSITORY_CONFIGURATION_PATH,
    fileURLToPath(new URL("../kakomonn.toml", import.meta.url)));
  let observed;
  readKakomonnConfiguration({
    existsSync(file) { observed = file; return false; },
    readFileSync() { assert.fail("absent configuration must not be read"); },
  });
  assert.equal(observed, REPOSITORY_CONFIGURATION_PATH);
});

test("reads only supported non-empty string settings from TOML", () => {
  assert.deepEqual(configurationFrom([
    '# configuration',
    'KAKOMONN_SYNC_TOKEN = "fixture-token"',
    "KAKOMONN_CHROME_USER_DATA_DIR = 'C:\\profiles\\kakomonn'",
    'KAKOMONN_READER_SCRIPT_PATH = ""',
  ].join("\n")), {
    KAKOMONN_SYNC_TOKEN: "fixture-token",
    KAKOMONN_CHROME_USER_DATA_DIR: "C:\\profiles\\kakomonn",
  });
});

test("returns an empty frozen configuration when the file is absent", () => {
  const configuration = readKakomonnConfiguration({ existsSync: () => false });
  assert.deepEqual(configuration, {});
  assert.equal(Object.isFrozen(configuration), true);
});

test("the parser rejects duplicate keys including quoted key spellings", () => {
  for (const key of ['KAKOMONN_SYNC_TOKEN', '"KAKOMONN_SYNC_TOKEN"', "'KAKOMONN_SYNC_TOKEN'"]) {
    assert.throws(() => configurationFrom(
      `KAKOMONN_SYNC_TOKEN = "first"\n${key} = "second"\n`), /already|duplicate/i);
  }
});

test("quoted multi-line values are not reparsed as configuration keys", () => {
  assert.deepEqual(configurationFrom('KAKOMONN_SYNC_TOKEN = """\nfirst\nKAKOMONN_UNKNOWN_SETTING=literal\nlast"""'), {
    KAKOMONN_SYNC_TOKEN: "first\nKAKOMONN_UNKNOWN_SETTING=literal\nlast",
  });
});

test("rejects unsupported keys, non-string values, and dotenv export syntax", () => {
  assert.throws(() => configurationFrom('KAKOMONN_UNKNOWN_SETTING = "value"'), /Unsupported/);
  assert.throws(() => configurationFrom('KAKOMONN_SYNC_TOKEN = 123'), /must be a string/);
  assert.throws(() => configurationFrom('export KAKOMONN_SYNC_TOKEN=first'));
});

test("requires explicit values without consulting the process environment", () => {
  const original = process.env.KAKOMONN_SYNC_TOKEN;
  process.env.KAKOMONN_SYNC_TOKEN = "stale-process-token";
  try {
    assert.equal(requireKakomonnConfiguration(
      configurationFrom('KAKOMONN_SYNC_TOKEN = "fixture-token"'), "KAKOMONN_SYNC_TOKEN"), "fixture-token");
    assert.throws(() => requireKakomonnConfiguration({}, "KAKOMONN_SYNC_TOKEN"), /is not set in/);
  } finally {
    if (original === undefined) delete process.env.KAKOMONN_SYNC_TOKEN;
    else process.env.KAKOMONN_SYNC_TOKEN = original;
  }
});

test("removes every Kakomonn setting from child environments", () => {
  assert.deepEqual(kakomonnFreeEnvironment({
    KAKOMONN_SYNC_TOKEN: "secret", KAKOMONN_CHROME_EXECUTABLE: "chrome.exe", PATH: "system-path",
  }), { PATH: "system-path" });
  assert.equal(KAKOMONN_CONFIGURATION_KEYS.length, 5);
});
