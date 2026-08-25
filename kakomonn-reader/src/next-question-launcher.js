  if (isNextQuestionLauncher) {
    document.title = "次の問題へ | KAKOMONN";

    const launcher = document.createElement("main");
    launcher.id = "kakomonn-next-question-launcher";
    launcher.setAttribute("aria-labelledby", "kakomonn-next-question-title");

    const launcherPanel = document.createElement("section");
    launcherPanel.id = "kakomonn-next-question-panel";
    launcherPanel.dataset.state = "loading";
    launcherPanel.setAttribute("aria-busy", "true");

    const launcherBrand = document.createElement("div");
    launcherBrand.id = "kakomonn-next-question-brand";
    launcherBrand.textContent = "KAKOMONN";

    const launcherContent = document.createElement("div");
    launcherContent.id = "kakomonn-next-question-content";

    const launcherIndicator = document.createElement("div");
    launcherIndicator.id = "kakomonn-next-question-indicator";
    launcherIndicator.setAttribute("aria-hidden", "true");

    const launcherTitle = document.createElement("h1");
    launcherTitle.id = "kakomonn-next-question-title";
    launcherTitle.textContent = "次の問題を準備しています";

    const launcherStatus = document.createElement("p");
    launcherStatus.id = "next-question-status";
    launcherStatus.setAttribute("role", "status");
    launcherStatus.setAttribute("aria-live", "polite");
    launcherStatus.textContent = "学習状況から, 今取り組む問題を確認しています.";

    launcherContent.append(
      launcherIndicator,
      launcherTitle,
      launcherStatus
    );

    const launcherActions = document.createElement("div");
    launcherActions.id = "kakomonn-next-question-actions";
    launcherActions.hidden = true;

    const launcherSettings = document.createElement("a");
    launcherSettings.id = "next-question-settings";
    launcherSettings.href = SYNC_SETTINGS_ENTRY_URL;
    launcherSettings.textContent = "同期設定を開く";
    launcherSettings.hidden = true;

    const launcherRetry = document.createElement("button");
    launcherRetry.id = "next-question-retry";
    launcherRetry.type = "button";
    launcherRetry.textContent = "もう一度試す";
    launcherRetry.hidden = true;
    launcherRetry.addEventListener("click", () => location.reload());

    launcherActions.append(launcherSettings, launcherRetry);
    launcherPanel.append(launcherBrand, launcherContent, launcherActions);
    launcher.appendChild(launcherPanel);
    document.body.replaceChildren(launcher);

    function showLauncherState({
      state,
      title,
      message,
      showRetry,
      showSettings,
    }) {
      launcherPanel.dataset.state = state;
      launcherPanel.setAttribute("aria-busy", "false");
      launcherTitle.textContent = title;
      launcherStatus.setAttribute(
        "role",
        state === "empty" ? "status" : "alert"
      );
      launcherStatus.textContent = message;
      launcherSettings.hidden = !showSettings;
      launcherRetry.hidden = !showRetry;
      launcherRetry.dataset.variant = showSettings ? "secondary" : "primary";
      launcherActions.hidden = !showSettings && !showRetry;
    }

    function showConfigurationFailure(title, message) {
      showLauncherState({
        state: "configuration-error",
        title,
        message,
        showRetry: true,
        showSettings: true,
      });
    }

    function showRequestFailure(error) {
      if (error?.code === "unauthorized") {
        showConfigurationFailure(
          "同期トークンを確認してください",
          "保存済みの同期トークンでは接続できませんでした. 同期設定で正しいトークンを保存してください."
        );
        return;
      }
      if (error?.code === "request_timeout") {
        showLauncherState({
          state: "service-error",
          title: "同期に時間がかかっています",
          message: "通信状態を確認してから, もう一度試してください.",
          showRetry: true,
          showSettings: false,
        });
        return;
      }
      if (error?.code === "catalog_missing" || error?.code === "catalog_error") {
        showLauncherState({
          state: "service-error",
          title: "問題一覧を同期できません",
          message: "問題画面で問題一覧を同期してから, もう一度試してください.",
          showRetry: true,
          showSettings: false,
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
          showSettings: false,
        });
        return;
      }
      showLauncherState({
        state: "service-error",
        title: "同期サービスに接続できません",
        message: "ネットワーク接続を確認してから, もう一度試してください.",
        showRetry: true,
        showSettings: false,
      });
    }

    let storedToken;
    try {
      storedToken = await GM.getValue(SYNC_TOKEN_KEY, "");
      if (typeof storedToken !== "string") {
        await GM.deleteValue(SYNC_TOKEN_KEY);
        storedToken = "";
      }
    } catch {
      showConfigurationFailure(
        "同期設定を読み込めません",
        "このiPhoneの同期設定を開き, 同期トークンを保存し直してください."
      );
      return;
    }

    const token = storedToken.trim();
    if (!token) {
      showConfigurationFailure(
        "同期設定が必要です",
        "このiPhoneに同期トークンが保存されていません. 同期設定でトークンを保存してください."
      );
      return;
    }

    try {
      const result = await requestNextQuestion(token);
      if (result.question === null) {
        showLauncherState({
          state: "empty",
          title: "今解く問題はありません",
          message: "時間を置いてから, 学習状況をもう一度確認してください.",
          showRetry: true,
          showSettings: false,
        });
        return;
      }
      window.location.replace(result.question.url);
    } catch (error) {
      showRequestFailure(error);
    }
    return;
  }
