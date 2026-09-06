export function installCopyController(app) {
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
      app.answerCopyOperation.rejectMarkdown(
        new Error("answer copy operation was replaced")
      );
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
            (markdown) => new Blob([markdown], { type: "text/plain" })
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
      app.answerCopyOperation.rejectMarkdown(
        new Error("answer copy operation was cancelled")
      );
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
  
  function showCopyContentError() {
    app.showReaderError(
      "markdown-content",
      "Markdownを作成できません",
      "問題文, 選択肢, 回答, 解説のいずれかを取得できませんでした.",
      { code: "copy_content_unavailable" },
      { label: "コピーを再試行", run: retryPendingCopy }
    );
  }
  
  function showClipboardWriteError(error) {
    app.showReaderError(
      "clipboard-write",
      "クリップボードへコピーできません",
      "BrowserまたはUserscript managerのclipboard権限を確認してください.",
      error,
      { label: "コピーを再試行", run: retryPendingCopy }
    );
  }
  
  function showCopyStorageError(error) {
    app.showReaderError(
      "copy-storage",
      "Markdownを保存できません",
      "Userscript storageへコピー待ちのMarkdownを保存できませんでした.",
      error,
      { label: "コピーを再試行", run: retryPendingCopy }
    );
  }
  
  async function processPendingAutomaticCopy(retryFromGesture = false) {
    if (app.automaticCopyPromise !== null) {
      return app.automaticCopyPromise;
    }
    if (
      app.pendingAttempt === null ||
      !["required", "ready"].includes(app.pendingAttempt.copy.state)
    ) {
      return app.pendingAttempt?.copy.state === "completed";
    }
  
    const operationId = app.pendingAttempt.operationId;
    app.automaticCopyPromise = (async () => {
      let markdown = app.pendingAttempt.copy.markdown ?? "";
      let gestureWritePromise = null;
      if (app.pendingAttempt.copy.state === "required") {
        const copyDocument = app.buildCopyMarkdown(app.frameDocument);
        if (copyDocument.state === "locked") {
          return false;
        }
        if (copyDocument.state !== "ready") {
          showCopyContentError();
          return false;
        }
        markdown = copyDocument.markdown;
        if (retryFromGesture && app.isIPhoneSafari) {
          gestureWritePromise = writeMarkdownToClipboard(markdown, true);
          void gestureWritePromise.catch(() => {});
        }
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
  
      try {
        await (
          gestureWritePromise ??
          writeMarkdownToClipboard(markdown, retryFromGesture)
        );
      } catch (error) {
        showClipboardWriteError(error);
        return false;
      }
  
      try {
        await app.updatePendingAttempt(operationId, (current) => ({
          ...current,
          copy: { state: "completed" },
        }));
      } catch (error) {
        showCopyStorageError(error);
        return false;
      }
      if (app.answerCopyOperation?.operationId === operationId) {
        discardAnswerCopyOperation();
      }
      await app.maybePreparePendingDestination();
      return true;
    })().finally(() => {
      app.automaticCopyPromise = null;
      app.updateSyncDependentControls();
    });
    return app.automaticCopyPromise;
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
