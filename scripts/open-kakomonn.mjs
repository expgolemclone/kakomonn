import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const KAKOMONN_URL = "https://chushoks.kakomonn.com/questions";

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
  environment = process.env,
  platform = process.platform,
  stat = statSync,
} = {}) {
  if (platform !== "win32") {
    throw new Error("open:kakomonn requires Windows");
  }

  const programFiles = environment.ProgramFiles;
  if (!programFiles) {
    throw new Error("ProgramFiles is not set");
  }
  const localAppData = environment.LOCALAPPDATA;
  if (!localAppData) {
    throw new Error("LOCALAPPDATA is not set");
  }

  const executablePath = path.win32.join(
    programFiles,
    "Google",
    "Chrome",
    "Application",
    "chrome.exe",
  );
  const userDataDir = path.win32.join(localAppData, "kakomonn-chrome-e2e");

  requirePathType(executablePath, "Chrome executable", stat);
  requirePathType(userDataDir, "Dedicated Chrome profile", stat);

  return {
    arguments: [`--user-data-dir=${userDataDir}`, KAKOMONN_URL],
    executablePath,
    userDataDir,
  };
}

export function secretFreeEnvironment(environment = process.env) {
  const childEnvironment = { ...environment };
  delete childEnvironment.KAKOMONN_SYNC_TOKEN;
  return childEnvironment;
}

export function openKakomonn({
  environment = process.env,
  platform = process.platform,
  spawnProcess = spawn,
  stat = statSync,
} = {}) {
  const launch = resolveKakomonnLaunch({ environment, platform, stat });
  const browserProcess = spawnProcess(launch.executablePath, launch.arguments, {
    detached: true,
    env: secretFreeEnvironment(environment),
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
