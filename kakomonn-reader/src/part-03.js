    if (choiceControls.length < 2) {
      return "";
    }

    const firstChoiceBlock = findFirstChoiceBlock(
      choiceControls[0],
      choiceControls
    );
    if (!isFollowingNode(metadataElement, firstChoiceBlock)) {
      return "";
    }

    const range = documentNode.createRange();
    range.setStartAfter(metadataElement);
    range.setEndBefore(firstChoiceBlock);

    const text = normalizeText(
      visibleStructuredText(
        range.commonAncestorContainer,
        range,
        isQuestionNoiseElement
      )
    );
    if (!text || compactLine(text).includes("解答する")) {
      return "";
    }

    return text;
  }
  // END QUESTION EXTRACTION

  function extractQuestionText() {
    return extractQuestionTextFromDocument(frameDocument);
  }

  const EXPLANATION_LOCK_TEXT = "解説は問題に回答すると表示されます";

  function normalizePageStateText(rawText) {
    return compactLine(rawText).replace(/[。．]+$/u, "");
  }

  function hasVisibleExplanationLock(lines) {
    for (let startIndex = 0; startIndex < lines.length; startIndex += 1) {
      let combinedText = "";

      for (
        let lineOffset = 0;
        lineOffset < 3 && startIndex + lineOffset < lines.length;
        lineOffset += 1
      ) {
        combinedText += normalizePageStateText(
          lines[startIndex + lineOffset]
        );

        if (combinedText === EXPLANATION_LOCK_TEXT) {
          return true;
        }

        if (!EXPLANATION_LOCK_TEXT.startsWith(combinedText)) {
          break;
        }
      }
    }

    return false;
  }

  function isExplanationHeading(line) {
    return /^この過去問の解説(?:（\d+件）)?$/.test(compactLine(line));
  }

  function isExplanationEnd(line) {
    const compact = compactLine(line);
    return (
      compact.startsWith("（訂正依頼・報告はこちら）") ||
      /^前の問題(?:（問\d+）)?へ$/.test(compact) ||
      /^令和.+問題一覧$/.test(compact) ||
      compact === "TOP"
    );
  }

  function isExplanationNoise(line) {
    const compact = compactLine(line);
    return (
      compact === "解答結果" ||
      compact === "解説は問題に回答すると" ||
      compact === "表示されます。" ||
      compact === "表示されます" ||
      /^\d{2}$/.test(compact) ||
      /^参考になった数\d+$/.test(compact) ||
      compact === "参考になった" ||
      compact === "参考にならなかった" ||
      compact === "この解説の修正を提案する" ||
      compact.toLowerCase() === "advertisement" ||
      compact === "次の問題は下へ"
    );
  }

  function extractExplanationText(lines) {
    const headingIndex = findFirstIndex(lines, 0, isExplanationHeading);
    if (headingIndex < 0) {
      return "";
    }

    const endIndex = findFirstIndex(lines, headingIndex + 1, isExplanationEnd);
    if (endIndex < 0) {
      return "";
    }

    const explanationLines = lines
      .slice(headingIndex + 1, endIndex)
      .filter((line) => !isExplanationNoise(line));

    return normalizeText(explanationLines.join("\n"));
  }

  function extractReadableSections() {
    const lines = getVisibleLines();
    const explanationLocked = hasVisibleExplanationLock(lines);

    return {
      questionText: extractQuestionText(),
      explanationText: explanationLocked ? "" : extractExplanationText(lines),
    };
  }

  function splitText(text) {
    const sentences = text.match(/[^。！？!?]+[。！？!?]?/g) ?? [];
    const chunks = [];
    let current = "";

    for (const sentence of sentences) {
      if ((current + sentence).length <= MAX_CHUNK_LENGTH) {
        current += sentence;
        continue;
      }

      if (current) {
        chunks.push(current);
        current = "";
      }

      if (sentence.length <= MAX_CHUNK_LENGTH) {
        current = sentence;
        continue;
      }

      for (
        let offset = 0;
        offset < sentence.length;
        offset += MAX_CHUNK_LENGTH
      ) {
        chunks.push(sentence.slice(offset, offset + MAX_CHUNK_LENGTH));
      }
    }

    if (current) {
      chunks.push(current);
    }

    return chunks;
  }

  function findRequiredSpeechVoice() {
    if (!isWindowsEdge) {
      return null;
    }

    return (
      speech
        .getVoices()
        .find((voice) => voice.name === EDGE_JAPANESE_VOICE_NAME) ?? null
    );
  }

  function initializeSpeechVoice(runId, onReady, onUnavailable) {
    if (!isWindowsEdge) {
      onReady();
      return;
    }

    speechVoice = findRequiredSpeechVoice();
    if (speechVoice !== null) {
      onReady();
      return;
    }

    setStatus("音声準備中");
    const warmupUtterance = new SpeechUtterance("準備");
    warmupUtterance.lang = "ja-JP";
    let warmupFinished = false;

    const finishWarmup = () => {
      if (warmupFinished || runId !== speechRunId) {
        return;
      }

      warmupFinished = true;
      activeUtterance = null;
      speechVoice = findRequiredSpeechVoice();
      if (speechVoice === null) {
        setStatus("日本語音声を利用できません");
        onUnavailable();
        return;
      }

      window.setTimeout(() => {
        if (runId === speechRunId) {
          onReady();
        }
      }, 0);
    };

    warmupUtterance.onend = finishWarmup;
    warmupUtterance.onerror = finishWarmup;
    activeUtterance = warmupUtterance;
    speech.speak(warmupUtterance);
  }

  function speakChunks(chunks, runId, label, rate, index = 0) {
    if (runId !== speechRunId) {
      return;
    }

    if (index >= chunks.length) {
      activeUtterance = null;
      stopButton.style.display = "none";
      setStatus(`${label}完了`);
      return;
    }

    const utterance = new SpeechUtterance(chunks[index]);
    utterance.lang = "ja-JP";
    utterance.rate = rate;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    if (isWindowsEdge) {
      if (speechVoice === null) {
        activeUtterance = null;
        stopButton.style.display = "none";
        setStatus("日本語音声を利用できません");
        return;
      }

      utterance.voice = speechVoice;
    }

    utterance.onstart = () => {
      if (runId === speechRunId) {
        setStatus(`${label} ${index + 1}/${chunks.length}`);
        stopButton.style.display = "block";
      }
    };

    utterance.onend = () => {
      if (runId === speechRunId) {
        speakChunks(chunks, runId, label, rate, index + 1);
      }
    };

    utterance.onerror = (event) => {
      if (runId !== speechRunId) {
        return;
      }

      activeUtterance = null;
      stopButton.style.display = "none";
      setStatus(`音声エラー ${event.error || "unknown"}`);
    };

    activeUtterance = utterance;
    speech.speak(utterance);
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
    speech.cancel();
    setStatus(`${label}準備中`);
    speakChunks(chunks, runId, label, rate);
  }

  function readCurrentPage() {
    if (!speechEnabled) {
      return;
    }

    const { questionText, explanationText } = extractReadableSections();
    lastExplanationText = explanationText;

    if (explanationText) {
      currentQuestionText = "";
