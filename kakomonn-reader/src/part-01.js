  document.documentElement.appendChild(style);

  const shell = document.createElement("div");
  shell.id = "kakomonn-reader-shell";
  shell.dataset.buildFingerprint = BUILD_FINGERPRINT;
  shell.dataset.scriptHandler = SCRIPT_HANDLER;

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
  stopButton.setAttribute(
    "aria-label",
    "読み上げを停止,ショートカットはs"
  );
  stopButton.setAttribute("aria-keyshortcuts", "s");
  stopButton.title = "ショートカット: s";

  const syncSettingsButton = document.createElement("button");
  syncSettingsButton.id = "kakomonn-reader-sync-settings-button";
  syncSettingsButton.type = "button";
  syncSettingsButton.textContent = "同期設定";
  syncSettingsButton.setAttribute("aria-label", "学習記録の同期設定を開く");

  controls.append(statusBadge, countBadge, stopButton, syncSettingsButton);

  const nextQuestionButton = document.createElement("button");
  nextQuestionButton.id = "kakomonn-reader-next";
  nextQuestionButton.type = "button";
  nextQuestionButton.textContent = "次の問題へ";
  nextQuestionButton.setAttribute("aria-label", "次の問題へ移動");
  nextQuestionButton.setAttribute("aria-keyshortcuts", "Enter");
  nextQuestionButton.disabled = true;

  const copyButton = document.createElement("button");
  copyButton.id = "kakomonn-reader-copy";
  copyButton.type = "button";
  copyButton.textContent = "回答後にコピー";
  copyButton.setAttribute(
    "aria-label",
    "問題文,自分の回答,解説をMarkdownでコピー,ショートカットはyy"
  );
  copyButton.title = "ショートカット: yy";
  copyButton.disabled = true;

  const actions = document.createElement("div");
  actions.id = "kakomonn-reader-actions";
  actions.append(copyButton, nextQuestionButton);

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
  syncSettingsTitle.textContent = "学習記録の同期設定";

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
    actions,
    syncSettings
  );

  function renderCount() {
    const nextMilestone =
      correctCount === null
        ? MILESTONE_INTERVAL
        :
          (Math.floor(correctCount / MILESTONE_INTERVAL) + 1) *
          MILESTONE_INTERVAL;
    countBadge.textContent = `${correctCount === null ? "--" : correctCount}問,次は${nextMilestone}問`;
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
      typeof GM.xmlHttpRequest === "function" &&
      clipboardAPIAvailable()
    );
  }

  function clipboardAPIAvailable() {
    return typeof GM === "object" && typeof GM.setClipboard === "function";
  }

  function isSyncState(value) {
    return (
      value !== null &&
      typeof value === "object" &&
      /^\d{4}-\d{2}-\d{2}$/.test(value.date) &&
      value.counts !== null &&
      typeof value.counts === "object" &&
      Number.isSafeInteger(value.counts.correct) &&
      value.counts.correct >= 0 &&
      (value.counts.answered === null ||
        (Number.isSafeInteger(value.counts.answered) &&
          value.counts.answered >= value.counts.correct)) &&
      value.milestoneInterval === MILESTONE_INTERVAL
    );
  }

  function isAnswerResponse(value) {
    return (
      value !== null &&
      typeof value === "object" &&
      isSyncState(value.state) &&
      (value.completedMilestone === null ||
        (Number.isSafeInteger(value.completedMilestone) &&
          value.completedMilestone > 0 &&
          value.completedMilestone % MILESTONE_INTERVAL === 0 &&
          value.completedMilestone <= value.state.counts.correct))
    );
  }

  function isSpeechTokenResponse(value) {
    return (
      value !== null &&
      typeof value === "object" &&
      typeof value.token === "string" &&
      value.token.length > 0 &&
      value.token.length <= 8192 &&
      !/\s/.test(value.token) &&
      value.expiresInSeconds === 600
    );
  }

  function isLegacyPendingCorrect(value) {
    return (
      value !== null &&
      typeof value === "object" &&
      /^[0-9a-f]{32}$/.test(value.operationId) &&
      /^\d{4}-\d{2}-\d{2}$/.test(value.date) &&
      typeof value.pageURL === "string" &&
      value.pageURL.startsWith("https://chushoks.kakomonn.com/")
    );
  }

  function isPendingAnswer(value) {
    return (
      isLegacyPendingCorrect(value) &&
      (value.result === "correct" || value.result === "incorrect")
    );
  }

  function isPendingCelebration(value) {
    return (
      value !== null &&
      typeof value === "object" &&
      /^\d{4}-\d{2}-\d{2}$/.test(value.date) &&
      Number.isSafeInteger(value.milestone) &&
      value.milestone > 0 &&
      value.milestone % MILESTONE_INTERVAL === 0 &&
      typeof value.sourcePageURL === "string" &&
      value.sourcePageURL.startsWith("https://chushoks.kakomonn.com/")
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
    let abortRequest = () => {};
    let rejectRequest = () => {};
    const promise = new Promise((resolve, reject) => {
      let settled = false;
      let timeoutTimer = null;
      const settleOnce = (callback) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutTimer !== null) {
          window.clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
        callback();
      };
      const resolveOnce = (response) => {
        settleOnce(() => resolve(response));
      };
      const rejectOnce = (code) => {
        settleOnce(() => reject(new SyncRequestError(code)));
      };
      rejectRequest = rejectOnce;

      timeoutTimer = window.setTimeout(() => {
        rejectOnce("request_timeout");
        abortRequest();
      }, details.timeout ?? SYNC_TIMEOUT_MS);

      try {
        const request = GM.xmlHttpRequest({
          ...details,
          timeout: details.timeout ?? SYNC_TIMEOUT_MS,
          onload: resolveOnce,
          onerror: () => rejectOnce("network_error"),
          onabort: () => rejectOnce("request_aborted"),
          ontimeout: () => rejectOnce("request_timeout"),
        });
        if (typeof request?.abort === "function") {
          abortRequest = () => request.abort();
        }
        if (typeof request?.catch === "function") {
          request.catch(() => rejectOnce("network_error"));
        }
      } catch {
        rejectOnce("network_error");
      }
    });
    promise.abort = () => {
      rejectRequest("request_aborted");
      abortRequest();
    };
    return promise;
  }

  async function requestSyncResponse(
    method,
    path,
    token,
    validator,
    body = null
  ) {
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
      if (!validator(responseBody)) {
        throw new SyncRequestError("invalid_response", response.status);
      }
      return responseBody;
    }

    if (
      response.status === 409 &&
      responseBody?.error === "date_changed" &&
      isSyncState(responseBody.state)
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

  function requestSyncState(token) {
    return requestSyncResponse(
      "GET",
      "/v2/state",
      token,
      isSyncState
    );
  }

  function requestAnswerResult(token, operation) {
    return requestSyncResponse(
      "POST",
      "/v2/answers",
      token,
      isAnswerResponse,
      operation
    );
  }

  function requestSpeechTokenResult(token) {
    return requestSyncResponse(
      "POST",
      "/v2/speech-token",
      token,
      isSpeechTokenResponse
    );
  }

  function clearAzureSpeechToken() {
    azureSpeechToken = "";
    azureSpeechTokenExpiresAt = 0;
  }

  function getAzureSpeechToken() {
    if (
      azureSpeechToken &&
      Date.now() + SPEECH_TOKEN_RENEWAL_SKEW_MS < azureSpeechTokenExpiresAt
    ) {
      return Promise.resolve(azureSpeechToken);
    }
    if (azureSpeechTokenPromise !== null) {
      return azureSpeechTokenPromise;
    }

    clearAzureSpeechToken();
    azureSpeechTokenPromise = requestSpeechTokenResult(syncToken)
      .then((result) => {
        azureSpeechToken = result.token;
        azureSpeechTokenExpiresAt =
          Date.now() + result.expiresInSeconds * 1000;
        return azureSpeechToken;
      })
      .finally(() => {
        azureSpeechTokenPromise = null;
      });
    return azureSpeechTokenPromise;
  }

  function syncErrorMessage(error) {
    if (error?.code === "unauthorized") {
      return "同期トークンが正しくありません";
    }
    if (error?.code === "request_timeout") {
      return "学習記録の同期がタイムアウトしました";
    }
    if (error?.code === "invalid_response") {
      return "同期APIの応答が不正です";
    }
    if (error?.code === "server_misconfigured") {
      return "同期APIが設定されていません";
    }
    return "学習記録を同期できません";
  }

  function applyRemoteState(state) {
    if (!isSyncState(state)) {
      throw new SyncRequestError("invalid_response");
    }

    activeCountDate = state.date;
    correctCount = state.counts.correct;
    renderCount();
  }

  function updateSyncDependentControls() {
    syncSettingsButton.disabled =
      syncInProgress || nextQuestionOperationInProgress;
    updateNextQuestionButton();
    updateCopyButton();
  }

  async function clearPendingAnswer() {
    await GM.deleteValue(PENDING_ANSWER_KEY);
    pendingAnswer = null;
  }

  async function clearPendingCelebration() {
    await GM.deleteValue(PENDING_CELEBRATION_KEY);
    pendingCelebration = null;
  }

  async function reconcilePendingDates() {
    let discarded = false;
    if (pendingAnswer !== null && pendingAnswer.date !== activeCountDate) {
      await clearPendingAnswer();
      discarded = true;
    }
    if (
      pendingCelebration !== null &&
      pendingCelebration.date !== activeCountDate
    ) {
      await clearPendingCelebration();
      discarded = true;
    }
    return discarded;
  }

  function openSyncSettings(required = false) {
    if (syncInProgress || nextQuestionOperationInProgress) {
      return;
    }

    clearYankSequence();
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

  async function refreshRemoteState() {
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
      setStatus("学習記録を同期中");
      updateSyncDependentControls();

      try {
        const state = await requestSyncState(syncToken);
        applyRemoteState(state);
        syncReady = true;

        if (await reconcilePendingDates()) {
          setStatus("前日の未同期分を破棄しました");
        } else if (pendingAnswer !== null) {
          setStatus("未完了の解答同期があります");
        } else if (pendingCelebration !== null) {
          setStatus(`${pendingCelebration.milestone}問達成.祝福を準備中`);
        } else {
          setStatus("待機中");
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
        void maybeContinuePendingCelebration();
        processCurrentPageSpeech();
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
        const state = await requestSyncState(candidateToken);
        activeCountDate = state.date;
        const discardedPending = await reconcilePendingDates();
        await GM.setValue(SYNC_TOKEN_KEY, candidateToken);

        syncToken = candidateToken;
        clearAzureSpeechToken();
        applyRemoteState(state);
        syncReady = true;
        syncSettings.dataset.required = "false";
        syncSettings.hidden = true;
        syncTokenInput.value = "";
        setStatus(
          discardedPending
            ? "前日の未同期分を破棄しました"
            : "学習記録を同期しました"
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
        void maybeContinuePendingCelebration();
        processCurrentPageSpeech();
      }
    })();

    return syncPromise;
  }

  function samePendingOperation(answer, legacyCorrect) {
    return (
      answer.result === "correct" &&
      answer.operationId === legacyCorrect.operationId &&
      answer.date === legacyCorrect.date &&
      answer.pageURL === legacyCorrect.pageURL
    );
  }

  async function restorePendingAnswer(storedAnswer, storedLegacyCorrect) {
    let answer = storedAnswer;
    let legacyCorrect = storedLegacyCorrect;
    let discardedInvalid = false;

    if (answer !== null && !isPendingAnswer(answer)) {
      await GM.deleteValue(PENDING_ANSWER_KEY);
      answer = null;
      discardedInvalid = true;
    }
    if (legacyCorrect !== null && !isLegacyPendingCorrect(legacyCorrect)) {
      await GM.deleteValue(LEGACY_PENDING_CORRECT_KEY);
      legacyCorrect = null;
      discardedInvalid = true;
    }

    if (answer !== null && legacyCorrect !== null) {
      if (!samePendingOperation(answer, legacyCorrect)) {
        throw new Error("conflicting pending answer data");
      }
      await GM.deleteValue(LEGACY_PENDING_CORRECT_KEY);
      legacyCorrect = null;
    }

    if (answer === null && legacyCorrect !== null) {
      answer = { ...legacyCorrect, result: "correct" };
      if (!isPendingAnswer(answer)) {
        throw new Error("invalid migrated pending answer");
      }
      await GM.setValue(PENDING_ANSWER_KEY, answer);
      await GM.deleteValue(LEGACY_PENDING_CORRECT_KEY);
    }

    pendingAnswer = answer;
    return discardedInvalid;
  }

  async function initializeSync() {
    renderCount();
    updateSyncDependentControls();

    if (!userscriptAPIAvailable()) {
      setStatus("ユーザースクリプトAPIを利用できません");
      return;
    }

    try {
      const [
        storedToken,
        storedPendingAnswer,
        storedLegacyCorrect,
        storedCelebration,
      ] =
        await Promise.all([
          GM.getValue(SYNC_TOKEN_KEY, ""),
          GM.getValue(PENDING_ANSWER_KEY, null),
          GM.getValue(LEGACY_PENDING_CORRECT_KEY, null),
          GM.getValue(PENDING_CELEBRATION_KEY, null),
        ]);

      if (typeof storedToken !== "string") {
        await GM.deleteValue(SYNC_TOKEN_KEY);
        syncToken = "";
        clearAzureSpeechToken();
      } else {
        syncToken = storedToken.trim();
        clearAzureSpeechToken();
      }

      if (
        await restorePendingAnswer(storedPendingAnswer, storedLegacyCorrect)
      ) {
        setStatus("不正な未同期データを削除しました");
      }

      if (
        storedCelebration !== null &&
        !isPendingCelebration(storedCelebration)
      ) {
        await GM.deleteValue(PENDING_CELEBRATION_KEY);
        pendingCelebration = null;
        setStatus("不正な祝福データを削除しました");
      } else {
        pendingCelebration = storedCelebration;
      }

      if (!syncToken) {
        syncReady = false;
        setStatus("同期トークンを設定してください");
        openSyncSettings(true);
        updateSyncDependentControls();
        return;
      }

      await refreshRemoteState();
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
      void refreshRemoteState();
    }
  }

  function stopSpeech() {
    if (speechInitializationInProgress) {
      speechInitializationInProgress = false;
      speechEnabled = false;
    }
    speechRunId += 1;
    cancelActiveSpeech();
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
