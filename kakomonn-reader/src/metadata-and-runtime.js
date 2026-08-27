// ==UserScript==
// @name         過去問reader＋連続自動読み上げ
// @namespace    local.kakomonn.reader
// @description  問題文と解説の読み上げ, コピー, 学習記録の端末間同期とdue card完了時の祝福を提供します.
// @match        https://*.kakomonn.com/*
// @connect      kakomonn-sync.kakomonn.workers.dev
// @connect      japaneast.tts.speech.microsoft.com
// @run-at       document-end
// @noframes
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// @grant        GM.xmlHttpRequest
// @grant        GM.setClipboard
// @grant        GM_info
// ==/UserScript==

(async () => {
  "use strict";

  if (window.top !== window.self) {
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
  const NEXT_QUESTION_SITE_ID = "chushoks.kakomonn.com";
  const NEXT_QUESTION_LAUNCHER_URL =
    `https://${NEXT_QUESTION_SITE_ID}/createques#kakomonn-next`;
  const SYNC_SETTINGS_ENTRY_URL =
    `https://${NEXT_QUESTION_SITE_ID}/createques#kakomonn-sync-settings`;
  const isNextQuestionLauncher = location.href === NEXT_QUESTION_LAUNCHER_URL;
  const isSyncSettingsEntry = location.href === SYNC_SETTINGS_ENTRY_URL;
  const CONGRATULATIONS_URL =
    "https://kakomonn-congratulations.kakomonn.workers.dev/";
  const SITE_ID = location.hostname.toLowerCase();
  if (
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.kakomonn\.com$/.test(
      SITE_ID
    )
  ) {
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
    return;
  }
  const SYNC_TOKEN_KEY = "kakomonn-reader.sync-token";
  const PENDING_ATTEMPT_KEY = `kakomonn-reader.${SITE_ID}.v8.pending-attempt`;
  const PENDING_CELEBRATION_KEY =
    `kakomonn-reader.${SITE_ID}.v8.pending-celebration`;
  const SYNC_TIMEOUT_MS = 15000;
  const SPEECH_TIMEOUT_MS = 30000;
  const FRAME_LOAD_DELAY_MS = 900;
  const FRAME_CHANGE_DELAY_MS = 700;
  const FRAME_PROBLEM_SCROLL_DELAYS_MS = [0, 120, 600];
  const COPY_FEEDBACK_DURATION_MS = 1400;
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
  const AZURE_SPEECH_VOICE_NAME = "ja-JP-NanamiNeural";
  const AZURE_SPEECH_OUTPUT_FORMAT =
    "audio-24khz-48kbitrate-mono-mp3";
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
  let speechRunId = 0;
  let activeSpeechRequest = null;
  let activeSpeechAudioURL = "";
  let azureSpeechToken = "";
  let azureSpeechTokenExpiresAt = 0;
  let azureSpeechTokenPromise = null;
  let frameDocument = null;
  let boundFrameDocument = null;
  let currentPageReadPending = false;
  let currentFrameURL = isSyncSettingsEntry
    ? `https://${NEXT_QUESTION_SITE_ID}/createques`
    : location.href;
  let loadTimer = null;
  let frameChangeTimer = null;
  let timeLimitPhase = null;
  let timeLimitDeadline = 0;
  let timeLimitTimeout = null;
  let timeLimitInterval = null;
  let timeLimitSourceDocument = null;
  let frameProblemScrollTimers = [];
  let copyFeedbackTimer = null;
  let frameMutationObserver = null;
  let awaitingAnswerResultSpeech = false;
  let navigationInProgress = false;
  let nextQuestionOperationInProgress = false;
  let learningMetrics = null;
  let syncToken = "";
  let syncReady = false;
  let syncInProgress = false;
  let syncPromise = null;
  let pendingAttempt = null;
  let pendingAttemptTransitionPromise = null;
  let pendingCelebration = null;
  let celebrationTransitionPromise = null;
