import { reportCopyFailure } from "./copy-failure-report.js";

export function installCopyController(app) {
  const CLIPBOARD_WRITE_TIMEOUT_MS = 5000;
  let automaticCopyOperation = null;
  let latestAutomaticCopyOperationId = null;

  function selectedAnswerIsReady() {
    const controls = app.currentQuestionControls();
    return (
      controls !== null &&
      controls.answerChoiceControls.filter(app.isSelectedAnswerChoice).length === 1
    );
  }

  function beginAutomaticCopyFromGesture() {
    const questionId = app.currentQuestionId();
    if (
      questionId === null ||
      app.getCurrentAnswerResult() !== "unknown" ||
      !selectedAnswerIsReady()
    ) {
      return null;
    }
    if (app.answerCopyOperation?.questionId === questionId) {
      return app.answerCopyOperation.operationId;
    }

    if (app.answerCopyOperation?.rejectMarkdown !== undefined) {
      app.answerCopyOperation.rejectMarkdown(new Error("answer copy operation was replaced"));
    }

    const operation = {
      operationId: app.createOperationId(),
      questionId,
      resolveMarkdown: null,
      rejectMarkdown: null,
      writePromise: null,
    };
    if (app.isIPhoneSafari) {
      try {
        if (
          typeof navigator.clipboard !== "object" ||
          navigator.clipboard === null ||
          typeof navigator.clipboard.write !== "function" ||
          typeof ClipboardItem !== "function"
        ) {
          throw new Error("Clipboard.write API is unavailable");
        }
        const markdownPromise = new Promise((resolve, reject) => {
          operation.resolveMarkdown = resolve;
          operation.rejectMarkdown = reject;
        });
        const clipboardItem = new ClipboardItem({
          "text/plain": markdownPromise.then(
            (markdown) => new Blob([markdown], { type: "text/plain" }),
          ),
        });
        operation.writePromise = navigator.clipboard.write([clipboardItem]);
        void operation.writePromise.catch(() => {});
      } catch (error) {
        operation.writePromise = Promise.reject(error);
        void operation.writePromise.catch(() => {});
      }
    }
    app.answerCopyOperation = operation;
    return operation.operationId;
  }

  function discardAnswerCopyOperation() {
    if (typeof app.answerCopyOperation?.rejectMarkdown === "function") {
      app.answerCopyOperation.rejectMarkdown(new Error("answer copy operation was cancelled"));
    }
    app.answerCopyOperation = null;
  }

  async function writeMarkdownToClipboard(markdown, retryFromGesture) {
    if (!app.isIPhoneSafari) {
      const copied = await GM.setClipboard(markdown);
      if (copied === false) {
        throw new Error("clipboard write was rejected");
      }
      return;
    }

    if (retryFromGesture) {
      if (
        typeof navigator.clipboard !== "object" ||
        navigator.clipboard === null ||
        typeof navigator.clipboard.write !== "function" ||
        typeof ClipboardItem !== "function"
      ) {
        throw new Error("Clipboard.write API is unavailable");
      }
      const clipboardItem = new ClipboardItem({
        "text/plain": new Blob([markdown], { type: "text/plain" }),
      });
      await navigator.clipboard.write([clipboardItem]);
      return;
    }

    const operation = app.answerCopyOperation;
    if (
      operation === null ||
      operation.operationId !== app.pendingAttempt?.operationId ||
      operation.writePromise === null
    ) {
      throw new Error("clipboard write was not started by the answer gesture");
    }
    operation.resolveMarkdown?.(markdown);
    operation.resolveMarkdown = null;
    operation.rejectMarkdown = null;
    await operation.writePromise;
  }

  async function failAutomaticCopy(operationId, questionId, reason) {
    void reportCopyFailure(app, questionId, reason);
    if (app.pendingAttempt?.operationId !== operationId) {
      return true;
    }
    try {
      await app.updatePendingAttempt(operationId, (current) => ({
        ...current,
        copy: { state: "not-required" },
      }));
    } catch (error) {
      showCopyStorageError(error);
      return false;
    }
    void app.maybePreparePendingDestination();
    return true;
  }

  function showCopyContentError() {
    const operation = app.pendingAttempt;
    return operation === null
      ? Promise.resolve(false)
      : failAutomaticCopy(operation.operationId, operation.questionId, "markdown_unavailable");
  }

  function clipboardWriteWithTimeout(writePromise) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (callback, value) => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeout);
        callback(value);
      };
      const timeout = window.setTimeout(() => {
        const error = new Error("clipboard write timed out");
        error.code = "clipboard_write_timeout";
        settle(reject, error);
      }, CLIPBOARD_WRITE_TIMEOUT_MS);
      Promise.resolve(writePromise).then(
        (value) => settle(resolve, value),
        (error) => settle(reject, error),
      );
    });
  }

  async function retryMarkdownCopy(markdown) {
    try {
      await clipboardWriteWithTimeout(writeMarkdownToClipboard(markdown, true));
      return true;
    } catch (error) {
      showClipboardWriteError(error, markdown);
      return false;
    }
  }

  function showClipboardWriteError(error, markdown) {
    const retryAction = app.isIPhoneSafari
      ? () => retryMarkdownCopy(markdown)
      : retryPendingCopy;
    app.showReaderError(
      "clipboard-write",
      "クリップボードへコピーできません",
      "BrowserまたはUserscript managerのclipboard権限を確認してください.",
      error,
      { label: "コピーを再試行", run: retryAction },
    );
  }

  function showCopyStorageError(error) {
    app.showReaderError(
      "copy-storage",
      "Markdownを保存できません",
      "Userscript storageへコピー待ちのMarkdownを保存できませんでした.",
      error,
      { label: "コピーを再試行", run: retryPendingCopy },
    );
  }

  async function completeClipboardWrite(operationId, questionId, markdown, writePromise) {
    try {
      await clipboardWriteWithTimeout(writePromise);
      if (
        app.pendingAttempt?.operationId === operationId &&
        app.pendingAttempt.copy.state === "ready"
      ) {
        try {
          await app.updatePendingAttempt(operationId, (current) => ({
            ...current,
            copy: { state: "completed" },
          }));
        } catch (error) {
          if (app.pendingAttempt?.operationId === operationId) {
            showCopyStorageError(error);
            return false;
          }
        }
      }
      if (app.answerCopyOperation?.operationId === operationId) {
        discardAnswerCopyOperation();
      }
      if (
        latestAutomaticCopyOperationId === operationId ||
        app.pendingAttempt?.operationId === operationId
      ) {
        await app.maybePreparePendingDestination();
      }
      return true;
    } catch (error) {
      const reason = error?.code === "clipboard_write_timeout"
        ? "clipboard_write_timeout"
        : "clipboard_write_failed";
      return failAutomaticCopy(operationId, questionId, reason);
    } finally {
      if (automaticCopyOperation?.operationId === operationId) {
        automaticCopyOperation = null;
      }
      app.updateSyncDependentControls();
    }
  }

  function processPendingAutomaticCopy(retryFromGesture = false) {
    if (
      app.pendingAttempt === null ||
      !["required", "ready"].includes(app.pendingAttempt.copy.state)
    ) {
      return Promise.resolve(app.pendingAttempt?.copy.state === "completed");
    }

    const operationId = app.pendingAttempt.operationId;
    const questionId = app.pendingAttempt.questionId;
    if (automaticCopyOperation?.operationId === operationId) {
      return automaticCopyOperation.dispatchPromise;
    }
    latestAutomaticCopyOperationId = operationId;

    const dispatchPromise = (async () => {
      let markdown = app.pendingAttempt.copy.markdown ?? "";
      if (app.pendingAttempt.copy.state === "required") {
        let copyDocument;
        try {
          copyDocument = app.buildCopyMarkdown(app.frameDocument);
        } catch {
          return failAutomaticCopy(operationId, questionId, "markdown_unavailable");
        }
        if (copyDocument.state === "locked") {
          return false;
        }
        if (copyDocument.state !== "ready") {
          return failAutomaticCopy(operationId, questionId, "markdown_unavailable");
        }
        markdown = copyDocument.markdown;
        try {
          await app.updatePendingAttempt(operationId, (current) => ({
            ...current,
            copy: { state: "ready", markdown },
          }));
        } catch (error) {
          showCopyStorageError(error);
          return false;
        }
      }

      const writePromise = writeMarkdownToClipboard(markdown, retryFromGesture);
      void writePromise.catch(() => {});
      if (app.isIPhoneSafari) {
        const completionPromise = completeClipboardWrite(operationId, questionId, markdown, writePromise);
        void completionPromise;
        void app.maybePreparePendingDestination();
        return true;
      }

      return completeClipboardWrite(operationId, questionId, markdown, writePromise);
    })();
    automaticCopyOperation = {
      dispatchPromise,
      operationId,
    };
    void dispatchPromise.then((dispatched) => {
      if (!dispatched && automaticCopyOperation?.operationId === operationId) {
        automaticCopyOperation = null;
        app.updateSyncDependentControls();
      }
    });
    return dispatchPromise;
  }

  function retryPendingCopy() {
    return processPendingAutomaticCopy(true);
  }

  Object.defineProperties(app, {
    selectedAnswerIsReady: { enumerable: false, get: () => selectedAnswerIsReady },
    beginAutomaticCopyFromGesture: { enumerable: false, get: () => beginAutomaticCopyFromGesture },
    discardAnswerCopyOperation: { enumerable: false, get: () => discardAnswerCopyOperation },
    writeMarkdownToClipboard: { enumerable: false, get: () => writeMarkdownToClipboard },
    showCopyContentError: { enumerable: false, get: () => showCopyContentError },
    showClipboardWriteError: { enumerable: false, get: () => showClipboardWriteError },
    showCopyStorageError: { enumerable: false, get: () => showCopyStorageError },
    processPendingAutomaticCopy: { enumerable: false, get: () => processPendingAutomaticCopy },
    retryPendingCopy: { enumerable: false, get: () => retryPendingCopy },
  });
}
