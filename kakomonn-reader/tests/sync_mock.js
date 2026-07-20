const SYNC_TOKEN_KEY = "kakomonn-reader.sync-token";
const PENDING_ANSWER_KEY = "kakomonn-reader.pending-answer";
const LEGACY_PENDING_CORRECT_KEY = "kakomonn-reader.pending-correct";
const PENDING_CELEBRATION_KEY = "kakomonn-reader.pending-celebration";
const SYNC_API_ORIGIN = "https://kakomonn-count-sync.expgolem-lab.workers.dev";
const CONGRATULATIONS_ORIGIN =
  "https://kakomonn-congratulations.expgolem-lab.workers.dev";
const AZURE_SPEECH_ORIGIN = "https://japaneast.tts.speech.microsoft.com";
const AZURE_SPEECH_TOKEN = "test-azure-speech-token";

function installSyncMockInWindow({
  initialCorrectCount,
  initialAnsweredCount,
  initialDate,
  expectedToken,
  hasStoredToken,
  initialPendingAnswer,
  initialLegacyPendingCorrect,
  initialPendingCelebration,
  initialProcessedOperations,
  returnsPromise,
  tokenKey,
  pendingAnswerKey,
  legacyPendingCorrectKey,
  celebrationKey,
  expectedOrigin,
  expectedSpeechOrigin,
  expectedSpeechToken,
}) {
  const values = new Map();
  if (hasStoredToken) {
    values.set(tokenKey, expectedToken);
  }
  if (initialPendingAnswer !== null) {
    values.set(pendingAnswerKey, initialPendingAnswer);
  }
  if (initialLegacyPendingCorrect !== null) {
    values.set(legacyPendingCorrectKey, initialLegacyPendingCorrect);
  }
  if (initialPendingCelebration !== null) {
    values.set(celebrationKey, initialPendingCelebration);
  }

  const processedOperationResults = new Map(
    initialProcessedOperations.map(
      ({ operationId, result = "correct", resultingCount = null }) => [
        operationId,
        {
          result,
          completedMilestone:
            result === "correct" &&
            resultingCount > 0 &&
            resultingCount % 50 === 0
              ? resultingCount
              : null,
        },
      ],
    ),
  );
  const mock = {
    count: initialCorrectCount,
    answeredCount: initialAnsweredCount,
    date: initialDate,
    token: expectedToken,
    calls: [],
    failNextRequest: false,
    failNextSetValue: false,
    failNextDeleteValue: false,
    holdNextSetValue: false,
    releaseHeldSetValue: null,
    commitThenFailNextAnswer: false,
    holdNextRequest: false,
    releaseHeldRequest: null,
  };

  const syncState = () => ({
    date: mock.date,
    counts: {
      correct: mock.count,
      answered: mock.answeredCount,
    },
    milestoneInterval: 50,
  });

  window.__syncMock = mock;
  window.GM = {
    async getValue(key, defaultValue) {
      return values.has(key) ? values.get(key) : defaultValue;
    },
    async setValue(key, value) {
      if (mock.failNextSetValue) {
        mock.failNextSetValue = false;
        throw new Error("mock storage write failed");
      }
      if (mock.holdNextSetValue) {
        mock.holdNextSetValue = false;
        await new Promise((resolve) => {
          mock.releaseHeldSetValue = () => {
            mock.releaseHeldSetValue = null;
            resolve();
          };
        });
      }
      values.set(key, structuredClone(value));
    },
    async deleteValue(key) {
      if (mock.failNextDeleteValue) {
        mock.failNextDeleteValue = false;
        throw new Error("mock storage delete failed");
      }
      values.delete(key);
    },
    xmlHttpRequest(details) {
      let resolveRequest = null;
      let rejectRequest = null;
      const requestPromise = returnsPromise
        ? new Promise((resolve, reject) => {
            resolveRequest = resolve;
            rejectRequest = reject;
          })
        : null;
      const respondJSON = (status, body) => {
        window.setTimeout(() => {
          const response = {
            status,
            responseText: JSON.stringify(body),
          };
          details.onload?.(response);
          resolveRequest?.(response);
        }, 0);
      };
      const respondAudio = () => {
        window.setTimeout(() => {
          const response = {
            status: 200,
            response: new Uint8Array([0x49, 0x44, 0x33, 0x04]).buffer,
            responseHeaders: "content-type: audio/mpeg",
          };
          details.onload?.(response);
          resolveRequest?.(response);
        }, 0);
      };
      const failRequest = () => {
        const error = new Error("mock request failed");
        details.onerror?.({});
        rejectRequest?.(error);
      };
      const contentType = details.headers?.["Content-Type"] ?? "";
      const call = {
        method: details.method,
        url: details.url,
        authorization: details.headers?.Authorization ?? "",
        headers: { ...(details.headers ?? {}) },
        body:
          details.data === undefined
            ? null
            : contentType === "application/json"
              ? JSON.parse(details.data)
              : details.data,
      };
      mock.calls.push(call);

      const executeRequest = () => {
        if (mock.failNextRequest) {
          mock.failNextRequest = false;
          failRequest();
          return;
        }

        const requestURL = new URL(call.url);
        if (requestURL.origin === expectedSpeechOrigin) {
          if (
            call.method !== "POST" ||
            requestURL.pathname !== "/cognitiveservices/v1" ||
            call.authorization !== `Bearer ${expectedSpeechToken}`
          ) {
            respondJSON(401, { error: "invalid_speech_request" });
            return;
          }
          respondAudio();
          return;
        }
        if (requestURL.origin !== expectedOrigin) {
          respondJSON(404, { error: "unexpected_origin" });
          return;
        }
        if (call.authorization !== `Bearer ${mock.token}`) {
          respondJSON(401, { error: "unauthorized" });
          return;
        }

        const pathname = requestURL.pathname;
        if (call.method === "GET" && pathname === "/v2/state") {
          respondJSON(200, syncState());
          return;
        }

        if (call.method === "POST" && pathname === "/v2/speech-token") {
          respondJSON(200, {
            token: expectedSpeechToken,
            expiresInSeconds: 600,
          });
          return;
        }

        if (call.method === "POST" && pathname === "/v2/answers") {
          if (call.body?.date !== mock.date) {
            respondJSON(409, {
              error: "date_changed",
              state: syncState(),
            });
            return;
          }

          const operationId = call.body?.operationId;
          const result = call.body?.result;
          if (
            !/^[0-9a-f]{32}$/.test(operationId) ||
            (result !== "correct" && result !== "incorrect")
          ) {
            respondJSON(400, { error: "invalid_request" });
            return;
          }

          let processed = processedOperationResults.get(operationId);
          if (processed !== undefined && processed.result !== result) {
            respondJSON(409, {
              error: "operation_conflict",
              state: syncState(),
            });
            return;
          }
          if (processed === undefined) {
            mock.answeredCount += 1;
            if (result === "correct") {
              mock.count += 1;
            }
            processed = {
              result,
              completedMilestone:
                result === "correct" && mock.count > 0 && mock.count % 50 === 0
                  ? mock.count
                  : null,
            };
            processedOperationResults.set(operationId, processed);
          }

          if (mock.commitThenFailNextAnswer) {
            mock.commitThenFailNextAnswer = false;
            failRequest();
            return;
          }

          respondJSON(200, {
            state: syncState(),
            completedMilestone: processed.completedMilestone,
          });
          return;
        }

        respondJSON(404, { error: "not_found" });
      };

      if (mock.holdNextRequest) {
        mock.holdNextRequest = false;
        mock.releaseHeldRequest = () => {
          mock.releaseHeldRequest = null;
          window.setTimeout(executeRequest, 0);
        };
      } else {
        window.setTimeout(executeRequest, 0);
      }

      if (requestPromise !== null) {
        requestPromise.abort = () => {};
        return requestPromise;
      }
      return { abort() {} };
    },
  };
  window.__getGMValue = (key) =>
    values.has(key) ? structuredClone(values.get(key)) : null;
}

function createSyncMockConfiguration({
  count = 0,
  answeredCount = count,
  date = "2026-07-17",
  token = "test-sync-token",
  configured = true,
  pendingAnswer = null,
  legacyPendingCorrect = null,
  pendingCelebration = null,
  processedOperations = [],
  userscriptsPromise = false,
} = {}) {
  return {
    initialCorrectCount: count,
    initialAnsweredCount: answeredCount,
    initialDate: date,
    expectedToken: token,
    hasStoredToken: configured,
    initialPendingAnswer: pendingAnswer,
    initialLegacyPendingCorrect: legacyPendingCorrect,
    initialPendingCelebration: pendingCelebration,
    initialProcessedOperations: processedOperations,
    returnsPromise: userscriptsPromise,
    tokenKey: SYNC_TOKEN_KEY,
    pendingAnswerKey: PENDING_ANSWER_KEY,
    legacyPendingCorrectKey: LEGACY_PENDING_CORRECT_KEY,
    celebrationKey: PENDING_CELEBRATION_KEY,
    expectedOrigin: SYNC_API_ORIGIN,
    expectedSpeechOrigin: AZURE_SPEECH_ORIGIN,
    expectedSpeechToken: AZURE_SPEECH_TOKEN,
  };
}

async function installSyncMock(page, options = {}) {
  await page.evaluate(
    installSyncMockInWindow,
    createSyncMockConfiguration(options),
  );
}

module.exports = {
  AZURE_SPEECH_ORIGIN,
  createSyncMockConfiguration,
  installSyncMock,
  installSyncMockInWindow,
  CONGRATULATIONS_ORIGIN,
  LEGACY_PENDING_CORRECT_KEY,
  PENDING_ANSWER_KEY,
  PENDING_CELEBRATION_KEY,
  SYNC_API_ORIGIN,
  SYNC_TOKEN_KEY,
};
