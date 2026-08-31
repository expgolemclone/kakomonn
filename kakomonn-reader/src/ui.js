  const shell = document.createElement("div");
  shell.id = "kakomonn-reader-shell";
  shell.dataset.buildFingerprint = BUILD_FINGERPRINT;
  shell.dataset.scriptHandler = SCRIPT_HANDLER;

  const frame = document.createElement("iframe");
  frame.id = "kakomonn-reader-frame";
  frame.title = "過去問ページ";
  frame.allow = "autoplay";
  frame.src = currentFrameURL;
  function enforceReaderFrameDimensions() {
    frame.removeAttribute("height");
    frame.removeAttribute("width");
    if (
      frame.style.getPropertyValue("height") !== "100%" ||
      frame.style.getPropertyPriority("height") !== "important"
    ) {
      frame.style.setProperty("height", "100%", "important");
    }
    if (
      frame.style.getPropertyValue("width") !== "100%" ||
      frame.style.getPropertyPriority("width") !== "important"
    ) {
      frame.style.setProperty("width", "100%", "important");
    }
  }
  enforceReaderFrameDimensions();
  const readerFrameDimensionObserver = new MutationObserver(
    enforceReaderFrameDimensions
  );
  readerFrameDimensionObserver.observe(frame, {
    attributes: true,
    attributeFilter: ["height", "style", "width"],
  });

  const timeLimitProgress = document.createElement("progress");
  timeLimitProgress.id = "kakomonn-reader-time-limit";
  timeLimitProgress.max = TIME_LIMIT_MS;
  timeLimitProgress.value = TIME_LIMIT_MS;
  timeLimitProgress.hidden = true;
  timeLimitProgress.setAttribute("aria-label", "問題の制限時間");

  const carriedCorrectFeedback = document.createElement("div");
  carriedCorrectFeedback.id = "kakomonn-reader-carried-correct-feedback";
  carriedCorrectFeedback.className = "kakomonn-reader-correct-feedback";
  carriedCorrectFeedback.hidden = true;
  carriedCorrectFeedback.setAttribute("aria-hidden", "true");

  shell.append(frame, timeLimitProgress, carriedCorrectFeedback);
  let activeCorrectFeedbackElement = null;

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

  const syncSettings = document.createElement("dialog");
  syncSettings.id = "kakomonn-reader-sync-settings";
  syncSettings.setAttribute(
    "aria-labelledby",
    "kakomonn-reader-sync-settings-title"
  );
  syncSettings.setAttribute(
    "aria-describedby",
    "kakomonn-reader-sync-settings-description"
  );

  const syncSettingsPanel = document.createElement("form");
  syncSettingsPanel.id = "kakomonn-reader-sync-settings-panel";

  const syncSettingsTitle = document.createElement("h2");
  syncSettingsTitle.id = "kakomonn-reader-sync-settings-title";
  syncSettingsTitle.textContent = "学習記録へ接続";

  const syncSettingsDescription = document.createElement("p");
  syncSettingsDescription.id = "kakomonn-reader-sync-settings-description";
  syncSettingsDescription.textContent =
    "Win11とiPhoneに同じ同期トークンを入力してください.";

  const syncTokenLabel = document.createElement("label");
  syncTokenLabel.htmlFor = "kakomonn-reader-sync-token";
  syncTokenLabel.textContent = "同期トークン";

  const syncTokenInput = document.createElement("input");
  syncTokenInput.id = "kakomonn-reader-sync-token";
  syncTokenInput.type = "password";
  syncTokenInput.autocomplete = "off";
  syncTokenInput.spellcheck = false;
  syncTokenInput.required = true;

  const syncSettingsError = document.createElement("p");
  syncSettingsError.id = "kakomonn-reader-sync-settings-error";
  syncSettingsError.setAttribute("role", "alert");

  const syncSettingsSaveButton = document.createElement("button");
  syncSettingsSaveButton.id = "kakomonn-reader-sync-settings-save";
  syncSettingsSaveButton.type = "submit";
  syncSettingsSaveButton.textContent = "確認して保存";

  syncSettingsPanel.append(
    syncSettingsTitle,
    syncSettingsDescription,
    syncTokenLabel,
    syncTokenInput,
    syncSettingsError,
    syncSettingsSaveButton
  );
  syncSettings.appendChild(syncSettingsPanel);

  const errorDialog = document.createElement("dialog");
  errorDialog.id = "kakomonn-reader-error-dialog";
  errorDialog.setAttribute("aria-labelledby", "kakomonn-reader-error-title");
  errorDialog.setAttribute(
    "aria-describedby",
    "kakomonn-reader-error-message kakomonn-reader-error-detail"
  );

  const errorDialogPanel = document.createElement("form");
  errorDialogPanel.id = "kakomonn-reader-error-panel";
  errorDialogPanel.method = "dialog";

  const errorDialogEyebrow = document.createElement("p");
  errorDialogEyebrow.className = "kakomonn-reader-dialog-eyebrow";
  errorDialogEyebrow.textContent = "ERROR";

  const errorDialogTitle = document.createElement("h2");
  errorDialogTitle.id = "kakomonn-reader-error-title";

  const errorDialogMessage = document.createElement("p");
  errorDialogMessage.id = "kakomonn-reader-error-message";

  const errorDialogDetail = document.createElement("code");
  errorDialogDetail.id = "kakomonn-reader-error-detail";

  const errorDialogCloseButton = document.createElement("button");
  errorDialogCloseButton.id = "kakomonn-reader-error-close";
  errorDialogCloseButton.type = "submit";
  errorDialogCloseButton.value = "close";
  errorDialogCloseButton.textContent = "閉じる";
  errorDialogCloseButton.autofocus = true;

  errorDialogPanel.append(
    errorDialogEyebrow,
    errorDialogTitle,
    errorDialogMessage,
    errorDialogDetail,
    errorDialogCloseButton
  );
  errorDialog.appendChild(errorDialogPanel);
  let visibleReaderErrorSignature = "";

  function readerErrorDetail(error, context) {
    const details = [`context=${context}`];
    if (typeof error?.code === "string" && error.code !== "") {
      details.push(`code=${error.code}`);
    }
    if (Number.isSafeInteger(error?.status) && error.status > 0) {
      details.push(`status=${error.status}`);
    }
    if (
      typeof error?.message === "string" &&
      error.message !== "" &&
      error.message !== error.code
    ) {
      details.push(`detail=${error.message}`);
    }
    return details.join(" | ");
  }

  function showReaderError(context, title, message, error = null) {
    const detail = readerErrorDetail(error, context);
    const signature = `${title}\u0000${message}\u0000${detail}`;
    if (errorDialog.open && signature === visibleReaderErrorSignature) {
      return;
    }
    errorDialogTitle.textContent = title;
    errorDialogMessage.textContent = message;
    errorDialogDetail.textContent = detail;
    visibleReaderErrorSignature = signature;
    if (syncSettings.open) {
      return;
    }
    if (!errorDialog.open) {
      errorDialog.showModal();
    }
  }

  errorDialog.addEventListener("close", () => {
    visibleReaderErrorSignature = "";
  });

  function mountReaderUI() {
    document.body.dataset.kakomonnReaderUi = "true";
    if (
      shell.isConnected &&
      actions.isConnected &&
      syncSettings.isConnected &&
      errorDialog.isConnected
    ) {
      return;
    }
    document.body.replaceChildren(shell, actions, syncSettings, errorDialog);
  }

  function clearCorrectFeedbackRemovalTimer() {
    if (correctFeedbackRemovalTimer === null) {
      return;
    }
    window.clearTimeout(correctFeedbackRemovalTimer);
    correctFeedbackRemovalTimer = null;
  }

  function showCarriedCorrectFeedbackVisual(variant) {
    clearCorrectFeedbackRemovalTimer();
    renderCorrectFeedbackElement(carriedCorrectFeedback, variant);
    carriedCorrectFeedback.dataset.state = "entering";
    carriedCorrectFeedback.removeAttribute("style");
    if (variant.id !== "ssr") {
      const inset = 16;
      const width = Math.min(Math.max(0, shell.clientWidth - inset * 2), 672);
      carriedCorrectFeedback.style.left = `${Math.max(inset, (shell.clientWidth - width) / 2)}px`;
      carriedCorrectFeedback.style.top = `${inset}px`;
      carriedCorrectFeedback.style.width = `${width}px`;
    }
    carriedCorrectFeedback.hidden = false;
    activeCorrectFeedbackElement = carriedCorrectFeedback;
    return true;
  }

  function showCorrectFeedbackVisual(variant, sourceDocument = frameDocument) {
    if (
      sourceDocument?.body === undefined ||
      sourceDocument !== frameDocument
    ) {
      return showCarriedCorrectFeedbackVisual(variant);
    }

    const resultBox = sourceDocument.querySelector("#js-answer-result-box");
    if (resultBox === null) {
      return showCarriedCorrectFeedbackVisual(variant);
    }

    clearCorrectFeedbackRemovalTimer();
    renderCorrectFeedbackElement(carriedCorrectFeedback, variant);
    carriedCorrectFeedback.hidden = true;
    carriedCorrectFeedback.dataset.state = "entering";
    carriedCorrectFeedback.removeAttribute("style");

    let feedback = resultBox.querySelector(
      ":scope > .kakomonn-reader-correct-feedback"
    );
    if (feedback === null) {
      feedback = sourceDocument.createElement("div");
      feedback.className = "kakomonn-reader-correct-feedback";
      resultBox.appendChild(feedback);
    }
    renderCorrectFeedbackElement(feedback, variant);
    feedback.dataset.state = "entering";
    activeCorrectFeedbackElement = feedback;
    return true;
  }

  function handoffCorrectFeedbackVisual(sourceDocument = frameDocument) {
    if (
      correctFeedbackPromise === null ||
      activeCorrectFeedbackElement === null ||
      activeCorrectFeedbackElement.ownerDocument !== sourceDocument
    ) {
      return false;
    }

    const rarity = activeCorrectFeedbackElement.dataset.rarity;
    const rect = activeCorrectFeedbackElement.getBoundingClientRect();

    activeCorrectFeedbackElement.remove();
    carriedCorrectFeedback.removeAttribute("style");
    if (rarity !== "ssr") {
      const inset = 16;
      const availableWidth = Math.max(0, shell.clientWidth - inset * 2);
      const width = Math.min(availableWidth, Math.max(220, rect.width));
      const left = Math.min(
        Math.max(inset, rect.left + (rect.width - width) / 2),
        Math.max(inset, shell.clientWidth - width - inset)
      );
      const top = Math.min(
        Math.max(inset, rect.top),
        Math.max(inset, shell.clientHeight - rect.height - inset)
      );
      carriedCorrectFeedback.style.left = `${left}px`;
      carriedCorrectFeedback.style.top = `${top}px`;
      carriedCorrectFeedback.style.width = `${width}px`;
    }
    carriedCorrectFeedback.dataset.state = "carried";
    carriedCorrectFeedback.hidden = false;
    activeCorrectFeedbackElement = carriedCorrectFeedback;
    return true;
  }

  function completeCorrectFeedbackVisual() {
    const feedback = activeCorrectFeedbackElement;
    if (feedback === null) {
      return Promise.resolve();
    }

    clearCorrectFeedbackRemovalTimer();
    feedback.dataset.state = "leaving";
    return new Promise((resolve) => {
      correctFeedbackRemovalTimer = window.setTimeout(() => {
        correctFeedbackRemovalTimer = null;
        if (feedback === carriedCorrectFeedback) {
          feedback.hidden = true;
          feedback.removeAttribute("style");
        } else {
          feedback.remove();
        }
        if (activeCorrectFeedbackElement === feedback) {
          activeCorrectFeedbackElement = null;
        }
        resolve();
      }, CORRECT_FEEDBACK_LEAVE_DURATION_MS);
    });
  }
