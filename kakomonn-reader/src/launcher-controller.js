export function installLauncherController(app) {
  let nextQuestionLauncherRequestInProgress = false;
  let readerInitializationStarted = false;
  function showLauncherLoading() {
    app.showLauncher({
      state: "loading",
      title: "次の問題を準備しています",
      message: "学習状況から, 今取り組む問題を確認しています.",
      showRetry: false,
    });
  }

  function showLauncherState(launcher) {
    app.showLauncher(launcher);
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
    if (error?.code === "invalid_response" || error?.code === "server_misconfigured") {
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
    app.mountReaderUI();
    if (!readerInitializationStarted) {
      readerInitializationStarted = true;
      void app.initializeStudyTime();
      void app.initializeSync();
    }
  }

  function requireSyncSettings(message) {
    const initializationAlreadyStarted = readerInitializationStarted;
    app.shouldLaunchNextQuestionAfterSync = true;
    enterReaderUI();
    if (initializationAlreadyStarted) {
      app.syncReady = false;
      app.openSyncSettings();
      app.setSyncSettings({ error: message });
      app.updateSyncDependentControls();
    }
  }

  function openScheduledQuestionInReader(questionURL, state = null) {
    app.shouldLaunchNextQuestionAfterSync = false;
    app.launcherSyncState = state;
    enterReaderUI();
    return app.navigateToScheduledQuestion(questionURL);
  }

  function showNoNextQuestionLauncher() {
    app.shouldLaunchNextQuestionAfterSync = true;
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
      storedToken = await GM.getValue(app.SYNC_TOKEN_KEY, "");
      if (typeof storedToken !== "string") {
        await GM.deleteValue(app.SYNC_TOKEN_KEY);
        storedToken = "";
      }
    } catch (error) {
      nextQuestionLauncherRequestInProgress = false;
      enterReaderUI();
      app.showReaderError(
        "launcher-storage",
        "同期設定を読み込めません",
        "Userscript storageを確認できませんでした. ページを再読み込みしてください.",
        error,
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
      const result = await app.requestNextQuestion(token);
      if (result.question === null) {
        showNoNextQuestionLauncher();
        return;
      }
      openScheduledQuestionInReader(result.question.url, result.state);
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

  Object.assign(app, {
    enterReaderUI,
    openScheduledQuestionInReader,
    showNoNextQuestionLauncher,
    startNextQuestionLauncher,
  });
}
