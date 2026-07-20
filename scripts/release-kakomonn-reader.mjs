import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export const IOS_WORKFLOW_FILE = "validate-kakomonn-reader-ios-safari.yml";
export const IOS_RUN_NAME_PREFIX = "Validate kakomonn-reader iOS";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const RELEASE_ASSET = "kakomonn-reader/kakomonn-reader.user.js";
const DISCOVERY_ATTEMPTS = 60;
const DISCOVERY_INTERVAL_MS = 2_000;
const WINDOWS_CMD_SAFE_PATTERN = /^[A-Za-z0-9_./:@=-]+$/;
const WINDOWS_WRAPPER_COMMANDS = new Set(["jj", "npm"]);

export class ReleaseError extends Error {}

function formatCommand(command, args) {
  return [command, ...args]
    .map((value) => (/^[A-Za-z0-9_./:@=-]+$/.test(value) ? value : JSON.stringify(value)))
    .join(" ");
}

function resolveInvocation(command, args, platform, commandShell) {
  if (platform !== "win32" || !WINDOWS_WRAPPER_COMMANDS.has(command)) {
    return { args, executable: command };
  }
  if (!commandShell) {
    throw new ReleaseError("ComSpec is required to execute Windows command wrappers");
  }
  const commandParts = [command, ...args];
  const unsafePart = commandParts.find(
    (value) => !WINDOWS_CMD_SAFE_PATTERN.test(value),
  );
  if (unsafePart !== undefined) {
    throw new ReleaseError(
      `Unsafe Windows command-wrapper argument was rejected: ${unsafePart}`,
    );
  }
  return {
    args: ["/d", "/s", "/c", commandParts.join(" ")],
    executable: commandShell,
  };
}

export function createCommandRunner({
  cwd = PROJECT_ROOT,
  platform = process.platform,
  commandShell = process.env.ComSpec,
  spawnSyncImpl = spawnSync,
} = {}) {
  return (command, args = [], { capture = false } = {}) => {
    const invocation = resolveInvocation(command, args, platform, commandShell);
    const result = spawnSyncImpl(invocation.executable, invocation.args, {
      cwd,
      encoding: "utf8",
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
      windowsHide: true,
    });

    if (result.error) {
      throw new ReleaseError(
        `Could not start ${formatCommand(command, args)}: ${result.error.message}`,
      );
    }
    if (result.status !== 0) {
      const details = capture
        ? [result.stdout, result.stderr]
            .map((value) => value?.trim())
            .filter(Boolean)
            .join("\n")
        : "";
      const suffix = details ? `\n${details}` : "";
      throw new ReleaseError(
        `Command failed with exit code ${result.status}: ${formatCommand(command, args)}${suffix}`,
      );
    }
    return capture ? result.stdout.trim() : "";
  };
}

function parseJson(output, label) {
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new ReleaseError(`${label} returned invalid JSON: ${error.message}`);
  }
}

function parseSha(output, label) {
  const sha = output.trim();
  if (!SHA_PATTERN.test(sha)) {
    throw new ReleaseError(`${label} did not resolve to one full commit SHA: ${sha}`);
  }
  return sha;
}

function readJjSha(runCommand, revision) {
  return parseSha(
    runCommand(
      "jj",
      ["log", "--no-graph", "-r", revision, "-T", "commit_id"],
      { capture: true },
    ),
    `jj revision ${revision}`,
  );
}

function readOriginUrl(runCommand) {
  const remoteList = runCommand("jj", ["git", "remote", "list"], {
    capture: true,
  });
  const originLines = remoteList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("origin "));
  if (originLines.length !== 1) {
    throw new ReleaseError("Exactly one origin remote is required");
  }
  return originLines[0].slice("origin ".length).trim();
}

function readGitHubRepository(runCommand, originUrl) {
  const repository = parseJson(
    runCommand(
      "gh",
      [
        "repo",
        "view",
        originUrl,
        "--json",
        "nameWithOwner,url,defaultBranchRef",
      ],
      { capture: true },
    ),
    "gh repo view",
  );

  if (
    typeof repository.nameWithOwner !== "string" ||
    typeof repository.url !== "string" ||
    repository.defaultBranchRef?.name !== "main"
  ) {
    throw new ReleaseError("The GitHub repository default branch must be main");
  }

  const mainSha = parseSha(
    runCommand(
      "gh",
      [
        "api",
        `repos/${repository.nameWithOwner}/commits/main`,
        "--jq",
        ".sha",
      ],
      { capture: true },
    ),
    "GitHub main",
  );

  return {
    mainSha,
    nameWithOwner: repository.nameWithOwner,
    url: repository.url.replace(/\/$/, ""),
  };
}

function assertReleaseState(runCommand, expectedSha = null) {
  runCommand("jj", ["git", "fetch", "--remote", "origin"]);

  const workingCopyDiff = runCommand(
    "jj",
    ["diff", "--from", "main", "--to", "@", "--summary"],
    { capture: true },
  );
  if (workingCopyDiff !== "") {
    throw new ReleaseError(
      `The working copy content differs from main:\n${workingCopyDiff}`,
    );
  }

  const mainSha = readJjSha(runCommand, "main");
  const originMainSha = readJjSha(runCommand, "main@origin");
  if (mainSha !== originMainSha) {
    throw new ReleaseError(
      `Local main ${mainSha} does not match main@origin ${originMainSha}`,
    );
  }
  if (expectedSha !== null && mainSha !== expectedSha) {
    throw new ReleaseError(
      `main changed during release validation: expected ${expectedSha}, got ${mainSha}`,
    );
  }

  const originUrl = readOriginUrl(runCommand);
  const repository = readGitHubRepository(runCommand, originUrl);
  if (repository.mainSha !== mainSha) {
    throw new ReleaseError(
      `GitHub main ${repository.mainSha} does not match local main ${mainSha}`,
    );
  }

  return { mainSha, repository };
}

function workflowRunTitle(commitSha, validationId) {
  return `${IOS_RUN_NAME_PREFIX} ${commitSha} [${validationId}]`;
}

async function findWorkflowRun({
  runCommand,
  repository,
  commitSha,
  validationId,
  sleep,
  attempts,
  intervalMs,
}) {
  const expectedTitle = workflowRunTitle(commitSha, validationId);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const runs = parseJson(
      runCommand(
        "gh",
        [
          "run",
          "list",
          "--workflow",
          IOS_WORKFLOW_FILE,
          "--branch",
          "main",
          "--event",
          "workflow_dispatch",
          "--limit",
          "50",
          "--json",
          "databaseId,displayTitle,status,conclusion,url",
          "--repo",
          repository,
        ],
        { capture: true },
      ),
      "gh run list",
    );
    if (!Array.isArray(runs)) {
      throw new ReleaseError("gh run list did not return an array");
    }

    const matches = runs.filter((run) => run.displayTitle === expectedTitle);
    if (matches.length > 1) {
      throw new ReleaseError(`Multiple workflow runs matched ${expectedTitle}`);
    }
    if (matches.length === 1) {
      const [match] = matches;
      if (!Number.isInteger(match.databaseId)) {
        throw new ReleaseError(`Workflow run ${expectedTitle} has no database ID`);
      }
      return match;
    }

    if (attempt + 1 < attempts) {
      await sleep(intervalMs);
    }
  }

  throw new ReleaseError(
    `Workflow run ${expectedTitle} did not appear within ${(attempts * intervalMs) / 1_000} seconds`,
  );
}

export async function runRelease({
  runCommand = createCommandRunner(),
  randomUUIDFn = randomUUID,
  sleep = delay,
  logger = console.log,
  nodeExecutable = process.execPath,
  discoveryAttempts = DISCOVERY_ATTEMPTS,
  discoveryIntervalMs = DISCOVERY_INTERVAL_MS,
} = {}) {
  logger("Checking release prerequisites and synchronized main state");
  runCommand("jj", ["--version"]);
  runCommand("gh", ["--version"]);
  runCommand("python3", ["--version"]);
  runCommand("gh", ["auth", "status", "--hostname", "github.com"]);

  const initialState = assertReleaseState(runCommand);
  const commitSha = initialState.mainSha;
  const repository = initialState.repository;

  logger("Installing locked dependencies");
  runCommand("npm", ["ci"]);
  runCommand("npm", ["ci", "--prefix", "congratulations"]);

  logger("Running Windows-compatible tests and E2E");
  runCommand("npm", ["test"]);
  runCommand("npm", ["run", "test:smoke"]);
  runCommand(nodeExecutable, ["kakomonn-reader/tests/live_site_e2e_test.js"]);

  const validationId = randomUUIDFn();
  logger(`Dispatching iOS Safari validation ${validationId}`);
  runCommand("gh", [
    "workflow",
    "run",
    IOS_WORKFLOW_FILE,
    "--ref",
    "main",
    "--raw-field",
    `commit_sha=${commitSha}`,
    "--raw-field",
    `validation_id=${validationId}`,
    "--repo",
    repository.nameWithOwner,
  ]);

  const workflowRun = await findWorkflowRun({
    runCommand,
    repository: repository.nameWithOwner,
    commitSha,
    validationId,
    sleep,
    attempts: discoveryAttempts,
    intervalMs: discoveryIntervalMs,
  });
  logger(`Waiting for ${workflowRun.url}`);
  runCommand("gh", [
    "run",
    "watch",
    String(workflowRun.databaseId),
    "--compact",
    "--exit-status",
    "--repo",
    repository.nameWithOwner,
  ]);

  logger("Building the release asset");
  runCommand("npm", ["run", "build:kakomonn-reader"]);

  logger("Rechecking main immediately before publishing");
  const finalState = assertReleaseState(runCommand, commitSha);
  if (finalState.repository.nameWithOwner !== repository.nameWithOwner) {
    throw new ReleaseError("The GitHub repository changed during release validation");
  }

  const shortSha = commitSha.slice(0, 12);
  const tagName = `kakomonn-reader-${commitSha}`;
  const title = `kakomonn-reader ${shortSha}`;
  const notes = `Built from commit [${commitSha}](${repository.url}/commit/${commitSha}).`;
  runCommand("gh", [
    "release",
    "create",
    tagName,
    RELEASE_ASSET,
    "--repo",
    repository.nameWithOwner,
    "--target",
    commitSha,
    "--title",
    title,
    "--notes",
    notes,
    "--latest",
  ]);

  logger(`Published ${tagName}`);
  return { commitSha, tagName, validationId, workflowRun };
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  if (process.argv.length !== 2) {
    console.error("Usage: npm run release:kakomonn-reader");
    process.exitCode = 2;
  } else {
    runRelease().catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
  }
}
