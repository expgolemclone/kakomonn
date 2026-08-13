import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const RELEASE_ASSET = "kakomonn-reader/kakomonn-reader.user.js";
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
  environment = process.env,
  platform = process.platform,
  commandShell = process.env.ComSpec,
  spawnSyncImpl = spawnSync,
} = {}) {
  const childEnvironment = {
    ...environment,
    NODE_OPTIONS: [environment.NODE_OPTIONS, "--use-system-ca"]
      .filter(Boolean)
      .join(" "),
  };
  return (command, args = [], { capture = false } = {}) => {
    const invocation = resolveInvocation(command, args, platform, commandShell);
    const result = spawnSyncImpl(invocation.executable, invocation.args, {
      cwd,
      encoding: "utf8",
      env: childEnvironment,
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

export async function runRelease({
  runCommand = createCommandRunner(),
  logger = console.log,
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

  logger("Running the complete Windows test suite and live E2E");
  runCommand("npm", ["test"]);

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
  return { commitSha, tagName };
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
