// ==UserScript==
// @name         過去問50問＋連続自動読み上げ
// @namespace    local.kakomonn.reader
// @description  問題文を1.5倍速, 解説を1.2倍速で読み上げ, 次問時の先頭表示, 問題・解説コピー, 日次50問カウントを提供します.
// @match        https://chushoks.kakomonn.com/*
// @run-at       document-end
// @noframes
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  if (window.top !== window.self) {
    return;
  }

  const GOAL = 50;
  const SHORTCUT_NAME = "過去問50問";
  const COUNT_STATE_KEY = "kakomonn-reader.daily-count";
  const START_PARAMETER = "count50";
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
  let goalCompleted = false;
  let navigationInProgress = false;
  let dailyResetTimer = null;
  let activeCountDate = "";

  function getLocalDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function saveCountState(dateKey, value) {
    localStorage.setItem(
      COUNT_STATE_KEY,
      JSON.stringify({ date: dateKey, count: value })
    );
  }

  function loadCountState() {
    const today = getLocalDateKey();
    const rawState = localStorage.getItem(COUNT_STATE_KEY);

    if (rawState === null) {
      saveCountState(today, 0);
      return { date: today, count: 0 };
    }

    let parsedState;
    try {
      parsedState = JSON.parse(rawState);
    } catch {
      saveCountState(today, 0);
      return { date: today, count: 0 };
    }

    const storedCount = Number.parseInt(parsedState?.count, 10);
    const isValidState =
      typeof parsedState?.date === "string" &&
      Number.isFinite(storedCount) &&
      storedCount >= 0;

    if (!isValidState || parsedState.date !== today) {
      saveCountState(today, 0);
      return { date: today, count: 0 };
    }

    const normalizedCount = Math.min(storedCount, GOAL);
    if (normalizedCount !== storedCount) {
      saveCountState(today, normalizedCount);
    }

    return { date: today, count: normalizedCount };
  }

  const initialURL = new URL(location.href);
  if (initialURL.searchParams.get(START_PARAMETER) === "start") {
    initialURL.searchParams.delete(START_PARAMETER);
    history.replaceState(null, "", initialURL.href);
    currentFrameURL = initialURL.href;
  }

  const initialCountState = loadCountState();
  let count = initialCountState.count;
  activeCountDate = initialCountState.date;
  goalCompleted = count >= GOAL;

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
    #kakomonn-reader-stop {
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
  `;
