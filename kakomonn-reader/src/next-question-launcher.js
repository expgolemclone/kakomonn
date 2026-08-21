  if (isNextQuestionLauncher) {
    const launcherStatus = document.getElementById("next-question-status");
    const launcherRetry = document.getElementById("next-question-retry");

    function showLauncherFailure(message) {
      if (launcherStatus !== null) {
        launcherStatus.setAttribute("role", "alert");
        launcherStatus.textContent = message;
      }
      if (launcherRetry !== null) {
        launcherRetry.hidden = false;
      }
    }

    if (launcherStatus === null || launcherRetry === null) {
      return;
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
