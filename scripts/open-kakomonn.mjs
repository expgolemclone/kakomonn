import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import kakomonnConfig from "./kakomonn-config.cjs";

const {
  kakomonnFreeEnvironment,
  readKakomonnConfiguration,
  requireKakomonnConfiguration,
} = kakomonnConfig;

export const KAKOMONN_SITE = "chushoks.kakomonn.com";
export const KAKOMONN_ORIGIN = `https://${KAKOMONN_SITE}`;
export const SYNC_API_ORIGIN = "https://kakomonn-sync.kakomonn.workers.dev";
export const CHROME_AUTOPLAY_ARGUMENT =
  "--autoplay-policy=no-user-gesture-required";
export const CHROME_HIDE_CRASH_RESTORE_BUBBLE_ARGUMENT =
  "--hide-crash-restore-bubble";

function validatedQuestionURL(candidateURL) {
  if (typeof candidateURL !== "string") {
    throw new Error("Next question response is invalid");
  }
  let url;
  try {
    url = new URL(candidateURL);
  } catch {
    throw new Error("Next question response is invalid");
  }
  const questionId = url.pathname.match(/^\/questions\/(\d+)$/)?.[1];
  if (
    url.origin !== KAKOMONN_ORIGIN ||
    questionId === undefined ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Next question response is invalid");
  }
  return { questionId, url: url.href };
}

function validatedNextQuestionURL(value) {
  if (value === null || typeof value !== "object") {
    throw new Error("Next question response is invalid");
  }
  if (value.question === null) {
    throw new Error("No next question is available");
  }
  if (typeof value.question !== "object") {
    throw new Error("Next question response is invalid");
  }

  const { questionId, url } = validatedQuestionURL(value.question.url);
  if (
    value.question.questionId !== questionId ||
    (value.question.kind !== "review" && value.question.kind !== "new") ||
    (value.question.dueMs !== null &&
      !Number.isSafeInteger(value.question.dueMs))
  ) {
    throw new Error("Next question response is invalid");
  }
  return url;
}

export async function requestNextQuestionURL({
  configuration = readKakomonnConfiguration(),
  fetchImpl = fetch,
} = {}) {
  const token = requireKakomonnConfiguration(
    configuration,
    "KAKOMONN_SYNC_TOKEN",
  );

  const endpoint = new URL("/v8/next", SYNC_API_ORIGIN);
  endpoint.searchParams.set("site", KAKOMONN_SITE);
  let response;
  try {
    response = await fetchImpl(endpoint, {
      headers: {
        Authorization: `Bearer ${token}`,
        "cache-control": "no-cache",
      },
    });
  } catch (error) {
    throw new Error("Failed to request the next question", { cause: error });
  }
  if (!response.ok) {
    throw new Error(`Next question request failed with HTTP ${response.status}`);
  }

  let body;
  try {
    body = await response.json();
  } catch (error) {
    throw new Error("Next question response is not valid JSON", {
      cause: error,
    });
  }
  return validatedNextQuestionURL(body);
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
  questionURL,
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
  const validatedURL = validatedQuestionURL(questionURL).url;

  return {
    arguments: [
      `--user-data-dir=${userDataDir}`,
      CHROME_HIDE_CRASH_RESTORE_BUBBLE_ARGUMENT,
      CHROME_AUTOPLAY_ARGUMENT,
      validatedURL,
    ],
    executablePath,
    userDataDir,
  };
}

export async function openKakomonn({
  configuration = readKakomonnConfiguration(),
  fetchImpl = fetch,
  platform = process.platform,
  spawnProcess = spawn,
  stat = statSync,
  systemEnvironment = process.env,
} = {}) {
  const questionURL = await requestNextQuestionURL({
    configuration,
    fetchImpl,
  });
  const launch = resolveKakomonnLaunch({
    configuration,
    questionURL,
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
    await openKakomonn();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
