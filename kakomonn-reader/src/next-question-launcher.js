  if (isNextQuestionLauncher) {
    document.title = "次の問題へ | KAKOMONN";

    const launcher = document.createElement("main");
    launcher.id = "kakomonn-next-question-launcher";
    launcher.setAttribute("aria-labelledby", "kakomonn-next-question-title");

    const launcherTitle = document.createElement("h1");
    launcherTitle.id = "kakomonn-next-question-title";
    launcherTitle.textContent = "次の問題へ";

    const launcherStatus = document.createElement("p");
    launcherStatus.id = "next-question-status";
    launcherStatus.setAttribute("role", "status");
    launcherStatus.setAttribute("aria-live", "polite");
    launcherStatus.textContent = "次に解く問題を確認しています.";

    const launcherRetry = document.createElement("button");
    launcherRetry.id = "next-question-retry";
    launcherRetry.type = "button";
    launcherRetry.hidden = true;
    launcherRetry.textContent = "再試行";
    launcherRetry.addEventListener("click", () => location.reload());

    launcher.append(launcherTitle, launcherStatus, launcherRetry);
    document.body.replaceChildren(launcher);

    function showLauncherFailure(message) {
      launcherStatus.setAttribute("role", "alert");
      launcherStatus.textContent = message;
      launcherRetry.hidden = false;
    }

    let storedToken;
    try {
      storedToken = await GM.getValue(SYNC_TOKEN_KEY, "");
      if (typeof storedToken !== "string") {
        await GM.deleteValue(SYNC_TOKEN_KEY);
        storedToken = "";
      }
    } catch {
      showLauncherFailure(
        "同期設定を読み込めません. 過去問readerを開いて同期設定を確認してから, 再試行してください."
      );
      return;
    }

    const token = storedToken.trim();
    if (!token) {
      showLauncherFailure(
        "同期tokenが設定されていません. 過去問readerの同期設定でtokenを保存してから, 再試行してください."
      );
      return;
    }

    try {
      const result = await requestNextQuestion(token);
      if (result.question === null) {
        showLauncherFailure(
          "現在解くべき問題はありません. 時間を置いて再試行してください."
        );
        return;
      }
      window.location.replace(result.question.url);
    } catch (error) {
      showLauncherFailure(
        `${syncErrorMessage(error)}. 通信状態または同期設定を確認してから, 再試行してください.`
      );
    }
    return;
  }
