export function createCatalogLoader({
  fetchConcurrency,
  siteId,
  SyncRequestError,
  timeoutMs,
}) {
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
      while (activeCount < fetchConcurrency && queue.length > 0) {
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
    const workerCount = Math.min(fetchConcurrency, items.length);
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
      return url.origin === `https://${siteId}` ? url : null;
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
    };
  
    consumePage(await loadPage(1));
    for (
      let firstPage = 2;
      firstPage <= totalPages;
      firstPage += fetchConcurrency
    ) {
      const lastPage = Math.min(
        totalPages,
        firstPage + fetchConcurrency - 1
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
    };
  }
  
  async function loadCatalogLists(loadCatalogDocument) {
    const createURL = `https://${siteId}/createques`;
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
  
  async function loadCompleteQuestionCatalog() {
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      timeoutMs
    );
    const loadCatalogDocument = createCatalogDocumentLoader(controller.signal);
    try {
      const snapshot = await loadQuestionCatalogSnapshot(loadCatalogDocument);
  
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

  return Object.freeze({ loadCompleteQuestionCatalog });
}
