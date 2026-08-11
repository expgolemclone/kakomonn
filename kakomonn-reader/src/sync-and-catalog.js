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
    const validCatalog =
      value?.catalog === null ||
      (value?.catalog !== null &&
        typeof value?.catalog === "object" &&
        Number.isSafeInteger(value.catalog.questionCount) &&
        value.catalog.questionCount > 0 &&
        Number.isSafeInteger(value.catalog.updatedAtMs) &&
        value.catalog.updatedAtMs > 0 &&
        Number.isSafeInteger(value.catalog.generation) &&
        value.catalog.generation > 0);
    return (
      value !== null &&
      typeof value === "object" &&
      value.site === SITE_ID &&
      /^\d{4}-\d{2}-\d{2}$/.test(value.today) &&
      Number.isSafeInteger(value.mastered) &&
      value.mastered >= 0 &&
      Number.isSafeInteger(value.todayDelta) &&
      validCatalog
    );
  }

  function isAttemptResponse(value) {
    return (
      value !== null &&
      typeof value === "object" &&
      value.attempt !== null &&
      typeof value.attempt === "object" &&
      /^\d+$/.test(value.attempt.questionId) &&
      (value.attempt.result === "correct" || value.attempt.result === "incorrect") &&
      Number.isFinite(value.attempt.previousStability) &&
      value.attempt.previousStability >= 0 &&
      Number.isFinite(value.attempt.stability) &&
      value.attempt.stability >= 0 &&
      [-1, 0, 1].includes(value.attempt.masteryDelta) &&
      value.totals !== null &&
      typeof value.totals === "object" &&
      Number.isSafeInteger(value.totals.mastered) &&
      value.totals.mastered >= 0 &&
      (value.completedMilestone === null ||
        (Number.isSafeInteger(value.completedMilestone) &&
          value.completedMilestone > 0 &&
          value.completedMilestone % MILESTONE_INTERVAL === 0))
    );
  }

  function isNextResponse(value) {
    if (value === null || typeof value !== "object") {
      return false;
    }
    if (value.question === null) {
      return true;
    }
    if (typeof value.question !== "object") {
      return false;
    }
    const questionId = value.question.questionId;
    if (!/^\d+$/.test(questionId)) {
      return false;
    }
    try {
      const url = new URL(value.question.url);
      return (
        url.origin === `https://${SITE_ID}` &&
        url.pathname === `/questions/${questionId}` &&
        url.search === "" &&
        url.hash === "" &&
        (value.question.kind === "review" || value.question.kind === "new") &&
        (value.question.dueMs === null || Number.isSafeInteger(value.question.dueMs))
      );
    } catch {
      return false;
    }
  }

  function isCatalogResponse(value) {
    return (
      value !== null &&
      typeof value === "object" &&
      value.site === SITE_ID &&
      Number.isSafeInteger(value.questionCount) &&
      value.questionCount > 0 &&
      Number.isSafeInteger(value.updatedAtMs) &&
      value.updatedAtMs > 0 &&
      Number.isSafeInteger(value.generation) &&
      value.generation > 0
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

  function isSitePageURL(value) {
    try {
      const url = new URL(value);
      return (
        url.origin === `https://${SITE_ID}` &&
        url.username === "" &&
        url.password === ""
      );
    } catch {
      return false;
    }
  }

  function extractQuestionIdFromURL(value) {
    try {
      const url = new URL(value);
      if (
        url.origin !== `https://${SITE_ID}` ||
        url.search !== "" ||
        url.hash !== ""
      ) {
        return null;
      }
      const match = url.pathname.match(/^\/questions\/(?:next\/)?(\d+)$/);
      return match?.[1] ?? null;
    } catch {
      return null;
    }
  }

  function isPendingAnswer(value) {
    if (
      value === null ||
      typeof value !== "object" ||
      value.site !== SITE_ID ||
      !/^[0-9a-f]{32}$/.test(value.operationId) ||
      !/^\d+$/.test(value.questionId) ||
      (value.result !== "correct" && value.result !== "incorrect") ||
      !isSitePageURL(value.pageURL) ||
      extractQuestionIdFromURL(value.pageURL) !== value.questionId ||
      (value.phase !== "queued" && value.phase !== "awaiting_navigation")
    ) {
      return false;
    }
    if (value.phase === "queued") {
      return value.nextURL === undefined;
    }
    return typeof value.nextURL === "string" && isScheduledQuestionURL(value.nextURL);
  }

  function isPendingCelebration(value) {
    return (
      value !== null &&
      typeof value === "object" &&
      value.site === SITE_ID &&
      Number.isSafeInteger(value.milestone) &&
      value.milestone > 0 &&
      value.milestone % MILESTONE_INTERVAL === 0 &&
      typeof value.sourcePageURL === "string" &&
      isSitePageURL(value.sourcePageURL)
    );
  }

  function isScheduledQuestionURL(value) {
    try {
      const url = new URL(value);
      return (
        url.origin === `https://${SITE_ID}` &&
        /^\/questions\/\d+$/.test(url.pathname) &&
        url.search === "" &&
        url.hash === ""
      );
    } catch {
      return false;
    }
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
      const resolveOnce = (response) => settleOnce(() => resolve(response));
      const rejectOnce = (code) =>
        settleOnce(() => reject(new SyncRequestError(code)));
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

  async function requestSyncResponse(method, path, token, validator, body = null) {
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
    throw new SyncRequestError(
      typeof responseBody?.error === "string" ? responseBody.error : "request_failed",
      response.status
    );
  }

  function requestSyncState(token) {
    const parameters = new URLSearchParams({ site: SITE_ID });
    return requestSyncResponse("GET", `/v4/state?${parameters}`, token, isSyncState);
  }

  function requestAttemptResult(token, operation) {
    return requestSyncResponse(
      "POST",
      "/v4/attempts",
      token,
      isAttemptResponse,
      {
        site: operation.site,
        questionId: operation.questionId,
        operationId: operation.operationId,
        result: operation.result,
      }
    );
  }

  function requestNextQuestion(token, excludeQuestionId = null) {
    const parameters = new URLSearchParams({ site: SITE_ID });
    if (excludeQuestionId !== null) {
      parameters.set("excludeQuestionId", excludeQuestionId);
    }
    return requestSyncResponse("GET", `/v4/next?${parameters}`, token, isNextResponse);
  }

  function requestCatalogUpdate(token, questionIds, expectedGeneration) {
    return requestSyncResponse("POST", "/v4/questions", token, isCatalogResponse, {
      site: SITE_ID,
      questionIds,
      expectedGeneration,
    });
  }

  function requestSpeechTokenResult(token) {
    return requestSyncResponse("POST", "/v4/speech-token", token, isSpeechTokenResponse);
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
        azureSpeechTokenExpiresAt = Date.now() + result.expiresInSeconds * 1000;
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
    if (error?.code === "catalog_missing" || error?.code === "catalog_error") {
      return "問題一覧を同期できません";
    }
    if (error?.code === "unknown_question") {
      return "現在の問題が問題一覧にありません";
    }
    if (error?.code === "operation_conflict") {
      return "解答記録のoperationIdが競合しました";
    }
    return "学習記録を同期できません";
  }

  function applyRemoteState(state) {
    if (!isSyncState(state)) {
      throw new SyncRequestError("invalid_response");
    }
    masteredCount = state.mastered;
    renderCount();
  }

  function updateSyncDependentControls() {
    syncSettingsButton.disabled = syncInProgress || nextQuestionOperationInProgress;
    updateNextQuestionButton();
    updateCopyButton();
    synchronizeTimeLimitPhase();
  }

  async function clearPendingAnswer() {
    await GM.deleteValue(PENDING_ANSWER_KEY);
    pendingAnswer = null;
  }

  async function markPendingAnswerAwaitingNavigation(operation, nextURL) {
    if (
      pendingAnswer === null ||
      pendingAnswer.operationId !== operation.operationId ||
      !isScheduledQuestionURL(nextURL)
    ) {
      throw new Error("pending answer changed");
    }
    const completed = { ...operation, phase: "awaiting_navigation", nextURL };
    if (!isPendingAnswer(completed)) {
      throw new Error("invalid completed answer");
    }
    await GM.setValue(PENDING_ANSWER_KEY, completed);
    pendingAnswer = completed;
  }

  async function clearPendingCelebration() {
    await GM.deleteValue(PENDING_CELEBRATION_KEY);
    pendingCelebration = null;
  }

  function openSyncSettings(required = false) {
    if (syncInProgress || nextQuestionOperationInProgress) {
      return;
    }
    clearShortcutSequence();
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

  async function fetchCatalogDocument(url) {
    let response;
    try {
      response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
    } catch {
      throw new SyncRequestError("catalog_error");
    }
    if (!response.ok) {
      throw new SyncRequestError("catalog_error", response.status);
    }
    const text = await response.text();
    const documentNode = new DOMParser().parseFromString(text, "text/html");
    if (documentNode.querySelector("parsererror") !== null) {
      throw new SyncRequestError("catalog_error");
    }
    return documentNode;
  }

  function strictSameOriginURL(href, baseURL) {
    try {
      const url = new URL(href, baseURL);
      return url.origin === `https://${SITE_ID}` ? url : null;
    } catch {
      return null;
    }
  }

  function collectQuestionIds(documentNode, pageURL) {
    const ids = new Set();
    for (const link of documentNode.querySelectorAll("a[href]")) {
      const url = strictSameOriginURL(link.getAttribute("href"), pageURL);
      const match = url?.pathname.match(/^\/questions\/(\d+)$/);
      if (match && url.search === "" && url.hash === "") {
        if (ids.has(match[1])) {
          throw new SyncRequestError("catalog_error");
        }
        ids.add(match[1]);
      }
    }
    return ids;
  }

  function catalogPagePosition(documentNode) {
    const bodyText = documentNode.body?.textContent ?? "";
    const bodyMatch = bodyText.match(/全(\d+)ページ中(\d+)ページ目です[。.]/);
    const titleMatch = documentNode.title.match(/[（(](\d+)\/(\d+)[）)]/);
    let currentPage = null;
    let totalPages = null;

    if (bodyMatch !== null) {
      totalPages = Number(bodyMatch[1]);
      currentPage = Number(bodyMatch[2]);
    }
    if (titleMatch !== null) {
      const titleCurrentPage = Number(titleMatch[1]);
      const titleTotalPages = Number(titleMatch[2]);
      if (
        currentPage !== null &&
        (currentPage !== titleCurrentPage || totalPages !== titleTotalPages)
      ) {
        throw new SyncRequestError("catalog_error");
      }
      currentPage = titleCurrentPage;
      totalPages = titleTotalPages;
    }
    if (
      !Number.isSafeInteger(currentPage) ||
      !Number.isSafeInteger(totalPages) ||
      currentPage < 1 ||
      totalPages < 1 ||
      currentPage > totalPages ||
      totalPages > 1000
    ) {
      throw new SyncRequestError("catalog_error");
    }
    return { currentPage, totalPages };
  }

  function collectCatalogListURLs(documentNode, pageURL, listURLs) {
    for (const link of documentNode.querySelectorAll("a[href]")) {
      const url = strictSameOriginURL(link.getAttribute("href"), pageURL);
      if (url && /^\/list1\/\d+$/.test(url.pathname)) {
        url.search = "";
        url.hash = "";
        listURLs.set(url.pathname, url.href);
      }
    }
  }

  function findCatalogIndexURL(documentNode, pageURL) {
    for (const link of documentNode.querySelectorAll("a[href]")) {
      const url = strictSameOriginURL(link.getAttribute("href"), pageURL);
      if (url?.pathname === "/list" && url.search === "" && url.hash === "") {
        return url.href;
      }
    }
    return null;
  }

  async function loadCatalogListSnapshot(listURL) {
    const questionIds = new Set();
    let totalPages = null;
    let fullPageSize = null;

    for (let page = 1; totalPages === null || page <= totalPages; page += 1) {
      const pageURL = new URL(listURL);
      pageURL.searchParams.set("page", String(page));
      const pageDocument = await fetchCatalogDocument(pageURL.href);
      const position = catalogPagePosition(pageDocument);
      if (position.currentPage !== page) {
        throw new SyncRequestError("catalog_error");
      }
      if (totalPages === null) {
        totalPages = position.totalPages;
      } else if (position.totalPages !== totalPages) {
        throw new SyncRequestError("catalog_error");
      }

      const pageIds = collectQuestionIds(pageDocument, pageURL.href);
      if (pageIds.size === 0) {
        throw new SyncRequestError("catalog_error");
      }
      if (page === 1 && totalPages > 1) {
        fullPageSize = pageIds.size;
      } else if (page < totalPages && pageIds.size !== fullPageSize) {
        throw new SyncRequestError("catalog_error");
      } else if (page === totalPages && fullPageSize !== null && pageIds.size > fullPageSize) {
        throw new SyncRequestError("catalog_error");
      }
      for (const id of pageIds) {
        if (questionIds.has(id)) {
          throw new SyncRequestError("catalog_error");
        }
        questionIds.add(id);
      }
    }

    return {
      totalPages,
      questionIds: [...questionIds].sort((left, right) => Number(left) - Number(right)),
    };
  }

  async function loadQuestionCatalogSnapshot() {
    const createURL = `https://${SITE_ID}/createques`;
    const createDocument = await fetchCatalogDocument(createURL);
    const catalogIndexURL = findCatalogIndexURL(createDocument, createURL);
    if (catalogIndexURL === null) {
      throw new SyncRequestError("catalog_error");
    }

    const listURLs = new Map();
    collectCatalogListURLs(createDocument, createURL, listURLs);
    const catalogIndexDocument = await fetchCatalogDocument(catalogIndexURL);
    collectCatalogListURLs(catalogIndexDocument, catalogIndexURL, listURLs);
    if (listURLs.size === 0) {
      throw new SyncRequestError("catalog_error");
    }

    const lists = new Map();
    const sortedLists = [...listURLs.entries()].sort(([left], [right]) => left.localeCompare(right));
    for (const [listPath, listURL] of sortedLists) {
      lists.set(listPath, await loadCatalogListSnapshot(listURL));
    }
    return lists;
  }

  function sameCatalogSnapshot(left, right) {
    if (left.size !== right.size) {
      return false;
    }
    for (const [listPath, leftSnapshot] of left) {
      const rightSnapshot = right.get(listPath);
      if (
        rightSnapshot === undefined ||
        leftSnapshot.totalPages !== rightSnapshot.totalPages ||
        leftSnapshot.questionIds.length !== rightSnapshot.questionIds.length ||
        leftSnapshot.questionIds.some((id, index) => id !== rightSnapshot.questionIds[index])
      ) {
        return false;
      }
    }
    return true;
  }

  async function loadCompleteQuestionCatalog() {
    const firstSnapshot = await loadQuestionCatalogSnapshot();
    const secondSnapshot = await loadQuestionCatalogSnapshot();
    if (!sameCatalogSnapshot(firstSnapshot, secondSnapshot)) {
      throw new SyncRequestError("catalog_error");
    }

    const questionIds = new Set();
    for (const { questionIds: listQuestionIds } of secondSnapshot.values()) {
      for (const id of listQuestionIds) {
        questionIds.add(id);
      }
    }
    if (questionIds.size === 0) {
      throw new SyncRequestError("catalog_error");
    }
    return [...questionIds].sort((left, right) => Number(left) - Number(right));
  }

  async function ensureQuestionCatalog(token, state) {
    const maxAgeMs = 24 * 60 * 60 * 1000;
    if (
      state.catalog !== null &&
      Date.now() - state.catalog.updatedAtMs >= 0 &&
      Date.now() - state.catalog.updatedAtMs < maxAgeMs
    ) {
      return state;
    }
    setStatus("問題一覧を同期中");
    const questionIds = await loadCompleteQuestionCatalog();
    const expectedGeneration = state.catalog?.generation ?? 0;
    try {
      await requestCatalogUpdate(token, questionIds, expectedGeneration);
    } catch (error) {
      if (error?.code !== "catalog_conflict") {
        throw error;
      }
      const currentState = await requestSyncState(token);
      if (
        currentState.catalog === null ||
        Date.now() - currentState.catalog.updatedAtMs < 0 ||
        Date.now() - currentState.catalog.updatedAtMs >= maxAgeMs
      ) {
        throw new SyncRequestError("catalog_error");
      }
      return currentState;
    }
    return requestSyncState(token);
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
        let state = await requestSyncState(syncToken);
        state = await ensureQuestionCatalog(syncToken, state);
        applyRemoteState(state);
        syncReady = true;
        if (pendingAnswer !== null) {
          setStatus("未完了の解答同期があります");
        } else if (pendingCelebration !== null) {
          setStatus(`${pendingCelebration.milestone}問定着.祝福を準備中`);
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
        void maybeContinuePendingAnswerNavigation();
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
        let state = await requestSyncState(candidateToken);
        state = await ensureQuestionCatalog(candidateToken, state);
        await GM.setValue(SYNC_TOKEN_KEY, candidateToken);
        syncToken = candidateToken;
        clearAzureSpeechToken();
        applyRemoteState(state);
        syncReady = true;
        syncSettings.dataset.required = "false";
        syncSettings.hidden = true;
        syncTokenInput.value = "";
        setStatus("学習記録を同期しました");
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
        void maybeContinuePendingAnswerNavigation();
        void maybeContinuePendingCelebration();
        processCurrentPageSpeech();
      }
    })();
    return syncPromise;
  }

  async function restorePendingState(storedAnswer, storedCelebration) {
    if (storedAnswer !== null && !isPendingAnswer(storedAnswer)) {
      await GM.deleteValue(PENDING_ANSWER_KEY);
      pendingAnswer = null;
    } else {
      pendingAnswer = storedAnswer;
    }
    if (storedCelebration !== null && !isPendingCelebration(storedCelebration)) {
      await GM.deleteValue(PENDING_CELEBRATION_KEY);
      pendingCelebration = null;
    } else {
      pendingCelebration = storedCelebration;
    }
  }

  async function initializeSync() {
    renderCount();
    updateSyncDependentControls();
    if (!userscriptAPIAvailable()) {
      setStatus("ユーザースクリプトAPIを利用できません");
      return;
    }
    try {
      const [storedToken, storedPendingAnswer, storedCelebration] = await Promise.all([
        GM.getValue(SYNC_TOKEN_KEY, ""),
        GM.getValue(PENDING_ANSWER_KEY, null),
        GM.getValue(PENDING_CELEBRATION_KEY, null),
      ]);
      if (typeof storedToken !== "string") {
        await GM.deleteValue(SYNC_TOKEN_KEY);
        syncToken = "";
      } else {
        syncToken = storedToken.trim();
      }
      clearAzureSpeechToken();
      await restorePendingState(storedPendingAnswer, storedCelebration);
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
    synchronizeTimeLimitPhase();
    if (
      document.visibilityState === "visible" &&
      syncToken &&
      pendingAnswer === null &&
      pendingCelebration === null &&
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

    if (speechEnabled) {
      setStatus("待機中");
    }
  }

