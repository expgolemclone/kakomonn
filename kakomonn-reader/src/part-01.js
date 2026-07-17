  document.documentElement.appendChild(style);

  const shell = document.createElement("div");
  shell.id = "kakomonn-reader-shell";

  const frame = document.createElement("iframe");
  frame.id = "kakomonn-reader-frame";
  frame.title = "過去問ページ";
  frame.allow = "autoplay";
  frame.src = currentFrameURL;
  shell.appendChild(frame);

  const controls = document.createElement("div");
  controls.id = "kakomonn-reader-controls";

  const statusBadge = document.createElement("div");
  statusBadge.id = "kakomonn-reader-status";
  statusBadge.textContent = "ページ読込中";

  const countBadge = document.createElement("div");
  countBadge.id = "kakomonn-reader-count";

  const stopButton = document.createElement("button");
  stopButton.id = "kakomonn-reader-stop";
  stopButton.type = "button";
  stopButton.textContent = "停止";

  const syncSettingsButton = document.createElement("button");
  syncSettingsButton.id = "kakomonn-reader-sync-settings-button";
  syncSettingsButton.type = "button";
  syncSettingsButton.textContent = "同期設定";
  syncSettingsButton.setAttribute("aria-label", "正解数の同期設定を開く");

  controls.append(statusBadge, countBadge, stopButton, syncSettingsButton);

  const nextQuestionButton = document.createElement("button");
  nextQuestionButton.id = "kakomonn-reader-next";
  nextQuestionButton.type = "button";
  nextQuestionButton.textContent = "次の問題へ";
  nextQuestionButton.setAttribute("aria-label", "次の問題へ移動");
  nextQuestionButton.hidden = true;
  nextQuestionButton.disabled = true;

  const copyButton = document.createElement("button");
  copyButton.id = "kakomonn-reader-copy";
  copyButton.type = "button";
  copyButton.textContent = "回答後にコピー";
  copyButton.setAttribute("aria-label", "問題文と解説をコピー");
  copyButton.hidden = true;
  copyButton.disabled = true;

  const startWrap = document.createElement("div");
  startWrap.id = "kakomonn-reader-start-wrap";

  const startButton = document.createElement("button");
  startButton.id = "kakomonn-reader-start";
  startButton.type = "button";
  startButton.textContent = "正解数を同期中";
  startButton.disabled = true;
  startWrap.appendChild(startButton);

  const syncSettings = document.createElement("div");
  syncSettings.id = "kakomonn-reader-sync-settings";
  syncSettings.hidden = true;
  syncSettings.setAttribute("role", "dialog");
  syncSettings.setAttribute("aria-modal", "true");
  syncSettings.setAttribute(
    "aria-labelledby",
    "kakomonn-reader-sync-settings-title"
  );

  const syncSettingsPanel = document.createElement("div");
  syncSettingsPanel.id = "kakomonn-reader-sync-settings-panel";

  const syncSettingsTitle = document.createElement("h2");
  syncSettingsTitle.id = "kakomonn-reader-sync-settings-title";
  syncSettingsTitle.textContent = "正解数の同期設定";

  const syncSettingsDescription = document.createElement("p");
  syncSettingsDescription.id = "kakomonn-reader-sync-settings-description";
  syncSettingsDescription.textContent =
    "Win11とiPhoneに同じ同期トークンを入力してください.";

  const syncTokenInput = document.createElement("input");
  syncTokenInput.id = "kakomonn-reader-sync-token";
  syncTokenInput.type = "password";
  syncTokenInput.autocomplete = "off";
  syncTokenInput.placeholder = "同期トークン";
  syncTokenInput.setAttribute("aria-label", "同期トークン");

  const syncSettingsError = document.createElement("div");
  syncSettingsError.id = "kakomonn-reader-sync-settings-error";
  syncSettingsError.setAttribute("role", "alert");

  const syncSettingsActions = document.createElement("div");
  syncSettingsActions.id = "kakomonn-reader-sync-settings-actions";

  const syncSettingsCancelButton = document.createElement("button");
  syncSettingsCancelButton.id = "kakomonn-reader-sync-settings-cancel";
  syncSettingsCancelButton.type = "button";
  syncSettingsCancelButton.textContent = "キャンセル";

  const syncSettingsSaveButton = document.createElement("button");
  syncSettingsSaveButton.id = "kakomonn-reader-sync-settings-save";
  syncSettingsSaveButton.type = "button";
  syncSettingsSaveButton.textContent = "確認して保存";

  syncSettingsActions.append(
    syncSettingsCancelButton,
    syncSettingsSaveButton
  );
  syncSettingsPanel.append(
    syncSettingsTitle,
    syncSettingsDescription,
    syncTokenInput,
    syncSettingsError,
    syncSettingsActions
  );
  syncSettings.appendChild(syncSettingsPanel);

  document.body.replaceChildren(
    shell,
    controls,
    startWrap,
    copyButton,
    nextQuestionButton,
    syncSettings
  );

  function renderCount() {
    countBadge.textContent =
      count === null ? `--/${GOAL}` : `${Math.min(count, GOAL)}/${GOAL}`;
  }

  function setStatus(message) {
    statusBadge.textContent = message;
  }

  class SyncRequestError extends Error {
    constructor(code, status = 0, state = null) {
      super(code);
      this.name = "SyncRequestError";
      this.code = code;
      this.status = status;
      this.state = state;
    }
  }

  function userscriptAPIAvailable() {
    return (
      typeof GM === "object" &&
      typeof GM.getValue === "function" &&
      typeof GM.setValue === "function" &&
      typeof GM.deleteValue === "function" &&
      typeof GM.xmlHttpRequest === "function"
    );
  }

  function isCountState(value) {
    return (
      value !== null &&
      typeof value === "object" &&
      /^\d{4}-\d{2}-\d{2}$/.test(value.date) &&
      Number.isInteger(value.count) &&
      value.count >= 0 &&
      value.count <= GOAL &&
      value.goal === GOAL
    );
  }

  function isPendingCorrect(value) {
    return (
      value !== null &&
      typeof value === "object" &&
      /^[0-9a-f]{32}$/.test(value.operationId) &&
      /^\d{4}-\d{2}-\d{2}$/.test(value.date) &&
      typeof value.pageURL === "string" &&
      value.pageURL.startsWith("https://chushoks.kakomonn.com/")
    );
  }

  function parseResponseJSON(response) {
    try {
      return JSON.parse(response.responseText);
    } catch {
      throw new SyncRequestError("invalid_response", response.status);
    }
  }

  function gmXMLHttpRequest(details) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const resolveOnce = (response) => {
        if (!settled) {
          settled = true;
          resolve(response);
        }
      };
      const rejectOnce = (code) => {
        if (!settled) {
          settled = true;
          reject(new SyncRequestError(code));
        }
      };

      try {
        const request = GM.xmlHttpRequest({
          ...details,
          timeout: SYNC_TIMEOUT_MS,
          onload: resolveOnce,
          onerror: () => rejectOnce("network_error"),
          onabort: () => rejectOnce("request_aborted"),
          ontimeout: () => rejectOnce("request_timeout"),
        });
        if (typeof request?.catch === "function") {
          request.catch(() => rejectOnce("network_error"));
        }
      } catch {
        rejectOnce("network_error");
      }
    });
  }

  async function requestSyncState(method, path, token, body = null) {
    const response = await gmXMLHttpRequest({
      method,
      url: `${SYNC_API_URL}${path}`,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === null ? {} : { "Content-Type": "application/json" }),
      },
      data: body === null ? undefined : JSON.stringify(body),
    });
    const responseBody = parseResponseJSON(response);

    if (response.status === 200) {
      if (!isCountState(responseBody)) {
        throw new SyncRequestError("invalid_response", response.status);
      }
      return responseBody;
    }

    if (
      response.status === 409 &&
      responseBody?.error === "date_changed" &&
      isCountState(responseBody.state)
    ) {
      throw new SyncRequestError(
        "date_changed",
        response.status,
        responseBody.state
      );
    }

    throw new SyncRequestError(
      typeof responseBody?.error === "string"
        ? responseBody.error
        : "request_failed",
      response.status
    );
  }

  function syncErrorMessage(error) {
    if (error?.code === "unauthorized") {
      return "同期トークンが正しくありません";
    }
    if (error?.code === "request_timeout") {
      return "正解数の同期がタイムアウトしました";
    }
    if (error?.code === "invalid_response") {
      return "同期APIの応答が不正です";
    }
    if (error?.code === "server_misconfigured") {
      return "同期APIが設定されていません";
    }
    return "正解数を同期できません";
  }

  function applyRemoteState(state) {
    if (!isCountState(state)) {
      throw new SyncRequestError("invalid_response");
    }

    activeCountDate = state.date;
    count = state.count;
    goalCompleted = count >= GOAL;
    renderCount();
  }

  function updateStartButton() {
    if (syncInProgress) {
      startButton.textContent = "正解数を同期中";
      startButton.disabled = true;
      return;
    }
    if (!syncToken) {
      startButton.textContent = "同期設定が必要";
      startButton.disabled = true;
      return;
    }
    if (!syncReady) {
      startButton.textContent = "同期を再試行";
      startButton.disabled = false;
      return;
    }
    if (!speechSupported) {
      startButton.textContent = "読み上げ非対応";
      startButton.disabled = true;
      return;
    }

    startButton.textContent = "読み上げを開始";
    startButton.disabled = false;
  }

  function updateSyncDependentControls() {
    syncSettingsButton.disabled =
      syncInProgress || nextQuestionOperationInProgress;
    updateStartButton();
    updateNextQuestionButton();
    updateCopyButton();
  }

  async function clearPendingCorrect() {
    await GM.deleteValue(PENDING_CORRECT_KEY);
    pendingCorrect = null;
  }

  async function reconcilePendingDate() {
    if (pendingCorrect === null || pendingCorrect.date === activeCountDate) {
      return false;
    }

    await clearPendingCorrect();
    return true;
  }

  function openSyncSettings(required = false) {
    if (syncInProgress || nextQuestionOperationInProgress) {
      return;
    }

    syncTokenInput.value = "";
    syncSettingsError.textContent = "";
    syncSettings.dataset.required = String(required);
    syncSettingsCancelButton.hidden = required;
    syncSettings.hidden = false;
    window.setTimeout(() => syncTokenInput.focus(), 0);
  }

  function closeSyncSettings() {
    if (syncSettings.dataset.required === "true") {
      return;
    }
    syncSettings.hidden = true;
    syncTokenInput.value = "";
    syncSettingsError.textContent = "";
  }

  async function refreshRemoteCount() {
    if (syncPromise !== null) {
      return syncPromise;
    }
    if (nextQuestionOperationInProgress) {
      return false;
    }
    if (!syncToken) {
      syncReady = false;
      openSyncSettings(true);
      updateSyncDependentControls();
      return false;
    }

    syncPromise = (async () => {
      syncInProgress = true;
      setStatus("正解数を同期中");
      updateSyncDependentControls();

      try {
        const state = await requestSyncState(
          "GET",
          "/v1/count",
          syncToken
        );
        applyRemoteState(state);
        syncReady = true;

        if (await reconcilePendingDate()) {
          setStatus("前日の未同期分を破棄しました");
        } else if (pendingCorrect !== null) {
          setStatus("未完了の正解数同期があります");
        } else if (goalCompleted) {
          setStatus(`本日の${GOAL}問を完了`);
        } else if (speechEnabled) {
          setStatus("待機中");
        } else {
          setStatus("開始ボタンを押してください");
        }
        return true;
      } catch (error) {
        syncReady = false;
        setStatus(`${syncErrorMessage(error)}.再試行してください`);
        return false;
      } finally {
        syncInProgress = false;
        syncPromise = null;
        updateSyncDependentControls();
      }
    })();

    return syncPromise;
  }

  async function saveSyncSettings() {
    const candidateToken = syncTokenInput.value.trim();
    if (!candidateToken) {
      syncSettingsError.textContent = "同期トークンを入力してください.";
      return;
    }
    if (syncPromise !== null || nextQuestionOperationInProgress) {
      syncSettingsError.textContent = "同期処理の完了を待ってください.";
      return;
    }

    const previousSyncReady = syncReady;
    syncInProgress = true;
    syncSettingsSaveButton.disabled = true;
    syncSettingsCancelButton.disabled = true;
    syncTokenInput.disabled = true;
    syncSettingsError.textContent = "同期APIを確認中です.";
    updateSyncDependentControls();

    syncPromise = (async () => {
      try {
        const state = await requestSyncState(
          "GET",
          "/v1/count",
          candidateToken
        );
        const discardedPending =
          pendingCorrect !== null && pendingCorrect.date !== state.date;
        if (discardedPending) {
          await clearPendingCorrect();
        }
        await GM.setValue(SYNC_TOKEN_KEY, candidateToken);

        syncToken = candidateToken;
        applyRemoteState(state);
        syncReady = true;
        syncSettings.dataset.required = "false";
        syncSettings.hidden = true;
        syncTokenInput.value = "";
        setStatus(
          discardedPending
            ? "前日の未同期分を破棄しました"
            : "正解数を同期しました"
        );
        return true;
      } catch (error) {
        syncReady = previousSyncReady;
        syncSettingsError.textContent = `${syncErrorMessage(error)}.`;
        return false;
      } finally {
        syncInProgress = false;
        syncPromise = null;
        syncSettingsSaveButton.disabled = false;
        syncSettingsCancelButton.disabled = false;
        syncTokenInput.disabled = false;
        updateSyncDependentControls();
      }
    })();

    return syncPromise;
  }

  async function initializeSync() {
    renderCount();
    updateStartButton();

    if (!userscriptAPIAvailable()) {
      setStatus("ユーザースクリプトの同期APIを利用できません");
      return;
    }

    try {
      const storedToken = await GM.getValue(SYNC_TOKEN_KEY, "");
      const storedPending = await GM.getValue(PENDING_CORRECT_KEY, null);

      if (typeof storedToken !== "string") {
        await GM.deleteValue(SYNC_TOKEN_KEY);
        syncToken = "";
      } else {
        syncToken = storedToken.trim();
      }

      if (storedPending !== null && !isPendingCorrect(storedPending)) {
        await GM.deleteValue(PENDING_CORRECT_KEY);
        pendingCorrect = null;
        setStatus("不正な未同期データを削除しました");
      } else {
        pendingCorrect = storedPending;
      }

      if (!syncToken) {
        syncReady = false;
        setStatus("同期トークンを設定してください");
        openSyncSettings(true);
        updateSyncDependentControls();
        return;
      }

      await refreshRemoteCount();
    } catch {
      syncReady = false;
      setStatus("同期設定を読み込めません");
      updateSyncDependentControls();
    }
  }

  function handlePageResume() {
    if (
      document.visibilityState === "visible" &&
      syncToken &&
      !nextQuestionOperationInProgress &&
      syncSettings.hidden
    ) {
      void refreshRemoteCount();
    }
  }

  function stopSpeech() {
    speechRunId += 1;
    activeUtterance = null;
    if (speechSupported) {
      speech.cancel();
    }
    stopButton.style.display = "none";

    if (speechEnabled) {
      setStatus("待機中");
    }
  }

  function normalizeText(rawText) {
    return rawText
      .replace(/\u00a0/g, " ")
      .split(/\r?\n/)
      .map((line) => line.replace(/[ \t]+/g, " ").trim())
      .filter(Boolean)
      .join("。")
      .replace(/。{2,}/g, "。")
      .trim();
  }

  function getVisibleLines() {
    if (!frameDocument?.body) {
      return [];
    }

    return visibleStructuredText(frameDocument.body)
      .replace(/\u00a0/g, " ")
      .split(/\r?\n/)
      .map((line) => line.replace(/[ \t]+/g, " ").trim())
      .filter(Boolean);
  }

  function compactLine(line) {
    return line.replace(/\s+/g, "").trim();
  }

  function normalizeInlineText(rawText) {
    return rawText
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function findFirstIndex(lines, startIndex, predicate) {
    for (let index = startIndex; index < lines.length; index += 1) {
      if (predicate(lines[index], index)) {
        return index;
      }
    }

    return -1;
  }

  // BEGIN QUESTION EXTRACTION
  const QUESTION_META_PATTERN =
    /^中小企業診断士試験\s*.+?(?:問|第)\s*\d+/;
  const ANSWER_CHOICE_SELECTOR =
    "input[type='radio'], input[type='checkbox'], [role='radio']";
  const BLOCK_TAG_NAMES = new Set([
    "ADDRESS",
    "ARTICLE",
    "ASIDE",
    "BLOCKQUOTE",
    "DD",
    "DIV",
    "DL",
    "DT",
    "FIELDSET",
    "FIGCAPTION",
    "FIGURE",
    "FOOTER",
    "FORM",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "HEADER",
    "HR",
    "LEGEND",
    "LI",
    "MAIN",
    "NAV",
    "OL",
    "P",
    "PRE",
    "SECTION",
    "TABLE",
    "TBODY",
    "TD",
    "TFOOT",
    "TH",
    "THEAD",
    "TR",
    "UL",
  ]);
  const CONTROL_BREAK_TAG_NAMES = new Set([
    "A",
    "BUTTON",
    "INPUT",
    "SELECT",
    "TEXTAREA",
  ]);


  function isVisibleElement(element) {
    const view = element.ownerDocument.defaultView;
    const style = view?.getComputedStyle(element);

    if (style?.display === "none" || style?.visibility === "hidden") {
      return false;
    }

    return element.getClientRects().length > 0;
  }

  function elementDepth(element) {
    let depth = 0;
    let current = element;

    while (current.parentElement) {
      depth += 1;
      current = current.parentElement;
    }

    return depth;
  }

  function findQuestionMetadataElement(documentNode) {
    const candidates = [];
    const checkedElements = new Set();
    const NodeFilterConstructor = documentNode.defaultView.NodeFilter;
    const walker = documentNode.createTreeWalker(
      documentNode.body,
      NodeFilterConstructor.SHOW_TEXT
    );
