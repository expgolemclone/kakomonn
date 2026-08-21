import assert from "node:assert/strict";
import test from "node:test";

import {
  CHROME_AUTOPLAY_ARGUMENT,
  KAKOMONN_SITE,
  KAKOMONN_ORIGIN,
  SYNC_API_ORIGIN,
  openKakomonn,
  requestNextQuestionURL,
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
const QUESTION_ID = "48300";
const QUESTION_URL = `${KAKOMONN_ORIGIN}/questions/${QUESTION_ID}`;

function nextQuestionResponse({
  questionId = QUESTION_ID,
  url = QUESTION_URL,
  kind = "review",
  dueMs = 1_787_214_768_127,
} = {}) {
  return {
    ok: true,
    status: 200,
    async json() {
      return { question: { questionId, url, kind, dueMs } };
    },
  };
}

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

test("requests the scheduled next question with the sync token", async () => {
  const calls = [];
  const result = await requestNextQuestionURL({
    environment: ENVIRONMENT,
    async fetchImpl(...arguments_) {
      calls.push(arguments_);
      return nextQuestionResponse();
    },
  });

  assert.equal(result, QUESTION_URL);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0][0].href,
    `${SYNC_API_ORIGIN}/v7/next?site=${KAKOMONN_SITE}`,
  );
  assert.deepEqual(calls[0][1], {
    headers: {
      Authorization: `Bearer ${ENVIRONMENT.KAKOMONN_SYNC_TOKEN}`,
      "cache-control": "no-cache",
    },
  });
});

test("resolves the dedicated Chrome profile and scheduled URL", () => {
  const launch = resolveKakomonnLaunch({
    questionURL: QUESTION_URL,
    environment: ENVIRONMENT,
    platform: "win32",
    stat: expectedStat,
  });

  assert.deepEqual(launch, {
    arguments: [
      `--user-data-dir=${PROFILE_PATH}`,
      CHROME_AUTOPLAY_ARGUMENT,
      QUESTION_URL,
    ],
    executablePath: CHROME_PATH,
    userDataDir: PROFILE_PATH,
  });
});

test("opens the scheduled question detached without passing the sync token", async () => {
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

  await openKakomonn({
    environment: ENVIRONMENT,
    fetchImpl: async () => nextQuestionResponse(),
    platform: "win32",
    spawnProcess,
    stat: expectedStat,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], CHROME_PATH);
  assert.deepEqual(calls[0][1], [
    `--user-data-dir=${PROFILE_PATH}`,
    CHROME_AUTOPLAY_ARGUMENT,
    QUESTION_URL,
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

test("rejects missing authentication without requesting or opening", async () => {
  let fetchCalled = false;
  let spawnCalled = false;
  await assert.rejects(
    () =>
      openKakomonn({
        environment: {
          LOCALAPPDATA: ENVIRONMENT.LOCALAPPDATA,
          ProgramFiles: ENVIRONMENT.ProgramFiles,
        },
        fetchImpl: async () => {
          fetchCalled = true;
          return nextQuestionResponse();
        },
        platform: "win32",
        spawnProcess() {
          spawnCalled = true;
        },
        stat: expectedStat,
      }),
    /KAKOMONN_SYNC_TOKEN is not set/,
  );
  assert.equal(fetchCalled, false);
  assert.equal(spawnCalled, false);
});

test("rejects request failures without opening Chrome", async () => {
  let spawnCalled = false;
  await assert.rejects(
    () =>
      openKakomonn({
        environment: ENVIRONMENT,
        fetchImpl: async () => ({ ok: false, status: 401 }),
        platform: "win32",
        spawnProcess() {
          spawnCalled = true;
        },
        stat: expectedStat,
      }),
    /HTTP 401/,
  );
  assert.equal(spawnCalled, false);

  await assert.rejects(
    () =>
      requestNextQuestionURL({
        environment: ENVIRONMENT,
        fetchImpl: async () => {
          throw new Error("network error");
        },
      }),
    /Failed to request the next question/,
  );
});

test("rejects invalid and unavailable next question responses", async () => {
  const invalidResponses = [
    {
      ok: true,
      status: 200,
      async json() {
        throw new SyntaxError("invalid JSON");
      },
      expected: /not valid JSON/,
    },
    {
      ...nextQuestionResponse(),
      async json() {
        return { question: null };
      },
      expected: /No next question is available/,
    },
    {
      ...nextQuestionResponse(),
      async json() {
        return {
          question: {
            questionId: QUESTION_ID,
            url: `https://example.com/questions/${QUESTION_ID}`,
            kind: "review",
            dueMs: null,
          },
        };
      },
      expected: /response is invalid/,
    },
    {
      ...nextQuestionResponse(),
      async json() {
        return {
          question: {
            questionId: "99999",
            url: QUESTION_URL,
            kind: "review",
            dueMs: null,
          },
        };
      },
      expected: /response is invalid/,
    },
  ];

  for (const response of invalidResponses) {
    await assert.rejects(
      () =>
        requestNextQuestionURL({
          environment: ENVIRONMENT,
          fetchImpl: async () => response,
        }),
      response.expected,
    );
  }
});

test("rejects unsupported platforms and missing required paths", () => {
  assert.throws(
    () =>
      resolveKakomonnLaunch({
        questionURL: QUESTION_URL,
        environment: ENVIRONMENT,
        platform: "linux",
        stat: expectedStat,
      }),
    /requires Windows/,
  );

  assert.throws(
    () =>
      resolveKakomonnLaunch({
        questionURL: QUESTION_URL,
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
        questionURL: QUESTION_URL,
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

  assert.throws(
    () =>
      resolveKakomonnLaunch({
        questionURL: `${KAKOMONN_ORIGIN}/questions/${QUESTION_ID}?unexpected=1`,
        environment: ENVIRONMENT,
        platform: "win32",
        stat: expectedStat,
      }),
    /response is invalid/,
  );
});
