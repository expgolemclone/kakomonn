import { spawn } from "node:child_process";
import { readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import kakomonnConfig from "./kakomonn-config.cjs";
import chromeDevTools from "./chrome-devtools.cjs";
import windowsChromeProfile from "./windows-chrome-profile.cjs";

const {
  kakomonnFreeEnvironment,
  readKakomonnConfiguration,
} = kakomonnConfig;
const {
  TAMPERMONKEY_BETA_EXTENSION_ID,
  activePortPath,
  prepareKakomonnPage,
  readDevToolsActivePort,
  waitForDevToolsActivePort,
} = chromeDevTools;
const {
  CHROME_AUTOPLAY_ARGUMENT,
  CHROME_REMOTE_DEBUGGING_ARGUMENT,
  inspectDedicatedChrome,
  isSameOrDescendantPath,
  stopDedicatedChrome,
} = windowsChromeProfile;

export const KAKOMONN_OPEN_URL =
  "https://kakomonn-sync.kakomonn.workers.dev/open";
export { CHROME_AUTOPLAY_ARGUMENT, CHROME_REMOTE_DEBUGGING_ARGUMENT };
export const CHROME_HIDE_CRASH_RESTORE_BUBBLE_ARGUMENT =
  "--hide-crash-restore-bubble";
export const CHROME_BOOTSTRAP_URL = "about:blank";
const READER_METADATA_PATH = fileURLToPath(
  new URL("../kakomonn-reader/src/metadata-and-runtime.js", import.meta.url),
);

export function readUserscriptIdentity({ readFile = readFileSync } = {}) {
  const source = readFile(READER_METADATA_PATH, "utf8");
  const readDirective = (directive) => {
    const matches = [
      ...source.matchAll(new RegExp(`^// @${directive}\\s+(.+)$`, "gm")),
    ];
    if (matches.length !== 1 || matches[0][1].trim() === "") {
      throw new Error(
        `Reader metadata must contain exactly one @${directive} directive`,
      );
    }
    return matches[0][1].trim();
  };
  return Object.freeze({
    name: readDirective("name"),
    namespace: readDirective("namespace"),
  });
}

function requirePathType(candidatePath, expectedType, stat = statSync) {
  let stats;
  try {
    stats = stat(candidatePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`${expectedType} was not found: ${candidatePath}`);
    }
    throw error;
  }

  const matches =
    expectedType === "Chrome executable" ? stats.isFile() : stats.isDirectory();
  if (!matches) {
    throw new Error(`${expectedType} has an unexpected type: ${candidatePath}`);
  }
}

export function resolveKakomonnLaunch({
  configuration = readKakomonnConfiguration(),
  platform = process.platform,
  stat = statSync,
  systemEnvironment = process.env,
} = {}) {
  if (platform !== "win32") {
    throw new Error("open:kakomonn requires Windows");
  }

  const programFiles = systemEnvironment.ProgramFiles;
  if (!programFiles) {
    throw new Error("ProgramFiles is not set");
  }
  const localAppData = systemEnvironment.LOCALAPPDATA;
  if (!localAppData) {
    throw new Error("LOCALAPPDATA is not set");
  }

  const executablePath = path.win32.resolve(
    configuration.KAKOMONN_CHROME_EXECUTABLE ??
      path.win32.join(
        programFiles,
        "Google",
        "Chrome",
        "Application",
        "chrome.exe",
      ),
  );
  const userDataDir = path.win32.resolve(
    configuration.KAKOMONN_CHROME_USER_DATA_DIR ??
      path.win32.join(localAppData, "kakomonn-chrome-e2e"),
  );
  const standardUserDataDir = path.win32.resolve(
    path.win32.join(localAppData, "Google", "Chrome", "User Data"),
  );

  requirePathType(executablePath, "Chrome executable", stat);
  requirePathType(userDataDir, "Dedicated Chrome profile", stat);
  if (isSameOrDescendantPath(standardUserDataDir, userDataDir, path.win32)) {
    throw new Error(
      "KAKOMONN_CHROME_USER_DATA_DIR must be outside the standard Chrome user data directory",
    );
  }

  return {
    arguments: [
      `--user-data-dir=${userDataDir}`,
      CHROME_HIDE_CRASH_RESTORE_BUBBLE_ARGUMENT,
      CHROME_AUTOPLAY_ARGUMENT,
      CHROME_REMOTE_DEBUGGING_ARGUMENT,
      CHROME_BOOTSTRAP_URL,
    ],
    executablePath,
    userDataDir,
  };
}

export async function openKakomonn({
  configuration = readKakomonnConfiguration(),
  inspectProfile = inspectDedicatedChrome,
  platform = process.platform,
  prepareBrowser = prepareKakomonnPage,
  readDevToolsPort = readDevToolsActivePort,
  removeFile = rmSync,
  spawnProcess = spawn,
  stat = statSync,
  stopProfile = stopDedicatedChrome,
  systemEnvironment = process.env,
  userscriptIdentity = readUserscriptIdentity(),
  waitForDevToolsPort = waitForDevToolsActivePort,
} = {}) {
  const launch = resolveKakomonnLaunch({
    configuration,
    platform,
    stat,
    systemEnvironment,
  });
  const profileState = inspectProfile(launch.userDataDir, {
    systemEnvironment,
  });
  const existingProfileIsCompatible =
    profileState.processCount > 0 &&
    profileState.autoplayAllowed &&
    profileState.remoteDebuggingEnabled;
  if (profileState.processCount > 0 && !existingProfileIsCompatible) {
    stopProfile(launch.userDataDir, { systemEnvironment });
  }
  const coldStart = !existingProfileIsCompatible;
  let browserProcess = null;
  let port;
  if (coldStart) {
    removeFile(activePortPath(launch.userDataDir), { force: true });
    browserProcess = spawnProcess(
      launch.executablePath,
      launch.arguments,
      {
        detached: true,
        env: kakomonnFreeEnvironment(systemEnvironment),
        stdio: "ignore",
      },
    );
    browserProcess.unref();
    port = await waitForDevToolsPort(
      launch.userDataDir,
      browserProcess,
    );
    return Object.freeze({
      ...launch,
      applicationOpened: false,
      coldStart: true,
      devToolsPort: port,
      targetId: null,
    });
  }
  port = readDevToolsPort(launch.userDataDir);

  const prepared = await prepareBrowser(port, {
    openURL: KAKOMONN_OPEN_URL,
    target: null,
    tampermonkeyExtensionId: TAMPERMONKEY_BETA_EXTENSION_ID,
    userscriptIdentity,
  });
  return Object.freeze({
    ...launch,
    applicationOpened: true,
    coldStart: false,
    devToolsPort: port,
    targetId: prepared.targetId,
  });
}

const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (scriptPath === fileURLToPath(import.meta.url)) {
  try {
    const result = await openKakomonn();
    if (!result.applicationOpened) {
      console.log(
        "専用Chromeを準備しました. Chromeの起動後に同じcommandをもう一度実行してください.",
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
