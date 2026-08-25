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
  const isNextQuestionLauncher = location.href === NEXT_QUESTION_LAUNCHER_URL;
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
  let currentFrameURL = location.href;
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

  const style = document.createElement("style");
  style.textContent = `
    :root {
      color-scheme: dark;
      --kakomonn-reader-canvas: #0b0d10;
      --kakomonn-reader-surface: #15191e;
      --kakomonn-reader-raised: #1d232b;
      --kakomonn-reader-text: #f3f4f6;
      --kakomonn-reader-muted: #a8b0bb;
      --kakomonn-reader-border: #343b45;
      --kakomonn-reader-primary: #1473e6;
      --kakomonn-reader-focus-ring: #a8c7fa;
      --kakomonn-reader-time-track: oklch(0.32 0.02 255);
      --kakomonn-reader-time-question: oklch(0.72 0.16 245);
      --kakomonn-reader-time-explanation: oklch(0.74 0.16 150);
      --kakomonn-reader-controls-height: calc(
        78px + env(safe-area-inset-top)
      );
      --kakomonn-reader-actions-height: calc(
        76px + env(safe-area-inset-bottom)
      );
    }

    html, body {
      width: 100% !important;
      height: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
      overflow: hidden !important;
      background: var(--kakomonn-reader-canvas) !important;
      color: var(--kakomonn-reader-text) !important;
    }

    #kakomonn-next-question-launcher {
      min-height: 100%;
      display: grid;
      place-content: center;
      gap: 16px;
      padding: max(24px, env(safe-area-inset-top)) 24px
        max(24px, env(safe-area-inset-bottom));
      box-sizing: border-box;
      background: var(--kakomonn-reader-canvas);
      color: var(--kakomonn-reader-text);
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      text-align: center;
    }

    #kakomonn-next-question-title,
    #next-question-status {
      margin: 0;
    }

    #kakomonn-next-question-title {
      font-size: clamp(24px, 8vw, 36px);
      line-height: 1.2;
    }

    #next-question-status {
      max-width: 36rem;
      color: var(--kakomonn-reader-muted);
      font-size: 16px;
      line-height: 1.6;
    }

    #next-question-retry {
      min-width: 8rem;
      min-height: 48px;
      justify-self: center;
      padding: 0 20px;
      border: 0;
      border-radius: 12px;
      background: var(--kakomonn-reader-primary);
      color: var(--kakomonn-reader-text);
      font: 700 16px/1 -apple-system, BlinkMacSystemFont, sans-serif;
      cursor: pointer;
      touch-action: manipulation;
    }

    #next-question-retry:focus-visible {
      outline: 3px solid var(--kakomonn-reader-focus-ring);
      outline-offset: 3px;
    }

    #kakomonn-reader-shell {
      position: fixed;
      top: var(--kakomonn-reader-controls-height);
      right: 0;
      bottom: var(--kakomonn-reader-actions-height);
      left: 0;
      z-index: 2147483000;
      background: var(--kakomonn-reader-canvas);
    }

    #kakomonn-reader-frame {
      width: 100%;
      height: 100%;
      border: 0;
      background: var(--kakomonn-reader-canvas);
    }

    #kakomonn-reader-controls {
      position: fixed;
      top: 0;
      right: 0;
      left: 0;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      height: var(--kakomonn-reader-controls-height);
      padding: calc(8px + env(safe-area-inset-top)) 12px 8px;
      box-sizing: border-box;
      background: var(--kakomonn-reader-surface);
      pointer-events: none;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    }

    #kakomonn-reader-time-limit {
      --kakomonn-reader-time-fill: var(--kakomonn-reader-time-question);
      position: absolute;
      right: 0;
      bottom: 0;
      left: 0;
      width: 100%;
      height: 4px;
      border: 0;
      appearance: none;
      background: var(--kakomonn-reader-time-track);
      color: var(--kakomonn-reader-time-fill);
      pointer-events: none;
    }

    #kakomonn-reader-time-limit[hidden] {
      display: none;
    }

    #kakomonn-reader-time-limit[data-phase="explanation"] {
      --kakomonn-reader-time-fill: var(--kakomonn-reader-time-explanation);
    }

    #kakomonn-reader-time-limit::-webkit-progress-bar {
      background: var(--kakomonn-reader-time-track);
    }

    #kakomonn-reader-time-limit::-webkit-progress-value {
      background: var(--kakomonn-reader-time-fill);
    }

    #kakomonn-reader-time-limit::-moz-progress-bar {
      background: var(--kakomonn-reader-time-fill);
    }

    #kakomonn-reader-status,
    #kakomonn-reader-skip,
    #kakomonn-reader-sync-settings-button {
      border: 0;
      border-radius: 999px;
      background: var(--kakomonn-reader-raised);
      color: var(--kakomonn-reader-text);
      font-size: 13px;
      font-weight: 700;
      line-height: 1;
      padding: 9px 12px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
    }

    #kakomonn-reader-status {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    #kakomonn-reader-learning-metrics {
      flex: 0 1 auto;
      min-width: 0;
      display: grid;
      gap: 5px;
      padding: 7px 12px;
      border: 0;
      border-radius: 14px;
      background: var(--kakomonn-reader-raised);
      color: var(--kakomonn-reader-text);
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
      font-weight: 700;
      line-height: 1;
    }

    #kakomonn-reader-due-card-progress,
    #kakomonn-reader-today-metrics,
    #kakomonn-reader-today-metrics > div {
      display: flex;
      align-items: baseline;
    }

    #kakomonn-reader-due-card-progress {
      justify-content: space-between;
      gap: 16px;
    }

    .kakomonn-reader-metric {
      display: flex;
      min-width: 0;
      align-items: baseline;
      gap: 5px;
      white-space: nowrap;
    }

    .kakomonn-reader-metric-label {
      color: var(--kakomonn-reader-muted);
      font-size: 10px;
      overflow-wrap: anywhere;
    }

    #kakomonn-reader-due-cards-completed {
      font-size: 13px;
    }

    #kakomonn-reader-due-cards-completed[data-completed="true"] {
      color: var(--kakomonn-reader-focus-ring);
    }

    .kakomonn-reader-remaining-value {
      display: flex;
      align-items: baseline;
      gap: 3px;
      color: var(--kakomonn-reader-focus-ring);
    }

    #kakomonn-reader-due-cards-remaining {
      font-size: 21px;
      font-variant-numeric: tabular-nums;
    }

    .kakomonn-reader-remaining-value small {
      color: var(--kakomonn-reader-muted);
      font-size: 10px;
    }

    #kakomonn-reader-today-metrics {
      justify-content: flex-end;
      gap: 14px;
      margin: 0;
    }

    #kakomonn-reader-today-metrics > div {
      min-width: 0;
      gap: 5px;
    }

    #kakomonn-reader-today-metrics dt {
      color: var(--kakomonn-reader-muted);
      font-size: 10px;
      overflow-wrap: anywhere;
    }

    #kakomonn-reader-today-metrics dd {
      display: flex;
      align-items: baseline;
      gap: 2px;
      margin: 0;
      font-size: 11px;
      font-variant-numeric: tabular-nums;
    }

    #kakomonn-reader-skip {
      pointer-events: auto;
      cursor: pointer;
    }

    #kakomonn-reader-sync-settings-button {
      pointer-events: auto;
      cursor: pointer;
    }

    #kakomonn-reader-skip:disabled,
    #kakomonn-reader-sync-settings-button:disabled {
      cursor: default;
      opacity: 0.55;
    }

    #kakomonn-reader-actions {
      position: fixed;
      right: 0;
      bottom: 0;
      left: 0;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      height: var(--kakomonn-reader-actions-height);
      padding: 10px 14px calc(10px + env(safe-area-inset-bottom));
      box-sizing: border-box;
      background: var(--kakomonn-reader-surface);
      pointer-events: none;
    }

    #kakomonn-reader-next,
    #kakomonn-reader-copy {
      position: static;
      flex: 0 1 240px;
      min-width: 160px;
      max-width: 240px;
      min-height: 54px;
      border: 0;
      border-radius: 17px;
      color: var(--kakomonn-reader-text);
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-weight: 800;
      line-height: 1;
      padding: 0 18px;
      box-shadow: 0 6px 22px rgba(0, 0, 0, 0.30);
      pointer-events: auto;
      touch-action: manipulation;
      -webkit-user-select: none;
      user-select: none;
      -webkit-tap-highlight-color: transparent;
    }

    #kakomonn-reader-next {
      background: var(--kakomonn-reader-primary);
      font-size: 17px;
    }

    #kakomonn-reader-copy {
      background: #2f855a;
      font-size: 14px;
    }

    #kakomonn-reader-next:active:not(:disabled),
    #kakomonn-reader-copy:active:not(:disabled) {
      transform: scale(0.97);
    }

    #kakomonn-reader-next:disabled,
    #kakomonn-reader-copy:disabled {
      background: rgba(90, 90, 90, 0.78);
      opacity: 0.72;
    }

    @media (max-width: 620px) {
      :root {
        --kakomonn-reader-controls-height: calc(
          136px + env(safe-area-inset-top)
        );
      }

      #kakomonn-reader-controls {
        display: grid;
        grid-template-rows: 32px minmax(88px, auto);
        grid-template-columns: minmax(0, 1fr) auto auto;
        align-content: center;
        gap: 4px;
        padding: calc(6px + env(safe-area-inset-top)) 6px 6px;
      }

      #kakomonn-reader-status,
      #kakomonn-reader-skip,
      #kakomonn-reader-sync-settings-button {
        padding-right: 8px;
        padding-left: 8px;
        font-size: 11px;
      }

      #kakomonn-reader-status {
        grid-row: 1;
        grid-column: 1;
      }

      #kakomonn-reader-skip {
        grid-row: 1;
        grid-column: 2;
      }

      #kakomonn-reader-sync-settings-button {
        grid-row: 1;
        grid-column: 3;
      }

      #kakomonn-reader-learning-metrics {
        grid-row: 2;
        grid-column: 1 / -1;
        justify-self: stretch;
        align-self: stretch;
        gap: 7px;
        padding: 8px;
      }

      #kakomonn-reader-due-card-progress {
        gap: 8px;
      }

      .kakomonn-reader-metric {
        align-items: center;
      }

      #kakomonn-reader-today-metrics {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }

      #kakomonn-reader-today-metrics > div {
        display: grid;
        gap: 3px;
        text-align: center;
      }

      #kakomonn-reader-today-metrics dd {
        justify-content: center;
      }

      #kakomonn-reader-actions {
        gap: 8px;
        padding-right: 8px;
        padding-left: 8px;
      }

      #kakomonn-reader-next,
      #kakomonn-reader-copy {
        flex: 1 1 0;
        min-width: 0;
        max-width: none;
        padding-right: 10px;
        padding-left: 10px;
        font-size: 14px;
      }
    }

    #kakomonn-reader-sync-settings {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      box-sizing: border-box;
      background: rgba(0, 0, 0, 0.48);
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    }

    #kakomonn-reader-sync-settings[hidden] {
      display: none;
    }

    #kakomonn-reader-sync-settings-panel {
      width: min(420px, 100%);
      padding: 22px;
      box-sizing: border-box;
      border: 1px solid var(--kakomonn-reader-border);
      border-radius: 18px;
      background: var(--kakomonn-reader-raised);
      color: var(--kakomonn-reader-text);
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.34);
    }

    #kakomonn-reader-sync-settings-title {
      margin: 0 0 10px;
      font-size: 20px;
    }

    #kakomonn-reader-sync-settings-description {
      margin: 0 0 14px;
      font-size: 14px;
      line-height: 1.5;
    }

    #kakomonn-reader-sync-token {
      width: 100%;
      min-height: 46px;
      padding: 10px 12px;
      box-sizing: border-box;
      border: 1px solid var(--kakomonn-reader-border);
      border-radius: 10px;
      background: var(--kakomonn-reader-canvas);
      color: var(--kakomonn-reader-text);
      font-size: 16px;
    }

    #kakomonn-reader-sync-token::placeholder {
      color: var(--kakomonn-reader-muted);
    }

    #kakomonn-reader-sync-settings-error {
      min-height: 20px;
      margin: 10px 0;
      color: #ff8a8a;
      font-size: 13px;
      line-height: 1.4;
    }

    #kakomonn-reader-sync-settings-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    #kakomonn-reader-sync-settings-save,
    #kakomonn-reader-sync-settings-cancel {
      min-height: 42px;
      padding: 0 16px;
      border: 0;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 700;
    }

    #kakomonn-reader-sync-settings-save {
      background: var(--kakomonn-reader-primary);
      color: var(--kakomonn-reader-text);
    }

    #kakomonn-reader-sync-settings-cancel {
      background: var(--kakomonn-reader-border);
      color: var(--kakomonn-reader-text);
    }

    #kakomonn-reader-sync-settings-save:disabled,
    #kakomonn-reader-sync-settings-cancel:disabled {
      opacity: 0.55;
    }

    #kakomonn-reader-next:focus-visible,
    #kakomonn-reader-copy:focus-visible,
    #kakomonn-reader-skip:focus-visible,
    #kakomonn-reader-sync-settings-button:focus-visible,
    #kakomonn-reader-sync-token:focus-visible,
    #kakomonn-reader-sync-settings-save:focus-visible,
    #kakomonn-reader-sync-settings-cancel:focus-visible {
      outline: 3px solid var(--kakomonn-reader-focus-ring);
      outline-offset: 2px;
    }
  `;
