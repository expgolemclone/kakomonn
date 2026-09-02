  function isLearningMetrics(metrics) {
    return (
      metrics !== null &&
      typeof metrics === "object" &&
      Number.isSafeInteger(metrics.stabilityDays) &&
      metrics.stabilityDays >= 0 &&
      typeof metrics.dailyKpiCompleted === "boolean" &&
      typeof metrics.dueCardsCompleted === "boolean" &&
      Number.isSafeInteger(metrics.dueCardsRemaining) &&
      metrics.dueCardsRemaining >= 0 &&
      metrics.dueCardsCompleted === (metrics.dueCardsRemaining === 0) &&
      Number.isSafeInteger(metrics.todayNewQuestionCount) &&
      metrics.todayNewQuestionCount >= 0 &&
      metrics.newQuestionGoal === 100 &&
      Number.isSafeInteger(metrics.newQuestionsRemaining) &&
      metrics.newQuestionsRemaining ===
        Math.max(0, metrics.newQuestionGoal - metrics.todayNewQuestionCount) &&
      metrics.dailyKpiCompleted ===
        (metrics.dueCardsCompleted && metrics.newQuestionsRemaining === 0) &&
      Number.isSafeInteger(metrics.todayStabilityDaysDelta) &&
      Number.isSafeInteger(metrics.attemptedQuestionCount) &&
      metrics.attemptedQuestionCount >= 0 &&
      Number.isSafeInteger(metrics.todayAttemptedQuestionCount) &&
      metrics.todayAttemptedQuestionCount >= 0 &&
      (metrics.todayCorrectRatePercent === null ||
        (Number.isSafeInteger(metrics.todayCorrectRatePercent) &&
          metrics.todayCorrectRatePercent >= 0 &&
          metrics.todayCorrectRatePercent <= 100))
    );
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
    const validLearningMetrics = isLearningMetrics(value?.learningMetrics);
    return (
      value !== null &&
      typeof value === "object" &&
      value.site === SITE_ID &&
      /^\d{4}-\d{2}-\d{2}$/.test(value.today) &&
      validLearningMetrics &&
      validCatalog
    );
  }

  function isAttemptResponse(value) {
    const metrics = value?.learningMetrics;
    const validCelebration =
      value?.celebration === undefined || isCelebration(value.celebration);
    return (
      value !== null &&
      typeof value === "object" &&
      value.attempt !== null &&
      typeof value.attempt === "object" &&
      /^\d+$/.test(value.attempt.questionId) &&
      (value.attempt.answerResult === "correct" ||
        value.attempt.answerResult === "incorrect") &&
      Number.isSafeInteger(value.attempt.attemptedAtMs) &&
      value.attempt.attemptedAtMs > 0 &&
      Number.isFinite(value.attempt.previousCardStabilityDays) &&
      value.attempt.previousCardStabilityDays >= 0 &&
      Number.isFinite(value.attempt.resultingCardStabilityDays) &&
      value.attempt.resultingCardStabilityDays >= 0 &&
      Number.isSafeInteger(value.attempt.previousStabilityDays) &&
      value.attempt.previousStabilityDays >= 0 &&
      Number.isSafeInteger(value.attempt.resultingStabilityDays) &&
      value.attempt.resultingStabilityDays >= 0 &&
      isLearningMetrics(metrics) &&
      isNextQuestion(value.nextQuestion) &&
      validCelebration
    );
  }

  function isCalendarDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) &&
      date.toISOString().slice(0, 10) === value;
  }

  function isCelebration(value) {
    return (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join(",") ===
        "dailyKpiCompleted,date,site" &&
      value.site === SITE_ID &&
      isCalendarDate(value.date) &&
      value.dailyKpiCompleted === true
    );
  }

  function isNextQuestion(question) {
    if (question === null) {
      return true;
    }
    if (typeof question !== "object") {
      return false;
    }
    const questionId = question.questionId;
    if (!/^\d+$/.test(questionId)) {
      return false;
    }
    try {
      const url = new URL(question.url);
      return (
        url.origin === `https://${SITE_ID}` &&
        url.pathname === `/questions/${questionId}` &&
        url.search === "" &&
        url.hash === "" &&
        (question.kind === "review" || question.kind === "new") &&
        (question.dueMs === null || Number.isSafeInteger(question.dueMs))
      );
    } catch {
      return false;
    }
  }

  function isNextResponse(value) {
    return (
      value !== null &&
      typeof value === "object" &&
      isNextQuestion(value.question)
    );
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

  function isAttemptCopyState(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const keys = Object.keys(value).sort().join(",");
    if (value.state === "ready") {
      return (
        keys === "markdown,state" &&
        typeof value.markdown === "string" &&
        value.markdown.length > 0
      );
    }
    return (
      keys === "state" &&
      ["required", "completed", "not-required"].includes(value.state)
    );
  }

  function isPendingAttempt(value) {
    if (
      value === null ||
      typeof value !== "object" ||
      value.site !== SITE_ID ||
      !/^[0-9a-f]{32}$/.test(value.operationId) ||
      !/^\d+$/.test(value.questionId) ||
      (value.answerResult !== "correct" && value.answerResult !== "incorrect") ||
      !isSitePageURL(value.pageURL) ||
      extractQuestionIdFromURL(value.pageURL) !== value.questionId ||
      (value.phase !== "queued" && value.phase !== "recorded") ||
      !isAttemptCopyState(value.copy)
    ) {
      return false;
    }
    if (value.phase === "queued") {
      return (
        value.nextURL === undefined &&
        value.kpiQuestionsRemaining === undefined
      );
    }
    const validNextURL =
      value.nextURL === null ||
      (typeof value.nextURL === "string" &&
        isScheduledQuestionURL(value.nextURL));
    const validKpiQuestionsRemaining =
      value.answerResult === "correct"
        ? Number.isSafeInteger(value.kpiQuestionsRemaining) &&
          value.kpiQuestionsRemaining >= 0
        : value.kpiQuestionsRemaining === undefined;
    return validNextURL && validKpiQuestionsRemaining;
  }

  function isPendingCelebration(value) {
    return isCelebration(value);
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
    return requestSyncResponse("GET", `/v9/state?${parameters}`, token, isSyncState);
  }

  function requestAttemptResult(token, operation) {
    return requestSyncResponse(
      "POST",
      "/v9/attempts",
      token,
      isAttemptResponse,
      {
        site: operation.site,
        questionId: operation.questionId,
        operationId: operation.operationId,
        answerResult: operation.answerResult,
      }
    );
  }

  function requestNextQuestion(token, excludeQuestionId = null) {
    const parameters = new URLSearchParams({ site: SITE_ID });
    if (excludeQuestionId !== null) {
      parameters.set("excludeQuestionId", excludeQuestionId);
    }
    return requestSyncResponse("GET", `/v9/next?${parameters}`, token, isNextResponse);
  }

  function requestCatalogUpdate(token, questionIds, expectedGeneration) {
    return requestSyncResponse("POST", "/v9/questions", token, isCatalogResponse, {
      site: SITE_ID,
      questionIds,
      expectedGeneration,
    });
  }

  function requestSpeechTokenResult(token) {
    return requestSyncResponse("POST", "/v9/speech-token", token, isSpeechTokenResponse);
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
    if (error?.code === "catalog_timeout") {
      return "問題一覧の同期がタイムアウトしました";
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

  function updateSyncDependentControls() {
    shell.setAttribute(
      "aria-busy",
      String(syncInProgress || nextQuestionOperationInProgress)
    );
    synchronizeTimeLimitPhase();
  }

  let pendingAttemptStoragePromise = Promise.resolve();

  function updatePendingAttempt(operationId, update) {
    const task = pendingAttemptStoragePromise.then(async () => {
      if (
        pendingAttempt === null ||
        pendingAttempt.operationId !== operationId
      ) {
        throw new Error("pending attempt changed");
      }
      const updated = update(pendingAttempt);
      if (!isPendingAttempt(updated)) {
        throw new Error("invalid pending attempt");
      }
      await GM.setValue(PENDING_ATTEMPT_KEY, updated);
      pendingAttempt = updated;
      return updated;
    });
    pendingAttemptStoragePromise = task.catch(() => {});
    return task;
  }

  async function clearPendingAttempt() {
    const task = pendingAttemptStoragePromise.then(async () => {
      await GM.deleteValue(PENDING_ATTEMPT_KEY);
      pendingAttempt = null;
    });
    pendingAttemptStoragePromise = task.catch(() => {});
    return task;
  }

  async function savePendingCelebration(celebration) {
    if (!isPendingCelebration(celebration)) {
      throw new Error("invalid pending celebration");
    }
    await GM.setValue(PENDING_CELEBRATION_KEY, celebration);
    pendingCelebration = celebration;
  }

  async function clearPendingCelebration() {
    await GM.deleteValue(PENDING_CELEBRATION_KEY);
    pendingCelebration = null;
  }

  async function markPendingAttemptRecorded(
    operation,
    nextURL,
    kpiQuestionsRemaining
  ) {
    if (
      pendingAttempt === null ||
      pendingAttempt.operationId !== operation.operationId ||
      (nextURL !== null && !isScheduledQuestionURL(nextURL)) ||
      (operation.answerResult === "correct" &&
        (!Number.isSafeInteger(kpiQuestionsRemaining) ||
          kpiQuestionsRemaining < 0)) ||
      (operation.answerResult === "incorrect" &&
        kpiQuestionsRemaining !== undefined)
    ) {
      throw new Error("pending attempt changed");
    }
    const updated = await updatePendingAttempt(
      operation.operationId,
      (current) => ({
        ...current,
        phase: "recorded",
        nextURL,
        ...(operation.answerResult === "correct"
          ? { kpiQuestionsRemaining }
          : {}),
      })
    );
    if (updated.answerResult === "correct") {
      resolveCorrectFeedbackKpi(
        updated.questionId,
        updated.kpiQuestionsRemaining
      );
    }
  }

  function openSyncSettings() {
    if (syncInProgress || nextQuestionOperationInProgress) {
      return;
    }
    clearShortcutSequence();
    syncTokenInput.value = "";
    syncSettingsError.textContent = "";
    if (errorDialog.open) {
      errorDialog.close();
    }
    if (!syncSettings.open) {
      syncSettings.showModal();
    }
    window.setTimeout(() => syncTokenInput.focus(), 0);
  }

  async function fetchCatalogDocument(url, signal) {
    let response;
    let text;
    try {
      response = await fetch(url, {
        credentials: "same-origin",
        cache: "no-store",
        signal,
      });
      if (!response.ok) {
        throw new SyncRequestError("catalog_error", response.status);
      }
      text = await response.text();
    } catch (error) {
      if (signal.aborted) {
        throw new SyncRequestError("catalog_timeout");
      }
      if (error instanceof SyncRequestError) {
        throw error;
      }
      throw new SyncRequestError("catalog_error");
    }
    const documentNode = new DOMParser().parseFromString(text, "text/html");
    if (documentNode.querySelector("parsererror") !== null) {
      throw new SyncRequestError("catalog_error");
    }
    return documentNode;
  }

  function createCatalogDocumentLoader(signal) {
    let activeCount = 0;
    const queue = [];

    const startNext = () => {
      while (activeCount < CATALOG_FETCH_CONCURRENCY && queue.length > 0) {
        const task = queue.shift();
        if (signal.aborted) {
          task.reject(new SyncRequestError("catalog_timeout"));
          continue;
        }
        activeCount += 1;
        void fetchCatalogDocument(task.url, signal)
          .then(task.resolve, task.reject)
          .finally(() => {
            activeCount -= 1;
            startNext();
          });
      }
    };

    return (url) =>
      new Promise((resolve, reject) => {
        queue.push({ url, resolve, reject });
        startNext();
      });
  }

  async function mapCatalogConcurrently(items, mapper) {
    const results = new Array(items.length);
    let nextIndex = 0;
    const workerCount = Math.min(CATALOG_FETCH_CONCURRENCY, items.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index], index);
      }
    });
    await Promise.all(workers);
    return results;
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

  async function loadCatalogListSnapshot(listURL, loadCatalogDocument) {
    const questionIds = new Set();
    let totalPages = null;
    let fullPageSize = null;
    let firstPageQuestionIds = null;
    let lastPageQuestionIds = null;

    const loadPage = async (page) => {
      const pageURL = new URL(listURL);
      pageURL.searchParams.set("page", String(page));
      return {
        page,
        pageURL: pageURL.href,
        pageDocument: await loadCatalogDocument(pageURL.href),
      };
    };

    const consumePage = ({ page, pageURL, pageDocument }) => {
      const position = catalogPagePosition(pageDocument);
      if (position.currentPage !== page) {
        throw new SyncRequestError("catalog_error");
      }
      if (totalPages === null) {
        totalPages = position.totalPages;
      } else if (position.totalPages !== totalPages) {
        throw new SyncRequestError("catalog_error");
      }

      const pageIds = collectQuestionIds(pageDocument, pageURL);
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
      const sortedPageIds = [...pageIds].sort(
        (left, right) => Number(left) - Number(right)
      );
      if (page === 1) {
        firstPageQuestionIds = sortedPageIds;
      }
      if (page === totalPages) {
        lastPageQuestionIds = sortedPageIds;
      }
    };

    consumePage(await loadPage(1));
    for (
      let firstPage = 2;
      firstPage <= totalPages;
      firstPage += CATALOG_FETCH_CONCURRENCY
    ) {
      const lastPage = Math.min(
        totalPages,
        firstPage + CATALOG_FETCH_CONCURRENCY - 1
      );
      const pages = [];
      for (let page = firstPage; page <= lastPage; page += 1) {
        pages.push(page);
      }
      const pageResults = await Promise.all(pages.map(loadPage));
      for (const pageResult of pageResults) {
        consumePage(pageResult);
      }
    }

    return {
      totalPages,
      questionIds: [...questionIds].sort((left, right) => Number(left) - Number(right)),
      firstPageQuestionIds,
      lastPageQuestionIds,
    };
  }

  async function loadCatalogLists(loadCatalogDocument) {
    const createURL = `https://${SITE_ID}/createques`;
    const createDocument = await loadCatalogDocument(createURL);
    const catalogIndexURL = findCatalogIndexURL(createDocument, createURL);
    if (catalogIndexURL === null) {
      throw new SyncRequestError("catalog_error");
    }

    const listURLs = new Map();
    collectCatalogListURLs(createDocument, createURL, listURLs);
    const catalogIndexDocument = await loadCatalogDocument(catalogIndexURL);
    collectCatalogListURLs(catalogIndexDocument, catalogIndexURL, listURLs);
    if (listURLs.size === 0) {
      throw new SyncRequestError("catalog_error");
    }

    return [...listURLs.entries()].sort(([left], [right]) =>
      left.localeCompare(right)
    );
  }

  async function loadQuestionCatalogSnapshot(loadCatalogDocument) {
    const sortedLists = await loadCatalogLists(loadCatalogDocument);
    const snapshots = await mapCatalogConcurrently(
      sortedLists,
      async ([listPath, listURL]) => [
        listPath,
        await loadCatalogListSnapshot(listURL, loadCatalogDocument),
      ]
    );
    return new Map(snapshots);
  }

  function sameQuestionIds(left, right) {
    return (
      left.length === right.length &&
      left.every((id, index) => id === right[index])
    );
  }

  async function validateCatalogListSnapshot(
    listURL,
    snapshot,
    loadCatalogDocument
  ) {
    const loadBoundary = async (page) => {
      const pageURL = new URL(listURL);
      pageURL.searchParams.set("page", String(page));
      const pageDocument = await loadCatalogDocument(pageURL.href);
      const position = catalogPagePosition(pageDocument);
      if (
        position.currentPage !== page ||
        position.totalPages !== snapshot.totalPages
      ) {
        throw new SyncRequestError("catalog_error");
      }
      return [...collectQuestionIds(pageDocument, pageURL.href)].sort(
        (left, right) => Number(left) - Number(right)
      );
    };

    const [firstPageQuestionIds, lastPageQuestionIds] =
      snapshot.totalPages === 1
        ? await loadBoundary(1).then((ids) => [ids, ids])
        : await Promise.all([
            loadBoundary(1),
            loadBoundary(snapshot.totalPages),
          ]);
    const derivedQuestionCount =
      firstPageQuestionIds.length * (snapshot.totalPages - 1) +
      lastPageQuestionIds.length;
    if (
      derivedQuestionCount !== snapshot.questionIds.length ||
      !sameQuestionIds(firstPageQuestionIds, snapshot.firstPageQuestionIds) ||
      !sameQuestionIds(lastPageQuestionIds, snapshot.lastPageQuestionIds)
    ) {
      throw new SyncRequestError("catalog_error");
    }
  }

  async function validateQuestionCatalogSnapshot(
    snapshot,
    loadCatalogDocument
  ) {
    const sortedLists = await loadCatalogLists(loadCatalogDocument);
    if (sortedLists.length !== snapshot.size) {
      throw new SyncRequestError("catalog_error");
    }
    for (const [listPath] of sortedLists) {
      if (!snapshot.has(listPath)) {
        throw new SyncRequestError("catalog_error");
      }
    }
    await mapCatalogConcurrently(
      sortedLists,
      async ([listPath, listURL]) =>
        validateCatalogListSnapshot(
          listURL,
          snapshot.get(listPath),
          loadCatalogDocument
        )
    );
  }

  async function loadCompleteQuestionCatalog() {
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      CATALOG_TIMEOUT_MS
    );
    const loadCatalogDocument = createCatalogDocumentLoader(controller.signal);
    try {
      const snapshot = await loadQuestionCatalogSnapshot(loadCatalogDocument);
      await validateQuestionCatalogSnapshot(snapshot, loadCatalogDocument);

      const questionIds = new Set();
      for (const { questionIds: listQuestionIds } of snapshot.values()) {
        for (const id of listQuestionIds) {
          questionIds.add(id);
        }
      }
      if (questionIds.size === 0) {
        throw new SyncRequestError("catalog_error");
      }
      return [...questionIds].sort((left, right) => Number(left) - Number(right));
    } catch (error) {
      controller.abort();
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
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
    const questionIds = await loadCompleteQuestionCatalog();
    const expectedGeneration = state.catalog?.generation ?? 0;
    try {
      const catalog = await requestCatalogUpdate(
        token,
        questionIds,
        expectedGeneration
      );
      return { ...state, catalog };
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
      openSyncSettings();
      updateSyncDependentControls();
      return false;
    }
    syncPromise = (async () => {
      let failedError = null;
      syncInProgress = true;
      updateSyncDependentControls();
      try {
        let state = await requestSyncState(syncToken);
        state = await ensureQuestionCatalog(syncToken, state);
        syncReady = true;
        return true;
      } catch (error) {
        syncReady = false;
        failedError = error;
        return false;
      } finally {
        syncInProgress = false;
        syncPromise = null;
        updateSyncDependentControls();
        if (failedError?.code === "unauthorized") {
          openSyncSettings();
        } else if (failedError !== null) {
          showReaderError(
            "sync-refresh",
            "学習記録を同期できません",
            `${syncErrorMessage(failedError)}. 通信状態を確認して再試行してください.`,
            failedError,
            {
              label: "同期を再試行",
              run: refreshRemoteState,
            }
          );
        }
        void resumePendingLearningFlow();
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
    syncInProgress = true;
    syncSettingsSaveButton.disabled = true;
    syncTokenInput.disabled = true;
    syncSettingsError.textContent = "同期APIを確認中です.";
    updateSyncDependentControls();
    syncPromise = (async () => {
      try {
        let state = await requestSyncState(candidateToken);
        state = await ensureQuestionCatalog(candidateToken, state);
        const nextQuestionResult = shouldLaunchNextQuestionAfterSync
          ? await requestNextQuestion(candidateToken)
          : null;
        await GM.setValue(SYNC_TOKEN_KEY, candidateToken);
        syncToken = candidateToken;
        clearAzureSpeechToken();
        syncReady = true;
        syncSettings.close();
        syncTokenInput.value = "";
        if (nextQuestionResult?.question === null) {
          showNoNextQuestionLauncher();
        } else if (nextQuestionResult?.question !== undefined) {
          openScheduledQuestionInReader(nextQuestionResult.question.url);
        }
        return true;
      } catch (error) {
        syncReady = false;
        syncSettingsError.textContent =
          `${syncErrorMessage(error)}. ${readerErrorDetail(error, "sync-token")}`;
        return false;
      } finally {
        syncInProgress = false;
        syncPromise = null;
        syncSettingsSaveButton.disabled = false;
        syncTokenInput.disabled = false;
        updateSyncDependentControls();
        void resumePendingLearningFlow();
        processCurrentPageSpeech();
      }
    })();
    return syncPromise;
  }

  async function restorePendingState(storedAttempt, storedCelebration) {
    if (storedAttempt !== null && !isPendingAttempt(storedAttempt)) {
      await GM.deleteValue(PENDING_ATTEMPT_KEY);
      pendingAttempt = null;
    } else {
      pendingAttempt = storedAttempt;
      if (
        pendingAttempt?.phase === "recorded" &&
        pendingAttempt.answerResult === "correct"
      ) {
        resolveCorrectFeedbackKpi(
          pendingAttempt.questionId,
          pendingAttempt.kpiQuestionsRemaining
        );
      }
    }
    if (storedCelebration !== null && !isPendingCelebration(storedCelebration)) {
      await GM.deleteValue(PENDING_CELEBRATION_KEY);
      pendingCelebration = null;
    } else {
      pendingCelebration = storedCelebration;
    }
  }

  async function initializeSync() {
    updateSyncDependentControls();
    try {
      const [storedToken, storedPendingAttempt, storedCelebration] =
        await Promise.all([
          GM.getValue(SYNC_TOKEN_KEY, ""),
          GM.getValue(PENDING_ATTEMPT_KEY, null),
          GM.getValue(PENDING_CELEBRATION_KEY, null),
        ]);
      if (typeof storedToken !== "string") {
        await GM.deleteValue(SYNC_TOKEN_KEY);
        syncToken = "";
      } else {
        syncToken = storedToken.trim();
      }
      clearAzureSpeechToken();
      await restorePendingState(storedPendingAttempt, storedCelebration);
      if (!syncToken) {
        syncReady = false;
        openSyncSettings();
        updateSyncDependentControls();
        return;
      }
      await refreshRemoteState();
    } catch (error) {
      syncReady = false;
      showReaderError(
        "sync-storage",
        "同期設定を読み込めません",
        "Userscript storageを確認できませんでした. ページを再読み込みしてください.",
        error
      );
      updateSyncDependentControls();
    }
  }

  function handlePageResume() {
    synchronizeTimeLimitPhase();
    if (
      document.visibilityState === "visible" &&
      syncToken &&
      syncReady &&
      pendingAttempt === null &&
      pendingCelebration === null &&
      !nextQuestionOperationInProgress &&
      !syncSettings.open &&
      getCurrentAnswerResult() !== "unknown"
    ) {
      recordCurrentAnswerIfAvailable();
    }
  }

  function stopSpeech() {
    if (speechInitializationInProgress) {
      speechInitializationInProgress = false;
      speechEnabled = false;
      finishSpeechInitialization();
    }
    speechRunId += 1;
    cancelActiveSpeech();

  }
