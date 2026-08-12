const SYNC_TOKEN_KEY = "kakomonn-reader.sync-token";
const SITE = "chushoks.kakomonn.com";
const PENDING_ANSWER_KEY = `kakomonn-reader.${SITE}.v5.pending-attempt`;
const LEGACY_PENDING_CORRECT_KEY = `kakomonn-reader.${SITE}.pending-correct`;
const SYNC_API_ORIGIN = "https://kakomonn-count-sync.expgolem-lab.workers.dev";
const AZURE_SPEECH_ORIGIN = "https://japaneast.tts.speech.microsoft.com";
const AZURE_SPEECH_TOKEN = "test-azure-speech-token";

function installSyncMockInWindow({
  initialStabilityDaysCount,
  initialAttemptCount,
  initialSolvedCount,
  initialTodaySolvedCount,
  initialDate,
  expectedToken,
  expectedSite,
  hasStoredToken,
  initialPendingAnswer,
  initialProcessedOperations,
  returnsPromise,
  tokenKey,
  pendingAnswerKey,
  expectedOrigin,
  expectedSpeechOrigin,
  expectedSpeechToken,
  writeClipboardToSystem,
  initialNextQuestionId,
  initialCatalogQuestionCount,
  initialCatalogGeneration,
}) {
  const values = new Map();
  if (hasStoredToken) values.set(tokenKey, expectedToken);
  if (initialPendingAnswer !== null) values.set(pendingAnswerKey, initialPendingAnswer);

  const processed = new Map(
    initialProcessedOperations.map((item) => [
      item.operationId,
      {
        questionId: item.questionId ?? "45124",
        result: item.result ?? "correct",
        previousStability: item.previousStability ?? 29,
        stability: item.stability ?? 31,
      },
    ]),
  );
  const solvedQuestionIds = new Set(
    initialProcessedOperations.map((item) => item.questionId ?? "45124")
  );

  const mock = {
    stabilityDays: initialStabilityDaysCount,
    attemptCount: initialAttemptCount,
    solved: initialSolvedCount,
    todaySolved: initialTodaySolvedCount,
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
    clipboardWrites: [],
    nextQuestionId: initialNextQuestionId,
    nextStabilityDaysDelta: 0,
    catalogUpdatedAtMs: Date.now(),
    catalogQuestionCount: initialCatalogQuestionCount,
    catalogGeneration: initialCatalogGeneration,
    conflictNextCatalogUpdate: false,
  };

  const syncState = () => ({
    site: expectedSite,
    today: mock.date,
    stabilityDays: mock.stabilityDays,
    solved: mock.solved,
    todaySolved: mock.todaySolved,
    todayStabilityDaysDelta: 0,
    catalog:
      mock.catalogQuestionCount === null
        ? null
        : {
            questionCount: mock.catalogQuestionCount,
            updatedAtMs: mock.catalogUpdatedAtMs,
            generation: mock.catalogGeneration,
          },
  });

  window.__syncMock = mock;
  window.GM = {
    async setClipboard(value) {
      if (window.__clipboardWriteFails) throw new Error("mock clipboard write failed");
      mock.clipboardWrites.push(value);
      window.__copiedTexts?.push(value);
      if (writeClipboardToSystem) await navigator.clipboard.writeText(value);
      return true;
    },
    async getValue(key, defaultValue) {
      return values.has(key) ? structuredClone(values.get(key)) : defaultValue;
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
          const response = { status, responseText: JSON.stringify(body) };
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
        if (
          call.method === "GET" &&
          pathname === "/v5/state" &&
          requestURL.searchParams.get("site") === expectedSite
        ) {
          respondJSON(200, syncState());
          return;
        }
        if (call.method === "POST" && pathname === "/v5/speech-token") {
          respondJSON(200, { token: expectedSpeechToken, expiresInSeconds: 600 });
          return;
        }
        if (
          call.method === "GET" &&
          pathname === "/v5/next" &&
          requestURL.searchParams.get("site") === expectedSite &&
          requestURL.searchParams.getAll("site").length === 1 &&
          requestURL.searchParams.getAll("excludeQuestionId").length <= 1
        ) {
          const questionId = mock.nextQuestionId;
          respondJSON(200, {
            question:
              questionId === null
                ? null
                : {
                    questionId,
                    url: `https://${expectedSite}/questions/${questionId}`,
                    kind: "new",
                    dueMs: null,
                  },
          });
          return;
        }
        if (call.method === "POST" && pathname === "/v5/questions") {
          if (mock.conflictNextCatalogUpdate) {
            mock.conflictNextCatalogUpdate = false;
            mock.catalogUpdatedAtMs = Date.now();
            mock.catalogQuestionCount = call.body?.questionIds?.length ?? 1;
            mock.catalogGeneration += 1;
            respondJSON(409, { error: "catalog_conflict" });
            return;
          }
          if (
            call.body?.site !== expectedSite ||
            !Array.isArray(call.body?.questionIds) ||
            call.body.questionIds.length === 0 ||
            !Number.isSafeInteger(call.body?.expectedGeneration) ||
            call.body.expectedGeneration < 0 ||
            Object.keys(call.body ?? {}).sort().join(",") !==
              "expectedGeneration,questionIds,site"
          ) {
            respondJSON(400, { error: "invalid_request" });
            return;
          }
          if (call.body.expectedGeneration !== mock.catalogGeneration) {
            respondJSON(409, { error: "catalog_conflict" });
            return;
          }
          mock.catalogUpdatedAtMs = Date.now();
          mock.catalogQuestionCount = call.body.questionIds.length;
          mock.catalogGeneration += 1;
          respondJSON(200, {
            site: expectedSite,
            questionCount: call.body.questionIds.length,
            updatedAtMs: mock.catalogUpdatedAtMs,
            generation: mock.catalogGeneration,
          });
          return;
        }
        if (call.method === "POST" && pathname === "/v5/attempts") {
          const operationId = call.body?.operationId;
          const questionId = call.body?.questionId;
          const result = call.body?.result;
          if (
            !/^[0-9a-f]{32}$/.test(operationId ?? "") ||
            !/^\d+$/.test(questionId ?? "") ||
            call.body?.site !== expectedSite ||
            (result !== "correct" && result !== "incorrect") ||
            Object.keys(call.body ?? {}).sort().join(",") !==
              "operationId,questionId,result,site"
          ) {
            respondJSON(400, { error: "invalid_request" });
            return;
          }
          let item = processed.get(operationId);
          if (
            item !== undefined &&
            (item.result !== result || item.questionId !== questionId)
          ) {
            respondJSON(409, { error: "operation_conflict" });
            return;
          }
          if (item === undefined) {
            mock.attemptCount += 1;
            if (!solvedQuestionIds.has(questionId)) {
              solvedQuestionIds.add(questionId);
              mock.solved += 1;
              mock.todaySolved += 1;
            }
            const delta = mock.nextStabilityDaysDelta;
            mock.nextStabilityDaysDelta = 0;
            mock.stabilityDays += delta;
            item = {
              questionId,
              result,
              previousStability: delta === -1 ? 35 : delta === 1 ? 29 : 10,
              stability: delta === -1 ? 5 : delta === 1 ? 31 : 11,
            };
            processed.set(operationId, item);
          }
          if (mock.commitThenFailNextAnswer) {
            mock.commitThenFailNextAnswer = false;
            failRequest();
            return;
          }
          respondJSON(200, {
            attempt: {
              questionId: item.questionId,
              result: item.result,
              previousStability: item.previousStability,
              stability: item.stability,
            },
            totals: {
              stabilityDays: mock.stabilityDays,
              solved: mock.solved,
              todaySolved: mock.todaySolved,
            },
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
  stabilityDays = 0,
  attemptCount = 0,
  solved = attemptCount,
  todaySolved = solved,
  date = "2026-08-10",
  token = "test-sync-token",
  configured = true,
  pendingAnswer = null,
  processedOperations = [],
  userscriptsPromise = false,
  systemClipboard = false,
  site = SITE,
  nextQuestionId = "45125",
  catalogQuestionCount = 999,
  catalogGeneration = catalogQuestionCount === null ? 0 : 1,
} = {}) {
  return {
    initialStabilityDaysCount: stabilityDays,
    initialAttemptCount: attemptCount,
    initialSolvedCount: solved,
    initialTodaySolvedCount: todaySolved,
    initialDate: date,
    expectedToken: token,
    expectedSite: site,
    hasStoredToken: configured,
    initialPendingAnswer: pendingAnswer,
    initialProcessedOperations: processedOperations,
    returnsPromise: userscriptsPromise,
    tokenKey: SYNC_TOKEN_KEY,
    pendingAnswerKey: `kakomonn-reader.${site}.v5.pending-attempt`,
    expectedOrigin: SYNC_API_ORIGIN,
    expectedSpeechOrigin: AZURE_SPEECH_ORIGIN,
    expectedSpeechToken: AZURE_SPEECH_TOKEN,
    writeClipboardToSystem: systemClipboard,
    initialNextQuestionId: nextQuestionId,
    initialCatalogQuestionCount: catalogQuestionCount,
    initialCatalogGeneration: catalogGeneration,
  };
}

async function installSyncMock(page, options = {}) {
  await page.evaluate(installSyncMockInWindow, createSyncMockConfiguration(options));
}

module.exports = {
  AZURE_SPEECH_ORIGIN,
  createSyncMockConfiguration,
  installSyncMock,
  installSyncMockInWindow,
  LEGACY_PENDING_CORRECT_KEY,
  PENDING_ANSWER_KEY,
  SITE,
  SYNC_API_ORIGIN,
  SYNC_TOKEN_KEY,
};
