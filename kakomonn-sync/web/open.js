(() => {
  "use strict";

  const READER_READY_TIMEOUT_MS = 15_000;
  const READER_BRIDGE_STATE_ATTRIBUTE = "data-kakomonn-reader-bridge-state";
  const READER_BRIDGE_TARGET_ATTRIBUTE = "data-kakomonn-reader-bridge-target";
  let phase = "waiting";
  let stateObserver = null;
  let timeoutID = null;

  function nextQuestionURL(content) {
    let url;
    try { url = new URL(content); } catch { throw new Error("invalid_url"); }
    if (
      url.protocol !== "https:" ||
      url.hostname !== "chushoks.kakomonn.com" ||
      url.search !== "" ||
      !(
        /^\/questions\/\d+$/.test(url.pathname) && url.hash === ""
      )
    ) throw new Error("invalid_url");
    return url.href;
  }

  function stopWaiting() {
    stateObserver?.disconnect();
    stateObserver = null;
    if (timeoutID !== null) clearTimeout(timeoutID);
    timeoutID = null;
  }

  function showBridgeError(code, title, message) {
    stopWaiting();
    phase = "error";
    document.querySelector("#open-bridge").hidden = true;
    document.querySelector("#open-error-title").textContent = title;
    document.querySelector("#open-error-message").textContent = message;
    document.querySelector("#open-error-detail").textContent =
      `context=open-bridge | code=${code}`;
    document.querySelector("#open-error").showModal();
  }

  function launch(target) {
    stopWaiting();
    phase = "away";
    history.replaceState(null, "", "/");
    history.pushState(null, "", "/open");
    location.replace(target);
  }

  function handleReaderState() {
    const state = document.documentElement.getAttribute(READER_BRIDGE_STATE_ATTRIBUTE);
    if (state === "ready") {
      try {
        const readerTarget = document.documentElement.getAttribute(
          READER_BRIDGE_TARGET_ATTRIBUTE
        );
        launch(nextQuestionURL(readerTarget));
      } catch {
        showBridgeError(
          "invalid_url",
          "次の問題を開けません",
          "接続先の設定が不正です."
        );
      }
      return true;
    }
    if (state === "error") {
      showBridgeError(
        "reader_unavailable",
        "Readerを起動できません",
        "Tampermonkeyと過去問readerが有効か確認して, ページを再読み込みしてください."
      );
      return true;
    }
    if (state === "empty") {
      showBridgeError(
        "no_next_question",
        "今解く問題はありません",
        "時間を置いてから, もう一度確認してください."
      );
      return true;
    }
    if (state === "unauthorized") {
      showBridgeError(
        "sync_unauthorized",
        "同期tokenを確認してください",
        "問題画面の同期設定でtokenを確認してから, ページを再読み込みしてください."
      );
      return true;
    }
    return false;
  }

  function waitForReader() {
    stateObserver = new MutationObserver(() => handleReaderState());
    stateObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [READER_BRIDGE_STATE_ATTRIBUTE],
    });
    timeoutID = setTimeout(() => {
      showBridgeError(
        "reader_ready_timeout",
        "Readerを起動できません",
        "Tampermonkeyと過去問readerが有効か確認して, ページを再読み込みしてください."
      );
    }, READER_READY_TIMEOUT_MS);
    handleReaderState();
  }

  document.querySelector("#open-error-reload").addEventListener("click", () => location.reload());

  window.addEventListener("pageshow", (event) => {
    if (phase === "away") {
      if (event.persisted) location.replace("/");
      return;
    }
    if (phase !== "waiting" || stateObserver) return;
    waitForReader();
  });
})();
