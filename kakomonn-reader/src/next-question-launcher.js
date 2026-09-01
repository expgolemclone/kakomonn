  let nextQuestionLauncherRequestInProgress = false;
  let readerInitializationStarted = false;
  let launcher = null;
  let launcherPanel = null;
  let launcherTitle = null;
  let launcherStatus = null;
  let launcherActions = null;
  let launcherRetry = null;

  function ensureNextQuestionLauncher() {
    if (launcher !== null) {
      return;
    }

    document.title = "次の問題へ | KAKOMONN";

    launcher = document.createElement("main");
    launcher.id = "kakomonn-next-question-launcher";
    launcher.setAttribute("aria-labelledby", "kakomonn-next-question-title");

    launcherPanel = document.createElement("section");
    launcherPanel.id = "kakomonn-next-question-panel";

    const launcherBrand = document.createElement("div");
    launcherBrand.id = "kakomonn-next-question-brand";
    launcherBrand.textContent = "KAKOMONN";

    const launcherContent = document.createElement("div");
    launcherContent.id = "kakomonn-next-question-content";

    const launcherIndicator = document.createElement("div");
    launcherIndicator.id = "kakomonn-next-question-indicator";
    launcherIndicator.setAttribute("aria-hidden", "true");

    launcherTitle = document.createElement("h1");
    launcherTitle.id = "kakomonn-next-question-title";

    launcherStatus = document.createElement("p");
    launcherStatus.id = "next-question-status";
    launcherStatus.setAttribute("role", "status");
    launcherStatus.setAttribute("aria-live", "polite");

    launcherContent.append(
      launcherIndicator,
      launcherTitle,
      launcherStatus
    );

    launcherActions = document.createElement("div");
    launcherActions.id = "kakomonn-next-question-actions";

    launcherRetry = document.createElement("button");
    launcherRetry.id = "next-question-retry";
    launcherRetry.type = "button";
    launcherRetry.textContent = "もう一度試す";
    launcherRetry.addEventListener("click", () => {
      void startNextQuestionLauncher();
    });

    launcherActions.appendChild(launcherRetry);
    launcherPanel.append(launcherBrand, launcherContent, launcherActions);
    launcher.appendChild(launcherPanel);
  }

  function mountNextQuestionLauncher() {
    ensureNextQuestionLauncher();
    delete document.body.dataset.kakomonnReaderUi;
    document.body.replaceChildren(launcher);
  }

  function showLauncherLoading() {
    mountNextQuestionLauncher();
    launcherPanel.dataset.state = "loading";
    launcherPanel.setAttribute("aria-busy", "true");
    launcherTitle.textContent = "次の問題を準備しています";
    launcherStatus.setAttribute("role", "status");
    launcherStatus.textContent =
      "学習状況から, 今取り組む問題を確認しています.";
    launcherActions.hidden = true;
    launcherRetry.hidden = true;
  }

  function showLauncherState({ state, title, message, showRetry }) {
    mountNextQuestionLauncher();
    launcherPanel.dataset.state = state;
    launcherPanel.setAttribute("aria-busy", "false");
    launcherTitle.textContent = title;
    launcherStatus.setAttribute(
      "role",
      state === "empty" ? "status" : "alert"
    );
    launcherStatus.textContent = message;
    launcherRetry.hidden = !showRetry;
    launcherRetry.dataset.variant = "primary";
    launcherActions.hidden = !showRetry;
  }

  function showLauncherRequestFailure(error) {
    if (error?.code === "request_timeout") {
      showLauncherState({
        state: "service-error",
        title: "同期に時間がかかっています",
        message: "通信状態を確認してから, もう一度試してください.",
        showRetry: true,
      });
      return;
    }
    if (error?.code === "catalog_missing" || error?.code === "catalog_error") {
      showLauncherState({
        state: "service-error",
        title: "問題一覧を同期できません",
        message: "問題画面で問題一覧を同期してから, もう一度試してください.",
        showRetry: true,
      });
      return;
    }
    if (
      error?.code === "invalid_response" ||
      error?.code === "server_misconfigured"
    ) {
      showLauncherState({
        state: "service-error",
        title: "同期サービスを利用できません",
        message: "同期APIの応答を確認できませんでした. 時間を置いて, もう一度試してください.",
        showRetry: true,
      });
      return;
    }
    showLauncherState({
      state: "service-error",
      title: "同期サービスに接続できません",
      message: "ネットワーク接続を確認してから, もう一度試してください.",
      showRetry: true,
    });
  }

  function enterReaderUI() {
    mountReaderUI();
    if (!readerInitializationStarted) {
      readerInitializationStarted = true;
      void initializeSync();
    }
  }

  function requireSyncSettings(message) {
    const initializationAlreadyStarted = readerInitializationStarted;
    shouldLaunchNextQuestionAfterSync = true;
    enterReaderUI();
    if (initializationAlreadyStarted) {
      syncReady = false;
      openSyncSettings();
      syncSettingsError.textContent = message;
      updateSyncDependentControls();
    }
  }

  function openScheduledQuestionInReader(questionURL) {
    shouldLaunchNextQuestionAfterSync = false;
    enterReaderUI();
    return navigateToScheduledQuestion(questionURL);
  }

  function showNoNextQuestionLauncher() {
    shouldLaunchNextQuestionAfterSync = true;
    showLauncherState({
      state: "empty",
      title: "今解く問題はありません",
      message: "時間を置いてから, 学習状況をもう一度確認してください.",
      showRetry: true,
    });
  }

  async function startNextQuestionLauncher() {
    if (nextQuestionLauncherRequestInProgress) {
      return;
    }
    nextQuestionLauncherRequestInProgress = true;
    showLauncherLoading();

    let storedToken;
    try {
      storedToken = GM_getValue(SYNC_TOKEN_KEY, "");
      if (typeof storedToken !== "string") {
        await GM.deleteValue(SYNC_TOKEN_KEY);
        storedToken = "";
      }
    } catch (error) {
      nextQuestionLauncherRequestInProgress = false;
      enterReaderUI();
      showReaderError(
        "launcher-storage",
        "同期設定を読み込めません",
        "Userscript storageを確認できませんでした. ページを再読み込みしてください.",
        error
      );
      return;
    }

    const token = storedToken.trim();
    if (!token) {
      nextQuestionLauncherRequestInProgress = false;
      requireSyncSettings("同期トークンを設定してください");
      return;
    }

    try {
      const result = await requestNextQuestion(token);
      if (result.question === null) {
        showNoNextQuestionLauncher();
        return;
      }
      openScheduledQuestionInReader(result.question.url);
    } catch (error) {
      if (error?.code === "unauthorized") {
        requireSyncSettings("同期トークンを確認してください");
      } else {
        showLauncherRequestFailure(error);
      }
    } finally {
      nextQuestionLauncherRequestInProgress = false;
    }
  }
