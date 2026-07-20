import assert from "node:assert/strict";
import test from "node:test";

import {
  IOS_RUN_NAME_PREFIX,
  IOS_WORKFLOW_FILE,
  createCommandRunner,
  runRelease,
} from "../scripts/release-kakomonn-reader.mjs";

const SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);
const VALIDATION_ID = "11111111-2222-4333-8444-555555555555";
const REPOSITORY = "expgolemclone/browser-extensions";
const REPOSITORY_URL = `https://github.com/${REPOSITORY}`;
const RUN_TITLE = `${IOS_RUN_NAME_PREFIX} ${SHA} [${VALIDATION_ID}]`;

function valueAt(values, index) {
  return values[Math.min(index, values.length - 1)];
}

function createFakeRunner({
  dirtySummary = "",
  mainShas = [SHA],
  originShas = [SHA],
  githubShas = [SHA],
  remoteList = `origin ${REPOSITORY_URL}.git`,
  runLists = [
    [
      {
        databaseId: 73,
        displayTitle: RUN_TITLE,
        status: "queued",
        conclusion: "",
        url: "https://github.com/example/actions/runs/73",
      },
    ],
  ],
  failNpmTest = false,
  failWorkflowWatch = false,
  failReleaseCreate = false,
} = {}) {
  const calls = [];
  let mainIndex = 0;
  let originIndex = 0;
  let githubIndex = 0;
  let runListIndex = 0;

  function runCommand(command, args = [], options = {}) {
    calls.push({ command, args: [...args], options: { ...options } });

    if (command === "jj" && args[0] === "diff") {
      return dirtySummary;
    }
    if (
      command === "jj" &&
      args[0] === "git" &&
      args[1] === "remote" &&
      args[2] === "list"
    ) {
      return remoteList;
    }
    if (command === "jj" && args[0] === "log") {
      const revision = args[args.indexOf("-r") + 1];
      if (revision === "main") {
        const value = valueAt(mainShas, mainIndex);
        mainIndex += 1;
        return value;
      }
      if (revision === "main@origin") {
        const value = valueAt(originShas, originIndex);
        originIndex += 1;
        return value;
      }
    }
    if (command === "gh" && args[0] === "repo" && args[1] === "view") {
      return JSON.stringify({
        nameWithOwner: REPOSITORY,
        url: REPOSITORY_URL,
        defaultBranchRef: { name: "main" },
      });
    }
    if (command === "gh" && args[0] === "api") {
      const value = valueAt(githubShas, githubIndex);
      githubIndex += 1;
      return value;
    }
    if (command === "gh" && args[0] === "run" && args[1] === "list") {
      const value = valueAt(runLists, runListIndex);
      runListIndex += 1;
      return JSON.stringify(value);
    }
    if (command === "npm" && args.length === 1 && args[0] === "test") {
      if (failNpmTest) {
        throw new Error("npm test failed");
      }
    }
    if (command === "gh" && args[0] === "run" && args[1] === "watch") {
      if (failWorkflowWatch) {
        throw new Error("iOS workflow failed");
      }
    }
    if (command === "gh" && args[0] === "release" && args[1] === "create") {
      if (failReleaseCreate) {
        throw new Error("release already exists");
      }
    }
    return "";
  }

  return { calls, runCommand };
}

function releaseOptions(fake, overrides = {}) {
  return {
    runCommand: fake.runCommand,
    randomUUIDFn: () => VALIDATION_ID,
    sleep: async () => {},
    logger: () => {},
    nodeExecutable: "node.exe",
    discoveryAttempts: 3,
    discoveryIntervalMs: 0,
    ...overrides,
  };
}

function findCall(calls, command, firstArg, secondArg) {
  return calls.find(
    (call) =>
      call.command === command &&
      call.args[0] === firstArg &&
      (secondArg === undefined || call.args[1] === secondArg),
  );
}

test("uses Windows command wrappers without a shell", () => {
  const calls = [];
  const runner = createCommandRunner({
    cwd: "C:\\repo",
    platform: "win32",
    commandShell: "C:\\Windows\\System32\\cmd.exe",
    spawnSyncImpl: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0, stdout: "ok\n", stderr: "" };
    },
  });

  assert.equal(runner("npm", ["--version"], { capture: true }), "ok");
  runner("jj", ["--version"]);

  assert.equal(calls[0].command, "C:\\Windows\\System32\\cmd.exe");
  assert.deepEqual(calls[0].args, ["/d", "/s", "/c", "npm --version"]);
  assert.deepEqual(calls[0].options.stdio, ["ignore", "pipe", "pipe"]);
  assert.equal(calls[0].options.cwd, "C:\\repo");
  assert.equal(calls[1].command, "C:\\Windows\\System32\\cmd.exe");
  assert.deepEqual(calls[1].args, ["/d", "/s", "/c", "jj --version"]);
  assert.equal(calls[1].options.stdio, "inherit");
  assert.throws(
    () => runner("npm", ["run", "unsafe & command"]),
    /Unsafe Windows command-wrapper argument/,
  );
});

test("publishes the synchronized main only after every validation", async () => {
  const fake = createFakeRunner();
  const result = await runRelease(releaseOptions(fake));

  assert.equal(result.commitSha, SHA);
  assert.equal(result.tagName, `kakomonn-reader-${SHA}`);
  assert.equal(
    findCall(fake.calls, "gh", "repo", "view").args[2],
    `${REPOSITORY_URL}.git`,
  );

  const dispatchCall = findCall(fake.calls, "gh", "workflow", "run");
  assert.deepEqual(dispatchCall.args, [
    "workflow",
    "run",
    IOS_WORKFLOW_FILE,
    "--ref",
    "main",
    "--raw-field",
    `commit_sha=${SHA}`,
    "--raw-field",
    `validation_id=${VALIDATION_ID}`,
    "--repo",
    REPOSITORY,
  ]);

  const watchCall = findCall(fake.calls, "gh", "run", "watch");
  assert.equal(watchCall.args[2], "73");

  const releaseCall = findCall(fake.calls, "gh", "release", "create");
  assert.deepEqual(releaseCall.args, [
    "release",
    "create",
    `kakomonn-reader-${SHA}`,
    "kakomonn-reader/kakomonn-reader.user.js",
    "--repo",
    REPOSITORY,
    "--target",
    SHA,
    "--title",
    `kakomonn-reader ${SHA.slice(0, 12)}`,
    "--notes",
    `Built from commit [${SHA}](${REPOSITORY_URL}/commit/${SHA}).`,
    "--latest",
  ]);

  const npmCalls = fake.calls
    .filter((call) => call.command === "npm")
    .map((call) => call.args.join(" "));
  assert.deepEqual(npmCalls, [
    "ci",
    "ci --prefix congratulations",
    "test",
    "run test:smoke",
    "run build:kakomonn-reader",
  ]);
});

test("rejects working copy content that differs from main", async () => {
  const fake = createFakeRunner({ dirtySummary: "M package.json" });

  await assert.rejects(
    runRelease(releaseOptions(fake)),
    /working copy content differs from main/,
  );
  assert.equal(fake.calls.some((call) => call.command === "npm"), false);
});

test("rejects local main that differs from origin", async () => {
  const fake = createFakeRunner({ originShas: [OTHER_SHA] });

  await assert.rejects(
    runRelease(releaseOptions(fake)),
    /does not match main@origin/,
  );
  assert.equal(findCall(fake.calls, "gh", "workflow", "run"), undefined);
});

test("rejects a repository without exactly one origin", async () => {
  const fake = createFakeRunner({ remoteList: "upstream https://example.com/repo" });

  await assert.rejects(
    runRelease(releaseOptions(fake)),
    /Exactly one origin remote is required/,
  );
  assert.equal(findCall(fake.calls, "gh", "workflow", "run"), undefined);
});

test("rejects GitHub main that differs from synchronized jj main", async () => {
  const fake = createFakeRunner({ githubShas: [OTHER_SHA] });

  await assert.rejects(
    runRelease(releaseOptions(fake)),
    /GitHub main .* does not match local main/,
  );
  assert.equal(findCall(fake.calls, "gh", "workflow", "run"), undefined);
});

test("does not dispatch iOS validation after a local test failure", async () => {
  const fake = createFakeRunner({ failNpmTest: true });

  await assert.rejects(runRelease(releaseOptions(fake)), /npm test failed/);
  assert.equal(findCall(fake.calls, "gh", "workflow", "run"), undefined);
});

test("ignores stale runs and watches only the validation UUID match", async () => {
  const staleRun = {
    databaseId: 12,
    displayTitle: `${IOS_RUN_NAME_PREFIX} ${SHA} [stale]`,
    status: "completed",
    conclusion: "success",
    url: "https://github.com/example/actions/runs/12",
  };
  const exactRun = {
    databaseId: 88,
    displayTitle: RUN_TITLE,
    status: "queued",
    conclusion: "",
    url: "https://github.com/example/actions/runs/88",
  };
  const fake = createFakeRunner({ runLists: [[staleRun], [staleRun, exactRun]] });
  let sleepCount = 0;

  await runRelease(
    releaseOptions(fake, {
      sleep: async () => {
        sleepCount += 1;
      },
    }),
  );

  assert.equal(sleepCount, 1);
  assert.equal(findCall(fake.calls, "gh", "run", "watch").args[2], "88");
});

test("does not publish after iOS validation fails", async () => {
  const fake = createFakeRunner({ failWorkflowWatch: true });

  await assert.rejects(
    runRelease(releaseOptions(fake)),
    /iOS workflow failed/,
  );
  assert.equal(findCall(fake.calls, "gh", "release", "create"), undefined);
});

test("does not publish when main moves during iOS validation", async () => {
  const fake = createFakeRunner({
    mainShas: [SHA, OTHER_SHA],
    originShas: [SHA, OTHER_SHA],
    githubShas: [SHA, OTHER_SHA],
  });

  await assert.rejects(
    runRelease(releaseOptions(fake)),
    /main changed during release validation/,
  );
  assert.equal(findCall(fake.calls, "gh", "release", "create"), undefined);
});

test("does not retry or overwrite an existing release", async () => {
  const fake = createFakeRunner({ failReleaseCreate: true });

  await assert.rejects(
    runRelease(releaseOptions(fake)),
    /release already exists/,
  );
  const releaseCalls = fake.calls.filter(
    (call) => call.command === "gh" && call.args[0] === "release",
  );
  assert.equal(releaseCalls.length, 1);
});
