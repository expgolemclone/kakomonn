const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("smol-toml");

const REPOSITORY_ROOT = path.resolve(__dirname, "..");
const REPOSITORY_CONFIGURATION_PATH = path.join(REPOSITORY_ROOT, "kakomonn.toml");
const KAKOMONN_CONFIGURATION_KEYS = Object.freeze([
  "KAKOMONN_SYNC_TOKEN",
  "KAKOMONN_CHROME_USER_DATA_DIR",
  "KAKOMONN_CHROME_EXECUTABLE",
  "KAKOMONN_CHROMIUM_EXECUTABLE",
  "KAKOMONN_READER_SCRIPT_PATH",
]);
const KAKOMONN_CONFIGURATION_KEY_SET = new Set(KAKOMONN_CONFIGURATION_KEYS);

function readKakomonnConfiguration({
  configurationFilePath = REPOSITORY_CONFIGURATION_PATH,
  existsSync = fs.existsSync,
  readFileSync = fs.readFileSync,
} = {}) {
  if (!existsSync(configurationFilePath)) {
    return Object.freeze({});
  }
  const parsed = parse(readFileSync(configurationFilePath, "utf8"));
  const configuration = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!KAKOMONN_CONFIGURATION_KEY_SET.has(key)) {
      throw new Error(`Unsupported Kakomonn configuration key: ${key}`);
    }
    if (typeof value !== "string") {
      throw new TypeError(`Kakomonn configuration must be a string: ${key}`);
    }
    if (value !== "") configuration[key] = value;
  }
  return Object.freeze(configuration);
}

function requireKakomonnConfiguration(configuration, key) {
  if (!KAKOMONN_CONFIGURATION_KEY_SET.has(key)) {
    throw new Error(`Unsupported Kakomonn configuration key: ${key}`);
  }
  const value = configuration?.[key];
  if (typeof value !== "string" || value === "") {
    throw new Error(`${key} is not set in ${REPOSITORY_CONFIGURATION_PATH}`);
  }
  return value;
}

function kakomonnFreeEnvironment(environment = process.env) {
  return Object.fromEntries(
    Object.entries(environment).filter(([key]) => !key.startsWith("KAKOMONN_")),
  );
}

module.exports = {
  KAKOMONN_CONFIGURATION_KEYS,
  REPOSITORY_CONFIGURATION_PATH,
  REPOSITORY_ROOT,
  kakomonnFreeEnvironment,
  readKakomonnConfiguration,
  requireKakomonnConfiguration,
};
