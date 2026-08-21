import assert from "node:assert/strict";
import test from "node:test";

import {
  KAKOMONN_URL,
  openKakomonn,
  resolveKakomonnLaunch,
} from "../scripts/open-kakomonn.mjs";

const ENVIRONMENT = {
  LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
  ProgramFiles: "C:\\Program Files",
  KAKOMONN_SYNC_TOKEN: "secret-token",
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

test("resolves the dedicated Chrome profile and kakomonn URL", () => {
  const launch = resolveKakomonnLaunch({
    environment: ENVIRONMENT,
    platform: "win32",
    stat: expectedStat,
  });

  assert.deepEqual(launch, {
    arguments: [`--user-data-dir=${PROFILE_PATH}`, KAKOMONN_URL],
    executablePath: CHROME_PATH,
    userDataDir: PROFILE_PATH,
  });
});

test("opens Chrome detached without passing the sync token", () => {
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

  openKakomonn({
    environment: ENVIRONMENT,
    platform: "win32",
    spawnProcess,
    stat: expectedStat,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], CHROME_PATH);
  assert.deepEqual(calls[0][1], [
    `--user-data-dir=${PROFILE_PATH}`,
    KAKOMONN_URL,
  ]);
  assert.deepEqual(calls[0][2], {
    detached: true,
    env: {
      LOCALAPPDATA: ENVIRONMENT.LOCALAPPDATA,
      ProgramFiles: ENVIRONMENT.ProgramFiles,
      SystemRoot: ENVIRONMENT.SystemRoot,
    },
    stdio: "ignore",
  });
  assert.equal(unrefCalled, true);
});

test("rejects unsupported platforms and missing required paths", () => {
  assert.throws(
    () =>
      resolveKakomonnLaunch({
        environment: ENVIRONMENT,
        platform: "linux",
        stat: expectedStat,
      }),
    /requires Windows/,
  );

  assert.throws(
    () =>
      resolveKakomonnLaunch({
        environment: ENVIRONMENT,
        platform: "win32",
        stat(candidatePath) {
          if (candidatePath === CHROME_PATH) {
            const error = new Error("missing");
            error.code = "ENOENT";
            throw error;
          }
          return expectedStat(candidatePath);
        },
      }),
    /Chrome executable was not found/,
  );

  assert.throws(
    () =>
      resolveKakomonnLaunch({
        environment: ENVIRONMENT,
        platform: "win32",
        stat(candidatePath) {
          if (candidatePath === PROFILE_PATH) {
            const error = new Error("missing");
            error.code = "ENOENT";
            throw error;
          }
          return expectedStat(candidatePath);
        },
      }),
    /Dedicated Chrome profile was not found/,
  );
});
