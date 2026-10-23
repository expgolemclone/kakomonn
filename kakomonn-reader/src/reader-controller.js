import { isNextResponse, isSite } from "../../contracts/kakomonn.mjs";
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
  CORRECT_FEEDBACK_CSS,
  CORRECT_FEEDBACK_LEAVE_DURATION_MS,
  CORRECT_FEEDBACK_MINIMUM_DURATION_MS,
  chooseCorrectFeedbackVariant,
  renderCorrectFeedbackElement,
  FEEDBACK_AUDIO_URLS,
} from "@expgolemclone/congratulations/feedback";
import { calculateKpiQuestionsRemaining, resolveCorrectFeedbackKpi,
  waitForCorrectFeedbackKpi as waitForCorrectFeedbackKpiResult } from "./feedback-kpi.js";
import { buildCopyMarkdown, directChild, isSelectedAnswerChoice } from "./markdown.js";
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
import { installStudyTimeController } from "./study-time-controller.js";
import { installDashboardBridge } from "./dashboard-bridge.js";
import { DASHBOARD_BRIDGE_STATE_ATTRIBUTE } from "../../contracts/dashboard-bridge.mjs";

export async function startReader() {
  const app = {};
  "use strict";

  const READER_FRAME_READY_MESSAGE_TYPE = "kakomonn-reader:frame-ready";
  if (window.top !== window.self) {
    window.parent.postMessage(
      {
        href: location.href,
        type: READER_FRAME_READY_MESSAGE_TYPE,
      },
      location.origin,
    );
    return;
  }

  const BUILD_FINGERPRINT = "__KAKOMONN_READER_BUILD_FINGERPRINT__";
  const SCRIPT_HANDLER =
    typeof GM_info === "object" && GM_info !== null && typeof GM_info.scriptHandler === "string"
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
  const SYNC_API_URL = "https://kakomonn-sync.kakomonn.workers.dev";
  const SYNC_TOKEN_KEY = "kakomonn-reader.sync-token";
  const LAUNCH_HANDOFF_KEY = "kakomonn-reader.v12.launch-handoff";
  const LAUNCH_HANDOFF_MAX_AGE_MS = 60000;
  const SYNC_TIMEOUT_MS = 15000;
  const isReaderBridge =
    location.origin === SYNC_API_URL &&
    location.pathname === "/open" &&
    location.search === "" &&
    location.hash === "";
  const isDashboardBridge = location.origin === SYNC_API_URL && location.pathname === "/";
  const NEXT_QUESTION_SITE_ID = "chushoks.kakomonn.com";
  const READER_BRIDGE_TARGET_ATTRIBUTE = "data-kakomonn-reader-bridge-target";
  const READER_BRIDGE_ERROR_ATTRIBUTE = "data-kakomonn-reader-bridge-error";
  function failReaderBridge(code) {
    document.documentElement.setAttribute(READER_BRIDGE_ERROR_ATTRIBUTE, code);
    document.documentElement.dataset.kakomonnReaderBridgeState = "error";
  }
  const isNextQuestionLauncher =
    location.hostname === NEXT_QUESTION_SITE_ID &&
    location.pathname === "/createques" &&
    location.search === "" &&
    location.hash === "#kakomonn-next";
  app.shouldLaunchNextQuestionAfterSync = isNextQuestionLauncher;

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
      const rejectOnce = (code) => settleOnce(() => reject(new SyncRequestError(code)));
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

  const isReaderBridgeNextResponse = (value) => isNextResponse(value, NEXT_QUESTION_SITE_ID);
  const hasDashboardBridgeRuntime =
    SCRIPT_HANDLER === "Tampermonkey" &&
    (isWindowsChrome || isIPhoneSafari) &&
    typeof GM === "object" &&
    GM !== null &&
    typeof GM.getValue === "function" &&
    typeof GM.listValues === "function" &&
    typeof GM.xmlHttpRequest === "function";
  if (isDashboardBridge) {
    if (!hasDashboardBridgeRuntime) {
      document.documentElement.setAttribute(DASHBOARD_BRIDGE_STATE_ATTRIBUTE, "error");
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
    typeof GM.listValues !== "function" ||
    typeof GM.setValue !== "function" ||
    typeof GM.deleteValue !== "function" ||
    typeof GM.xmlHttpRequest !== "function" ||
    typeof GM.setClipboard !== "function"
  ) {
    if (isReaderBridge) {
      failReaderBridge("runtime_unavailable");
    }
    return;
  }
  if (isReaderBridge) {
    let phase = "storage";
    try {
      const storedToken = await GM.getValue(SYNC_TOKEN_KEY, "");
      const token = typeof storedToken === "string" ? storedToken.trim() : "";
      const parameters = new URLSearchParams({ site: NEXT_QUESTION_SITE_ID });
      phase = "request";
      const result = await requestSyncResponse(
        "GET",
        `/v12/next?${parameters}`,
        token,
        isReaderBridgeNextResponse,
      );
      if (result.question === null) {
        document.documentElement.dataset.kakomonnReaderBridgeState = "empty";
        return;
      }
      phase = "storage";
      await GM.setValue(LAUNCH_HANDOFF_KEY, {
        createdAtMs: Date.now(),
        questionURL: result.question.url,
        state: result.state,
      });
      document.documentElement.setAttribute(READER_BRIDGE_TARGET_ATTRIBUTE, result.question.url);
      document.documentElement.dataset.kakomonnReaderBridgeState = "ready";
    } catch (error) {
      if (phase === "request" && error?.code === "unauthorized") {
        document.documentElement.dataset.kakomonnReaderBridgeState = "unauthorized";
      } else {
        failReaderBridge(
          phase === "storage"
            ? "storage_unavailable"
            : typeof error?.code === "string" && /^[a-z][a-z0-9_]*$/.test(error.code)
              ? error.code
              : "request_failed",
        );
      }
    }
    return;
  }
  const SITE_ID = location.hostname.toLowerCase();
  if (!isSite(SITE_ID)) {
    return;
  }
  const PENDING_ATTEMPT_KEY = `kakomonn-reader.${SITE_ID}.v9.pending-attempt`;
  const PENDING_CELEBRATION_KEY = `kakomonn-reader.${SITE_ID}.v9.pending-celebration`;
  const CATALOG_TIMEOUT_MS = 15000;
  const CATALOG_FETCH_CONCURRENCY = 4;
  const SPEECH_TIMEOUT_MS = 30000;
  const FRAME_PROBLEM_SCROLL_DELAYS_MS = [0, 120, 600];
  const SHORTCUT_SEQUENCE_TIMEOUT_MS = 400;
  const TIME_LIMIT_MS = 5 * 60 * 1000;
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
      --kakomonn-frame-correct: #52e1b6;
      --kakomonn-frame-incorrect: #e89292;
    }

    #js-answer-result-box.is-correct::before {
      border-top-color: var(--kakomonn-frame-correct);
    }

    #js-answer-result-box.is-wrong::before {
      background-color: var(--kakomonn-frame-incorrect);
    }
  
    header.l-header {
      display: none !important;
    }

    .p-post > .fixed_btn,
    .p-post > .fixed_btn_menu,
    .l-footer > .pagetop {
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
  const AZURE_SPEECH_URL = "https://japaneast.tts.speech.microsoft.com/cognitiveservices/v1";
  const JAPANESE_SPEECH_LOCALE = "ja-JP";
  const JAPANESE_SPEECH_VOICE_NAME = "ja-JP-NanamiNeural";
  const AZURE_SPEECH_OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
  const FEEDBACK_AUDIO_DATA_URLS = FEEDBACK_AUDIO_URLS;
  const SILENT_AUDIO_DATA_URL =
    "data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==";
  const SPEECH_GESTURE_STATUS = "画面をクリックまたはタップすると読み上げます";

  const speechAudio = typeof window.Audio === "function" ? new window.Audio() : null;
  const speechSupported =
    typeof speechAudio?.play === "function" &&
    typeof speechAudio?.pause === "function" &&
    typeof speechAudio?.canPlayType === "function" &&
    speechAudio.canPlayType("audio/mpeg") !== "" &&
    (isIPhoneSafari || isWindowsChrome);
  app.speechEnabled = false;
  app.speechPaused = false;
  app.speechInitializationInProgress = false;
  app.speechInitializationPromise = null;
  app.speechInitializationResolve = null;
  app.speechRunId = 0;
  const activeSpeechRequests = new Set();
  app.speechChunkSession = null;
  app.activeSpeechAudioURL = "";
  app.activeSpeechPlaybackCancel = null;
  app.azureSpeechToken = "";
  app.azureSpeechTokenExpiresAt = 0;
  app.azureSpeechTokenPromise = null;
  app.frameDocument = null;
  app.boundFrameDocument = null;
  app.currentPageReadPending = false;
  app.currentFrameURL = app.shouldLaunchNextQuestionAfterSync ? "about:blank" : location.href;
  app.timeLimitPhase = null;
  app.timeLimitDeadline = 0;
  app.timeLimitTimeout = null;
  app.timeLimitInterval = null;
  app.timeLimitSourceDocument = null;
  app.frameProblemScrollTimers = [];
  app.frameMutationObserver = null;
  app.frameControlObserver = null;
  app.observedAnswerResult = null;
  app.observedCommentary = null;
  app.awaitingAnswerResultSpeech = false;
  app.navigationInProgress = false;
  app.nextQuestionOperationInProgress = false;
  app.syncToken = "";
  app.syncReady = false;
  app.syncInProgress = false;
  app.syncPromise = null;
  app.catalogReady = false;
  app.catalogInProgress = false;
  app.catalogPromise = null;
  app.currentSyncState = null;
  app.launcherSyncState = null;
  app.pendingAttempt = null;
  app.pendingAttemptTransitionPromise = null;
  app.pendingCelebration = null;
  app.answerCopyOperation = null;

  const correctFeedbackDocuments = new WeakSet();
  app.correctFeedbackPromise = null;
  app.correctFeedbackRemovalTimer = null;
  function waitForCorrectFeedbackKpi(questionId) {
    return waitForCorrectFeedbackKpiResult(questionId, app.pendingAttempt);
  }
  function extractQuestionText() {
    return extractQuestionTextFromDocument(app.frameDocument);
  }
  const { loadCompleteQuestionCatalog } = createCatalogLoader({
    fetchConcurrency: CATALOG_FETCH_CONCURRENCY,
    siteId: SITE_ID,
    SyncRequestError,
    timeoutMs: CATALOG_TIMEOUT_MS,
  });
  installReaderStyles(CORRECT_FEEDBACK_CSS);

  Object.assign(app, {
    loadCompleteQuestionCatalog,
    READER_FRAME_READY_MESSAGE_TYPE,
    BUILD_FINGERPRINT,
    SCRIPT_HANDLER,
    isIPhoneSafari,
    SYNC_TOKEN_KEY,
    LAUNCH_HANDOFF_KEY,
    LAUNCH_HANDOFF_MAX_AGE_MS,
    isNextQuestionLauncher,
    SyncRequestError,
    gmXMLHttpRequest,
    requestSyncResponse,
    SITE_ID,
    PENDING_ATTEMPT_KEY,
    PENDING_CELEBRATION_KEY,
    SPEECH_TIMEOUT_MS,
    FRAME_PROBLEM_SCROLL_DELAYS_MS,
    SHORTCUT_SEQUENCE_TIMEOUT_MS,
    TIME_LIMIT_MS,
    FRAME_DARK_MODE_STYLE_ID,
    FRAME_DARK_MODE_CSS,
    CORRECT_FEEDBACK_CSS,
    QUESTION_SPEECH_RATE,
    ANSWER_RESULT_SPEECH_RATE,
    SPEECH_TOKEN_RENEWAL_SKEW_MS,
    AZURE_SPEECH_URL,
    JAPANESE_SPEECH_LOCALE,
    JAPANESE_SPEECH_VOICE_NAME,
    AZURE_SPEECH_OUTPUT_FORMAT,
    FEEDBACK_AUDIO_DATA_URLS,
    SILENT_AUDIO_DATA_URL,
    SPEECH_GESTURE_STATUS,
    speechAudio,
    speechSupported,
    activeSpeechRequests,
    correctFeedbackDocuments,
    waitForCorrectFeedbackKpi,
    extractQuestionText,
    answerResultFromDocument,
    findAnswerButtonAfter,
    findAnswerChoiceControls,
    findQuestionMetadataElement,
    isVisibleElement,
    normalizeInlineText,
    splitText,
    CORRECT_FEEDBACK_LEAVE_DURATION_MS,
    CORRECT_FEEDBACK_MINIMUM_DURATION_MS,
    calculateKpiQuestionsRemaining,
    chooseCorrectFeedbackVariant,
    renderCorrectFeedbackElement,
    resolveCorrectFeedbackKpi,
    buildCopyMarkdown,
    directChild,
    isSelectedAnswerChoice,
  });
  installSyncController(app);
  installLauncherController(app);
  installViewController(app);
  installStudyTimeController(app);
  installCopyController(app);
  installNavigationController(app);
  installLifecycleController(app);
  installSpeechController(app);
  installShortcutsController(app);
}
