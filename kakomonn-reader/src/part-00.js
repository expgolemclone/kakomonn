// ==UserScript==
// @name         過去問マイルストーン＋連続自動読み上げ
// @namespace    local.kakomonn.reader
// @description  問題文と解説の読み上げ, コピー, 端末間で共有する日次学習記録と50問ごとの祝福を提供します.
// @match        https://chushoks.kakomonn.com/*
// @connect      kakomonn-count-sync.expgolem-lab.workers.dev
// @connect      japaneast.tts.speech.microsoft.com
// @run-at       document-end
// @noframes
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// @grant        GM.xmlHttpRequest
// @grant        GM_info
// ==/UserScript==

(async () => {
  "use strict";

  if (window.top !== window.self) {
    return;
  }

  const MILESTONE_INTERVAL = 50;
  const BUILD_FINGERPRINT = "__KAKOMONN_READER_BUILD_FINGERPRINT__";
  const SCRIPT_HANDLER =
    typeof GM_info === "object" &&
    typeof GM_info.scriptHandler === "string"
      ? GM_info.scriptHandler
      : "";
  const SYNC_API_URL =
    "https://kakomonn-count-sync.expgolem-lab.workers.dev";
  const CONGRATULATIONS_URL =
    "https://kakomonn-congratulations.expgolem-lab.workers.dev/";
  const SYNC_TOKEN_KEY = "kakomonn-reader.sync-token";
  const PENDING_ANSWER_KEY = "kakomonn-reader.pending-answer";
  const LEGACY_PENDING_CORRECT_KEY = "kakomonn-reader.pending-correct";
  const PENDING_CELEBRATION_KEY = "kakomonn-reader.pending-celebration";
  const START_PARAMETER = "count50";
  const SYNC_TIMEOUT_MS = 15000;
  const SPEECH_TIMEOUT_MS = 30000;
  const FRAME_LOAD_DELAY_MS = 900;
  const EXPLANATION_CHANGE_DELAY_MS = 700;
  const FRAME_SCROLL_RESET_DELAYS_MS = [0, 120, 600];
  const COPY_FEEDBACK_DURATION_MS = 1400;
  const MAX_CHUNK_LENGTH = 1500;
  const QUESTION_SPEECH_RATE = 2.0;
  const EXPLANATION_SPEECH_RATE = 1.7;
  const SPEECH_TOKEN_RENEWAL_SKEW_MS = 60000;
  const AZURE_SPEECH_URL =
    "https://japaneast.tts.speech.microsoft.com/cognitiveservices/v1";
  const AZURE_SPEECH_VOICE_NAME = "ja-JP-NanamiNeural";
  const AZURE_SPEECH_OUTPUT_FORMAT =
    "audio-24khz-48kbitrate-mono-mp3";
  const SILENT_AUDIO_DATA_URL =
    "data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==";
  const SPEECH_GESTURE_STATUS =
    "画面をクリックまたはタップすると読み上げます";

  const speechAudio =
    typeof window.Audio === "function" ? new window.Audio() : null;
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isWindowsEdge =
    navigator.userAgent.includes("Windows NT") &&
    navigator.userAgent.includes("Edg/");
  const speechSupported =
    typeof speechAudio?.play === "function" &&
    typeof speechAudio?.pause === "function" &&
    typeof speechAudio?.canPlayType === "function" &&
    speechAudio.canPlayType("audio/mpeg") !== "" &&
    (isIOS || isWindowsEdge);
  let speechEnabled = false;
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
  let explanationTimer = null;
  let frameScrollResetTimers = [];
  let copyFeedbackTimer = null;
  let frameMutationObserver = null;
  let lastExplanationText = "";
  let currentQuestionText = "";
  let navigationInProgress = false;
  let nextQuestionOperationInProgress = false;
  let correctCount = null;
  let activeCountDate = "";
  let syncToken = "";
  let syncReady = false;
  let syncInProgress = false;
  let syncPromise = null;
  let pendingAnswer = null;
  let pendingCelebration = null;
  let celebrationTransitionPromise = null;

  const initialURL = new URL(location.href);
  if (initialURL.searchParams.get(START_PARAMETER) === "start") {
    initialURL.searchParams.delete(START_PARAMETER);
    history.replaceState(null, "", initialURL.href);
    currentFrameURL = initialURL.href;
  }

  const style = document.createElement("style");
  style.textContent = `
    :root {
      --kakomonn-reader-controls-height: calc(
        56px + env(safe-area-inset-top)
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
      background: #fff !important;
    }

    #kakomonn-reader-shell {
      position: fixed;
      top: var(--kakomonn-reader-controls-height);
      right: 0;
      bottom: var(--kakomonn-reader-actions-height);
      left: 0;
      z-index: 2147483000;
      background: #fff;
    }

    #kakomonn-reader-frame {
      width: 100%;
      height: 100%;
      border: 0;
      background: #fff;
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
      background: #111;
      pointer-events: none;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    }

    #kakomonn-reader-count,
    #kakomonn-reader-status,
    #kakomonn-reader-stop,
    #kakomonn-reader-sync-settings-button {
      border: 0;
      border-radius: 999px;
      background: rgba(20, 20, 20, 0.90);
      color: #fff;
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

    #kakomonn-reader-count {
      flex: 0 0 auto;
      white-space: nowrap;
    }

    #kakomonn-reader-stop {
      pointer-events: auto;
      display: none;
    }

    #kakomonn-reader-sync-settings-button {
      pointer-events: auto;
      cursor: pointer;
    }

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
      background: #111;
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
      color: #fff;
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
      background: #1473e6;
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
      #kakomonn-reader-controls {
        gap: 4px;
        padding-right: 6px;
        padding-left: 6px;
      }

      #kakomonn-reader-count,
      #kakomonn-reader-status,
      #kakomonn-reader-stop,
      #kakomonn-reader-sync-settings-button {
        padding-right: 8px;
        padding-left: 8px;
        font-size: 11px;
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
      border-radius: 18px;
      background: #fff;
      color: #1a202c;
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
      border: 1px solid #a0aec0;
      border-radius: 10px;
      font-size: 16px;
    }

    #kakomonn-reader-sync-settings-error {
      min-height: 20px;
      margin: 10px 0;
      color: #c53030;
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
      background: #1473e6;
      color: #fff;
    }

    #kakomonn-reader-sync-settings-cancel {
      background: #e2e8f0;
      color: #1a202c;
    }

    #kakomonn-reader-sync-settings-save:disabled,
    #kakomonn-reader-sync-settings-cancel:disabled {
      opacity: 0.55;
    }
  `;
