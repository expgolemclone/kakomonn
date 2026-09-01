  function showSpeechGestureError(error = null) {
    const detail = { code: "autoplay_blocked" };
    if (typeof error?.message === "string" && error.message !== "") {
      detail.message = error.message;
    }
    showReaderError(
      "speech-gesture",
      "読み上げを開始できません",
      `${SPEECH_GESTURE_STATUS}. このdialogを閉じる操作で再試行します.`,
      detail
    );
  }

  function initializeSpeechPlayback(runId, onReady, onUnavailable) {
    speechAudio.src = SILENT_AUDIO_DATA_URL;

    let playPromise;
    try {
      playPromise = speechAudio.play();
    } catch (error) {
      speechAudio.src = "";
      onUnavailable(error);
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
      .catch((error) => {
        speechAudio.src = "";
        if (runId === speechRunId) {
          onUnavailable(error);
        }
      });
  }

  function finishSpeechInitialization() {
    const resolve = speechInitializationResolve;
    speechInitializationResolve = null;
    speechInitializationPromise = null;
    resolve?.();
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

  function buildSpeechSSML({ locale, rate, text, voiceName }) {
    const ratePercentage = Math.round((rate - 1) * 100);
    const signedRate = `${ratePercentage >= 0 ? "+" : ""}${ratePercentage}%`;
    return (
      `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}">` +
      `<voice name="${voiceName}">` +
      `<prosody rate="${signedRate}">${escapeSpeechText(text)}</prosody>` +
      "</voice></speak>"
    );
  }

  function requestAzureSpeechAudio(
    token,
    text,
    rate,
    locale = JAPANESE_SPEECH_LOCALE,
    voiceName = JAPANESE_SPEECH_VOICE_NAME
  ) {
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
      data: buildSpeechSSML({ locale, rate, text, voiceName }),
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
    const cancelPlayback = activeSpeechPlaybackCancel;
    activeSpeechPlaybackCancel = null;
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
    cancelPlayback?.();
  }

  function cancelActiveSpeech() {
    speechChunkSession = null;
    for (const request of activeSpeechRequests) {
      request.abort();
    }
    activeSpeechRequests.clear();
    clearActiveSpeechAudio();
  }

  async function playActiveSpeechAudio(runId) {
    try {
      await speechAudio.play();
    } catch (error) {
      if (runId === speechRunId) {
        cancelActiveSpeech();
        speechEnabled = false;
        currentPageReadPending = true;
        showSpeechGestureError(error);
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
      return true;
    }

    speechPaused = false;
    void playActiveSpeechAudio(speechRunId);
    return true;
  }

  function prepareSpeechChunk(session, index) {
    if (index >= session.chunks.length) {
      return Promise.resolve({ audioData: null, error: null });
    }
    const existing = session.prepared.get(index);
    if (existing !== undefined) {
      return existing;
    }

    const prepared = (async () => {
      const token = await getAzureSpeechToken();
      if (speechChunkSession !== session || session.runId !== speechRunId) {
        throw new SyncRequestError("request_aborted");
      }
      const request = requestAzureSpeechAudio(
        token,
        session.chunks[index],
        session.rate,
        session.locale,
        session.voiceName
      );
      activeSpeechRequests.add(request);
      try {
        return await request;
      } finally {
        activeSpeechRequests.delete(request);
      }
    })().then(
      (audioData) => ({ audioData, error: null }),
      (error) => ({ audioData: null, error })
    );
    session.prepared.set(index, prepared);
    return prepared;
  }

  async function playSpeechChunk(session, index) {
    if (speechChunkSession !== session || session.runId !== speechRunId) {
      return;
    }
    if (index >= session.chunks.length) {
      speechChunkSession = null;
      return;
    }

    const result = await prepareSpeechChunk(session, index);
    session.prepared.delete(index);
    if (speechChunkSession !== session || session.runId !== speechRunId) {
      return;
    }
    if (result.error !== null) {
      speechChunkSession = null;
      if (result.error?.code !== "request_aborted") {
        showReaderError(
          "speech-request",
          "音声を取得できません",
          `${speechErrorMessage(result.error)}. 通信状態を確認してください.`,
          result.error
        );
      }
      return;
    }

    clearActiveSpeechAudio();
    activeSpeechAudioURL = URL.createObjectURL(
      new Blob([result.audioData], { type: "audio/mpeg" })
    );
    speechAudio.src = activeSpeechAudioURL;
    speechAudio.onplay = () => {
      if (speechChunkSession === session && session.runId === speechRunId) {
        speechPaused = false;
        void prepareSpeechChunk(session, index + 1);
      }
    };

    speechAudio.onended = () => {
      if (speechChunkSession === session && session.runId === speechRunId) {
        clearActiveSpeechAudio();
        void playSpeechChunk(session, index + 1);
      }
    };

    speechAudio.onerror = () => {
      if (speechChunkSession !== session || session.runId !== speechRunId) {
        return;
      }

      speechChunkSession = null;
      clearActiveSpeechAudio();
      showReaderError(
        "speech-playback",
        "音声を再生できません",
        "Browserの音声出力を確認し, 画面を操作して再試行してください.",
        { code: "audio_playback_failed" }
      );
    };

    await playActiveSpeechAudio(session.runId);
  }

  function speakText(
    text,
    label,
    rate,
    locale = JAPANESE_SPEECH_LOCALE,
    voiceName = JAPANESE_SPEECH_VOICE_NAME
  ) {
    if (!speechEnabled) {
      return;
    }

    const chunks = splitText(text);
    if (chunks.length === 0) {
      showReaderError(
        "speech-content",
        `${label}を読み上げられません`,
        `${label}の本文を取得できませんでした.`,
        { code: "speech_text_missing" }
      );
      return;
    }

    speechRunId += 1;
    const runId = speechRunId;
    cancelActiveSpeech();
    const session = {
      chunks,
      runId,
      label,
      rate,
      locale,
      voiceName,
      prepared: new Map(),
    };
    speechChunkSession = session;
    void playSpeechChunk(session, 0);
  }

  function writeWaveText(view, offset, value) {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  }

  function createCorrectChimeWave(variant) {
    const { duration, gain, tones } = variant.chime;
    const sampleCount = Math.ceil(CORRECT_CHIME_SAMPLE_RATE * duration);
    const buffer = new ArrayBuffer(44 + sampleCount * 2);
    const view = new DataView(buffer);

    writeWaveText(view, 0, "RIFF");
    view.setUint32(4, 36 + sampleCount * 2, true);
    writeWaveText(view, 8, "WAVE");
    writeWaveText(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, CORRECT_CHIME_SAMPLE_RATE, true);
    view.setUint32(28, CORRECT_CHIME_SAMPLE_RATE * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeWaveText(view, 36, "data");
    view.setUint32(40, sampleCount * 2, true);

    for (let index = 0; index < sampleCount; index += 1) {
      const time = index / CORRECT_CHIME_SAMPLE_RATE;
      let sample = 0;
      for (const tone of tones) {
        const toneTime = time - tone.start;
        if (toneTime < 0 || toneTime >= tone.duration) {
          continue;
        }
        const progress = toneTime / tone.duration;
        const attack = Math.min(1, toneTime / 0.008);
        const release = (1 - progress) ** 2;
        sample +=
          Math.sin(2 * Math.PI * tone.frequency * toneTime) *
          attack *
          release *
          gain;
      }
      const clampedSample = Math.max(-1, Math.min(1, sample));
      view.setInt16(44 + index * 2, clampedSample * 0x7fff, true);
    }

    return buffer;
  }

  function playFeedbackAudio(source, runId, label) {
    if (speechAudio === null || runId !== speechRunId) {
      return Promise.resolve(false);
    }

    clearActiveSpeechAudio();
    if (typeof source === "string") {
      speechAudio.src = source;
    } else {
      activeSpeechAudioURL = URL.createObjectURL(source);
      speechAudio.src = activeSpeechAudioURL;
    }

    return new Promise((resolve) => {
      let settled = false;
      const settle = (completed) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(completed);
      };
      const cancelPlayback = () => settle(false);
      activeSpeechPlaybackCancel = cancelPlayback;

      speechAudio.onplay = () => {
        if (runId === speechRunId) {
          speechPaused = false;
        }
      };
      speechAudio.onended = () => {
        if (runId !== speechRunId) {
          return;
        }
        if (activeSpeechPlaybackCancel === cancelPlayback) {
          activeSpeechPlaybackCancel = null;
        }
        clearActiveSpeechAudio();
        settle(true);
      };
      speechAudio.onerror = () => {
        if (runId !== speechRunId) {
          return;
        }
        if (activeSpeechPlaybackCancel === cancelPlayback) {
          activeSpeechPlaybackCancel = null;
        }
        clearActiveSpeechAudio();
        showReaderError(
          "correct-feedback-playback",
          "正解feedbackを再生できません",
          "Browserの音声出力を確認してください.",
          { code: "feedback_playback_failed" }
        );
        settle(false);
      };

      let playPromise;
      try {
        playPromise = speechAudio.play();
      } catch (error) {
        if (activeSpeechPlaybackCancel === cancelPlayback) {
          activeSpeechPlaybackCancel = null;
        }
        clearActiveSpeechAudio();
        showSpeechGestureError(error);
        settle(false);
        return;
      }
      Promise.resolve(playPromise).catch((error) => {
        if (runId !== speechRunId) {
          return;
        }
        if (activeSpeechPlaybackCancel === cancelPlayback) {
          activeSpeechPlaybackCancel = null;
        }
        clearActiveSpeechAudio();
        showSpeechGestureError(error);
        settle(false);
      });
    });
  }

  async function playCorrectFeedbackSequence(variant) {
    if (speechInitializationPromise !== null) {
      await speechInitializationPromise;
    }
    if (!speechEnabled || speechAudio === null) {
      return false;
    }

    speechRunId += 1;
    const runId = speechRunId;
    cancelActiveSpeech();
    const chimeCompleted = await playFeedbackAudio(
      new Blob([createCorrectChimeWave(variant)], { type: "audio/wav" }),
      runId,
      "正解音"
    );
    if (!chimeCompleted || runId !== speechRunId) {
      return;
    }

    const voiceCompleted = await playFeedbackAudio(
      FEEDBACK_AUDIO_DATA_URLS[variant.id],
      runId,
      variant.speechText
    );
    return voiceCompleted && runId === speechRunId;
  }

  function beginCorrectAnswerFeedback(sourceDocument = frameDocument) {
    if (
      sourceDocument?.body === undefined ||
      sourceDocument !== frameDocument ||
      correctFeedbackDocuments.has(sourceDocument)
    ) {
      return false;
    }

    correctFeedbackDocuments.add(sourceDocument);
    awaitingAnswerResultSpeech = false;
    const variant = chooseCorrectFeedbackVariant();

    const previousFeedback = correctFeedbackPromise ?? Promise.resolve();
    const scheduledFeedback = previousFeedback.then(async () => {
      showCorrectFeedbackVisual(variant, sourceDocument);
      const minimumDuration = new Promise((resolve) => {
        window.setTimeout(resolve, CORRECT_FEEDBACK_MINIMUM_DURATION_MS);
      });
      try {
        await Promise.all([
          playCorrectFeedbackSequence(variant),
          minimumDuration,
        ]);
      } catch (error) {
        showReaderError(
          "correct-feedback",
          "正解feedbackを再生できません",
          "音声出力を確認してください.",
          error
        );
      }
      await completeCorrectFeedbackVisual();
    });
    correctFeedbackPromise = scheduledFeedback;
    void scheduledFeedback.then(() => {
      if (correctFeedbackPromise !== scheduledFeedback) {
        return;
      }
      correctFeedbackPromise = null;
      processCurrentPageSpeech();
      void maybePreparePendingDestination();
    });
    return true;
  }

  function speakAnswerResult(answerResult) {
    if (answerResult === "correct") {
      beginCorrectAnswerFeedback();
      return;
    }

    const label = "不正解";
    awaitingAnswerResultSpeech = false;
    void (async () => {
      if (speechInitializationPromise !== null) {
        await speechInitializationPromise;
      }
      if (!speechEnabled || speechAudio === null) {
        return;
      }
      speechRunId += 1;
      const runId = speechRunId;
      cancelActiveSpeech();
      await playFeedbackAudio(
        FEEDBACK_AUDIO_DATA_URLS.incorrect,
        runId,
        label
      );
    })();
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
      showReaderError(
        "question-speech-content",
        "問題文を読み上げられません",
        "問題pageから読み上げ対象の本文を取得できませんでした.",
        { code: "question_text_missing" }
      );
      return;
    }

    awaitingAnswerResultSpeech = true;
    speakText(`問題文。${questionText}`, "問題文", QUESTION_SPEECH_RATE);
  }
