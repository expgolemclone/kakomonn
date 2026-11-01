import mantineStyles from "@mantine/core/styles.css?inline";

export function installReaderStyles() {
  const style = document.createElement("style");
  style.textContent = mantineStyles + `
    html { font-size: 100% !important; }
    html, body { width: 100% !important; height: 100svh !important; margin: 0 !important;
      padding: 0 !important; overflow: hidden !important; background: #0b0d10 !important; }
    body[data-kakomonn-reader-ui="true"] { display: block !important; }
    #kakomonn-reader-shell { position: relative; width: 100%; height: 100%; overflow: hidden; }
    #kakomonn-reader-frame { display: block; width: 100%; height: 100%; border: 0; }
    #kakomonn-reader-time-limit { position: absolute; z-index: 3; inset: 0 0 auto; height: 4px; }
    #kakomonn-reader-study-time { position: absolute; z-index: 4;
      top: max(.5rem, env(safe-area-inset-top)); right: max(.5rem, env(safe-area-inset-right));
      width: clamp(1.45rem, 4.5vw, 1.7rem); height: clamp(1.45rem, 4.5vw, 1.7rem);
      padding: 0; border-radius: 50%; background: oklch(0.08 0 0 / 0.94); color: oklch(0.62 0 0);
      font-size: clamp(.46rem, 1.55vw, .56rem); pointer-events: none; }
    #kakomonn-reader-feedback { position: absolute; z-index: 5; top: 1rem; left: 50%;
      transform: translateX(-50%); width: min(672px, calc(100% - 32px)); pointer-events: none; }
    #kakomonn-next-question-launcher { min-height: 100svh; padding:
      max(24px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right))
      max(24px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left)); }
    #kakomonn-next-question-panel { width: min(420px, 100%); }
  `;
  document.documentElement.appendChild(style);
}
