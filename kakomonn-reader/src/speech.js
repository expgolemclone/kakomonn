  function initializeSpeechPlayback(runId, onReady, onUnavailable) {
    setStatus("準備中", "音声準備中");
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
    index = 0,
    locale = JAPANESE_SPEECH_LOCALE,
    voiceName = JAPANESE_SPEECH_VOICE_NAME
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
      const request = requestAzureSpeechAudio(
        token,
        chunks[index],
        rate,
        locale,
        voiceName
      );
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
        void speakAzureSpeechChunks(
          chunks,
          runId,
          label,
          rate,
          index + 1,
          locale,
          voiceName
        );
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
      setStatus(`${label}を取得できません`);
      return;
    }

    speechRunId += 1;
    const runId = speechRunId;
    cancelActiveSpeech();
    setStatus("準備中", `${label}準備中`);
    void speakAzureSpeechChunks(
      chunks,
      runId,
      label,
      rate,
      0,
      locale,
      voiceName
    );
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

  function playCorrectFeedbackAudioBlob(blob, runId, label) {
    if (speechAudio === null || runId !== speechRunId) {
      return Promise.resolve(false);
    }

    clearActiveSpeechAudio();
    activeSpeechAudioURL = URL.createObjectURL(blob);
    speechAudio.src = activeSpeechAudioURL;

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
          setStatus(label);
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
        setStatus("音声を再生できません");
        settle(false);
      };

      let playPromise;
      try {
        playPromise = speechAudio.play();
      } catch {
        if (activeSpeechPlaybackCancel === cancelPlayback) {
          activeSpeechPlaybackCancel = null;
        }
        clearActiveSpeechAudio();
        setStatus(SPEECH_GESTURE_STATUS);
        settle(false);
        return;
      }
      Promise.resolve(playPromise).catch(() => {
        if (runId !== speechRunId) {
          return;
        }
        if (activeSpeechPlaybackCancel === cancelPlayback) {
          activeSpeechPlaybackCancel = null;
        }
        clearActiveSpeechAudio();
        setStatus(SPEECH_GESTURE_STATUS);
        settle(false);
      });
    });
  }

  async function requestCorrectFeedbackVoice(runId, variant) {
    const token = await getAzureSpeechToken();
    if (runId !== speechRunId) {
      throw new SyncRequestError("request_aborted");
    }
    const request = requestAzureSpeechAudio(
      token,
      variant.speechText,
      variant.speechRate,
      ENGLISH_SPEECH_LOCALE,
      ENGLISH_SPEECH_VOICE_NAME
    );
    activeSpeechRequest = request;
    try {
      return await request;
    } finally {
      if (activeSpeechRequest === request) {
        activeSpeechRequest = null;
      }
    }
  }

  async function playCorrectFeedbackSequence(variant) {
    if (speechInitializationPromise !== null) {
      await speechInitializationPromise;
    }
    if (!speechEnabled || speechAudio === null) {
      setStatus(SPEECH_GESTURE_STATUS);
      return;
    }

    speechRunId += 1;
    const runId = speechRunId;
    cancelActiveSpeech();
    const voiceResultPromise = requestCorrectFeedbackVoice(runId, variant).then(
      (audioData) => ({ audioData, error: null }),
      (error) => ({ audioData: null, error })
    );
    const chimeCompleted = await playCorrectFeedbackAudioBlob(
      new Blob([createCorrectChimeWave(variant)], { type: "audio/wav" }),
      runId,
      "正解音"
    );
    if (!chimeCompleted || runId !== speechRunId) {
      activeSpeechRequest?.abort();
      await voiceResultPromise;
      return;
    }

    const voiceResult = await voiceResultPromise;
    if (runId !== speechRunId) {
      return;
    }
    if (voiceResult.error !== null) {
      if (voiceResult.error?.code !== "request_aborted") {
        setStatus(speechErrorMessage(voiceResult.error));
      }
      return;
    }

    const voiceCompleted = await playCorrectFeedbackAudioBlob(
      new Blob([voiceResult.audioData], { type: "audio/mpeg" }),
      runId,
      variant.speechText
    );
    if (voiceCompleted && runId === speechRunId) {
      setStatus("正解完了");
    }
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
      } catch {
        setStatus("正解feedbackを再生できません");
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
      void maybeContinuePendingCelebration();
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
