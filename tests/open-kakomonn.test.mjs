import assert from "node:assert/strict";
import test from "node:test";

import windowsChromeProfile from "../scripts/windows-chrome-profile.cjs";
import {
  CHROME_AUTOPLAY_ARGUMENT,
  CHROME_COLD_START_GRACE_MS,
  CHROME_HIDE_CRASH_RESTORE_BUBBLE_ARGUMENT,
  CHROME_NO_STARTUP_WINDOW_ARGUMENT,
  KAKOMONN_OPEN_URL,
  openKakomonn,
  resolveKakomonnLaunch,
} from "../scripts/open-kakomonn.mjs";

const {
  inspectDedicatedChrome,
  inspectDedicatedChromePowerShell,
  stopDedicatedChromePowerShell,
} = windowsChromeProfile;

const SYSTEM_ENVIRONMENT = {
  LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
  ProgramFiles: "C:\\Program Files",
  KAKOMONN_SYNC_TOKEN: "process-token-must-not-be-forwarded",
  SystemRoot: "C:\\Windows",
};
const CHROME_PATH =
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE_PATH =
  "C:\\Users\\tester\\AppData\\Local\\kakomonn-chrome-e2e";
const EMPTY_PROFILE_STATE = Object.freeze({
  autoplayAllowed: false,
  processCount: 0,
  rootProcessCount: 0,
});

function expectedStat(candidatePath) {
  if (candidatePath === CHROME_PATH) {
    return { isDirectory: () => false, isFile: () => true };
  }
  if (candidatePath === PROFILE_PATH) {
    return { isDirectory: () => true, isFile: () => false };
  }
  const error = new Error(`Missing fixture: ${candidatePath}`);
  error.code = "ENOENT";
  throw error;
}

test("resolves the dedicated Chrome profile and fixed open URL", () => {
  const launch = resolveKakomonnLaunch({
    configuration: {},
    platform: "win32",
    stat: expectedStat,
    systemEnvironment: SYSTEM_ENVIRONMENT,
  });

  assert.deepEqual(launch, {
    arguments: [
      `--user-data-dir=${PROFILE_PATH}`,
      CHROME_HIDE_CRASH_RESTORE_BUBBLE_ARGUMENT,
      CHROME_AUTOPLAY_ARGUMENT,
      KAKOMONN_OPEN_URL,
    ],
    executablePath: CHROME_PATH,
    userDataDir: PROFILE_PATH,
  });
});

test("warms a cold dedicated Chrome profile before opening the fixed URL", async () => {
  const calls = [];
  let unrefCallCount = 0;
  const profileInspections = [];
  const waits = [];
  const spawnProcess = (...arguments_) => {
    calls.push(arguments_);
    return {
      exitCode: null,
      unref() {
        unrefCallCount += 1;
      },
    };
  };

  const launch = await openKakomonn({
    configuration: {},
    inspectProfile(userDataDir, options) {
      profileInspections.push({ options, userDataDir });
      return EMPTY_PROFILE_STATE;
    },
    platform: "win32",
    spawnProcess,
    stat: expectedStat,
    systemEnvironment: SYSTEM_ENVIRONMENT,
    async waitForColdStart(milliseconds) {
      waits.push(milliseconds);
    },
  });

  assert.deepEqual(profileInspections, [
    {
      options: { systemEnvironment: SYSTEM_ENVIRONMENT },
      userDataDir: PROFILE_PATH,
    },
  ]);
  assert.deepEqual(waits, [CHROME_COLD_START_GRACE_MS]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], CHROME_PATH);
  assert.deepEqual(calls[0][1], [
    `--user-data-dir=${PROFILE_PATH}`,
    CHROME_HIDE_CRASH_RESTORE_BUBBLE_ARGUMENT,
    CHROME_AUTOPLAY_ARGUMENT,
    CHROME_NO_STARTUP_WINDOW_ARGUMENT,
  ]);
  assert.deepEqual(calls[0][2], {
    detached: true,
    env: {
      LOCALAPPDATA: SYSTEM_ENVIRONMENT.LOCALAPPDATA,
      ProgramFiles: SYSTEM_ENVIRONMENT.ProgramFiles,
      SystemRoot: SYSTEM_ENVIRONMENT.SystemRoot,
    },
    stdio: "ignore",
  });
  assert.equal(calls[1][0], CHROME_PATH);
  assert.deepEqual(calls[1][1], [
    `--user-data-dir=${PROFILE_PATH}`,
    CHROME_HIDE_CRASH_RESTORE_BUBBLE_ARGUMENT,
    CHROME_AUTOPLAY_ARGUMENT,
    KAKOMONN_OPEN_URL,
  ]);
  assert.deepEqual(calls[1][2], calls[0][2]);
  assert.equal(unrefCallCount, 2);
  assert.deepEqual(launch, {
    arguments: calls[1][1],
    executablePath: CHROME_PATH,
    userDataDir: PROFILE_PATH,
  });
});

test("reuses a dedicated Chrome process with automatic playback enabled", async () => {
  let stopCalled = false;
  let spawnCalled = false;
  await openKakomonn({
    configuration: {},
    inspectProfile() {
      return {
        autoplayAllowed: true,
        processCount: 8,
        rootProcessCount: 1,
      };
    },
    platform: "win32",
    spawnProcess() {
      spawnCalled = true;
      return { unref() {} };
    },
    stat: expectedStat,
    stopProfile() {
      stopCalled = true;
    },
    systemEnvironment: SYSTEM_ENVIRONMENT,
  });
  assert.equal(spawnCalled, true);
  assert.equal(stopCalled, false);
});

test("restarts and warms only a dedicated Chrome process missing automatic playback", async () => {
  const operations = [];
  await openKakomonn({
    configuration: {},
    inspectProfile() {
      operations.push("inspect");
      return {
        autoplayAllowed: false,
        processCount: 8,
        rootProcessCount: 1,
      };
    },
    platform: "win32",
    spawnProcess() {
      operations.push("spawn");
      return { exitCode: null, unref() {} };
    },
    stat: expectedStat,
    stopProfile(userDataDir, options) {
      operations.push("stop");
      assert.equal(userDataDir, PROFILE_PATH);
      assert.deepEqual(options, { systemEnvironment: SYSTEM_ENVIRONMENT });
    },
    systemEnvironment: SYSTEM_ENVIRONMENT,
    async waitForColdStart(milliseconds) {
      operations.push(`wait:${milliseconds}`);
    },
  });
  assert.deepEqual(operations, [
    "inspect",
    "stop",
    "spawn",
    `wait:${CHROME_COLD_START_GRACE_MS}`,
    "spawn",
  ]);
});

test("does not open the URL when cold Chrome exits during startup", async () => {
  const calls = [];
  await assert.rejects(
    () =>
      openKakomonn({
        configuration: {},
        inspectProfile: () => EMPTY_PROFILE_STATE,
        platform: "win32",
        spawnProcess(...arguments_) {
          calls.push(arguments_);
          return { exitCode: 9, unref() {} };
        },
        stat: expectedStat,
        systemEnvironment: SYSTEM_ENVIRONMENT,
        async waitForColdStart() {},
      }),
    /Google Chrome exited during startup: 9/,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].at(-1), CHROME_NO_STARTUP_WINDOW_ARGUMENT);
});

test("does not launch when a required dedicated Chrome restart fails", async () => {
  let spawnCalled = false;
  await assert.rejects(
    async () =>
      openKakomonn({
        configuration: {},
        inspectProfile: () => ({
          autoplayAllowed: false,
          processCount: 1,
          rootProcessCount: 1,
        }),
        platform: "win32",
        spawnProcess() {
          spawnCalled = true;
          return { unref() {} };
        },
        stat: expectedStat,
        stopProfile() {
          throw new Error("restart failed");
        },
        systemEnvironment: SYSTEM_ENVIRONMENT,
      }),
    /restart failed/,
  );
  assert.equal(spawnCalled, false);
});

test("does not launch when the dedicated Chrome process cannot be inspected", async () => {
  let spawnCalled = false;
  await assert.rejects(
    async () =>
      openKakomonn({
        configuration: {},
        inspectProfile() {
          throw new Error("inspection failed");
        },
        platform: "win32",
        spawnProcess() {
          spawnCalled = true;
          return { unref() {} };
        },
        stat: expectedStat,
        systemEnvironment: SYSTEM_ENVIRONMENT,
      }),
    /inspection failed/,
  );
  assert.equal(spawnCalled, false);
});

test("uses configured Chrome paths", () => {
  const configuredChrome = "D:\\Chrome\\chrome.exe";
  const configuredProfile = "D:\\KakomonnProfile";
  const launch = resolveKakomonnLaunch({
    configuration: {
      KAKOMONN_CHROME_EXECUTABLE: configuredChrome,
      KAKOMONN_CHROME_USER_DATA_DIR: configuredProfile,
    },
    platform: "win32",
    stat(candidatePath) {
      if (candidatePath === configuredChrome) {
        return { isDirectory: () => false, isFile: () => true };
      }
      if (candidatePath === configuredProfile) {
        return { isDirectory: () => true, isFile: () => false };
      }
      throw new Error(`Unexpected path: ${candidatePath}`);
    },
    systemEnvironment: SYSTEM_ENVIRONMENT,
  });

  assert.equal(launch.executablePath, configuredChrome);
  assert.equal(launch.userDataDir, configuredProfile);
  assert.equal(launch.arguments.at(-1), KAKOMONN_OPEN_URL);
});

test("rejects unsupported platforms and missing system paths", () => {
  assert.throws(
    () =>
      resolveKakomonnLaunch({
        configuration: {},
        platform: "linux",
        stat: expectedStat,
        systemEnvironment: SYSTEM_ENVIRONMENT,
      }),
    /requires Windows/,
  );
  assert.throws(
    () =>
      resolveKakomonnLaunch({
        configuration: {},
        platform: "win32",
        stat: expectedStat,
        systemEnvironment: {
          LOCALAPPDATA: SYSTEM_ENVIRONMENT.LOCALAPPDATA,
        },
      }),
    /ProgramFiles is not set/,
  );
  assert.throws(
    () =>
      resolveKakomonnLaunch({
        configuration: {},
        platform: "win32",
        stat: expectedStat,
        systemEnvironment: {
          ProgramFiles: SYSTEM_ENVIRONMENT.ProgramFiles,
        },
      }),
    /LOCALAPPDATA is not set/,
  );
});

test("rejects missing and incorrectly typed Chrome paths", () => {
  assert.throws(
    () =>
      resolveKakomonnLaunch({
        configuration: {},
        platform: "win32",
        stat(candidatePath) {
          if (candidatePath === CHROME_PATH) {
            const error = new Error("missing");
            error.code = "ENOENT";
            throw error;
          }
          return expectedStat(candidatePath);
        },
        systemEnvironment: SYSTEM_ENVIRONMENT,
      }),
    /Chrome executable was not found/,
  );
  assert.throws(
    () =>
      resolveKakomonnLaunch({
        configuration: {},
        platform: "win32",
        stat(candidatePath) {
          if (candidatePath === PROFILE_PATH) {
            return { isDirectory: () => false, isFile: () => true };
          }
          return expectedStat(candidatePath);
        },
        systemEnvironment: SYSTEM_ENVIRONMENT,
      }),
    /Dedicated Chrome profile has an unexpected type/,
  );
});

test("rejects the standard Chrome profile before inspecting processes", async () => {
  const standardProfile =
    "C:\\Users\\tester\\AppData\\Local\\Google\\Chrome\\User Data\\Default";
  let inspected = false;
  await assert.rejects(
    async () =>
      openKakomonn({
        configuration: {
          KAKOMONN_CHROME_USER_DATA_DIR: standardProfile,
        },
        inspectProfile() {
          inspected = true;
          return EMPTY_PROFILE_STATE;
        },
        platform: "win32",
        stat(candidatePath) {
          if (candidatePath === CHROME_PATH) {
            return { isDirectory: () => false, isFile: () => true };
          }
          if (candidatePath === standardProfile) {
            return { isDirectory: () => true, isFile: () => false };
          }
          throw new Error(`Unexpected path: ${candidatePath}`);
        },
        systemEnvironment: SYSTEM_ENVIRONMENT,
      }),
    /must be outside the standard Chrome user data directory/,
  );
  assert.equal(inspected, false);
});

test("inspects the exact Chrome profile through a sanitized PowerShell call", () => {
  const calls = [];
  const state = inspectDedicatedChrome(PROFILE_PATH, {
    spawnSyncImpl(executable, args, options) {
      calls.push({ args, executable, options });
      return {
        status: 0,
        stderr: "",
        stdout: JSON.stringify({
          autoplayAllowed: true,
          processCount: 7,
          rootProcessCount: 1,
        }),
      };
    },
    systemEnvironment: SYSTEM_ENVIRONMENT,
  });
  assert.deepEqual(state, {
    autoplayAllowed: true,
    processCount: 7,
    rootProcessCount: 1,
  });
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].executable,
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  );
  assert.deepEqual(calls[0].args.slice(-4), [
    "-UserDataDir",
    PROFILE_PATH,
    "-AutoplayArgument",
    CHROME_AUTOPLAY_ARGUMENT,
  ]);
  assert.equal(
    Object.keys(calls[0].options.env).some((key) =>
      key.startsWith("KAKOMONN_"),
    ),
    false,
  );
});

test("matches normalized Chrome profile paths in PowerShell", () => {
  assert.match(inspectDedicatedChromePowerShell, /autoplayAllowed/);
  assert.match(stopDedicatedChromePowerShell, /Get-DedicatedChromeProcesses/);
  assert.match(stopDedicatedChromePowerShell, /Dedicated Chrome processes did not exit/);
  assert.doesNotMatch(stopDedicatedChromePowerShell, /taskkill/i);
});
