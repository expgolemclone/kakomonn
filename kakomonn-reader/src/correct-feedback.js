  const CORRECT_FEEDBACK_LEAVE_DURATION_MS = 180;
  const CORRECT_FEEDBACK_MINIMUM_DURATION_MS = 1200;
  const CORRECT_CHIME_SAMPLE_RATE = 22050;
  const CORRECT_FEEDBACK_RANDOM_BUCKETS = 1000;
  const UINT16_RANGE = 0x10000;

  const CORRECT_FEEDBACK_VARIANTS = Object.freeze([
    Object.freeze({
      id: "normal",
      label: "NORMAL",
      displayText: "That's Right!!",
      speechText: "That's right!",
      chime: Object.freeze({
        duration: 0.72,
        gain: 0.34,
        tones: Object.freeze([
          Object.freeze({ duration: 0.18, frequency: 880, start: 0 }),
          Object.freeze({ duration: 0.5, frequency: 659.25, start: 0.22 }),
        ]),
      }),
    }),
    Object.freeze({
      id: "rare",
      label: "RARE",
      displayText: "Nice! That's Right!!",
      speechText: "Nice! That's right!",
      chime: Object.freeze({
        duration: 0.74,
        gain: 0.3,
        tones: Object.freeze([
          Object.freeze({ duration: 0.24, frequency: 1046.5, start: 0 }),
          Object.freeze({ duration: 0.24, frequency: 1318.51, start: 0.16 }),
          Object.freeze({ duration: 0.42, frequency: 1567.98, start: 0.32 }),
        ]),
      }),
    }),
    Object.freeze({
      id: "super-rare",
      label: "SUPER RARE",
      displayText: "Amazing! That's Right!!",
      speechText: "Amazing! That's right!",
      chime: Object.freeze({
        duration: 0.86,
        gain: 0.27,
        tones: Object.freeze([
          Object.freeze({ duration: 0.3, frequency: 783.99, start: 0 }),
          Object.freeze({ duration: 0.3, frequency: 987.77, start: 0.13 }),
          Object.freeze({ duration: 0.3, frequency: 1174.66, start: 0.26 }),
          Object.freeze({ duration: 0.47, frequency: 1567.98, start: 0.39 }),
        ]),
      }),
    }),
    Object.freeze({
      id: "ssr",
      label: "SSR",
      displayText: "Legendary! That's Right!!",
      speechText: "Legendary! That's right!",
      chime: Object.freeze({
        duration: 1.02,
        gain: 0.23,
        tones: Object.freeze([
          Object.freeze({ duration: 0.25, frequency: 523.25, start: 0 }),
          Object.freeze({ duration: 0.25, frequency: 659.25, start: 0.09 }),
          Object.freeze({ duration: 0.25, frequency: 783.99, start: 0.18 }),
          Object.freeze({ duration: 0.38, frequency: 1046.5, start: 0.32 }),
          Object.freeze({ duration: 0.38, frequency: 1318.51, start: 0.43 }),
          Object.freeze({ duration: 0.48, frequency: 1567.98, start: 0.54 }),
        ]),
      }),
    }),
  ]);

  const CORRECT_FEEDBACK_VARIANT_BY_ID = new Map(
    CORRECT_FEEDBACK_VARIANTS.map((variant) => [variant.id, variant])
  );

  const CORRECT_FEEDBACK_CSS = `
    .kakomonn-reader-correct-feedback {
      --kakomonn-feedback-accent: oklch(0.79 0.14 151);
      --kakomonn-feedback-border: oklch(0.72 0.14 151);
      --kakomonn-feedback-surface: oklch(0.29 0.075 151);
      --kakomonn-feedback-text: oklch(0.97 0.02 151);
      position: relative;
      isolation: isolate;
      display: grid;
      width: min(100%, 34rem);
      min-height: 72px;
      margin: 16px auto;
      place-content: center;
      gap: 8px;
      overflow: hidden;
      box-sizing: border-box;
      border: 2px solid var(--kakomonn-feedback-border);
      border-radius: 18px;
      padding: 14px 20px;
      background: var(--kakomonn-feedback-surface);
      color: var(--kakomonn-feedback-text);
      box-shadow: 0 12px 36px oklch(0.08 0.025 151 / 0.42);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      text-align: center;
      pointer-events: none;
      animation: kakomonn-correct-feedback-enter 180ms cubic-bezier(.2, .8, .2, 1) both;
    }

    .kakomonn-reader-correct-feedback::before,
    .kakomonn-reader-correct-feedback::after {
      position: absolute;
      z-index: 0;
      pointer-events: none;
      content: "";
    }

    .kakomonn-reader-correct-feedback-badge,
    .kakomonn-reader-correct-feedback-message {
      position: relative;
      z-index: 1;
    }

    .kakomonn-reader-correct-feedback-badge {
      justify-self: center;
      border: 1px solid color-mix(in oklch, var(--kakomonn-feedback-accent), white 28%);
      border-radius: 999px;
      padding: 4px 9px;
      background: color-mix(in oklch, var(--kakomonn-feedback-surface), black 18%);
      color: var(--kakomonn-feedback-accent);
      font-size: 11px;
      font-weight: 850;
      line-height: 1;
      letter-spacing: .14em;
    }

    .kakomonn-reader-correct-feedback-message {
      font-size: clamp(24px, 7vw, 48px);
      font-weight: 900;
      line-height: 1;
      letter-spacing: -.035em;
      overflow-wrap: anywhere;
    }

    .kakomonn-reader-correct-feedback[data-rarity="rare"] {
      --kakomonn-feedback-accent: oklch(0.84 0.13 215);
      --kakomonn-feedback-border: oklch(0.72 0.15 215);
      --kakomonn-feedback-surface: oklch(0.27 0.075 222);
      --kakomonn-feedback-text: oklch(0.97 0.025 215);
      width: min(100%, 38rem);
      min-height: 88px;
      box-shadow:
        0 16px 48px oklch(0.12 0.06 220 / 0.56),
        0 0 32px oklch(0.72 0.15 215 / 0.3);
    }

    .kakomonn-reader-correct-feedback[data-rarity="rare"]::before {
      inset: -80% -30%;
      background: linear-gradient(
        115deg,
        transparent 38%,
        oklch(0.96 0.04 215 / 0.52) 48%,
        transparent 58%
      );
      animation: kakomonn-correct-feedback-sheen 900ms ease-out both;
    }

    .kakomonn-reader-correct-feedback[data-rarity="rare"]
      .kakomonn-reader-correct-feedback-message {
      font-size: clamp(28px, 7.5vw, 54px);
    }

    .kakomonn-reader-correct-feedback[data-rarity="super-rare"] {
      --kakomonn-feedback-accent: oklch(0.82 0.18 315);
      --kakomonn-feedback-border: oklch(0.7 0.21 315);
      --kakomonn-feedback-surface: oklch(0.25 0.09 305);
      --kakomonn-feedback-text: oklch(0.98 0.025 315);
      width: min(100%, 42rem);
      min-height: 108px;
      border-width: 3px;
      box-shadow:
        0 20px 64px oklch(0.1 0.07 300 / 0.62),
        0 0 42px oklch(0.72 0.2 315 / 0.4),
        inset 0 0 28px oklch(0.85 0.12 330 / 0.12);
    }

    .kakomonn-reader-correct-feedback[data-rarity="super-rare"]::before {
      inset: 5px;
      border: 1px solid oklch(0.92 0.08 320 / 0.62);
      border-radius: 13px;
      animation: kakomonn-correct-feedback-ring 780ms ease-out both;
    }

    .kakomonn-reader-correct-feedback[data-rarity="super-rare"]::after {
      inset: -45%;
      background:
        radial-gradient(circle at 20% 30%, white 0 2px, transparent 3px),
        radial-gradient(circle at 76% 24%, white 0 1px, transparent 2px),
        radial-gradient(circle at 68% 76%, white 0 2px, transparent 3px),
        radial-gradient(circle at 30% 82%, white 0 1px, transparent 2px);
      opacity: .7;
      animation: kakomonn-correct-feedback-sparkle 900ms ease-out both;
    }

    .kakomonn-reader-correct-feedback[data-rarity="super-rare"]
      .kakomonn-reader-correct-feedback-message {
      font-size: clamp(34px, 8vw, 64px);
    }

    .kakomonn-reader-correct-feedback[data-rarity="ssr"] {
      --kakomonn-feedback-accent: oklch(0.9 0.17 92);
      --kakomonn-feedback-border: oklch(0.88 0.16 88);
      --kakomonn-feedback-surface: oklch(0.2 0.055 75);
      --kakomonn-feedback-text: oklch(0.99 0.025 94);
      position: fixed;
      z-index: 2147483647;
      inset: 0;
      width: auto;
      min-height: 100%;
      margin: 0;
      border: 0;
      border-radius: 0;
      padding:
        max(28px, env(safe-area-inset-top))
        max(20px, env(safe-area-inset-right))
        max(28px, env(safe-area-inset-bottom))
        max(20px, env(safe-area-inset-left));
      background:
        radial-gradient(circle at 50% 48%, oklch(0.55 0.16 86 / 0.56), transparent 34%),
        radial-gradient(circle at 50% 50%, oklch(0.28 0.08 74), oklch(0.12 0.025 70) 74%);
      box-shadow: inset 0 0 90px oklch(0.9 0.17 92 / 0.24);
    }

    .kakomonn-reader-correct-feedback[data-rarity="ssr"]::before {
      inset: -55vmax;
      background: repeating-conic-gradient(
        from 0deg,
        oklch(0.96 0.1 94 / 0.2) 0deg 5deg,
        transparent 5deg 14deg
      );
      animation: kakomonn-correct-feedback-rays 6s linear infinite;
    }

    .kakomonn-reader-correct-feedback[data-rarity="ssr"]::after {
      inset: 0;
      background:
        radial-gradient(circle at 12% 18%, white 0 2px, transparent 3px),
        radial-gradient(circle at 84% 15%, oklch(0.95 0.12 95) 0 3px, transparent 4px),
        radial-gradient(circle at 75% 72%, white 0 2px, transparent 3px),
        radial-gradient(circle at 18% 78%, oklch(0.95 0.12 95) 0 3px, transparent 4px),
        radial-gradient(circle at 92% 48%, white 0 2px, transparent 3px),
        radial-gradient(circle at 42% 9%, oklch(0.95 0.12 95) 0 2px, transparent 3px);
      filter: drop-shadow(0 0 8px oklch(0.92 0.14 92));
      animation: kakomonn-correct-feedback-particles 900ms ease-out both;
    }

    .kakomonn-reader-correct-feedback[data-rarity="ssr"]
      .kakomonn-reader-correct-feedback-badge {
      padding: 7px 15px;
      font-size: 14px;
      letter-spacing: .22em;
      box-shadow: 0 0 24px oklch(0.9 0.17 92 / 0.56);
    }

    .kakomonn-reader-correct-feedback[data-rarity="ssr"]
      .kakomonn-reader-correct-feedback-message {
      max-width: 15ch;
      font-size: clamp(42px, 12vw, 92px);
      line-height: .96;
      text-shadow:
        0 0 18px oklch(0.96 0.12 95 / 0.5),
        0 5px 0 oklch(0.38 0.1 76 / 0.72);
    }

    .kakomonn-reader-correct-feedback[data-state="leaving"] {
      animation: kakomonn-correct-feedback-leave 180ms ease-in both;
    }

    @keyframes kakomonn-correct-feedback-enter {
      from {
        opacity: 0;
        transform: translateY(8px) scale(.94);
      }
    }

    @keyframes kakomonn-correct-feedback-leave {
      to {
        opacity: 0;
        transform: translateY(-10px) scale(.98);
      }
    }

    @keyframes kakomonn-correct-feedback-sheen {
      from { transform: translateX(-58%) rotate(8deg); }
      to { transform: translateX(58%) rotate(8deg); }
    }

    @keyframes kakomonn-correct-feedback-ring {
      from { opacity: 0; transform: scale(.82); }
      55% { opacity: 1; }
      to { opacity: .5; transform: scale(1); }
    }

    @keyframes kakomonn-correct-feedback-sparkle {
      from { opacity: 0; transform: rotate(-8deg) scale(.72); }
      45% { opacity: 1; }
      to { opacity: .7; transform: rotate(8deg) scale(1); }
    }

    @keyframes kakomonn-correct-feedback-rays {
      to { transform: rotate(1turn); }
    }

    @keyframes kakomonn-correct-feedback-particles {
      from { opacity: 0; transform: scale(.58); }
      45% { opacity: 1; }
      to { opacity: .85; transform: scale(1); }
    }

    @media (prefers-reduced-motion: reduce) {
      .kakomonn-reader-correct-feedback,
      .kakomonn-reader-correct-feedback[data-state="leaving"],
      .kakomonn-reader-correct-feedback::before,
      .kakomonn-reader-correct-feedback::after {
        animation: none;
        transition: none;
      }
    }
  `;

  const correctFeedbackDocuments = new WeakSet();
  const correctFeedbackKpiResolvers = new Map();
  let correctFeedbackPromise = null;
  let correctFeedbackRemovalTimer = null;

  function calculateKpiQuestionsRemaining(metrics) {
    const remaining =
      metrics.dueCardsRemaining + metrics.newQuestionsRemaining;
    if (!Number.isSafeInteger(remaining) || remaining < 0) {
      throw new TypeError("KPI questions remaining is invalid.");
    }
    return remaining;
  }

  function waitForCorrectFeedbackKpi(questionId) {
    if (!/^\d+$/.test(questionId ?? "")) {
      return Promise.reject(
        new TypeError("Correct feedback question ID is invalid.")
      );
    }
    if (
      pendingAttempt?.phase === "recorded" &&
      pendingAttempt.answerResult === "correct" &&
      pendingAttempt.questionId === questionId
    ) {
      return Promise.resolve(pendingAttempt.kpiQuestionsRemaining);
    }
    return new Promise((resolve) => {
      const resolvers = correctFeedbackKpiResolvers.get(questionId) ?? [];
      resolvers.push(resolve);
      correctFeedbackKpiResolvers.set(questionId, resolvers);
    });
  }

  function resolveCorrectFeedbackKpi(questionId, remaining) {
    if (
      !/^\d+$/.test(questionId ?? "") ||
      !Number.isSafeInteger(remaining) ||
      remaining < 0
    ) {
      throw new TypeError("Correct feedback KPI result is invalid.");
    }
    const resolvers = correctFeedbackKpiResolvers.get(questionId);
    if (resolvers === undefined || resolvers.length === 0) {
      return false;
    }
    const resolve = resolvers.shift();
    if (resolvers.length === 0) {
      correctFeedbackKpiResolvers.delete(questionId);
    }
    resolve(remaining);
    return true;
  }

  function randomIntegerBelow(limit, cryptoSource = globalThis.crypto) {
    if (
      !Number.isSafeInteger(limit) ||
      limit <= 0 ||
      limit > UINT16_RANGE
    ) {
      throw new RangeError("limit must be between 1 and 65536.");
    }
    if (typeof cryptoSource?.getRandomValues !== "function") {
      throw new TypeError("Crypto random values are unavailable.");
    }

    const acceptedRange = UINT16_RANGE - (UINT16_RANGE % limit);
    const values = new Uint16Array(1);
    do {
      cryptoSource.getRandomValues(values);
    } while (values[0] >= acceptedRange);
    return values[0] % limit;
  }

  function chooseCorrectFeedbackVariant(cryptoSource = globalThis.crypto) {
    const bucket = randomIntegerBelow(
      CORRECT_FEEDBACK_RANDOM_BUCKETS,
      cryptoSource
    );
    if (bucket === 0) {
      return CORRECT_FEEDBACK_VARIANT_BY_ID.get("ssr");
    }
    if (bucket <= 10) {
      return CORRECT_FEEDBACK_VARIANT_BY_ID.get("super-rare");
    }
    if (bucket <= 110) {
      return CORRECT_FEEDBACK_VARIANT_BY_ID.get("rare");
    }
    return CORRECT_FEEDBACK_VARIANT_BY_ID.get("normal");
  }

  function renderCorrectFeedbackElement(element, variant) {
    if (
      !(element instanceof element.ownerDocument.defaultView.HTMLElement) ||
      !CORRECT_FEEDBACK_VARIANTS.includes(variant)
    ) {
      throw new TypeError("Correct feedback rendering input is invalid.");
    }

    const ownerDocument = element.ownerDocument;
    const badge = ownerDocument.createElement("span");
    badge.className = "kakomonn-reader-correct-feedback-badge";
    badge.textContent = variant.label;
    const message = ownerDocument.createElement("span");
    message.className = "kakomonn-reader-correct-feedback-message";
    message.textContent = variant.displayText;
    element.dataset.rarity = variant.id;
    element.setAttribute("aria-hidden", "true");
    element.replaceChildren(badge, message);
  }
