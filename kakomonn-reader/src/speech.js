  function initializeSpeechPlayback(runId, onReady, onUnavailable) {
    setStatus("音声準備中");
    speechAudio.src = SILENT_AUDIO_DATA_URL;

    let playPromise;
    try {
      playPromise = speechAudio.play();
    } catch {
      speechAudio.src = "";
      onUnavailable();
      return;
    }

    Promise.resolve(playPromise)
      .then(() => {
        speechAudio.pause();
        speechAudio.src = "";
        speechAudio.load?.();
        if (runId === speechRunId) {
          onReady();
        }
      })
      .catch(() => {
        speechAudio.src = "";
        if (runId === speechRunId) {
          onUnavailable();
        }
      });
  }

  function escapeSpeechText(text) {
    return text.replace(/[&<>"']/g, (character) => {
      const entities = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      };
      return entities[character];
    });
  }

  function buildSpeechSSML(text, rate) {
    const ratePercentage = Math.round((rate - 1) * 100);
    const signedRate = `${ratePercentage >= 0 ? "+" : ""}${ratePercentage}%`;
    return (
      '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ja-JP">' +
      `<voice name="${AZURE_SPEECH_VOICE_NAME}">` +
      `<prosody rate="${signedRate}">${escapeSpeechText(text)}</prosody>` +
      "</voice></speak>"
    );
  }

  function requestAzureSpeechAudio(token, text, rate) {
    const request = gmXMLHttpRequest({
      method: "POST",
      url: AZURE_SPEECH_URL,
      timeout: SPEECH_TIMEOUT_MS,
      responseType: "arraybuffer",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": AZURE_SPEECH_OUTPUT_FORMAT,
      },
      data: buildSpeechSSML(text, rate),
    });
    const result = request.then((response) => {
      if (
        response.status === 200 &&
        typeof response.response?.byteLength === "number" &&
        response.response.byteLength > 0
      ) {
        return response.response;
      }
      if (response.status === 401) {
        clearAzureSpeechToken();
        throw new SyncRequestError("speech_unauthorized", response.status);
      }
      if (response.status === 429) {
        throw new SyncRequestError("speech_quota_exceeded", response.status);
      }
      throw new SyncRequestError("speech_request_failed", response.status);
    });
    result.abort = () => request.abort();
    return result;
  }

  function speechErrorMessage(error) {
    if (error?.code === "server_misconfigured") {
      return "音声APIが設定されていません";
    }
    if (error?.code === "speech_service_unavailable") {
      return "音声APIを利用できません";
    }
    if (error?.code === "speech_quota_exceeded") {
      return "音声の無料枠を使い切りました";
    }
    if (error?.code === "speech_unauthorized") {
      return "音声認証に失敗しました";
    }
    if (error?.code === "request_timeout") {
      return "音声取得がタイムアウトしました";
    }
    return "音声を取得できません";
  }

  function clearActiveSpeechAudio() {
    speechPaused = false;
    speechAudio?.pause();
    if (speechAudio) {
      speechAudio.onplay = null;
      speechAudio.onended = null;
      speechAudio.onerror = null;
      speechAudio.src = "";
      speechAudio.load?.();
    }
    if (activeSpeechAudioURL) {
      URL.revokeObjectURL(activeSpeechAudioURL);
      activeSpeechAudioURL = "";
    }
  }

  function cancelActiveSpeech() {
    activeSpeechRequest?.abort();
    activeSpeechRequest = null;
    clearActiveSpeechAudio();
  }

  async function playActiveSpeechAudio(runId) {
    try {
      await speechAudio.play();
    } catch {
      if (runId === speechRunId) {
        clearActiveSpeechAudio();
        speechEnabled = false;
        currentPageReadPending = true;
        setStatus(SPEECH_GESTURE_STATUS);
      }
    }
  }

  function toggleSpeechPause() {
    if (!speechEnabled || !activeSpeechAudioURL || speechAudio === null) {
      return false;
    }

    if (!speechPaused) {
      speechAudio.pause();
      speechPaused = true;
      setStatus("読み上げ一時停止");
      return true;
    }

    speechPaused = false;
    setStatus("読み上げ再開中");
    void playActiveSpeechAudio(speechRunId);
    return true;
  }

  function completeSpeechChunks(runId, label) {
    if (runId !== speechRunId) {
      return;
    }

    activeSpeechRequest = null;
    setStatus(`${label}完了`);
  }

  async function speakAzureSpeechChunks(
    chunks,
    runId,
    label,
    rate,
    index = 0
  ) {
    if (runId !== speechRunId) {
      return;
    }

    if (index >= chunks.length) {
      completeSpeechChunks(runId, label);
      return;
    }

    let audioData;
    try {
      const token = await getAzureSpeechToken();
      if (runId !== speechRunId) {
        return;
      }
      const request = requestAzureSpeechAudio(token, chunks[index], rate);
      activeSpeechRequest = request;
      audioData = await request;
      if (activeSpeechRequest === request) {
        activeSpeechRequest = null;
      }
    } catch (error) {
      if (runId === speechRunId && error?.code !== "request_aborted") {
        activeSpeechRequest = null;
        setStatus(speechErrorMessage(error));
      }
      return;
    }

    if (runId !== speechRunId) {
      return;
    }

    clearActiveSpeechAudio();
    activeSpeechAudioURL = URL.createObjectURL(
      new Blob([audioData], { type: "audio/mpeg" })
    );
    speechAudio.src = activeSpeechAudioURL;
    speechAudio.onplay = () => {
      if (runId === speechRunId) {
        speechPaused = false;
        setStatus(`${label} ${index + 1}/${chunks.length}`);
      }
    };

    speechAudio.onended = () => {
      if (runId === speechRunId) {
        clearActiveSpeechAudio();
        void speakAzureSpeechChunks(chunks, runId, label, rate, index + 1);
      }
    };

    speechAudio.onerror = () => {
      if (runId !== speechRunId) {
        return;
      }

      clearActiveSpeechAudio();
      setStatus("音声を再生できません");
    };

    await playActiveSpeechAudio(runId);
  }

  function speakText(text, label, rate) {
    if (!speechEnabled) {
      return;
    }

    const chunks = splitText(text);
    if (chunks.length === 0) {
      setStatus(`${label}を取得できません`);
      return;
    }

    speechRunId += 1;
    const runId = speechRunId;
    cancelActiveSpeech();
    setStatus(`${label}準備中`);
    void speakAzureSpeechChunks(chunks, runId, label, rate);
  }

  function speakAnswerResult(answerResult) {
    const label = answerResult === "correct" ? "正解" : "不正解";
    awaitingAnswerResultSpeech = false;
    speakText(`${label}.`, label, ANSWER_RESULT_SPEECH_RATE);
  }

  function readCurrentPage() {
    if (!speechEnabled) {
      return;
    }

    const answerResult = getCurrentAnswerResult();
    if (answerResult !== "unknown") {
      speakAnswerResult(answerResult);
      return;
    }

    const questionText = extractQuestionText();
    if (!questionText) {
      setStatus("問題文を取得できません");
      return;
    }

    awaitingAnswerResultSpeech = true;
    speakText(`問題文。${questionText}`, "問題文", QUESTION_SPEECH_RATE);
  }
