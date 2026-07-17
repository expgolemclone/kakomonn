// ==UserScript==
// @name         過去問マイルストーン＋連続自動読み上げ
// @namespace    local.kakomonn.reader
// @description  問題文と解説の読み上げ, コピー, 端末間で共有する日次正解数と50問ごとの祝福を提供します.
// @match        https://chushoks.kakomonn.com/*
// @connect      kakomonn-count-sync.expgolem-lab.workers.dev
// @run-at       document-end
// @noframes
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// @grant        GM.xmlHttpRequest
// ==/UserScript==

(async () => {
  "use strict";

  if (window.top !== window.self) {
    return;
  }

  const MILESTONE_INTERVAL = 50;
  const SYNC_API_URL =
    "https://kakomonn-count-sync.expgolem-lab.workers.dev";
  const CONGRATULATIONS_URL =
    "https://kakomonn-congratulations.vercel.app/";
  const SYNC_TOKEN_KEY = "kakomonn-reader.sync-token";
  const PENDING_CORRECT_KEY = "kakomonn-reader.pending-correct";
  const PENDING_CELEBRATION_KEY = "kakomonn-reader.pending-celebration";
  const START_PARAMETER = "count50";
  const SYNC_TIMEOUT_MS = 15000;
  const FRAME_LOAD_DELAY_MS = 900;
  const EXPLANATION_CHANGE_DELAY_MS = 700;
  const NEXT_QUESTION_RELOAD_DELAY_MS = 1200;
  const FRAME_SCROLL_RESET_DELAYS_MS = [0, 120, 600];
  const COPY_FEEDBACK_DURATION_MS = 1400;
  const MAX_CHUNK_LENGTH = 120;
  const QUESTION_SPEECH_RATE = 1.5;
  const EXPLANATION_SPEECH_RATE = 1.2;
  const EDGE_JAPANESE_VOICE_NAME =
    "Microsoft Nanami Online (Natural) - Japanese (Japan)";

  const speech = window.speechSynthesis;
  const SpeechUtterance = window.SpeechSynthesisUtterance;
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isWindowsEdge =
    navigator.userAgent.includes("Windows NT") &&
    navigator.userAgent.includes("Edg/");
  const speechSupported =
    typeof speech?.cancel === "function" &&
    typeof speech?.speak === "function" &&
    typeof speech?.getVoices === "function" &&
    typeof SpeechUtterance === "function" &&
    (isIOS || isWindowsEdge);
  let speechEnabled = false;
  let speechRunId = 0;
  let activeUtterance = null;
  let speechVoice = null;
  let frameDocument = null;
  let boundFrameDocument = null;
  let currentFrameURL = location.href;
  let loadTimer = null;
  let explanationTimer = null;
  let nextQuestionReloadTimer = null;
  let frameScrollResetTimers = [];
  let copyFeedbackTimer = null;
  let frameMutationObserver = null;
  let lastExplanationText = "";
  let currentQuestionText = "";
  let navigationInProgress = false;
  let nextQuestionOperationInProgress = false;
  let allowNextQuestionClick = false;
  let count = null;
  let activeCountDate = "";
  let syncToken = "";
  let syncReady = false;
  let syncInProgress = false;
  let syncPromise = null;
  let pendingCorrect = null;
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
      inset: 0;
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
      right: 12px;
      top: calc(12px + env(safe-area-inset-top));
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 8px;
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
      max-width: 52vw;
      overflow: hidden;
      text-overflow: ellipsis;
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

    #kakomonn-reader-next,
    #kakomonn-reader-copy {
      position: fixed;
      right: 14px;
      z-index: 2147483647;
      min-width: 138px;
      border: 0;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-weight: 800;
      line-height: 1;
      padding: 0 18px;
      box-shadow: 0 6px 22px rgba(0, 0, 0, 0.30);
      pointer-events: auto;
      -webkit-tap-highlight-color: transparent;
    }

    #kakomonn-reader-next {
      bottom: calc(16px + env(safe-area-inset-bottom));
      min-height: 54px;
      border-radius: 17px;
      background: #1473e6;
      font-size: 17px;
    }

    #kakomonn-reader-copy {
      bottom: calc(80px + env(safe-area-inset-bottom));
      min-height: 44px;
      border-radius: 15px;
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

    #kakomonn-reader-start-wrap {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      padding:
        24px
        20px
        calc(28px + env(safe-area-inset-bottom));
      box-sizing: border-box;
      background: rgba(0, 0, 0, 0.12);
      pointer-events: none;
    }

    #kakomonn-reader-start {
      width: min(520px, 100%);
      min-height: 58px;
      border: 0;
      border-radius: 18px;
      background: #1473e6;
      color: #fff;
      font-size: 19px;
      font-weight: 800;
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.28);
      pointer-events: auto;
    }

    #kakomonn-reader-start:disabled {
      background: rgba(90, 90, 90, 0.90);
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
