import {
  isNextResponse,
  isSite,
} from "../../contracts/kakomonn.mjs";
import { createCatalogLoader } from "./catalog.js";
import {
  answerResultFromDocument,
  extractQuestionTextFromDocument,
  findAnswerButtonAfter,
  findAnswerChoiceControls,
  findQuestionMetadataElement,
  hasVisibleExplanationLock,
  isVisibleElement,
  normalizeInlineText,
  splitText,
} from "./content.js";
import {
  CORRECT_CHIME_SAMPLE_RATE,
  CORRECT_FEEDBACK_CSS,
  CORRECT_FEEDBACK_LEAVE_DURATION_MS,
  CORRECT_FEEDBACK_MINIMUM_DURATION_MS,
  calculateKpiQuestionsRemaining,
  chooseCorrectFeedbackVariant,
  renderCorrectFeedbackElement,
  resolveCorrectFeedbackKpi,
  waitForCorrectFeedbackKpi as waitForCorrectFeedbackKpiResult,
} from "./correct-feedback.js";
import {
  buildCopyMarkdown,
  directChild,
  isSelectedAnswerChoice,
} from "./markdown.js";
import { installReaderStyles } from "./styles.js";
import { createSyncRequest } from "./sync-request.js";
import { installSyncController } from "./sync-controller.js";
import { installLauncherController } from "./launcher-controller.js";
import { installViewController } from "./view-controller.js";
import { installCopyController } from "./copy-controller.js";
import { installNavigationController } from "./navigation-controller.js";
import { installLifecycleController } from "./lifecycle-controller.js";
import { installSpeechController } from "./speech-controller.js";
import { installShortcutsController } from "./shortcuts-controller.js";
import { installDashboardBridge } from "./dashboard-bridge.js";
import { DASHBOARD_BRIDGE_STATE_ATTRIBUTE } from "../../contracts/dashboard-bridge.mjs";

export async function startReader() {
"use strict";
  
  const READER_FRAME_READY_MESSAGE_TYPE =
    "kakomonn-reader:frame-ready";
  if (window.top !== window.self) {
    window.parent.postMessage(
      {
        href: location.href,
        type: READER_FRAME_READY_MESSAGE_TYPE,
      },
      location.origin
    );
    return;
  }
  
  const BUILD_FINGERPRINT = "__KAKOMONN_READER_BUILD_FINGERPRINT__";
  const SCRIPT_HANDLER =
    typeof GM_info === "object" &&
    GM_info !== null &&
    typeof GM_info.scriptHandler === "string"
      ? GM_info.scriptHandler
      : "";
  const userAgent = navigator.userAgent;
  const isWindowsChrome =
    userAgent.includes("Windows NT") &&
    /\bChrome\/\d+(?:\.\d+)+/.test(userAgent) &&
    !userAgent.includes("Edg/");
  const isIPhoneSafari =
    userAgent.includes("iPhone") &&
    userAgent.includes("AppleWebKit/") &&
    /\bVersion\/\d+(?:\.\d+)+/.test(userAgent) &&
    /\bMobile\/\S+/.test(userAgent) &&
    /\bSafari\/\d+(?:\.\d+)+/.test(userAgent) &&
    !/(?:CriOS|FxiOS|EdgiOS|OPiOS)\//.test(userAgent);
  const SYNC_API_URL =
    "https://kakomonn-sync.kakomonn.workers.dev";
  const SYNC_TOKEN_KEY = "kakomonn-reader.sync-token";
  const LAUNCH_HANDOFF_KEY = "kakomonn-reader.v11.launch-handoff";
  const LAUNCH_HANDOFF_MAX_AGE_MS = 60000;
  const SYNC_TIMEOUT_MS = 15000;
  const isReaderBridge =
    location.origin === SYNC_API_URL &&
    location.pathname === "/open" &&
    location.search === "" &&
    location.hash === "";
  const isDashboardBridge =
    location.origin === SYNC_API_URL && location.pathname === "/";
  const NEXT_QUESTION_SITE_ID = "chushoks.kakomonn.com";
  const READER_BRIDGE_TARGET_ATTRIBUTE =
    "data-kakomonn-reader-bridge-target";
  const isNextQuestionLauncher =
    location.hostname === NEXT_QUESTION_SITE_ID &&
    location.pathname === "/createques" &&
    location.search === "" &&
    location.hash === "#kakomonn-next";
  let shouldLaunchNextQuestionAfterSync = isNextQuestionLauncher;
  const CONGRATULATIONS_URL =
    "https://kakomonn-congratulations.kakomonn.workers.dev/";
  
  class SyncRequestError extends Error {
    constructor(code, status = 0, responseBody = null) {
      super(code);
      this.name = "SyncRequestError";
      this.code = code;
      this.status = status;
      this.responseBody = responseBody;
    }
  }
  
  function gmXMLHttpRequest(details) {
    const requestTimeoutMs = details.timeout ?? SYNC_TIMEOUT_MS;
    const requestDetails = { ...details };
    delete requestDetails.timeout;
    let tampermonkeyRequest = null;
    let requestTimeout = null;
    let rejectRequest = () => false;
    const promise = new Promise((resolve, reject) => {
      let settled = false;
      const settleOnce = (callback) => {
        if (settled) {
          return false;
        }
        settled = true;
        if (requestTimeout !== null) {
          window.clearTimeout(requestTimeout);
          requestTimeout = null;
        }
        callback();
        return true;
      };
      const resolveOnce = (response) => settleOnce(() => resolve(response));
      const rejectOnce = (code) =>
        settleOnce(() => reject(new SyncRequestError(code)));
      rejectRequest = rejectOnce;
      requestTimeout = window.setTimeout(() => {
        if (!rejectOnce("request_timeout")) {
          return;
        }
        try {
          tampermonkeyRequest?.abort();
        } catch {
          // timeout result is already final.
        }
      }, requestTimeoutMs);
      try {
        requestDetails.onload = resolveOnce;
        requestDetails.onerror = () => rejectOnce("network_error");
        requestDetails.onabort = () => rejectOnce("request_aborted");
        requestDetails.ontimeout = () => rejectOnce("request_timeout");
        tampermonkeyRequest = GM.xmlHttpRequest(requestDetails);
      } catch {
        rejectOnce("network_error");
      }
    });
    promise.abort = () => {
      if (!rejectRequest("request_aborted")) {
        return;
      }
      try {
        tampermonkeyRequest?.abort();
      } catch {
        // abort result is already final.
      }
    };
    return promise;
  }
  const requestSyncResponse = createSyncRequest({
    apiURL: SYNC_API_URL,
    gmXMLHttpRequest,
    SyncRequestError,
  });
  
  const isReaderBridgeNextResponse = (value) =>
    isNextResponse(value, NEXT_QUESTION_SITE_ID);
  const hasDashboardBridgeRuntime =
    SCRIPT_HANDLER === "Tampermonkey" &&
    (isWindowsChrome || isIPhoneSafari) &&
    typeof GM === "object" &&
    GM !== null &&
    typeof GM.getValue === "function" &&
    typeof GM.xmlHttpRequest === "function";
  if (isDashboardBridge) {
    if (!hasDashboardBridgeRuntime) {
      document.documentElement.setAttribute(
        DASHBOARD_BRIDGE_STATE_ATTRIBUTE,
        "error",
      );
      return;
    }
    installDashboardBridge({
      gm: GM,
      requestSyncResponse,
      syncTokenKey: SYNC_TOKEN_KEY,
    });
    return;
  }
  if (
    SCRIPT_HANDLER !== "Tampermonkey" ||
    (!isWindowsChrome && !isIPhoneSafari) ||
    typeof GM !== "object" ||
    GM === null ||
    typeof GM.getValue !== "function" ||
    typeof GM.setValue !== "function" ||
    typeof GM.deleteValue !== "function" ||
    typeof GM.xmlHttpRequest !== "function" ||
    typeof GM.setClipboard !== "function"
  ) {
    if (isReaderBridge) {
      document.documentElement.dataset.kakomonnReaderBridgeState = "error";
    }
    return;
  }
  if (isReaderBridge) {
    try {
      const storedToken = await GM.getValue(SYNC_TOKEN_KEY, "");
      const token = typeof storedToken === "string" ? storedToken.trim() : "";
      const parameters = new URLSearchParams({ site: NEXT_QUESTION_SITE_ID });
      const result = await requestSyncResponse(
        "GET",
        `/v11/next?${parameters}`,
        token,
        isReaderBridgeNextResponse
      );
      if (result.question === null) {
        document.documentElement.dataset.kakomonnReaderBridgeState = "empty";
        return;
      }
      await GM.setValue(LAUNCH_HANDOFF_KEY, {
        createdAtMs: Date.now(),
        questionURL: result.question.url,
        state: result.state,
      });
      document.documentElement.setAttribute(
        READER_BRIDGE_TARGET_ATTRIBUTE,
        result.question.url
      );
      document.documentElement.dataset.kakomonnReaderBridgeState = "ready";
    } catch (error) {
      document.documentElement.dataset.kakomonnReaderBridgeState =
        error?.code === "unauthorized" ? "unauthorized" : "error";
    }
    return;
  }
  const SITE_ID = location.hostname.toLowerCase();
  if (!isSite(SITE_ID)) {
    return;
  }
  const PENDING_ATTEMPT_KEY = `kakomonn-reader.${SITE_ID}.v9.pending-attempt`;
  const PENDING_CELEBRATION_KEY =
    `kakomonn-reader.${SITE_ID}.v9.pending-celebration`;
  const CATALOG_TIMEOUT_MS = 15000;
  const CATALOG_FETCH_CONCURRENCY = 4;
  const SPEECH_TIMEOUT_MS = 30000;
  const FRAME_PROBLEM_SCROLL_DELAYS_MS = [0, 120, 600];
  const SHORTCUT_SEQUENCE_TIMEOUT_MS = 400;
  const TIME_LIMIT_MS = 5 * 60 * 1000;
  const MAX_CHUNK_LENGTH = 1500;
  const FRAME_DARK_MODE_STYLE_ID = "kakomonn-reader-dark-mode";
  const FRAME_DARK_MODE_CSS = `
    :root {
      color-scheme: dark;
      --kakomonn-frame-canvas: #0b0d10;
      --kakomonn-frame-surface: #15191e;
      --kakomonn-frame-raised: #1d232b;
      --kakomonn-frame-text: #f3f4f6;
      --kakomonn-frame-muted: #a8b0bb;
      --kakomonn-frame-border: #343b45;
      --kakomonn-frame-link: #8ab4f8;
    }
  
    header.l-header {
      display: none !important;
    }
  
    html,
    body,
    .l-header,
    .l-main,
    .l-footer,
    .p-post,
    .inner,
    #js-img-zoom-area,
    .sect_problem,
    .sect_commentary,
    #js-commentary-section {
      background-color: var(--kakomonn-frame-canvas) !important;
      color: var(--kakomonn-frame-text) !important;
      border-color: var(--kakomonn-frame-border) !important;
    }
  
    .problem_detail,
    #js-commentary-wrap,
    #js-expound-head,
    #calculator {
      background-color: var(--kakomonn-frame-surface) !important;
      border-color: var(--kakomonn-frame-border) !important;
    }
  
    .problem_detail,
    .problem_detail > .when,
    .problem_detail > .ttl,
    .problem_detail > .zoomin,
    .problem_detail > ul.list,
    .problem_detail > ul.list > li,
    .problem_detail > ul.list > li > div,
    .problem_detail > ul.check,
    .problem_detail > ul.check > li,
    .problem_detail > ul.check > li > label,
    #js-commentary-wrap,
    #js-commentary-wrap > .item,
    #js-commentary-wrap > .item > .none_text,
    #js-commentary-wrap > .item > .num,
    #js-commentary-wrap > .item > .text,
    #js-commentary-wrap > .item > .reference {
      color: var(--kakomonn-frame-text) !important;
      border-color: var(--kakomonn-frame-border) !important;
    }
  
    .problem_detail > ul.list > li,
    .problem_detail > ul.list > li > div,
    .problem_detail > ul.check > li,
    .problem_detail > ul.check > li > label,
    #js-commentary-wrap > .item > .text,
    #js-commentary-wrap > .item > .reference {
      background-color: var(--kakomonn-frame-raised) !important;
    }
  
    :root[data-kakomonn-reader-phase="question"] .answer-right,
    :root[data-kakomonn-reader-phase="question"] .answer-mistake,
    :root[data-kakomonn-reader-phase="question"] #explst,
    :root[data-kakomonn-reader-phase="question"] .sect_commentary {
      display: none !important;
    }
  
    .problem_detail > ul.list > li.is-active > div,
    #js-commentary-wrap > .item > .none_text,
    #js-commentary-wrap > .item > .num {
      color: var(--kakomonn-frame-muted) !important;
    }
  
    .problem_detail > ul.list > li::before,
    .problem_detail > ul.check > li > label > span::before {
      color: var(--kakomonn-frame-text) !important;
      border-color: var(--kakomonn-frame-border) !important;
    }
  
    .problem_detail a,
    #js-commentary-wrap a {
      color: var(--kakomonn-frame-link) !important;
    }
  
    .problem_detail input,
    .problem_detail select,
    .problem_detail textarea,
    #calculator input,
    #calculator select,
    #calculator textarea {
      background-color: var(--kakomonn-frame-canvas) !important;
      color: var(--kakomonn-frame-text) !important;
      border-color: var(--kakomonn-frame-border) !important;
    }
  
    .problem_detail .next_ques_btn .button_entity {
      background-color: var(--kakomonn-frame-surface) !important;
    }
  
    .problem_detail .next_ques_btn,
    .problem_detail .next_ques_btn .button_entity {
      display: none !important;
    }
  
    .problem_detail > .zoomin img,
    .problem_detail > ul.list img,
    #js-commentary-wrap > .item .text img {
      filter: invert(100%) hue-rotate(180deg) !important;
    }
  
  `;
  const QUESTION_SPEECH_RATE = 2.0;
  const ANSWER_RESULT_SPEECH_RATE = 1.7;
  const SPEECH_TOKEN_RENEWAL_SKEW_MS = 60000;
  const AZURE_SPEECH_URL =
    "https://japaneast.tts.speech.microsoft.com/cognitiveservices/v1";
  const JAPANESE_SPEECH_LOCALE = "ja-JP";
  const JAPANESE_SPEECH_VOICE_NAME = "ja-JP-NanamiNeural";
  const AZURE_SPEECH_OUTPUT_FORMAT =
    "audio-24khz-48kbitrate-mono-mp3";
  const FEEDBACK_AUDIO_DATA_URLS = Object.freeze({
    normal: "data:audio/mpeg;base64,__KAKOMONN_FEEDBACK_NORMAL__",
    rare: "data:audio/mpeg;base64,__KAKOMONN_FEEDBACK_RARE__",
    "super-rare": "data:audio/mpeg;base64,__KAKOMONN_FEEDBACK_SUPER_RARE__",
    ssr: "data:audio/mpeg;base64,__KAKOMONN_FEEDBACK_SSR__",
    incorrect: "data:audio/mpeg;base64,__KAKOMONN_FEEDBACK_INCORRECT__",
  });
  const SILENT_AUDIO_DATA_URL =
    "data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==";
  const SPEECH_GESTURE_STATUS =
    "画面をクリックまたはタップすると読み上げます";
  
  const speechAudio =
    typeof window.Audio === "function" ? new window.Audio() : null;
  const speechSupported =
    typeof speechAudio?.play === "function" &&
    typeof speechAudio?.pause === "function" &&
    typeof speechAudio?.canPlayType === "function" &&
    speechAudio.canPlayType("audio/mpeg") !== "" &&
    (isIPhoneSafari || isWindowsChrome);
  let speechEnabled = false;
  let speechPaused = false;
  let speechInitializationInProgress = false;
  let speechInitializationPromise = null;
  let speechInitializationResolve = null;
  let speechRunId = 0;
  const activeSpeechRequests = new Set();
  let speechChunkSession = null;
  let activeSpeechAudioURL = "";
  let activeSpeechPlaybackCancel = null;
  let azureSpeechToken = "";
  let azureSpeechTokenExpiresAt = 0;
  let azureSpeechTokenPromise = null;
  let frameDocument = null;
  let boundFrameDocument = null;
  let currentPageReadPending = false;
  let currentFrameURL = shouldLaunchNextQuestionAfterSync
    ? "about:blank"
    : location.href;
  let timeLimitPhase = null;
  let timeLimitDeadline = 0;
  let timeLimitTimeout = null;
  let timeLimitInterval = null;
  let timeLimitSourceDocument = null;
  let frameProblemScrollTimers = [];
  let frameMutationObserver = null;
  let frameControlObserver = null;
  let observedAnswerResult = null;
  let observedCommentary = null;
  let awaitingAnswerResultSpeech = false;
  let navigationInProgress = false;
  let nextQuestionOperationInProgress = false;
  let syncToken = "";
  let syncReady = false;
  let syncInProgress = false;
  let syncPromise = null;
  let catalogReady = false;
  let catalogInProgress = false;
  let catalogPromise = null;
  let currentSyncState = null;
  let launcherSyncState = null;
  let pendingAttempt = null;
  let pendingAttemptTransitionPromise = null;
  let pendingCelebration = null;
  let answerCopyOperation = null;
  let automaticCopyPromise = null;
  
  
  const correctFeedbackDocuments = new WeakSet();
  let correctFeedbackPromise = null;
  let correctFeedbackRemovalTimer = null;
  function waitForCorrectFeedbackKpi(questionId) {
    return waitForCorrectFeedbackKpiResult(questionId, pendingAttempt);
  }
  function extractQuestionText() {
    return extractQuestionTextFromDocument(frameDocument);
  }
  const { loadCompleteQuestionCatalog } = createCatalogLoader({
    fetchConcurrency: CATALOG_FETCH_CONCURRENCY,
    siteId: SITE_ID,
    SyncRequestError,
    timeoutMs: CATALOG_TIMEOUT_MS,
  });
  installReaderStyles(CORRECT_FEEDBACK_CSS);

  const app = {};
  Object.defineProperties(app, {
    READER_FRAME_READY_MESSAGE_TYPE: { enumerable: false, get: () => READER_FRAME_READY_MESSAGE_TYPE },
    BUILD_FINGERPRINT: { enumerable: false, get: () => BUILD_FINGERPRINT },
    SCRIPT_HANDLER: { enumerable: false, get: () => SCRIPT_HANDLER },
    isIPhoneSafari: { enumerable: false, get: () => isIPhoneSafari },
    SYNC_TOKEN_KEY: { enumerable: false, get: () => SYNC_TOKEN_KEY },
    LAUNCH_HANDOFF_KEY: { enumerable: false, get: () => LAUNCH_HANDOFF_KEY },
    LAUNCH_HANDOFF_MAX_AGE_MS: { enumerable: false, get: () => LAUNCH_HANDOFF_MAX_AGE_MS },
    isNextQuestionLauncher: { enumerable: false, get: () => isNextQuestionLauncher },
    shouldLaunchNextQuestionAfterSync: { enumerable: false, get: () => shouldLaunchNextQuestionAfterSync, set: (value) => { shouldLaunchNextQuestionAfterSync = value; } },
    CONGRATULATIONS_URL: { enumerable: false, get: () => CONGRATULATIONS_URL },
    SyncRequestError: { enumerable: false, get: () => SyncRequestError },
    gmXMLHttpRequest: { enumerable: false, get: () => gmXMLHttpRequest },
    requestSyncResponse: { enumerable: false, get: () => requestSyncResponse },
    SITE_ID: { enumerable: false, get: () => SITE_ID },
    PENDING_ATTEMPT_KEY: { enumerable: false, get: () => PENDING_ATTEMPT_KEY },
    PENDING_CELEBRATION_KEY: { enumerable: false, get: () => PENDING_CELEBRATION_KEY },
    SPEECH_TIMEOUT_MS: { enumerable: false, get: () => SPEECH_TIMEOUT_MS },
    FRAME_PROBLEM_SCROLL_DELAYS_MS: { enumerable: false, get: () => FRAME_PROBLEM_SCROLL_DELAYS_MS },
    SHORTCUT_SEQUENCE_TIMEOUT_MS: { enumerable: false, get: () => SHORTCUT_SEQUENCE_TIMEOUT_MS },
    TIME_LIMIT_MS: { enumerable: false, get: () => TIME_LIMIT_MS },
    FRAME_DARK_MODE_STYLE_ID: { enumerable: false, get: () => FRAME_DARK_MODE_STYLE_ID },
    FRAME_DARK_MODE_CSS: { enumerable: false, get: () => FRAME_DARK_MODE_CSS },
    QUESTION_SPEECH_RATE: { enumerable: false, get: () => QUESTION_SPEECH_RATE },
    ANSWER_RESULT_SPEECH_RATE: { enumerable: false, get: () => ANSWER_RESULT_SPEECH_RATE },
    SPEECH_TOKEN_RENEWAL_SKEW_MS: { enumerable: false, get: () => SPEECH_TOKEN_RENEWAL_SKEW_MS },
    AZURE_SPEECH_URL: { enumerable: false, get: () => AZURE_SPEECH_URL },
    JAPANESE_SPEECH_LOCALE: { enumerable: false, get: () => JAPANESE_SPEECH_LOCALE },
    JAPANESE_SPEECH_VOICE_NAME: { enumerable: false, get: () => JAPANESE_SPEECH_VOICE_NAME },
    AZURE_SPEECH_OUTPUT_FORMAT: { enumerable: false, get: () => AZURE_SPEECH_OUTPUT_FORMAT },
    FEEDBACK_AUDIO_DATA_URLS: { enumerable: false, get: () => FEEDBACK_AUDIO_DATA_URLS },
    SILENT_AUDIO_DATA_URL: { enumerable: false, get: () => SILENT_AUDIO_DATA_URL },
    SPEECH_GESTURE_STATUS: { enumerable: false, get: () => SPEECH_GESTURE_STATUS },
    speechAudio: { enumerable: false, get: () => speechAudio },
    speechSupported: { enumerable: false, get: () => speechSupported },
    speechEnabled: { enumerable: false, get: () => speechEnabled, set: (value) => { speechEnabled = value; } },
    speechPaused: { enumerable: false, get: () => speechPaused, set: (value) => { speechPaused = value; } },
    speechInitializationInProgress: { enumerable: false, get: () => speechInitializationInProgress, set: (value) => { speechInitializationInProgress = value; } },
    speechInitializationPromise: { enumerable: false, get: () => speechInitializationPromise, set: (value) => { speechInitializationPromise = value; } },
    speechInitializationResolve: { enumerable: false, get: () => speechInitializationResolve, set: (value) => { speechInitializationResolve = value; } },
    speechRunId: { enumerable: false, get: () => speechRunId, set: (value) => { speechRunId = value; } },
    activeSpeechRequests: { enumerable: false, get: () => activeSpeechRequests },
    speechChunkSession: { enumerable: false, get: () => speechChunkSession, set: (value) => { speechChunkSession = value; } },
    activeSpeechAudioURL: { enumerable: false, get: () => activeSpeechAudioURL, set: (value) => { activeSpeechAudioURL = value; } },
    activeSpeechPlaybackCancel: { enumerable: false, get: () => activeSpeechPlaybackCancel, set: (value) => { activeSpeechPlaybackCancel = value; } },
    azureSpeechToken: { enumerable: false, get: () => azureSpeechToken, set: (value) => { azureSpeechToken = value; } },
    azureSpeechTokenExpiresAt: { enumerable: false, get: () => azureSpeechTokenExpiresAt, set: (value) => { azureSpeechTokenExpiresAt = value; } },
    azureSpeechTokenPromise: { enumerable: false, get: () => azureSpeechTokenPromise, set: (value) => { azureSpeechTokenPromise = value; } },
    frameDocument: { enumerable: false, get: () => frameDocument, set: (value) => { frameDocument = value; } },
    boundFrameDocument: { enumerable: false, get: () => boundFrameDocument, set: (value) => { boundFrameDocument = value; } },
    currentPageReadPending: { enumerable: false, get: () => currentPageReadPending, set: (value) => { currentPageReadPending = value; } },
    currentFrameURL: { enumerable: false, get: () => currentFrameURL, set: (value) => { currentFrameURL = value; } },
    timeLimitPhase: { enumerable: false, get: () => timeLimitPhase, set: (value) => { timeLimitPhase = value; } },
    timeLimitDeadline: { enumerable: false, get: () => timeLimitDeadline, set: (value) => { timeLimitDeadline = value; } },
    timeLimitTimeout: { enumerable: false, get: () => timeLimitTimeout, set: (value) => { timeLimitTimeout = value; } },
    timeLimitInterval: { enumerable: false, get: () => timeLimitInterval, set: (value) => { timeLimitInterval = value; } },
    timeLimitSourceDocument: { enumerable: false, get: () => timeLimitSourceDocument, set: (value) => { timeLimitSourceDocument = value; } },
    frameProblemScrollTimers: { enumerable: false, get: () => frameProblemScrollTimers, set: (value) => { frameProblemScrollTimers = value; } },
    frameMutationObserver: { enumerable: false, get: () => frameMutationObserver, set: (value) => { frameMutationObserver = value; } },
    frameControlObserver: { enumerable: false, get: () => frameControlObserver, set: (value) => { frameControlObserver = value; } },
    observedAnswerResult: { enumerable: false, get: () => observedAnswerResult, set: (value) => { observedAnswerResult = value; } },
    observedCommentary: { enumerable: false, get: () => observedCommentary, set: (value) => { observedCommentary = value; } },
    awaitingAnswerResultSpeech: { enumerable: false, get: () => awaitingAnswerResultSpeech, set: (value) => { awaitingAnswerResultSpeech = value; } },
    navigationInProgress: { enumerable: false, get: () => navigationInProgress, set: (value) => { navigationInProgress = value; } },
    nextQuestionOperationInProgress: { enumerable: false, get: () => nextQuestionOperationInProgress, set: (value) => { nextQuestionOperationInProgress = value; } },
    syncToken: { enumerable: false, get: () => syncToken, set: (value) => { syncToken = value; } },
    syncReady: { enumerable: false, get: () => syncReady, set: (value) => { syncReady = value; } },
    syncInProgress: { enumerable: false, get: () => syncInProgress, set: (value) => { syncInProgress = value; } },
    syncPromise: { enumerable: false, get: () => syncPromise, set: (value) => { syncPromise = value; } },
    catalogReady: { enumerable: false, get: () => catalogReady, set: (value) => { catalogReady = value; } },
    catalogInProgress: { enumerable: false, get: () => catalogInProgress, set: (value) => { catalogInProgress = value; } },
    catalogPromise: { enumerable: false, get: () => catalogPromise, set: (value) => { catalogPromise = value; } },
    currentSyncState: { enumerable: false, get: () => currentSyncState, set: (value) => { currentSyncState = value; } },
    launcherSyncState: { enumerable: false, get: () => launcherSyncState, set: (value) => { launcherSyncState = value; } },
    pendingAttempt: { enumerable: false, get: () => pendingAttempt, set: (value) => { pendingAttempt = value; } },
    pendingAttemptTransitionPromise: { enumerable: false, get: () => pendingAttemptTransitionPromise, set: (value) => { pendingAttemptTransitionPromise = value; } },
    pendingCelebration: { enumerable: false, get: () => pendingCelebration, set: (value) => { pendingCelebration = value; } },
    answerCopyOperation: { enumerable: false, get: () => answerCopyOperation, set: (value) => { answerCopyOperation = value; } },
    automaticCopyPromise: { enumerable: false, get: () => automaticCopyPromise, set: (value) => { automaticCopyPromise = value; } },
    correctFeedbackDocuments: { enumerable: false, get: () => correctFeedbackDocuments },
    correctFeedbackPromise: { enumerable: false, get: () => correctFeedbackPromise, set: (value) => { correctFeedbackPromise = value; } },
    correctFeedbackRemovalTimer: { enumerable: false, get: () => correctFeedbackRemovalTimer, set: (value) => { correctFeedbackRemovalTimer = value; } },
    waitForCorrectFeedbackKpi: { enumerable: false, get: () => waitForCorrectFeedbackKpi },
    extractQuestionText: { enumerable: false, get: () => extractQuestionText },
    loadCompleteQuestionCatalog: { enumerable: false, get: () => loadCompleteQuestionCatalog },
    answerResultFromDocument: { enumerable: false, get: () => answerResultFromDocument },
    findAnswerButtonAfter: { enumerable: false, get: () => findAnswerButtonAfter },
    findAnswerChoiceControls: { enumerable: false, get: () => findAnswerChoiceControls },
    findQuestionMetadataElement: { enumerable: false, get: () => findQuestionMetadataElement },
    isVisibleElement: { enumerable: false, get: () => isVisibleElement },
    normalizeInlineText: { enumerable: false, get: () => normalizeInlineText },
    splitText: { enumerable: false, get: () => splitText },
    CORRECT_CHIME_SAMPLE_RATE: { enumerable: false, get: () => CORRECT_CHIME_SAMPLE_RATE },
    CORRECT_FEEDBACK_CSS: { enumerable: false, get: () => CORRECT_FEEDBACK_CSS },
    CORRECT_FEEDBACK_LEAVE_DURATION_MS: { enumerable: false, get: () => CORRECT_FEEDBACK_LEAVE_DURATION_MS },
    CORRECT_FEEDBACK_MINIMUM_DURATION_MS: { enumerable: false, get: () => CORRECT_FEEDBACK_MINIMUM_DURATION_MS },
    calculateKpiQuestionsRemaining: { enumerable: false, get: () => calculateKpiQuestionsRemaining },
    chooseCorrectFeedbackVariant: { enumerable: false, get: () => chooseCorrectFeedbackVariant },
    renderCorrectFeedbackElement: { enumerable: false, get: () => renderCorrectFeedbackElement },
    resolveCorrectFeedbackKpi: { enumerable: false, get: () => resolveCorrectFeedbackKpi },
    buildCopyMarkdown: { enumerable: false, get: () => buildCopyMarkdown },
    directChild: { enumerable: false, get: () => directChild },
    isSelectedAnswerChoice: { enumerable: false, get: () => isSelectedAnswerChoice },
  });
  installSyncController(app);
  installLauncherController(app);
  installViewController(app);
  installCopyController(app);
  installNavigationController(app);
  installLifecycleController(app);
  installSpeechController(app);
  installShortcutsController(app);
}
