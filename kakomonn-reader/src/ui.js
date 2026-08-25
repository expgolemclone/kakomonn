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
  shell.appendChild(frame);

  const controls = document.createElement("div");
  controls.id = "kakomonn-reader-controls";

  const statusBadge = document.createElement("div");
  statusBadge.id = "kakomonn-reader-status";
  statusBadge.setAttribute("role", "status");
  statusBadge.setAttribute("aria-live", "polite");
  statusBadge.setAttribute("aria-atomic", "true");
  const statusText = document.createElement("span");
  statusText.textContent = "読込中";
  statusBadge.appendChild(statusText);

  const learningMetricsButton = document.createElement("button");
  learningMetricsButton.id = "kakomonn-reader-learning-metrics";
  learningMetricsButton.type = "button";
  learningMetricsButton.setAttribute("aria-expanded", "false");
  learningMetricsButton.setAttribute(
    "aria-controls",
    "kakomonn-reader-learning-metrics-details"
  );

  const learningMetricsLiveStatus = document.createElement("span");
  learningMetricsLiveStatus.id = "kakomonn-reader-learning-metrics-live-status";
  learningMetricsLiveStatus.className = "kakomonn-reader-visually-hidden";
  learningMetricsLiveStatus.setAttribute("role", "status");
  learningMetricsLiveStatus.setAttribute("aria-live", "polite");
  learningMetricsLiveStatus.setAttribute("aria-atomic", "true");

  const learningMetricsDetails = document.createElement("dl");
  learningMetricsDetails.id = "kakomonn-reader-learning-metrics-details";
  learningMetricsDetails.hidden = true;

  const dueCardsCompletedMetric = document.createElement("div");
  dueCardsCompletedMetric.className = "kakomonn-reader-detail-metric";
  const dueCardsCompletedLabel = document.createElement("dt");
  dueCardsCompletedLabel.textContent = "dueCardsCompleted";
  const dueCardsCompletedDefinition = document.createElement("dd");
  const dueCardsCompletedValue = document.createElement("strong");
  dueCardsCompletedValue.id = "kakomonn-reader-due-cards-completed";
  dueCardsCompletedDefinition.appendChild(dueCardsCompletedValue);
  dueCardsCompletedMetric.append(
    dueCardsCompletedLabel,
    dueCardsCompletedDefinition
  );

  const dueCardsRemainingMetric = document.createElement("div");
  dueCardsRemainingMetric.className = "kakomonn-reader-metric";
  const dueCardsRemainingLabel = document.createElement("span");
  dueCardsRemainingLabel.className = "kakomonn-reader-metric-label";
  dueCardsRemainingLabel.textContent = "dueCardsRemaining";
  const dueCardsRemainingValue = document.createElement("span");
  dueCardsRemainingValue.className = "kakomonn-reader-remaining-value";
  const dueCardsRemainingPrefix = document.createElement("small");
  dueCardsRemainingPrefix.textContent = "あと";
  const dueCardsRemainingNumber = document.createElement("strong");
  dueCardsRemainingNumber.id = "kakomonn-reader-due-cards-remaining";
  const dueCardsRemainingUnit = document.createElement("small");
  dueCardsRemainingUnit.textContent = "問";
  dueCardsRemainingValue.append(
    dueCardsRemainingPrefix,
    dueCardsRemainingNumber,
    dueCardsRemainingUnit
  );
  dueCardsRemainingMetric.append(
    dueCardsRemainingLabel,
    dueCardsRemainingValue
  );
  learningMetricsButton.appendChild(dueCardsRemainingMetric);

  const todayStabilityDaysDeltaMetric = document.createElement("div");
  todayStabilityDaysDeltaMetric.className = "kakomonn-reader-detail-metric";
  const todayStabilityDaysDeltaLabel = document.createElement("dt");
  todayStabilityDaysDeltaLabel.textContent = "todayStabilityDaysDelta";
  const todayStabilityDaysDeltaValue = document.createElement("dd");
  const todayStabilityDaysDeltaNumber = document.createElement("strong");
  todayStabilityDaysDeltaNumber.id =
    "kakomonn-reader-today-stability-days-delta";
  const todayStabilityDaysDeltaUnit = document.createElement("span");
  todayStabilityDaysDeltaUnit.textContent = "日";
  todayStabilityDaysDeltaValue.append(
    todayStabilityDaysDeltaNumber,
    todayStabilityDaysDeltaUnit
  );
  todayStabilityDaysDeltaMetric.append(
    todayStabilityDaysDeltaLabel,
    todayStabilityDaysDeltaValue
  );

  const todayAttemptedQuestionCountMetric = document.createElement("div");
  todayAttemptedQuestionCountMetric.className = "kakomonn-reader-detail-metric";
  const todayAttemptedQuestionCountLabel = document.createElement("dt");
  todayAttemptedQuestionCountLabel.textContent = "todayAttemptedQuestionCount";
  const todayAttemptedQuestionCountValue = document.createElement("dd");
  const todayAttemptedQuestionCountNumber = document.createElement("strong");
  todayAttemptedQuestionCountNumber.id =
    "kakomonn-reader-today-attempted-question-count";
  const todayAttemptedQuestionCountUnit = document.createElement("span");
  todayAttemptedQuestionCountUnit.textContent = "問";
  todayAttemptedQuestionCountValue.append(
    todayAttemptedQuestionCountNumber,
    todayAttemptedQuestionCountUnit
  );
  todayAttemptedQuestionCountMetric.append(
    todayAttemptedQuestionCountLabel,
    todayAttemptedQuestionCountValue
  );
  learningMetricsDetails.append(
    dueCardsCompletedMetric,
    todayStabilityDaysDeltaMetric,
    todayAttemptedQuestionCountMetric
  );

  const syncSettingsButton = document.createElement("button");
  syncSettingsButton.id = "kakomonn-reader-sync-settings-button";
  syncSettingsButton.type = "button";
  syncSettingsButton.textContent = "同期設定";
  syncSettingsButton.setAttribute("aria-label", "学習記録の同期設定を開く");

  const timeLimitProgress = document.createElement("progress");
  timeLimitProgress.id = "kakomonn-reader-time-limit";
  timeLimitProgress.max = TIME_LIMIT_MS;
  timeLimitProgress.value = TIME_LIMIT_MS;
  timeLimitProgress.hidden = true;
  timeLimitProgress.setAttribute("aria-label", "問題の制限時間");

  controls.append(
    statusBadge,
    learningMetricsButton,
    syncSettingsButton,
    learningMetricsDetails,
    learningMetricsLiveStatus,
    timeLimitProgress
  );

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

  document.body.dataset.kakomonnReaderUi = "true";
  document.body.replaceChildren(controls, shell, actions, syncSettings);

  function renderLearningMetrics() {
    const dueCardsCompletedText =
      learningMetrics === null
        ? "--"
        : learningMetrics.dueCardsCompleted ? "達成" : "未達成";
    const dueCardsRemainingText =
      learningMetrics === null
        ? "--"
        : learningMetrics.dueCardsRemaining.toLocaleString("ja-JP");
    const todayStabilityDaysDeltaText =
      learningMetrics === null
        ? "--"
        : `${learningMetrics.todayStabilityDaysDelta >= 0 ? "+" : ""}${learningMetrics.todayStabilityDaysDelta.toLocaleString("ja-JP")}`;
    const todayAttemptedQuestionCountText =
      learningMetrics === null
        ? "--"
        : learningMetrics.todayAttemptedQuestionCount.toLocaleString("ja-JP");
    dueCardsCompletedValue.textContent = dueCardsCompletedText;
    if (learningMetrics === null) {
      delete dueCardsCompletedValue.dataset.completed;
    } else {
      dueCardsCompletedValue.dataset.completed = String(
        learningMetrics.dueCardsCompleted
      );
    }
    dueCardsRemainingNumber.textContent = dueCardsRemainingText;
    todayStabilityDaysDeltaNumber.textContent = todayStabilityDaysDeltaText;
    todayAttemptedQuestionCountNumber.textContent =
      todayAttemptedQuestionCountText;
    const dueCardsRemainingAccessibleText =
      learningMetrics === null ? "--" : `あと${dueCardsRemainingText}問`;
    const detailsAction =
      learningMetricsButton.getAttribute("aria-expanded") === "true"
        ? "詳細を非表示"
        : "詳細を表示";
    learningMetricsButton.setAttribute(
      "aria-label",
      `dueCardsRemaining ${dueCardsRemainingAccessibleText}. ${detailsAction}`
    );
    learningMetricsLiveStatus.textContent =
      `dueCardsRemaining ${dueCardsRemainingAccessibleText}`;
  }

  function setLearningMetricsExpanded(expanded) {
    learningMetricsButton.setAttribute("aria-expanded", String(expanded));
    learningMetricsDetails.hidden = !expanded;
    renderLearningMetrics();
  }

  learningMetricsButton.addEventListener("click", () => {
    setLearningMetricsExpanded(
      learningMetricsButton.getAttribute("aria-expanded") !== "true"
    );
  });

  function setStatus(message, accessibleMessage = message) {
    statusText.textContent = message;
    if (accessibleMessage === message) {
      statusBadge.removeAttribute("aria-label");
    } else {
      statusBadge.setAttribute("aria-label", accessibleMessage);
    }
  }
