import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import kakomonnConfig from "./kakomonn-config.cjs";
import windowsChromeProfile from "./windows-chrome-profile.cjs";

const {
  kakomonnFreeEnvironment,
  readKakomonnConfiguration,
} = kakomonnConfig;
const {
  CHROME_AUTOPLAY_ARGUMENT,
  inspectDedicatedChrome,
  isSameOrDescendantPath,
  stopDedicatedChrome,
} = windowsChromeProfile;

export const KAKOMONN_OPEN_URL =
  "https://kakomonn-sync.kakomonn.workers.dev/open";
export { CHROME_AUTOPLAY_ARGUMENT };
export const CHROME_HIDE_CRASH_RESTORE_BUBBLE_ARGUMENT =
  "--hide-crash-restore-bubble";
export const CHROME_NO_STARTUP_WINDOW_ARGUMENT = "--no-startup-window";
export const CHROME_COLD_START_GRACE_MS = 1_000;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
      KAKOMONN_OPEN_URL,
    ],
    executablePath,
    userDataDir,
  };
}

export async function openKakomonn({
  configuration = readKakomonnConfiguration(),
  inspectProfile = inspectDedicatedChrome,
  platform = process.platform,
  spawnProcess = spawn,
  stat = statSync,
  stopProfile = stopDedicatedChrome,
  systemEnvironment = process.env,
  waitForColdStart = delay,
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
  let requiresColdStart = profileState.processCount === 0;
  if (profileState.processCount > 0 && !profileState.autoplayAllowed) {
    stopProfile(launch.userDataDir, { systemEnvironment });
    requiresColdStart = true;
  }
  const spawnOptions = {
    detached: true,
    env: kakomonnFreeEnvironment(systemEnvironment),
    stdio: "ignore",
  };
  if (requiresColdStart) {
    const bootstrapProcess = spawnProcess(
      launch.executablePath,
      [
        ...launch.arguments.slice(0, -1),
        CHROME_NO_STARTUP_WINDOW_ARGUMENT,
      ],
      spawnOptions,
    );
    bootstrapProcess.unref();
    await waitForColdStart(CHROME_COLD_START_GRACE_MS);
    if (
      bootstrapProcess.exitCode !== undefined &&
      bootstrapProcess.exitCode !== null &&
      bootstrapProcess.exitCode !== 0
    ) {
      throw new Error(
        `Google Chrome exited during startup: ${bootstrapProcess.exitCode}`,
      );
    }
  }
  const browserProcess = spawnProcess(launch.executablePath, launch.arguments, {
    ...spawnOptions,
  });
  browserProcess.unref();
  return launch;
}

const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (scriptPath === fileURLToPath(import.meta.url)) {
  try {
    await openKakomonn();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
