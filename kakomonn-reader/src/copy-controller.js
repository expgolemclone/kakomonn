import { reportCopyFailure } from "./copy-failure-report.js";

export function installCopyController(app) {
  const COPY_TIMEOUT_MS = 5000;
  let automaticCopyOperation = null;

  function selectedAnswerIsReady() {
    const controls = app.currentQuestionControls();
    return controls !== null &&
      controls.answerChoiceControls.filter(app.isSelectedAnswerChoice).length === 1;
  }

  function beginAutomaticCopyFromGesture() {
    const questionId = app.currentQuestionId();
    if (questionId === null || app.getCurrentAnswerResult() !== "unknown" ||
        !selectedAnswerIsReady()) return null;
    if (app.answerCopyOperation?.questionId === questionId) {
      return app.answerCopyOperation.operationId;
    }
    discardAnswerCopyOperation();
    const operation = {
      operationId: app.createOperationId(), questionId,
      resolveMarkdown: null, rejectMarkdown: null, writePromise: null,
    };
    if (app.isIPhoneSafari) {
      try {
        if (typeof navigator.clipboard?.write !== "function" ||
            typeof ClipboardItem !== "function") {
          throw new Error("Clipboard.write API is unavailable");
        }
        const markdownPromise = new Promise((resolve, reject) => {
          operation.resolveMarkdown = resolve;
          operation.rejectMarkdown = reject;
        });
        const blobPromise = markdownPromise.then(
          (markdown) => new Blob([markdown], { type: "text/plain" }),
        );
        void blobPromise.catch(() => {});
        const item = new ClipboardItem({ "text/plain": blobPromise });
        operation.writePromise = Promise.resolve(navigator.clipboard.write([item]));
      } catch (error) {
        operation.writePromise = Promise.reject(error);
      }
      void operation.writePromise.catch(() => {});
    }
    app.answerCopyOperation = operation;
    return operation.operationId;
  }

  function discardAnswerCopyOperation() {
    app.answerCopyOperation?.rejectMarkdown?.(new Error("answer copy operation was cancelled"));
    app.answerCopyOperation = null;
  }

  async function writeMarkdownToClipboard(markdown, operationId) {
    if (!app.isIPhoneSafari) {
      if (await GM.setClipboard(markdown) === false) {
        throw new Error("clipboard write was rejected");
      }
      return;
    }
    const operation = app.answerCopyOperation;
    if (operation?.operationId !== operationId || operation.writePromise === null) {
      throw new Error("clipboard write was not started by the answer gesture");
    }
    operation.resolveMarkdown?.(markdown);
    operation.resolveMarkdown = null;
    operation.rejectMarkdown = null;
    await operation.writePromise;
  }

  function withCopyTimeout(promise) {
    let timeout;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = window.setTimeout(() => {
          const error = new Error("clipboard write timed out");
          error.code = "clipboard_write_timeout";
          reject(error);
        }, COPY_TIMEOUT_MS);
      }),
    ]).finally(() => window.clearTimeout(timeout));
  }

  function prepareMarkdown(documentNode) {
    return new Promise((resolve, reject) => {
      let observer = null;
      let timeout = null;
      const finish = (result, error = null) => {
        observer?.disconnect();
        if (timeout !== null) window.clearTimeout(timeout);
        if (error !== null) reject(error);
        else resolve(result);
      };
      const inspect = () => {
        try {
          const result = app.buildCopyMarkdown(documentNode);
          if (result.state !== "locked") finish(result);
          return result.state;
        } catch (error) {
          finish(null, error);
          return "failed";
        }
      };
      if (inspect() !== "locked") return;
      observer = new MutationObserver(inspect);
      observer.observe(documentNode.body, {
        subtree: true, childList: true, characterData: true, attributes: true,
      });
      timeout = window.setTimeout(() => finish({ state: "unavailable" }), COPY_TIMEOUT_MS);
    });
  }

  async function setCopyState(operationId, copy) {
    if (app.pendingAttempt?.operationId !== operationId) return;
    try {
      await app.updatePendingAttempt(operationId, (current) => ({ ...current, copy }));
    } catch (error) {
      if (app.pendingAttempt?.operationId !== operationId) return;
      // A failure to persist the answer operation is a storage error, not a clipboard error.
      app.showReaderError("attempt-storage", "解答記録を保存できません",
        "Userscript storageを確認し, ページを再読み込みしてください.", error);
      throw error;
    }
  }

  async function failAutomaticCopy(operationId, questionId, reason) {
    void reportCopyFailure(app, questionId, reason);
    if (app.answerCopyOperation?.operationId === operationId) discardAnswerCopyOperation();
    await setCopyState(operationId, { state: "failed" });
    void app.maybePreparePendingDestination();
    return true;
  }

  async function completeClipboardWrite(operationId, questionId, writePromise) {
    let reason = null;
    try {
      await withCopyTimeout(writePromise);
    } catch (error) {
      reason = error?.code === "clipboard_write_timeout"
        ? "clipboard_write_timeout" : "clipboard_write_failed";
    }
    try {
      if (reason !== null) return await failAutomaticCopy(operationId, questionId, reason);
      await setCopyState(operationId, { state: "completed" });
      if (app.answerCopyOperation?.operationId === operationId) discardAnswerCopyOperation();
      void app.maybePreparePendingDestination();
      return true;
    } finally {
      if (automaticCopyOperation?.operationId === operationId) automaticCopyOperation = null;
      app.updateSyncDependentControls();
    }
  }

  function processPendingAutomaticCopy() {
    const operation = app.pendingAttempt;
    if (operation === null || !["required", "ready"].includes(operation.copy.state)) {
      return Promise.resolve(["completed", "failed"].includes(operation?.copy.state));
    }
    const { operationId, questionId } = operation;
    if (automaticCopyOperation?.operationId === operationId) {
      return automaticCopyOperation.dispatchPromise;
    }
    const documentNode = app.frameDocument;
    const dispatchPromise = (async () => {
      let markdown = operation.copy.markdown;
      if (operation.copy.state === "required") {
        let copyDocument;
        try {
          copyDocument = await prepareMarkdown(documentNode);
        } catch {
          return failAutomaticCopy(operationId, questionId, "markdown_unavailable");
        }
        if (copyDocument.state !== "ready") {
          return failAutomaticCopy(operationId, questionId, "markdown_unavailable");
        }
        markdown = copyDocument.markdown;
        await setCopyState(operationId, { state: "ready", markdown });
      }
      if (app.pendingAttempt?.operationId !== operationId) return false;
      const completion = completeClipboardWrite(
        operationId, questionId, writeMarkdownToClipboard(markdown, operationId),
      );
      if (app.isIPhoneSafari) {
        void completion.catch(() => {});
        void app.maybePreparePendingDestination();
        return true;
      }
      return completion;
    })();
    automaticCopyOperation = { dispatchPromise, operationId };
    void dispatchPromise.catch(() => {
      if (automaticCopyOperation?.operationId === operationId) automaticCopyOperation = null;
    });
    return dispatchPromise.catch(() => false);
  }

  Object.defineProperties(app, {
    selectedAnswerIsReady: { enumerable: false, get: () => selectedAnswerIsReady },
    beginAutomaticCopyFromGesture: { enumerable: false, get: () => beginAutomaticCopyFromGesture },
    discardAnswerCopyOperation: { enumerable: false, get: () => discardAnswerCopyOperation },
    processPendingAutomaticCopy: { enumerable: false, get: () => processPendingAutomaticCopy },
  });
}
