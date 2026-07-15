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
    if (!text || compactLine(text).includes("è§£ç­”ã™ã‚‹")) {
      return "";
    }

    return text;
  }
  // END QUESTION EXTRACTION

  function extractQuestionText() {
    return extractQuestionTextFromDocument(frameDocument);
  }

  const EXPLANATION_LOCK_TEXT = "è§£èª¬ã¯å•é¡Œã«å›ç­”ã™ã‚‹ã¨è¡¨ç¤ºã•ã‚Œã¾ã™";

  function normalizePageStateText(rawText) {
    return compactLine(rawText).replace(/[ã€‚ï¼]+$/u, "");
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
    return /^ã“ã®éå»å•ã®è§£èª¬(?:ï¼ˆ\d+ä»¶ï¼‰)?$/.test(compactLine(line));
  }

  function isExplanationEnd(line) {
    const compact = compactLine(line);
    return (
      compact.startsWith("ï¼ˆè¨‚æ­£ä¾é ¼ãƒ»å ±å‘Šã¯ã“ã¡ã‚‰ï¼‰") ||
      /^å‰ã®å•é¡Œ(?:ï¼ˆå•\d+ï¼‰)?ã¸$/.test(compact) ||
      /^ä»¤å’Œ.+å•é¡Œä¸€è¦§$/.test(compact) ||
      compact === "TOP"
    );
  }

  function isExplanationNoise(line) {
    const compact = compactLine(line);
    return (
      compact === "è§£ç­”çµæœ" ||
      compact === "è§£èª¬ã¯å•é¡Œã«å›ç­”ã™ã‚‹ã¨" ||
      compact === "è¡¨ç¤ºã•ã‚Œã¾ã™ã€‚" ||
      compact === "è¡¨ç¤ºã•ã‚Œã¾ã™" ||
      /^\d{2}$/.test(compact) ||
      /^å‚è€ƒã«ãªã£ãŸæ•°\d+$/.test(compact) ||
      compact === "å‚è€ƒã«ãªã£ãŸ" ||
      compact === "å‚è€ƒã«ãªã‚‰ãªã‹ã£ãŸ" ||
      compact === "ã“ã®è§£èª¬ã®ä¿®æ­£ã‚’ææ¡ˆã™ã‚‹" ||
      compact.toLowerCase() === "advertisement" ||
      compact === "æ¬¡ã®å•é¡Œã¯ä¸‹ã¸"
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
    const sentences = text.match(/[^ã€‚ï¼ï¼Ÿ!?]+[ã€‚ï¼ï¼Ÿ!?]?/g) ?? [];
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

  function selectJapaneseVoice() {
    const voices = speech.getVoices();
    return (
      voices.find((voice) => voice.lang === "ja-JP") ??
      voices.find((voice) => voice.lang.toLowerCase().startsWith("ja")) ??
      null
    );
  }

  function speakChunks(chunks, runId, label, rate, index = 0) {
    if (runId !== speechRunId) {
      return;
    }

    if (index >= chunks.length) {
      activeUtterance = null;
      stopButton.style.display = "none";
      setStatus(`${label}å®Œäº†`);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(chunks[index]);
    utterance.lang = "ja-JP";
    utterance.rate = rate;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    const voice = selectJapaneseVoice();
    if (voice) {
      utterance.voice = voice;
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
      setStatus(`éŸ³å£°ã‚¨ãƒ©ãƒ¼ ${event.error || "unknown"}`);
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
      setStatus(`${label}·
K–>[–ú_Ÿ7ûo
M€¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô((€€€ÍÁ••¡IÕ¹%€¬ô€Äì(€€€½¹ÍĞÉÕ¹%€ôÍÁ••¡IÕ¹%ì(€€€ÍÁ•• ¹…¹•° ¤ì(€€€Í•ÑMÑ…ÑÕÌ¡€‘í±…‰•±÷šê[–
g’âµ€¤ì(€€€ÍÁ•…­¡Õ¹­Ì¡¡Õ¹­Ì°ÉÕ¹%°±…‰•°°É…Ñ”¤ì(€ô((€™Õ¹Ñ¥½¸É•…‘ÕÉÉ•¹ÑA…” ¤ì(€€€¥˜€ …ÍÁ••¡¹…‰±•¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô((€€€½¹ÍĞìÅÕ•ÍÑ¥½¹Q•áĞ°•áÁ±…¹…Ñ¥½¹Q•áĞô€ô•áÑÉ…ÑI•…‘…‰±•M•Ñ¥½¹Ì ¤ì(€€€±…ÍÑáÁ±…¹…Ñ¥½¹Q•áĞ€ô•áÁ±…¹…Ñ¥½¹Q•áĞì((€€€¥˜€¡•áÁ±…¹…Ñ¥½¹Q•áĞ¤ì(€€€€€ÕÉÉ•¹ÑEÕ•ÍÑ¥½¹Q•áĞ€ô€ˆˆì(