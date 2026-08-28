const fs = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("node:util");

const REPOSITORY_ROOT = path.resolve(__dirname, "..");
const REPOSITORY_ENV_PATH = path.join(REPOSITORY_ROOT, ".env");
const KAKOMONN_CONFIGURATION_KEYS = Object.freeze([
  "KAKOMONN_SYNC_TOKEN",
  "KAKOMONN_CHROME_USER_DATA_DIR",
  "KAKOMONN_CHROME_EXECUTABLE",
  "KAKOMONN_CHROMIUM_EXECUTABLE",
  "KAKOMONN_READER_SCRIPT_PATH",
  "KAKOMONN_XCODE_VERSION",
  "KAKOMONN_IOS_VERSION",
  "KAKOMONN_IOS_DEVICE",
]);
const KAKOMONN_CONFIGURATION_KEY_SET = new Set(
  KAKOMONN_CONFIGURATION_KEYS,
);

function configuredKeyOccurrences(contents) {
  const occurrences = new Map();
  for (const match of contents.matchAll(
    /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/gm,
  )) {
    const key = match[1];
    occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
  }
  return occurrences;
}

function readKakomonnConfiguration({
  envFilePath = REPOSITORY_ENV_PATH,
  existsSync = fs.existsSync,
  readFileSync = fs.readFileSync,
  parseEnvImpl = parseEnv,
} = {}) {
  if (!existsSync(envFilePath)) {
    return Object.freeze({});
  }

  const contents = readFileSync(envFilePath, "utf8");
  const occurrences = configuredKeyOccurrences(contents);
  for (const [key, count] of occurrences) {
    if (key.startsWith("KAKOMONN_") && !KAKOMONN_CONFIGURATION_KEY_SET.has(key)) {
      throw new Error(`Unsupported Kakomonn configuration key: ${key}`);
    }
    if (KAKOMONN_CONFIGURATION_KEY_SET.has(key) && count !== 1) {
      throw new Error(`Duplicate Kakomonn configuration key: ${key}`);
    }
  }

  const parsed = parseEnvImpl(contents);
  const configuration = {};
  for (const key of KAKOMONN_CONFIGURATION_KEYS) {
    const value = parsed[key];
    if (typeof value === "string" && value !== "") {
      configuration[key] = value;
    }
  }
  return Object.freeze(configuration);
}

function requireKakomonnConfiguration(configuration, key) {
  if (!KAKOMONN_CONFIGURATION_KEY_SET.has(key)) {
    throw new Error(`Unsupported Kakomonn configuration key: ${key}`);
  }
  const value = configuration?.[key];
  if (typeof value !== "string" || value === "") {
    throw new Error(`${key} is not set in ${REPOSITORY_ENV_PATH}`);
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
  REPOSITORY_ENV_PATH,
  REPOSITORY_ROOT,
  kakomonnFreeEnvironment,
  readKakomonnConfiguration,
  requireKakomonnConfiguration,
};
