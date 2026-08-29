import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import kakomonnConfig from "./kakomonn-config.cjs";

const {
  kakomonnFreeEnvironment,
  readKakomonnConfiguration,
} = kakomonnConfig;

export const KAKOMONN_OPEN_URL =
  "https://kakomonn-sync.kakomonn.workers.dev/open";
export const CHROME_AUTOPLAY_ARGUMENT =
  "--autoplay-policy=no-user-gesture-required";
export const CHROME_HIDE_CRASH_RESTORE_BUBBLE_ARGUMENT =
  "--hide-crash-restore-bubble";

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

  requirePathType(executablePath, "Chrome executable", stat);
  requirePathType(userDataDir, "Dedicated Chrome profile", stat);

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

export function openKakomonn({
  configuration = readKakomonnConfiguration(),
  platform = process.platform,
  spawnProcess = spawn,
  stat = statSync,
  systemEnvironment = process.env,
} = {}) {
  const launch = resolveKakomonnLaunch({
    configuration,
    platform,
    stat,
    systemEnvironment,
  });
  const browserProcess = spawnProcess(launch.executablePath, launch.arguments, {
    detached: true,
    env: kakomonnFreeEnvironment(systemEnvironment),
    stdio: "ignore",
  });
  browserProcess.unref();
  return launch;
}

const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (scriptPath === fileURLToPath(import.meta.url)) {
  try {
    openKakomonn();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
