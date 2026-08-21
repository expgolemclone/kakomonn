const SYNC_TOKEN_KEY = "kakomonn-reader.sync-token";
const SITE = "chushoks.kakomonn.com";
const PENDING_ATTEMPT_KEY = `kakomonn-reader.${SITE}.v7.pending-attempt`;
const PENDING_CELEBRATION_KEY = `kakomonn-reader.${SITE}.v7.pending-celebration`;
const LEGACY_PENDING_CORRECT_KEY = `kakomonn-reader.${SITE}.pending-correct`;
const SYNC_API_ORIGIN = "https://kakomonn-sync.kakomonn.workers.dev";
const AZURE_SPEECH_ORIGIN = "https://japaneast.tts.speech.microsoft.com";
const AZURE_SPEECH_TOKEN = "test-azure-speech-token";

function installSyncMockInWindow({
  initialStabilityDays,
  initialAttemptCount,
  initialAttemptedQuestionCount,
  initialTodayAttemptedQuestionCount,
  initialDate,
  expectedToken,
  expectedSite,
  hasStoredToken,
  initialPendingAttempt,
  initialPendingCelebration,
  initialProcessedOperations,
  tokenKey,
  pendingAttemptKey,
  pendingCelebrationKey,
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
  if (initialPendingAttempt !== null) values.set(pendingAttemptKey, initialPendingAttempt);
  if (initialPendingCelebration !== null) {
    values.set(pendingCelebrationKey, initialPendingCelebration);
  }

  const processed = new Map(
    initialProcessedOperations.map((item) => [
      item.operationId,
      {
        questionId: item.questionId ?? "45124",
        answerResult: item.answerResult ?? "correct",
        attemptedAtMs: item.attemptedAtMs ?? 1786500000000,
        previousCardStabilityDays: item.previousCardStabilityDays ?? 29,
        resultingCardStabilityDays: item.resultingCardStabilityDays ?? 31,
        previousStabilityDays: item.previousStabilityDays ?? 10,
        resultingStabilityDays: item.resultingStabilityDays ?? 11,
        celebration: item.celebration,
      },
    ]),
  );
  const attemptedQuestionIds = new Set(
    initialProcessedOperations.map((item) => item.questionId ?? "45124")
  );

  const mock = {
    stabilityDays: initialStabilityDays,
    attemptCount: initialAttemptCount,
    attemptedQuestionCount: initialAttemptedQuestionCount,
    todayAttemptedQuestionCount: initialTodayAttemptedQuestionCount,
    todayStabilityDaysDelta: 0,
    date: initialDate,
    token: expectedToken,
    calls: [],
    failNextRequest: false,
    timeoutNextRequest: false,
    failNextSetValue: false,
    failNextDeleteValue: false,
    holdNextSetValue: false,
    releaseHeldSetValue: null,
    commitThenFailNextAttempt: false,
    holdNextRequest: false,
    releaseHeldRequest: null,
    clipboardWrites: [],
    nextQuestionId: initialNextQuestionId,
    nextAttemptStabilityDaysDelta: 0,
    nextCelebration: null,
    catalogUpdatedAtMs: Date.now(),
    catalogQuestionCount: initialCatalogQuestionCount,
    catalogGeneration: initialCatalogGeneration,
    conflictNextCatalogUpdate: false,
  };

  const syncState = () => ({
    site: expectedSite,
    today: mock.date,
    learningMetrics: {
      stabilityDays: mock.stabilityDays,
      todayStabilityDaysDelta: mock.todayStabilityDaysDelta,
      attemptedQuestionCount: mock.attemptedQuestionCount,
      todayAttemptedQuestionCount: mock.todayAttemptedQuestionCount,
    },
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
  window.GM_info = { scriptHandler: "Tampermonkey" };
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
      let resolveRequest;
      let rejectRequest;
      const requestPromise = new Promise((resolve, reject) => {
        resolveRequest = resolve;
        rejectRequest = reject;
      });
      const respondJSON = (status, body) => {
        window.setTimeout(() => {
          const response = { status, responseText: JSON.stringify(body) };
          resolveRequest(response);
        }, 0);
      };
      const respondAudio = () => {
        window.setTimeout(() => {
          const response = {
            status: 200,
            response: new Uint8Array([0x49, 0x44, 0x33, 0x04]).buffer,
            responseHeaders: "content-type: audio/mpeg",
          };
          resolveRequest(response);
        }, 0);
      };
      const failRequest = () => {
        const error = new Error("mock request failed");
        details.onerror?.({});
        rejectRequest(error);
      };
      const timeoutRequest = () => {
        const error = new Error("mock request timed out");
        details.ontimeout?.({});
        rejectRequest(error);
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
        if (mock.timeoutNextRequest) {
          mock.timeoutNextRequest = false;
          timeoutRequest();
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
          pathname === "/v7/state" &&
          requestURL.searchParams.get("site") === expectedSite
        ) {
          respondJSON(200, syncState());
          return;
        }
        if (call.method === "POST" && pathname === "/v7/speech-token") {
          respondJSON(200, { token: expectedSpeechToken, expiresInSeconds: 600 });
          return;
        }
        if (
          call.method === "GET" &&
          pathname === "/v7/next" &&
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
        if (call.method === "POST" && pathname === "/v7/questions") {
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
        if (call.method === "POST" && pathname === "/v7/attempts") {
          const operationId = call.body?.operationId;
          const questionId = call.body?.questionId;
          const answerResult = call.body?.answerResult;
          if (
            !/^[0-9a-f]{32}$/.test(operationId ?? "") ||
            !/^\d+$/.test(questionId ?? "") ||
            call.body?.site !== expectedSite ||
            (answerResult !== "correct" && answerResult !== "incorrect") ||
            Object.keys(call.body ?? {}).sort().join(",") !==
              "answerResult,operationId,questionId,site"
          ) {
            respondJSON(400, { error: "invalid_request" });
            return;
          }
          let item = processed.get(operationId);
          if (
            item !== undefined &&
            (item.answerResult !== answerResult || item.questionId !== questionId)
          ) {
            respondJSON(409, { error: "operation_conflict" });
            return;
          }
          if (item === undefined) {
            mock.attemptCount += 1;
            if (!attemptedQuestionIds.has(questionId)) {
              attemptedQuestionIds.add(questionId);
              mock.attemptedQuestionCount += 1;
              mock.todayAttemptedQuestionCount += 1;
            }
            const nextAttemptStabilityDaysDelta =
              mock.nextAttemptStabilityDaysDelta;
            mock.nextAttemptStabilityDaysDelta = 0;
            const previousStabilityDays = mock.stabilityDays;
            mock.stabilityDays += nextAttemptStabilityDaysDelta;
            mock.todayStabilityDaysDelta += nextAttemptStabilityDaysDelta;
            item = {
              questionId,
              answerResult,
              attemptedAtMs: Date.now(),
              previousCardStabilityDays:
                nextAttemptStabilityDaysDelta === -1
                  ? 35
                  : nextAttemptStabilityDaysDelta === 1
                    ? 29
                    : 10,
              resultingCardStabilityDays:
                nextAttemptStabilityDaysDelta === -1
                  ? 5
                  : nextAttemptStabilityDaysDelta === 1
                    ? 31
                    : 11,
              previousStabilityDays,
              resultingStabilityDays: mock.stabilityDays,
              celebration: mock.nextCelebration ?? undefined,
            };
            mock.nextCelebration = null;
            processed.set(operationId, item);
          }
          if (mock.commitThenFailNextAttempt) {
            mock.commitThenFailNextAttempt = false;
            failRequest();
            return;
          }
          respondJSON(200, {
            attempt: {
              questionId: item.questionId,
              answerResult: item.answerResult,
              attemptedAtMs: item.attemptedAtMs,
              previousCardStabilityDays: item.previousCardStabilityDays,
              resultingCardStabilityDays: item.resultingCardStabilityDays,
              previousStabilityDays: item.previousStabilityDays,
              resultingStabilityDays: item.resultingStabilityDays,
            },
            learningMetrics: {
              stabilityDays: mock.stabilityDays,
              todayStabilityDaysDelta: mock.todayStabilityDaysDelta,
              attemptedQuestionCount: mock.attemptedQuestionCount,
              todayAttemptedQuestionCount: mock.todayAttemptedQuestionCount,
            },
            ...(item.celebration === undefined
              ? {}
              : { celebration: item.celebration }),
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
      requestPromise.abort = () => {
        const error = new Error("mock request aborted");
        details.onabort?.({});
        rejectRequest(error);
      };
      return requestPromise;
    },
  };
  window.__getGMValue = (key) =>
    values.has(key) ? structuredClone(values.get(key)) : null;
}

function createSyncMockConfiguration({
  stabilityDays = 0,
  attemptCount = 0,
  attemptedQuestionCount = attemptCount,
  todayAttemptedQuestionCount = attemptedQuestionCount,
  date = "2026-08-10",
  token = "test-sync-token",
  configured = true,
  pendingAttempt = null,
  pendingCelebration = null,
  processedOperations = [],
  systemClipboard = false,
  site = SITE,
  nextQuestionId = "45125",
  catalogQuestionCount = 999,
  catalogGeneration = catalogQuestionCount === null ? 0 : 1,
} = {}) {
  return {
    initialStabilityDays: stabilityDays,
    initialAttemptCount: attemptCount,
    initialAttemptedQuestionCount: attemptedQuestionCount,
    initialTodayAttemptedQuestionCount: todayAttemptedQuestionCount,
    initialDate: date,
    expectedToken: token,
    expectedSite: site,
    hasStoredToken: configured,
    initialPendingAttempt: pendingAttempt,
    initialPendingCelebration: pendingCelebration,
    initialProcessedOperations: processedOperations,
    tokenKey: SYNC_TOKEN_KEY,
    pendingAttemptKey: `kakomonn-reader.${site}.v7.pending-attempt`,
    pendingCelebrationKey: `kakomonn-reader.${site}.v7.pending-celebration`,
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
  PENDING_ATTEMPT_KEY,
  PENDING_CELEBRATION_KEY,
  SITE,
  SYNC_API_ORIGIN,
  SYNC_TOKEN_KEY,
};
