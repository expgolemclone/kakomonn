  const style = document.createElement("style");
  style.textContent = `
    :root {
      color-scheme: dark;
      --kakomonn-reader-p-ink-1000: oklch(0.13 0.012 255);
      --kakomonn-reader-p-ink-950: oklch(0.17 0.014 255);
      --kakomonn-reader-p-ink-900: oklch(0.22 0.018 255);
      --kakomonn-reader-p-ink-850: oklch(0.27 0.022 255);
      --kakomonn-reader-p-ink-700: oklch(0.36 0.025 255);
      --kakomonn-reader-p-ink-400: oklch(0.75 0.025 255);
      --kakomonn-reader-p-ink-50: oklch(0.97 0.006 255);
      --kakomonn-reader-p-blue-500: oklch(0.62 0.18 255);
      --kakomonn-reader-p-blue-300: oklch(0.83 0.08 255);
      --kakomonn-reader-p-green-500: oklch(0.57 0.12 155);
      --kakomonn-reader-p-amber-400: oklch(0.79 0.14 80);
      --kakomonn-reader-p-red-400: oklch(0.74 0.17 25);
      --kakomonn-reader-canvas: var(--kakomonn-reader-p-ink-1000);
      --kakomonn-reader-surface: var(--kakomonn-reader-p-ink-950);
      --kakomonn-reader-raised: var(--kakomonn-reader-p-ink-900);
      --kakomonn-reader-text: var(--kakomonn-reader-p-ink-50);
      --kakomonn-reader-muted: var(--kakomonn-reader-p-ink-400);
      --kakomonn-reader-border: var(--kakomonn-reader-p-ink-700);
      --kakomonn-reader-primary: var(--kakomonn-reader-p-blue-500);
      --kakomonn-reader-copy: var(--kakomonn-reader-p-green-500);
      --kakomonn-reader-focus-ring: var(--kakomonn-reader-p-blue-300);
      --kakomonn-reader-error: var(--kakomonn-reader-p-red-400);
      --kakomonn-reader-metric-accent: oklch(0.79 0.12 221);
      --kakomonn-reader-success: oklch(0.79 0.14 151);
      --kakomonn-reader-time-track: oklch(0.32 0.02 255);
      --kakomonn-reader-time-question: oklch(0.72 0.16 245);
      --kakomonn-reader-time-explanation: oklch(0.74 0.16 150);
      --kakomonn-reader-control-gap: 8px;
      --kakomonn-reader-control-gutter: 8px;
      --kakomonn-reader-control-radius: 16px;
      --kakomonn-reader-control-shadow:
        0 6px 22px oklch(0.04 0.01 255 / 0.34);
    }

    html, body {
      width: 100% !important;
      height: 100svh !important;
      margin: 0 !important;
      padding: 0 !important;
      overflow: hidden !important;
      background: var(--kakomonn-reader-canvas) !important;
      color: var(--kakomonn-reader-text) !important;
    }

    body[data-kakomonn-reader-ui="true"] {
      display: block !important;
    }

    #kakomonn-next-question-launcher {
      min-height: 100svh;
      height: 100%;
      display: grid;
      place-items: center;
      padding:
        max(32px, env(safe-area-inset-top))
        max(20px, env(safe-area-inset-right))
        max(32px, env(safe-area-inset-bottom))
        max(20px, env(safe-area-inset-left));
      box-sizing: border-box;
      overflow-y: auto;
      background:
        radial-gradient(
          circle at 18% 12%,
          oklch(0.52 0.13 258 / 0.22),
          transparent 42%
        ),
        radial-gradient(
          circle at 88% 90%,
          oklch(0.46 0.09 222 / 0.14),
          transparent 38%
        ),
        var(--kakomonn-reader-canvas);
      color: var(--kakomonn-reader-text);
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      -webkit-font-smoothing: antialiased;
    }

    #kakomonn-next-question-panel {
      --kakomonn-launcher-accent: var(--kakomonn-reader-primary);
      container-type: inline-size;
      width: min(100%, 420px);
      display: grid;
      gap: 24px;
      padding: 28px 24px 24px;
      box-sizing: border-box;
      border: 1px solid oklch(0.72 0.025 255 / 0.22);
      border-radius: 28px;
      background: oklch(0.19 0.018 255 / 0.92);
      box-shadow:
        0 28px 80px oklch(0.03 0.01 255 / 0.5),
        inset 0 1px 0 oklch(0.97 0.006 255 / 0.06);
      backdrop-filter: blur(20px);
    }

    #kakomonn-next-question-panel[data-state="service-error"] {
      --kakomonn-launcher-accent: var(--kakomonn-reader-error);
    }

    #kakomonn-next-question-panel[data-state="empty"] {
      --kakomonn-launcher-accent: var(--kakomonn-reader-p-green-500);
    }

    #kakomonn-next-question-brand {
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--kakomonn-reader-muted);
      font-size: 12px;
      font-weight: 750;
      letter-spacing: 0.16em;
    }

    #kakomonn-next-question-brand::before {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--kakomonn-launcher-accent);
      box-shadow: 0 0 18px var(--kakomonn-launcher-accent);
      content: "";
    }

    #kakomonn-next-question-content {
      display: grid;
      gap: 14px;
    }

    #kakomonn-next-question-indicator {
      position: relative;
      width: 52px;
      height: 52px;
      display: grid;
      place-items: center;
      border: 1px solid oklch(0.72 0.025 255 / 0.18);
      border-radius: 17px;
      background: oklch(0.25 0.025 255 / 0.78);
      color: var(--kakomonn-launcher-accent);
    }

    #kakomonn-next-question-indicator::before,
    #kakomonn-next-question-indicator::after {
      position: absolute;
      box-sizing: border-box;
      content: "";
    }

    [data-state="loading"] #kakomonn-next-question-indicator::before {
      width: 24px;
      height: 24px;
      border: 2px solid oklch(0.72 0.025 255 / 0.22);
      border-top-color: var(--kakomonn-launcher-accent);
      border-radius: 50%;
      animation: kakomonn-launcher-spin 900ms linear infinite;
    }

    [data-state="service-error"]
      #kakomonn-next-question-indicator::before {
      width: 4px;
      height: 18px;
      border-radius: 999px;
      background: currentColor;
      transform: translateY(-4px);
    }

    [data-state="service-error"]
      #kakomonn-next-question-indicator::after {
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: currentColor;
      transform: translateY(10px);
    }

    [data-state="empty"] #kakomonn-next-question-indicator::before {
      width: 24px;
      height: 13px;
      border-bottom: 3px solid currentColor;
      border-left: 3px solid currentColor;
      transform: translateY(-3px) rotate(-45deg);
    }

    #kakomonn-next-question-title,
    #next-question-status {
      margin: 0;
    }

    #kakomonn-next-question-title {
      max-width: 14ch;
      font-size: clamp(26px, 21px + 2cqi, 34px);
      font-weight: 760;
      letter-spacing: -0.025em;
      line-height: 1.18;
    }

    #next-question-status {
      max-width: 34rem;
      color: var(--kakomonn-reader-muted);
      font-size: 15px;
      line-height: 1.65;
    }

    #kakomonn-next-question-actions {
      display: grid;
      gap: 10px;
    }

    #kakomonn-next-question-actions[hidden] {
      display: none;
    }

    #next-question-retry {
      min-height: 52px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 20px;
      box-sizing: border-box;
      border: 1px solid transparent;
      border-radius: 15px;
      color: var(--kakomonn-reader-text);
      font: 750 16px/1 -apple-system, BlinkMacSystemFont, sans-serif;
      text-align: center;
      text-decoration: none;
      cursor: pointer;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    }

    #next-question-retry[hidden] {
      display: none;
    }

    #next-question-retry {
      background: var(--kakomonn-reader-primary);
    }

    #next-question-retry:active {
      transform: scale(0.98);
    }

    #next-question-retry:focus-visible {
      outline: 2px solid var(--kakomonn-reader-focus-ring);
      outline-offset: 4px;
    }

    @container (max-width: 340px) {
      #kakomonn-next-question-panel {
        gap: 20px;
        padding: 24px 20px 20px;
        border-radius: 24px;
      }

      #kakomonn-next-question-title {
        font-size: 26px;
      }
    }

    @keyframes kakomonn-launcher-spin {
      to {
        transform: rotate(1turn);
      }
    }

    ${CORRECT_FEEDBACK_CSS}

    #kakomonn-reader-shell {
      position: relative;
      z-index: 2147483000;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      background: var(--kakomonn-reader-canvas);
    }

    #kakomonn-reader-frame {
      display: block;
      width: 100%;
      height: 100%;
      border: 0;
      background: var(--kakomonn-reader-canvas);
    }

    #kakomonn-reader-time-limit {
      --kakomonn-reader-time-fill: var(--kakomonn-reader-time-question);
      position: absolute;
      z-index: 3;
      top: 0;
      right: 0;
      left: 0;
      width: 100%;
      height: 4px;
      border: 0;
      appearance: none;
      background: var(--kakomonn-reader-time-track);
      color: var(--kakomonn-reader-time-fill);
      pointer-events: none;
    }

    #kakomonn-reader-time-limit[hidden] {
      display: none;
    }

    #kakomonn-reader-time-limit[data-phase="explanation"] {
      --kakomonn-reader-time-fill: var(--kakomonn-reader-time-explanation);
    }

    #kakomonn-reader-time-limit::-webkit-progress-bar {
      background: var(--kakomonn-reader-time-track);
    }

    #kakomonn-reader-time-limit::-webkit-progress-value {
      background: var(--kakomonn-reader-time-fill);
    }

    #kakomonn-reader-time-limit::-moz-progress-bar {
      background: var(--kakomonn-reader-time-fill);
    }

    #kakomonn-reader-carried-correct-feedback {
      position: absolute;
      z-index: 2;
      margin: 0;
    }

    #kakomonn-reader-carried-correct-feedback[hidden] {
      display: none;
    }

    #kakomonn-reader-carried-correct-feedback[data-rarity="ssr"] {
      inset: 0;
      width: 100%;
      min-height: 100%;
    }

    #kakomonn-reader-sync-settings,
    #kakomonn-reader-error-dialog {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      width: 100%;
      max-width: none;
      height: 100%;
      max-height: none;
      margin: 0;
      padding:
        max(24px, env(safe-area-inset-top))
        max(20px, env(safe-area-inset-right))
        max(24px, env(safe-area-inset-bottom))
        max(20px, env(safe-area-inset-left));
      box-sizing: border-box;
      overflow-y: auto;
      overscroll-behavior: contain;
      border: 0;
      background: transparent;
      color: var(--kakomonn-reader-text);
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    }

    #kakomonn-reader-sync-settings[open],
    #kakomonn-reader-error-dialog[open] {
      display: grid;
      place-items: center;
    }

    #kakomonn-reader-sync-settings:not([open]),
    #kakomonn-reader-error-dialog:not([open]) {
      display: none;
    }

    #kakomonn-reader-sync-settings::backdrop,
    #kakomonn-reader-error-dialog::backdrop {
      background: oklch(0.04 0.01 255 / 0.72);
    }

    #kakomonn-reader-sync-settings-panel,
    #kakomonn-reader-error-panel {
      width: min(420px, 100%);
      max-height: calc(100svh - 48px);
      padding: 22px;
      box-sizing: border-box;
      display: grid;
      gap: 14px;
      overflow-y: auto;
      border: 1px solid var(--kakomonn-reader-border);
      border-radius: 18px;
      background: var(--kakomonn-reader-raised);
      color: var(--kakomonn-reader-text);
      box-shadow: 0 16px 48px oklch(0.04 0.01 255 / 0.38);
    }

    #kakomonn-reader-sync-settings-title,
    #kakomonn-reader-error-title {
      margin: 0;
      font-size: 20px;
    }

    #kakomonn-reader-sync-settings-description,
    #kakomonn-reader-error-message {
      margin: 0;
      font-size: 14px;
      line-height: 1.5;
    }

    #kakomonn-reader-sync-settings-panel > label {
      color: var(--kakomonn-reader-muted);
      font-size: 13px;
      font-weight: 700;
    }

    #kakomonn-reader-sync-token {
      width: 100%;
      min-height: 46px;
      padding: 10px 12px;
      box-sizing: border-box;
      border: 1px solid var(--kakomonn-reader-border);
      border-radius: 10px;
      background: var(--kakomonn-reader-canvas);
      color: var(--kakomonn-reader-text);
      font-size: 16px;
    }

    #kakomonn-reader-sync-settings-error {
      min-height: 20px;
      margin: 0;
      color: var(--kakomonn-reader-error);
      font-size: 13px;
      line-height: 1.4;
    }

    #kakomonn-reader-sync-settings-save,
    #kakomonn-reader-error-retry,
    #kakomonn-reader-error-close {
      min-height: 48px;
      padding: 0 16px;
      border: 0;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 700;
    }

    #kakomonn-reader-sync-settings-save {
      background: var(--kakomonn-reader-primary);
      color: var(--kakomonn-reader-text);
    }

    #kakomonn-reader-error-retry,
    #kakomonn-reader-error-close {
      background: var(--kakomonn-reader-primary);
      color: var(--kakomonn-reader-text);
    }

    #kakomonn-reader-sync-settings-save:disabled,
    #kakomonn-reader-error-retry:disabled {
      opacity: 0.55;
    }

    .kakomonn-reader-dialog-eyebrow {
      margin: 0;
      color: var(--kakomonn-reader-error);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.14em;
    }

    #kakomonn-reader-error-detail {
      display: block;
      padding: 12px;
      border: 1px solid var(--kakomonn-reader-border);
      border-radius: 10px;
      background: var(--kakomonn-reader-canvas);
      color: var(--kakomonn-reader-muted);
      font-size: 12px;
      line-height: 1.5;
      overflow-wrap: anywhere;
      white-space: normal;
    }

    #kakomonn-reader-sync-token:focus-visible,
    #kakomonn-reader-sync-settings-save:focus-visible,
    #kakomonn-reader-error-retry:focus-visible,
    #kakomonn-reader-error-close:focus-visible {
      outline: 3px solid var(--kakomonn-reader-focus-ring);
      outline-offset: 2px;
    }

    @media (prefers-reduced-motion: reduce) {
      [data-state="loading"] #kakomonn-next-question-indicator::before {
        transition: none;
        animation: none;
      }
    }
  `;
  document.documentElement.appendChild(style);
