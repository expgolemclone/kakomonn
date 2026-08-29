import assert from "node:assert/strict";
import test from "node:test";

import {
  CHROME_AUTOPLAY_ARGUMENT,
  CHROME_HIDE_CRASH_RESTORE_BUBBLE_ARGUMENT,
  KAKOMONN_OPEN_URL,
  openKakomonn,
  resolveKakomonnLaunch,
} from "../scripts/open-kakomonn.mjs";

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

test("opens the fixed URL detached without requiring or forwarding a token", () => {
  const calls = [];
  let unrefCalled = false;
  const spawnProcess = (...arguments_) => {
    calls.push(arguments_);
    return {
      unref() {
        unrefCalled = true;
      },
    };
  };

  const launch = openKakomonn({
    configuration: {},
    platform: "win32",
    spawnProcess,
    stat: expectedStat,
    systemEnvironment: SYSTEM_ENVIRONMENT,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], CHROME_PATH);
  assert.deepEqual(calls[0][1], [
    `--user-data-dir=${PROFILE_PATH}`,
    CHROME_HIDE_CRASH_RESTORE_BUBBLE_ARGUMENT,
    CHROME_AUTOPLAY_ARGUMENT,
    KAKOMONN_OPEN_URL,
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
  assert.equal(unrefCalled, true);
  assert.deepEqual(launch, {
    arguments: calls[0][1],
    executablePath: CHROME_PATH,
    userDataDir: PROFILE_PATH,
  });
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
