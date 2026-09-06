export function installSpeechController(app) {
  function showSpeechGestureError(error = null) {
    const detail = { code: "autoplay_blocked" };
    if (typeof error?.message === "string" && error.message !== "") {
      detail.message = error.message;
    }
    app.showReaderError(
      "speech-gesture",
      "読み上げを開始できません",
      `${app.SPEECH_GESTURE_STATUS}. このdialogを閉じる操作で再試行します.`,
      detail
    );
  }
  
  function initializeSpeechPlayback(runId, onReady, onUnavailable) {
    app.speechAudio.src = app.SILENT_AUDIO_DATA_URL;
  
    let playPromise;
    try {
      playPromise = app.speechAudio.play();
    } catch (error) {
      app.speechAudio.src = "";
      onUnavailable(error);
      return;
    }
  
    Promise.resolve(playPromise)
      .then(() => {
        app.speechAudio.pause();
        app.speechAudio.src = "";
        app.speechAudio.load?.();
        if (runId === app.speechRunId) {
          onReady();
        }
      })
      .catch((error) => {
        app.speechAudio.src = "";
        if (runId === app.speechRunId) {
          onUnavailable(error);
        }
      });
  }
  
  function finishSpeechInitialization() {
    const resolve = app.speechInitializationResolve;
    app.speechInitializationResolve = null;
    app.speechInitializationPromise = null;
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
    locale = app.JAPANESE_SPEECH_LOCALE,
    voiceName = app.JAPANESE_SPEECH_VOICE_NAME
  ) {
    const request = app.gmXMLHttpRequest({
      method: "POST",
      url: app.AZURE_SPEECH_URL,
      timeout: app.SPEECH_TIMEOUT_MS,
      responseType: "arraybuffer",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": app.AZURE_SPEECH_OUTPUT_FORMAT,
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
        app.clearAzureSpeechToken();
        throw new app.SyncRequestError("speech_unauthorized", response.status);
      }
      if (response.status === 429) {
        throw new app.SyncRequestError("speech_quota_exceeded", response.status);
      }
      throw new app.SyncRequestError("speech_request_failed", response.status);
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
    const cancelPlayback = app.activeSpeechPlaybackCancel;
    app.activeSpeechPlaybackCancel = null;
    app.speechPaused = false;
    app.speechAudio?.pause();
    if (app.speechAudio) {
      app.speechAudio.onplay = null;
      app.speechAudio.onended = null;
      app.speechAudio.onerror = null;
      app.speechAudio.src = "";
      app.speechAudio.load?.();
    }
    if (app.activeSpeechAudioURL) {
      URL.revokeObjectURL(app.activeSpeechAudioURL);
      app.activeSpeechAudioURL = "";
    }
    cancelPlayback?.();
  }
  
  function cancelActiveSpeech() {
    app.speechChunkSession = null;
    for (const request of app.activeSpeechRequests) {
      request.abort();
    }
    app.activeSpeechRequests.clear();
    clearActiveSpeechAudio();
  }
  
  async function playActiveSpeechAudio(runId) {
    try {
      await app.speechAudio.play();
    } catch (error) {
      if (runId === app.speechRunId) {
        cancelActiveSpeech();
        app.speechEnabled = false;
        app.currentPageReadPending = true;
        showSpeechGestureError(error);
      }
    }
  }
  
  function toggleSpeechPause() {
    if (!app.speechEnabled || !app.activeSpeechAudioURL || app.speechAudio === null) {
      return false;
    }
  
    if (!app.speechPaused) {
      app.speechAudio.pause();
      app.speechPaused = true;
      return true;
    }
  
    app.speechPaused = false;
    void playActiveSpeechAudio(app.speechRunId);
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
      const token = await app.getAzureSpeechToken();
      if (app.speechChunkSession !== session || session.runId !== app.speechRunId) {
        throw new app.SyncRequestError("request_aborted");
      }
      const request = requestAzureSpeechAudio(
        token,
        session.chunks[index],
        session.rate,
        session.locale,
        session.voiceName
      );
      app.activeSpeechRequests.add(request);
      try {
        return await request;
      } finally {
        app.activeSpeechRequests.delete(request);
      }
    })().then(
      (audioData) => ({ audioData, error: null }),
      (error) => ({ audioData: null, error })
    );
    session.prepared.set(index, prepared);
    return prepared;
  }
  
  async function playSpeechChunk(session, index) {
    if (app.speechChunkSession !== session || session.runId !== app.speechRunId) {
      return;
    }
    if (index >= session.chunks.length) {
      app.speechChunkSession = null;
      return;
    }
  
    const result = await prepareSpeechChunk(session, index);
    session.prepared.delete(index);
    if (app.speechChunkSession !== session || session.runId !== app.speechRunId) {
      return;
    }
    if (result.error !== null) {
      app.speechChunkSession = null;
      if (result.error?.code !== "request_aborted") {
        app.showReaderError(
          "speech-request",
          "音声を取得できません",
          `${speechErrorMessage(result.error)}. 通信状態を確認してください.`,
          result.error
        );
      }
      return;
    }
  
    clearActiveSpeechAudio();
    app.activeSpeechAudioURL = URL.createObjectURL(
      new Blob([result.audioData], { type: "audio/mpeg" })
    );
    app.speechAudio.src = app.activeSpeechAudioURL;
    app.speechAudio.onplay = () => {
      if (app.speechChunkSession === session && session.runId === app.speechRunId) {
        app.speechPaused = false;
        void prepareSpeechChunk(session, index + 1);
      }
    };
  
    app.speechAudio.onended = () => {
      if (app.speechChunkSession === session && session.runId === app.speechRunId) {
        clearActiveSpeechAudio();
        void playSpeechChunk(session, index + 1);
      }
    };
  
    app.speechAudio.onerror = () => {
      if (app.speechChunkSession !== session || session.runId !== app.speechRunId) {
        return;
      }
  
      app.speechChunkSession = null;
      clearActiveSpeechAudio();
      app.showReaderError(
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
    locale = app.JAPANESE_SPEECH_LOCALE,
    voiceName = app.JAPANESE_SPEECH_VOICE_NAME
  ) {
    if (!app.speechEnabled) {
      return;
    }
  
    const chunks = app.splitText(text);
    if (chunks.length === 0) {
      app.showReaderError(
        "speech-content",
        `${label}を読み上げられません`,
        `${label}の本文を取得できませんでした.`,
        { code: "speech_text_missing" }
      );
      return;
    }
  
    app.speechRunId += 1;
    const runId = app.speechRunId;
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
    app.speechChunkSession = session;
    void playSpeechChunk(session, 0);
  }
  
  function writeWaveText(view, offset, value) {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  }
  
  function createCorrectChimeWave(variant) {
    const { duration, gain, tones } = variant.chime;
    const sampleCount = Math.ceil(app.CORRECT_CHIME_SAMPLE_RATE * duration);
    const buffer = new ArrayBuffer(44 + sampleCount * 2);
    const view = new DataView(buffer);
  
    writeWaveText(view, 0, "RIFF");
    view.setUint32(4, 36 + sampleCount * 2, true);
    writeWaveText(view, 8, "WAVE");
    writeWaveText(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, app.CORRECT_CHIME_SAMPLE_RATE, true);
    view.setUint32(28, app.CORRECT_CHIME_SAMPLE_RATE * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeWaveText(view, 36, "data");
    view.setUint32(40, sampleCount * 2, true);
  
    for (let index = 0; index < sampleCount; index += 1) {
      const time = index / app.CORRECT_CHIME_SAMPLE_RATE;
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
    if (app.speechAudio === null || runId !== app.speechRunId) {
      return Promise.resolve(false);
    }
  
    clearActiveSpeechAudio();
    if (typeof source === "string") {
      app.speechAudio.src = source;
    } else {
      app.activeSpeechAudioURL = URL.createObjectURL(source);
      app.speechAudio.src = app.activeSpeechAudioURL;
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
      app.activeSpeechPlaybackCancel = cancelPlayback;
  
      app.speechAudio.onplay = () => {
        if (runId === app.speechRunId) {
          app.speechPaused = false;
        }
      };
      app.speechAudio.onended = () => {
        if (runId !== app.speechRunId) {
          return;
        }
        if (app.activeSpeechPlaybackCancel === cancelPlayback) {
          app.activeSpeechPlaybackCancel = null;
        }
        clearActiveSpeechAudio();
        settle(true);
      };
      app.speechAudio.onerror = () => {
        if (runId !== app.speechRunId) {
          return;
        }
        if (app.activeSpeechPlaybackCancel === cancelPlayback) {
          app.activeSpeechPlaybackCancel = null;
        }
        clearActiveSpeechAudio();
        app.showReaderError(
          "correct-feedback-playback",
          "正解feedbackを再生できません",
          "Browserの音声出力を確認してください.",
          { code: "feedback_playback_failed" }
        );
        settle(false);
      };
  
      let playPromise;
      try {
        playPromise = app.speechAudio.play();
      } catch (error) {
        if (app.activeSpeechPlaybackCancel === cancelPlayback) {
          app.activeSpeechPlaybackCancel = null;
        }
        clearActiveSpeechAudio();
        showSpeechGestureError(error);
        settle(false);
        return;
      }
      Promise.resolve(playPromise).catch((error) => {
        if (runId !== app.speechRunId) {
          return;
        }
        if (app.activeSpeechPlaybackCancel === cancelPlayback) {
          app.activeSpeechPlaybackCancel = null;
        }
        clearActiveSpeechAudio();
        showSpeechGestureError(error);
        settle(false);
      });
    });
  }
  
  async function prepareCorrectFeedbackKpiAudio(remainingPromise, runId) {
    const remaining = await remainingPromise;
    if (runId !== app.speechRunId) {
      return null;
    }
    const token = await app.getAzureSpeechToken();
    if (runId !== app.speechRunId) {
      return null;
    }
    const text = String(remaining);
    const request = requestAzureSpeechAudio(
      token,
      text,
      app.ANSWER_RESULT_SPEECH_RATE
    );
    app.activeSpeechRequests.add(request);
    try {
      return { audioData: await request, text };
    } finally {
      app.activeSpeechRequests.delete(request);
    }
  }
  
  async function playCorrectFeedbackSequence(variant, remainingPromise) {
    if (app.speechInitializationPromise !== null) {
      await app.speechInitializationPromise;
    }
    if (!app.speechEnabled || app.speechAudio === null) {
      return false;
    }
  
    app.speechRunId += 1;
    const runId = app.speechRunId;
    cancelActiveSpeech();
    const preparedKpiAudioPromise = prepareCorrectFeedbackKpiAudio(
      remainingPromise,
      runId
    ).then(
      (prepared) => ({ error: null, prepared }),
      (error) => ({ error, prepared: null })
    );
    const chimeCompleted = await playFeedbackAudio(
      new Blob([createCorrectChimeWave(variant)], { type: "audio/wav" }),
      runId,
      "正解音"
    );
    if (!chimeCompleted || runId !== app.speechRunId) {
      return;
    }
  
    const voiceCompleted = await playFeedbackAudio(
      app.FEEDBACK_AUDIO_DATA_URLS[variant.id],
      runId,
      variant.speechText
    );
    if (!voiceCompleted || runId !== app.speechRunId) {
      return false;
    }
  
    const kpiAudio = await preparedKpiAudioPromise;
    if (kpiAudio.error !== null) {
      throw kpiAudio.error;
    }
    if (kpiAudio.prepared === null || runId !== app.speechRunId) {
      return false;
    }
    return playFeedbackAudio(
      new Blob([kpiAudio.prepared.audioData], { type: "audio/mpeg" }),
      runId,
      kpiAudio.prepared.text
    );
  }
  
  function beginCorrectAnswerFeedback(sourceDocument = app.frameDocument) {
    if (
      sourceDocument?.body === undefined ||
      sourceDocument !== app.frameDocument ||
      app.correctFeedbackDocuments.has(sourceDocument)
    ) {
      return false;
    }
  
    app.correctFeedbackDocuments.add(sourceDocument);
    app.awaitingAnswerResultSpeech = false;
    const variant = app.chooseCorrectFeedbackVariant();
    const remainingPromise = app.waitForCorrectFeedbackKpi(app.currentQuestionId());
  
    const previousFeedback = app.correctFeedbackPromise ?? Promise.resolve();
    const scheduledFeedback = previousFeedback.then(async () => {
      app.showCorrectFeedbackVisual(variant, sourceDocument);
      const minimumDuration = new Promise((resolve) => {
        window.setTimeout(resolve, app.CORRECT_FEEDBACK_MINIMUM_DURATION_MS);
      });
      try {
        await Promise.all([
          playCorrectFeedbackSequence(variant, remainingPromise),
          minimumDuration,
        ]);
      } catch (error) {
        app.showReaderError(
          "correct-feedback",
          "正解feedbackを再生できません",
          "音声出力を確認してください.",
          error
        );
      }
      await app.completeCorrectFeedbackVisual();
    });
    app.correctFeedbackPromise = scheduledFeedback;
    void scheduledFeedback.then(() => {
      if (app.correctFeedbackPromise !== scheduledFeedback) {
        return;
      }
      app.correctFeedbackPromise = null;
      app.processCurrentPageSpeech();
      void app.maybePreparePendingDestination();
    });
    return true;
  }
  
  function speakAnswerResult(answerResult) {
    if (answerResult === "correct") {
      beginCorrectAnswerFeedback();
      return;
    }
  
    const label = "不正解";
    app.awaitingAnswerResultSpeech = false;
    void (async () => {
      if (app.speechInitializationPromise !== null) {
        await app.speechInitializationPromise;
      }
      if (!app.speechEnabled || app.speechAudio === null) {
        return;
      }
      app.speechRunId += 1;
      const runId = app.speechRunId;
      cancelActiveSpeech();
      await playFeedbackAudio(
        app.FEEDBACK_AUDIO_DATA_URLS.incorrect,
        runId,
        label
      );
    })();
  }
  
  function readCurrentPage() {
    if (!app.speechEnabled) {
      return;
    }
  
    const answerResult = app.getCurrentAnswerResult();
    if (answerResult !== "unknown") {
      speakAnswerResult(answerResult);
      return;
    }
  
    const questionText = app.extractQuestionText();
    if (!questionText) {
      app.showReaderError(
        "question-speech-content",
        "問題文を読み上げられません",
        "問題pageから読み上げ対象の本文を取得できませんでした.",
        { code: "question_text_missing" }
      );
      return;
    }
  
    app.awaitingAnswerResultSpeech = true;
    speakText(`問題文。${questionText}`, "問題文", app.QUESTION_SPEECH_RATE);
  }

  Object.defineProperties(app, {
    showSpeechGestureError: { enumerable: false, get: () => showSpeechGestureError },
    initializeSpeechPlayback: { enumerable: false, get: () => initializeSpeechPlayback },
    finishSpeechInitialization: { enumerable: false, get: () => finishSpeechInitialization },
    escapeSpeechText: { enumerable: false, get: () => escapeSpeechText },
    buildSpeechSSML: { enumerable: false, get: () => buildSpeechSSML },
    requestAzureSpeechAudio: { enumerable: false, get: () => requestAzureSpeechAudio },
    speechErrorMessage: { enumerable: false, get: () => speechErrorMessage },
    clearActiveSpeechAudio: { enumerable: false, get: () => clearActiveSpeechAudio },
    cancelActiveSpeech: { enumerable: false, get: () => cancelActiveSpeech },
    playActiveSpeechAudio: { enumerable: false, get: () => playActiveSpeechAudio },
    toggleSpeechPause: { enumerable: false, get: () => toggleSpeechPause },
    prepareSpeechChunk: { enumerable: false, get: () => prepareSpeechChunk },
    playSpeechChunk: { enumerable: false, get: () => playSpeechChunk },
    speakText: { enumerable: false, get: () => speakText },
    writeWaveText: { enumerable: false, get: () => writeWaveText },
    createCorrectChimeWave: { enumerable: false, get: () => createCorrectChimeWave },
    playFeedbackAudio: { enumerable: false, get: () => playFeedbackAudio },
    prepareCorrectFeedbackKpiAudio: { enumerable: false, get: () => prepareCorrectFeedbackKpiAudio },
    playCorrectFeedbackSequence: { enumerable: false, get: () => playCorrectFeedbackSequence },
    beginCorrectAnswerFeedback: { enumerable: false, get: () => beginCorrectAnswerFeedback },
    speakAnswerResult: { enumerable: false, get: () => speakAnswerResult },
    readCurrentPage: { enumerable: false, get: () => readCurrentPage },
  });
}
