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
      height: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
      overflow: hidden !important;
      background: var(--kakomonn-reader-canvas) !important;
      color: var(--kakomonn-reader-text) !important;
    }

    body[data-kakomonn-reader-ui="true"] {
      display: grid !important;
      grid-template-rows: auto minmax(0, 1fr) auto;
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

    #kakomonn-reader-controls {
      position: relative;
      z-index: 2147483647;
      display: grid;
      grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.6fr) auto;
      align-items: stretch;
      gap: var(--kakomonn-reader-control-gap);
      min-width: 0;
      padding:
        calc(var(--kakomonn-reader-control-gutter) + env(safe-area-inset-top))
        max(var(--kakomonn-reader-control-gutter), env(safe-area-inset-right))
        var(--kakomonn-reader-control-gutter)
        max(var(--kakomonn-reader-control-gutter), env(safe-area-inset-left));
      box-sizing: border-box;
      background: var(--kakomonn-reader-surface);
      pointer-events: none;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    }

    #kakomonn-reader-time-limit {
      --kakomonn-reader-time-fill: var(--kakomonn-reader-time-question);
      position: absolute;
      right: 0;
      bottom: 0;
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

    #kakomonn-reader-status,
    #kakomonn-reader-learning-metrics,
    #kakomonn-reader-sync-settings-button,
    #kakomonn-reader-learning-metrics-details {
      min-width: 0;
      box-sizing: border-box;
      border: 0;
      border-radius: var(--kakomonn-reader-control-radius);
      background: var(--kakomonn-reader-raised);
      color: var(--kakomonn-reader-text);
      box-shadow: var(--kakomonn-reader-control-shadow);
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    }

    #kakomonn-reader-status,
    #kakomonn-reader-learning-metrics,
    #kakomonn-reader-sync-settings-button {
      min-height: 52px;
    }

    #kakomonn-reader-status {
      display: flex;
      align-items: center;
      padding: 0 12px;
      font-size: 12px;
      font-weight: 700;
      line-height: 1;
      white-space: nowrap;
    }

    #kakomonn-reader-status > span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    #kakomonn-reader-learning-metrics {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      column-gap: 10px;
      row-gap: 2px;
      padding: 6px 12px;
      font: inherit;
      text-align: left;
      pointer-events: auto;
      cursor: pointer;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    }

    #kakomonn-reader-learning-metrics::after {
      grid-column: 2;
      grid-row: 1 / span 2;
      width: 8px;
      height: 8px;
      flex: 0 0 auto;
      border-right: 2px solid var(--kakomonn-reader-muted);
      border-bottom: 2px solid var(--kakomonn-reader-muted);
      transform: translateY(-2px) rotate(45deg);
      transition: transform 140ms ease;
      content: "";
    }

    #kakomonn-reader-learning-metrics[aria-expanded="true"]::after {
      transform: translateY(2px) rotate(225deg);
    }

    .kakomonn-reader-metric {
      display: flex;
      grid-column: 1;
      min-width: 0;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
      white-space: nowrap;
    }

    .kakomonn-reader-metric-label,
    #kakomonn-reader-learning-metrics-details dt {
      min-width: 0;
      color: var(--kakomonn-reader-muted);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.015em;
      overflow-wrap: anywhere;
    }

    .kakomonn-reader-remaining-value {
      display: flex;
      flex: 0 0 auto;
      align-items: baseline;
      gap: 3px;
      color: var(--kakomonn-reader-metric-accent);
    }

    #kakomonn-reader-due-cards-remaining,
    #kakomonn-reader-new-questions-remaining {
      font-size: 20px;
      font-variant-numeric: tabular-nums;
    }

    .kakomonn-reader-remaining-value small {
      color: var(--kakomonn-reader-muted);
      font-size: 10px;
    }

    #kakomonn-reader-sync-settings-button {
      padding: 0 14px;
      font-size: 12px;
      font-weight: 700;
      line-height: 1;
      pointer-events: auto;
      cursor: pointer;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    }

    #kakomonn-reader-learning-metrics-details {
      grid-column: 1 / -1;
      display: grid;
      margin: 0;
      padding: 4px 12px;
    }

    #kakomonn-reader-learning-metrics-details[hidden] {
      display: none;
    }

    .kakomonn-reader-detail-metric {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 16px;
      min-height: 38px;
      border-top: 1px solid var(--kakomonn-reader-border);
    }

    .kakomonn-reader-detail-metric:first-child {
      border-top: 0;
    }

    #kakomonn-reader-learning-metrics-details dd {
      display: flex;
      align-items: baseline;
      gap: 2px;
      margin: 0;
      font-size: 13px;
      font-variant-numeric: tabular-nums;
    }

    #kakomonn-reader-daily-kpi-completed[data-completed="true"],
    #kakomonn-reader-due-cards-completed[data-completed="true"] {
      color: var(--kakomonn-reader-success);
    }

    .kakomonn-reader-visually-hidden {
      position: absolute !important;
      width: 1px !important;
      height: 1px !important;
      padding: 0 !important;
      margin: -1px !important;
      overflow: hidden !important;
      clip: rect(0, 0, 0, 0) !important;
      white-space: nowrap !important;
      border: 0 !important;
    }

    #kakomonn-reader-sync-settings-button:disabled {
      cursor: default;
      opacity: 0.55;
    }

    #kakomonn-reader-actions {
      position: relative;
      z-index: 2147483647;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      align-items: center;
      gap: var(--kakomonn-reader-control-gap);
      min-width: 0;
      padding:
        var(--kakomonn-reader-control-gutter)
        max(var(--kakomonn-reader-control-gutter), env(safe-area-inset-right))
        calc(var(--kakomonn-reader-control-gutter) + env(safe-area-inset-bottom))
        max(var(--kakomonn-reader-control-gutter), env(safe-area-inset-left));
      box-sizing: border-box;
      background: var(--kakomonn-reader-surface);
      pointer-events: none;
    }

    #kakomonn-reader-next,
    #kakomonn-reader-copy {
      width: 100%;
      min-width: 0;
      min-height: 54px;
      padding: 0 12px;
      border: 0;
      border-radius: var(--kakomonn-reader-control-radius);
      color: var(--kakomonn-reader-text);
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-weight: 800;
      line-height: 1;
      box-shadow: var(--kakomonn-reader-control-shadow);
      pointer-events: auto;
      touch-action: manipulation;
      -webkit-user-select: none;
      user-select: none;
      -webkit-tap-highlight-color: transparent;
    }

    #kakomonn-reader-next {
      background: var(--kakomonn-reader-primary);
      font-size: 17px;
    }

    #kakomonn-reader-copy {
      background: var(--kakomonn-reader-copy);
      font-size: 14px;
    }

    #kakomonn-reader-learning-metrics:active,
    #kakomonn-reader-sync-settings-button:active:not(:disabled),
    #kakomonn-reader-next:active:not(:disabled),
    #kakomonn-reader-copy:active:not(:disabled) {
      transform: scale(0.97);
    }

    #kakomonn-reader-next:disabled,
    #kakomonn-reader-copy:disabled {
      background: oklch(0.46 0.01 255 / 0.78);
      opacity: 0.72;
    }

    #kakomonn-reader-sync-settings {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding:
        max(24px, env(safe-area-inset-top))
        max(20px, env(safe-area-inset-right))
        max(24px, env(safe-area-inset-bottom))
        max(20px, env(safe-area-inset-left));
      box-sizing: border-box;
      overflow-y: auto;
      overscroll-behavior: contain;
      background: oklch(0.04 0.01 255 / 0.62);
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    }

    #kakomonn-reader-sync-settings[hidden] {
      display: none;
    }

    #kakomonn-reader-sync-settings-panel {
      width: min(420px, 100%);
      max-height: calc(100svh - 48px);
      margin: auto;
      padding: 22px;
      box-sizing: border-box;
      overflow-y: auto;
      border: 1px solid var(--kakomonn-reader-border);
      border-radius: 18px;
      background: var(--kakomonn-reader-raised);
      color: var(--kakomonn-reader-text);
      box-shadow: 0 16px 48px oklch(0.04 0.01 255 / 0.38);
    }

    #kakomonn-reader-sync-settings-title {
      margin: 0 0 10px;
      font-size: 20px;
    }

    #kakomonn-reader-sync-settings-description {
      margin: 0 0 14px;
      font-size: 14px;
      line-height: 1.5;
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

    #kakomonn-reader-sync-token::placeholder {
      color: var(--kakomonn-reader-muted);
    }

    #kakomonn-reader-sync-settings-error {
      min-height: 20px;
      margin: 10px 0;
      color: var(--kakomonn-reader-error);
      font-size: 13px;
      line-height: 1.4;
    }

    #kakomonn-reader-sync-settings-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    #kakomonn-reader-sync-settings-save,
    #kakomonn-reader-sync-settings-cancel {
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

    #kakomonn-reader-sync-settings-cancel {
      background: var(--kakomonn-reader-border);
      color: var(--kakomonn-reader-text);
    }

    #kakomonn-reader-sync-settings-save:disabled,
    #kakomonn-reader-sync-settings-cancel:disabled {
      opacity: 0.55;
    }

    @media (max-width: 480px) {
      #kakomonn-reader-controls {
        grid-template-columns: minmax(0, 1fr) auto;
      }

      #kakomonn-reader-status {
        grid-column: 1;
        grid-row: 1;
      }

      #kakomonn-reader-sync-settings-button {
        grid-column: 2;
        grid-row: 1;
      }

      #kakomonn-reader-learning-metrics {
        grid-column: 1 / -1;
        grid-row: 2;
      }

      #kakomonn-reader-learning-metrics-details {
        grid-row: 3;
      }
    }

    #kakomonn-reader-next:focus-visible,
    #kakomonn-reader-copy:focus-visible,
    #kakomonn-reader-learning-metrics:focus-visible,
    #kakomonn-reader-sync-settings-button:focus-visible,
    #kakomonn-reader-sync-token:focus-visible,
    #kakomonn-reader-sync-settings-save:focus-visible,
    #kakomonn-reader-sync-settings-cancel:focus-visible {
      outline: 3px solid var(--kakomonn-reader-focus-ring);
      outline-offset: 2px;
    }

    @media (prefers-reduced-motion: reduce) {
      #kakomonn-reader-learning-metrics::after,
      [data-state="loading"] #kakomonn-next-question-indicator::before {
        transition: none;
        animation: none;
      }
    }
  `;
  document.documentElement.appendChild(style);
