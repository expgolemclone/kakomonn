const { readFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const speechAudioFixture = readFileSync(join(
  dirname(require.resolve('@expgolemclone/congratulations/feedback')), 'audio/correct-normal.mp3',
)).toString('base64');

const SYNC_TOKEN_KEY = "kakomonn-reader.sync-token";
const SITE = "chushoks.kakomonn.com";
const PENDING_ATTEMPT_KEY = `kakomonn-reader.${SITE}.v9.pending-attempt`;
const PENDING_CELEBRATION_KEY = `kakomonn-reader.${SITE}.v9.pending-celebration`;
const LEGACY_PENDING_CORRECT_KEY = `kakomonn-reader.${SITE}.pending-correct`;
const SYNC_API_ORIGIN = "https://kakomonn-sync.kakomonn.workers.dev";
const AZURE_SPEECH_ORIGIN = "https://japaneast.tts.speech.microsoft.com";
const AZURE_SPEECH_TOKEN = "test-azure-speech-token";

function installSyncFixtureInWindow({
  state, attempts, completedMetrics, initialAttemptCount, expectedToken, expectedSite,
  hasStoredToken, initialPendingAttempt, initialPendingCelebration,
  tokenKey, pendingAttemptKey, pendingCelebrationKey, expectedOrigin,
  expectedSpeechOrigin, expectedSpeechToken, speechAudioBase64, writeClipboardToSystem,
  initialNextQuestionId, initialNextError,
}) {
  if (state.catalog !== null) state.catalog.updatedAtMs = Date.now();
  const values = new Map();
  if (hasStoredToken) values.set(tokenKey, expectedToken);
  if (initialPendingAttempt !== null) values.set(pendingAttemptKey, initialPendingAttempt);
  if (initialPendingCelebration !== null) values.set(pendingCelebrationKey, initialPendingCelebration);
  const observedOperations = new Map();
  let responseIndex = 0;
  const fixture = {
    state, attemptResponses: attempts, completedMetrics,
    attemptCount: initialAttemptCount, token: expectedToken, calls: [],
    abortedRequestCount: 0, failNextRequest: false,
    failSetValueKey: null, failNextDeleteValue: false,
    holdSetValueKey: null, releaseHeldSetValue: null,
    commitThenFailNextAttempt: false, holdNextRequest: false, releaseHeldRequest: null,
    holdSpeechRequestNumber: null, speechRequestCount: 0, releaseHeldSpeechRequest: null,
    clipboardWrites: [], nextQuestionId: initialNextQuestionId, nextError: initialNextError,
    nextCelebration: null,
  };
  const question = () => fixture.nextQuestionId === null ? null : {
    questionId: fixture.nextQuestionId, url: `https://${expectedSite}/questions/${fixture.nextQuestionId}`,
    kind: "new", dueMs: null,
  };
  window.__syncFixture = fixture;
  window.GM_info = { scriptHandler: "Tampermonkey" };
  window.GM = {
    async listValues() {
      return Array.from(values.keys());
    },
    async getValue(key, defaultValue) {
      return values.has(key) ? structuredClone(values.get(key)) : defaultValue;
    },
    async setClipboard(value) {
      if (window.__clipboardWriteFails) throw new Error("fixture clipboard write failed");
      fixture.clipboardWrites.push(value);
      window.__copiedTexts?.push(value);
      if (writeClipboardToSystem) await navigator.clipboard.writeText(value);
      return true;
    },
    async setValue(key, value) {
      if (fixture.failSetValueKey === key) {
        fixture.failSetValueKey = null;
        throw new Error("fixture storage write failed");
      }
      if (fixture.holdSetValueKey === key) {
        fixture.holdSetValueKey = null;
        await new Promise((resolve) => {
          fixture.releaseHeldSetValue = () => {
            fixture.releaseHeldSetValue = null;
            resolve();
          };
        });
      }
      values.set(key, structuredClone(value));
    },
    async deleteValue(key) {
      if (fixture.failNextDeleteValue) {
        fixture.failNextDeleteValue = false;
        throw new Error("fixture storage delete failed");
      }
      values.delete(key);
    },
  };
  window.GM.xmlHttpRequest = (details) => {
    let aborted = false;
    let releaseHeldRequest = null;
    const request = {};
    const respondJSON = (status, body) => {
      window.setTimeout(() => {
        if (aborted) {
          return;
        }
        const response = { status, responseText: JSON.stringify(body) };
        details.onload(response);
      }, 0);
    };
    const respondAudio = () => {
      window.setTimeout(() => {
        if (aborted) {
          return;
        }
        const response = {
          status: 200,
          response: Uint8Array.from(atob(speechAudioBase64), character => character.charCodeAt(0)).buffer,
          responseHeaders: "content-type: audio/mpeg",
        };
        details.onload(response);
      }, 0);
    };
    const failRequest = () => {
      if (aborted) {
        return;
      }
      details.onerror(new Error("fixture network error"));
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
    fixture.calls.push(call);
    const isSpeechRequest = new URL(call.url).origin === expectedSpeechOrigin;
    if (isSpeechRequest) {
      fixture.speechRequestCount += 1;
    }

    const executeRequest = () => {
      if (fixture.failNextRequest) {
        fixture.failNextRequest = false;
        failRequest();
        return;
      }
      const url = new URL(call.url);
      if (url.origin === expectedSpeechOrigin) { respondAudio(); return; }
      if (url.origin !== expectedOrigin) { respondJSON(404, { error: "unexpected_origin" }); return; }
      if (call.authorization !== `Bearer ${fixture.token}`) { respondJSON(401, { error: "unauthorized" }); return; }
      switch (url.pathname) {
        case "/v12/copy-failures":
          respondJSON(200, { accepted: true }); return;
        case "/v12/speech-token":
          respondJSON(200, { token: expectedSpeechToken, expiresInSeconds: 600 }); return;
        case "/v12/state":
          respondJSON(200, fixture.state); return;
        case "/v12/next":
          if (fixture.nextError) respondJSON(409, { error: fixture.nextError });
          else respondJSON(200, { state: fixture.state, question: question() });
          return;
        case "/v12/questions": {
          const catalog = { questionCount: call.body.questionIds.length, updatedAtMs: Date.now(), generation: 1 };
          fixture.state.catalog = catalog;
          respondJSON(200, { site: expectedSite, ...catalog, question: question() });
          return;
        }
        case "/v12/study-time":
          respondJSON(200, { state: fixture.state }); return;
        case "/v12/attempts": {
          const key = call.body.operationId;
          let response = observedOperations.get(key);
          if (!response) {
            response = structuredClone(fixture.attemptResponses[responseIndex]);
            if (!response) throw new Error("No response fixture for this request");
            responseIndex += 1;
            // These are request-correlated fixture fields, not computed learning state.
            response.attempt.questionId = call.body.questionId;
            response.attempt.answerResult = call.body.answerResult;
            response.nextQuestion = question();
            if (fixture.nextCelebration) {
              response.celebration = fixture.nextCelebration;
              response.learningMetrics = structuredClone(fixture.completedMetrics);
              fixture.nextCelebration = null;
            }
            observedOperations.set(key, response);
            fixture.attemptCount += 1;
          }
          fixture.state.learningMetrics = structuredClone(response.learningMetrics);
          if (fixture.commitThenFailNextAttempt) {
            fixture.commitThenFailNextAttempt = false; failRequest(); return;
          }
          respondJSON(200, response); return;
        }
        default: respondJSON(404, { error: "not_found" });
      }
    };

    const isHeldSpeechRequest =
      isSpeechRequest && fixture.speechRequestCount === fixture.holdSpeechRequestNumber;
    if (fixture.holdNextRequest || isHeldSpeechRequest) {
      fixture.holdNextRequest = false;
      releaseHeldRequest = () => {
        if (aborted) {
          return;
        }
        fixture.releaseHeldRequest = null;
        fixture.releaseHeldSpeechRequest = null;
        window.setTimeout(executeRequest, 0);
      };
      fixture.releaseHeldRequest = releaseHeldRequest;
      if (isHeldSpeechRequest) {
        fixture.releaseHeldSpeechRequest = releaseHeldRequest;
      }
    } else {
      window.setTimeout(executeRequest, 0);
    }
    request.abort = () => {
      if (aborted) {
        return;
      }
      aborted = true;
      fixture.abortedRequestCount += 1;
      if (fixture.releaseHeldRequest === releaseHeldRequest) {
        fixture.releaseHeldRequest = null;
      }
      if (fixture.releaseHeldSpeechRequest === releaseHeldRequest) {
        fixture.releaseHeldSpeechRequest = null;
      }
      details.onabort(new Error("fixture request aborted"));
    };
    return request;
  };
  window.__getGMValue = (key) => (values.has(key) ? structuredClone(values.get(key)) : null);
}

function createSyncFixtureConfiguration({
  configured = true, pendingAttempt = null, pendingCelebration = null,
  systemClipboard = false, speechAudioBase64 = speechAudioFixture, site = SITE,
  token = "test-sync-token", nextQuestionId = "45125", nextError = null,
  catalogQuestionCount = 999, catalogGeneration = catalogQuestionCount === null ? 0 : 1,
  completionScenario = false, ...unknownOptions
} = {}) {
  if (Object.keys(unknownOptions).length > 0) {
    throw new TypeError(`Unknown sync fixture options: ${Object.keys(unknownOptions).join(", ")}`);
  }
  const fixtures = require("./sync-fixtures.cjs");
  const metrics = completionScenario ? fixtures.beforeCompletionMetrics : fixtures.emptyMetrics;
  const state = {
    site, today: "2026-08-10", learningMetrics: structuredClone(metrics),
    catalog: catalogQuestionCount === null ? null : {
      questionCount: catalogQuestionCount, generation: catalogGeneration, updatedAtMs: Date.now(),
    },
  };
  const attempts = [fixtures.firstAnswerMetrics, fixtures.secondAnswerMetrics].map(learningMetrics => ({
    attempt: {
      questionId: "45124", answerResult: "correct", attemptedAtMs: 1786320000000,
      previousCardStabilityDays: 10, resultingCardStabilityDays: 11,
      previousStabilityDays: 0, resultingStabilityDays: 0,
    },
    learningMetrics: structuredClone(learningMetrics), nextQuestion: null,
  }));
  return fixtures.validateSyncFixtures({
    state, attempts, completedMetrics: fixtures.completedMetrics,
    initialAttemptCount: completionScenario ? 9 : 0,
    expectedToken: token, expectedSite: site, hasStoredToken: configured,
    initialPendingAttempt: pendingAttempt, initialPendingCelebration: pendingCelebration,
    tokenKey: SYNC_TOKEN_KEY, pendingAttemptKey: `kakomonn-reader.${site}.v9.pending-attempt`,
    pendingCelebrationKey: `kakomonn-reader.${site}.v9.pending-celebration`,
    expectedOrigin: SYNC_API_ORIGIN, expectedSpeechOrigin: AZURE_SPEECH_ORIGIN,
    expectedSpeechToken: AZURE_SPEECH_TOKEN, speechAudioBase64,
    writeClipboardToSystem: systemClipboard, initialNextQuestionId: nextQuestionId, initialNextError: nextError,
  });
}

async function installSyncFixture(page, options = {}) {
  await page.evaluate(installSyncFixtureInWindow, createSyncFixtureConfiguration(options));
}

module.exports = {
  AZURE_SPEECH_ORIGIN, createSyncFixtureConfiguration, installSyncFixture, installSyncFixtureInWindow,
  LEGACY_PENDING_CORRECT_KEY, PENDING_ATTEMPT_KEY, PENDING_CELEBRATION_KEY,
  SITE, SPEECH_AUDIO_BYTES: Buffer.from(speechAudioFixture, "base64").length, SYNC_API_ORIGIN, SYNC_TOKEN_KEY,
};
