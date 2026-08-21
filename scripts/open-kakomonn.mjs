import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const KAKOMONN_SITE = "chushoks.kakomonn.com";
export const KAKOMONN_ORIGIN = `https://${KAKOMONN_SITE}`;
export const SYNC_API_ORIGIN = "https://kakomonn-sync.kakomonn.workers.dev";

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
  environment = process.env,
  fetchImpl = fetch,
} = {}) {
  const token = environment.KAKOMONN_SYNC_TOKEN;
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("KAKOMONN_SYNC_TOKEN is not set");
  }

  const endpoint = new URL("/v7/next", SYNC_API_ORIGIN);
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
  questionURL,
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
  const validatedURL = validatedQuestionURL(questionURL).url;

  return {
    arguments: [`--user-data-dir=${userDataDir}`, validatedURL],
    executablePath,
    userDataDir,
  };
}

export function secretFreeEnvironment(environment = process.env) {
  const childEnvironment = { ...environment };
  delete childEnvironment.KAKOMONN_SYNC_TOKEN;
  return childEnvironment;
}

export async function openKakomonn({
  environment = process.env,
  fetchImpl = fetch,
  platform = process.platform,
  spawnProcess = spawn,
  stat = statSync,
} = {}) {
  const questionURL = await requestNextQuestionURL({ environment, fetchImpl });
  const launch = resolveKakomonnLaunch({
    questionURL,
    environment,
    platform,
    stat,
  });
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
    await openKakomonn();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
