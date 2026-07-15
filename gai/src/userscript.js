// ==UserScript==
// @name         GAI Opus 4.8 Guided Learning
// @namespace    local.gai.force-opus
// @description  GAIでClaude Opus 4.8, Thinking, Effort Max, 指定システムプロンプトを自動設定します.
// @match        https://ddu8kbg9xidvx.cloudfront.net/*
// @run-at       document-idle
// @noframes
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  if (window.top !== window.self) {
    return;
  }

  const TARGET_MODEL = "Claude Opus 4.8";
  const TARGET_EFFORT = "max";
  const SYSTEM_PROMPT_LABEL = "システムプロンプト";
  const SYSTEM_PROMPT = __SYSTEM_PROMPT_JSON__;
  const THINKING_ICON_SIGNATURE = "M230,136.49";
  const SETTINGS_ICON_SIGNATURE = "M40,88H73";
  const APPLY_PROMPT_ICON_SIGNATURE = "M244,56v48";
  const RECONCILE_DELAY_MS = 80;
  const CONTROL_WAIT_MS = 2500;

  const nonModelButtons = new WeakSet();
  const handledPromptFields = new WeakSet();
  const configuredSettingsButtons = new WeakMap();
  const recentClicks = new WeakMap();
  const reportedFailures = new Set();

  let reconcileTimer = null;
  let reconcileRunning = false;
  let reconcileRequested = false;

  function normalizeText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function isVisible(element) {
    if (!(element instanceof Element) || !element.isConnected) {
      return false;
    }
    const style = getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      element.getClientRects().length > 0
    );
  }

  function findButtonByIcon(signature, root = document) {
    return [...root.querySelectorAll("button")].find((button) => {
      if (!isVisible(button) || button.closest('[role="dialog"]')) {
        return false;
      }
      return [...button.querySelectorAll("svg path")].some((path) =>
        (path.getAttribute("d") ?? "").startsWith(signature)
      );
    });
  }

  function findButtonByIconInside(root, signature) {
    return [...root.querySelectorAll("button")].find(
      (button) =>
        isVisible(button) &&
        [...button.querySelectorAll("svg path")].some((path) =>
          (path.getAttribute("d") ?? "").startsWith(signature)
        )
    );
  }

  function waitFor(check, timeoutMs = CONTROL_WAIT_MS) {
    const startedAt = Date.now();
    return new Promise((resolve) => {
      const poll = () => {
        const result = check();
        if (result) {
          resolve(result);
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          resolve(null);
          return;
        }
        setTimeout(poll, 50);
      };
      poll();
    });
  }

  function clickOnceWhilePending(button) {
    const previousClick = recentClicks.get(button) ?? 0;
    if (Date.now() - previousClick < CONTROL_WAIT_MS) {
      return false;
    }
    recentClicks.set(button, Date.now());
    button.click();
    return true;
  }

  function setNativeValue(element, value) {
    const prototype = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (!descriptor?.set) {
      throw new Error("対象コントロールにnative value setterがありません.");
    }
    descriptor.set.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function findSelectedModelButton() {
    return [...document.querySelectorAll('button[aria-haspopup="listbox"]')].find(
      (button) =>
        isVisible(button) &&
        !button.closest('[role="dialog"]') &&
        normalizeText(button.textContent) === TARGET_MODEL
    );
  }

  function findOpenListbox(button) {
    const controlledId = button.getAttribute("aria-controls");
    if (!controlledId) {
      return null;
    }
    const controlled = document.getElementById(controlledId);
    return controlled?.getAttribute("role") === "listbox" && isVisible(controlled)
      ? controlled
      : null;
  }

  async function ensureModel() {
    if (findSelectedModelButton()) {
      return true;
    }

    const candidates = [
      ...document.querySelectorAll('button[aria-haspopup="listbox"]'),
    ].filter(
      (button) =>
        isVisible(button) &&
        !button.closest('[role="dialog"]') &&
        !nonModelButtons.has(button)
    );

    for (const button of candidates) {
      if (!clickOnceWhilePending(button)) {
        continue;
      }
      const listbox = await waitFor(() => findOpenListbox(button));
      if (!listbox) {
        nonModelButtons.add(button);
        continue;
      }

      const targetOption = [...listbox.querySelectorAll('[role="option"]')].find(
        (option) => normalizeText(option.textContent) === TARGET_MODEL
      );
      if (!targetOption) {
        nonModelButtons.add(button);
        if (button.getAttribute("aria-expanded") === "true") {
          button.click();
          await waitFor(
            () => button.getAttribute("aria-expanded") !== "true",
            600
          );
        }
        continue;
      }

      targetOption.click();
      const selected = await waitFor(findSelectedModelButton);
      if (!selected) {
        reportFailure("model", "モデルの選択結果を確認できませんでした.");
        return false;
      }
      console.info(`[GAI Force] モデル: ${TARGET_MODEL}`);
      return true;
    }

    return false;
  }

  function isThinkingEnabled(button) {
    return (
      button.classList.contains("text-aws-smile") &&
      button.classList.contains("border-aws-smile")
    );
  }

  async function ensureThinking() {
    const button = findButtonByIcon(THINKING_ICON_SIGNATURE);
    if (!button) {
      return false;
    }
    if (isThinkingEnabled(button)) {
      return true;
    }
    if (!clickOnceWhilePending(button)) {
      return false;
    }
    const enabled = await waitFor(() => {
      const current = findButtonByIcon(THINKING_ICON_SIGNATURE);
      return current && isThinkingEnabled(current) ? current : null;
    });
    if (!enabled) {
      reportFailure("thinking", "Thinkingを有効化できませんでした.");
      return false;
    }
    console.info("[GAI Force] Thinking: ON");
    return true;
  }

  function isEffortSelect(select) {
    if (!(select instanceof HTMLSelectElement) || !isVisible(select)) {
      return false;
    }
    const values = [...select.options].map((option) => option.value);
    return ["max", "high", "medium", "low"].every((value) =>
      values.includes(value)
    );
  }

  function findEffortSelect() {
    return [...document.querySelectorAll("select")].find(isEffortSelect);
  }

  async function closeEffortDialog(select) {
    const dialog = select.closest('[role="dialog"]');
    const closeButton = dialog?.querySelector('button[title="閉じる"]');
    if (!(closeButton instanceof HTMLButtonElement)) {
      reportFailure("effort-dialog", "詳細設定を閉じるボタンが見つかりません.");
      return false;
    }
    closeButton.click();
    const closed = await waitFor(
      () => !dialog.isConnected || !isVisible(dialog),
      CONTROL_WAIT_MS
    );
    if (!closed) {
      reportFailure("effort-dialog", "詳細設定を閉じられませんでした.");
      return false;
    }
    return true;
  }

  async function ensureEffort() {
    const screenKey = `${location.pathname}${location.search}`;
    const settingsButton = findButtonByIcon(SETTINGS_ICON_SIGNATURE);
    let select = findEffortSelect();

    if (!select && !settingsButton) {
      return false;
    }
    if (
      !select &&
      settingsButton &&
      configuredSettingsButtons.get(settingsButton) === screenKey
    ) {
      return true;
    }
    if (!select && settingsButton) {
      if (!clickOnceWhilePending(settingsButton)) {
        return false;
      }
      select = await waitFor(findEffortSelect);
    }
    if (!select) {
      reportFailure("effort", "Effort設定が見つかりませんでした.");
      return false;
    }

    if (select.value !== TARGET_EFFORT) {
      setNativeValue(select, TARGET_EFFORT);
      const updated = await waitFor(() => {
        const current = findEffortSelect();
        return current?.value === TARGET_EFFORT ? current : null;
      });
      if (!updated) {
        reportFailure("effort", "EffortをMaxへ変更できませんでした.");
        return false;
      }
      select = updated;
      console.info("[GAI Force] Effort: Max");
    }

    const closed = await closeEffortDialog(select);
    if (!closed) {
      return false;
    }
    const currentSettingsButton = findButtonByIcon(SETTINGS_ICON_SIGNATURE);
    if (!currentSettingsButton) {
      reportFailure("effort-button", "詳細設定ボタンを再取得できませんでした.");
      return false;
    }
    configuredSettingsButtons.set(currentSettingsButton, screenKey);
    return true;
  }

  function directText(element) {
    return normalizeText(
      [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent)
        .join(" ")
    );
  }

  function findSystemPromptHeading() {
    return [...document.querySelectorAll("div")].find(
      (element) =>
        isVisible(element) &&
        !element.closest('[role="dialog"]') &&
        directText(element) === SYSTEM_PROMPT_LABEL
    );
  }

  function findSystemPromptControl() {
    const heading = findSystemPromptHeading();
    if (!heading) {
      return null;
    }

    let container = heading.parentElement;
    for (let depth = 0; container && depth < 8; depth += 1) {
      const textarea = [...container.querySelectorAll("textarea")].find(
        (element) => isVisible(element) && !element.closest('[role="dialog"]')
      );
      const applyButton = findButtonByIconInside(
        container,
        APPLY_PROMPT_ICON_SIGNATURE
      );
      if (textarea && applyButton) {
        return { textarea, applyButton };
      }
      container = container.parentElement;
    }
    return null;
  }

  async function ensureSystemPrompt() {
    let control = findSystemPromptControl();
    if (!control) {
      const heading = findSystemPromptHeading();
      if (!heading) {
        return true;
      }
      if (!clickOnceWhilePending(heading)) {
        return false;
      }
      control = await waitFor(findSystemPromptControl);
      if (!control) {
        reportFailure(
          "system-prompt-expand",
          "システムプロンプト欄を展開できませんでした."
        );
        return false;
      }
    }
    if (handledPromptFields.has(control.textarea)) {
      return true;
    }
    if (
      control.textarea.value === SYSTEM_PROMPT &&
      control.applyButton.disabled
    ) {
      handledPromptFields.add(control.textarea);
      return true;
    }
    if (control.textarea.value !== SYSTEM_PROMPT) {
      setNativeValue(control.textarea, SYSTEM_PROMPT);
    }

    control = await waitFor(() => {
      const current = findSystemPromptControl();
      return current?.textarea.value === SYSTEM_PROMPT &&
        !current.applyButton.disabled
        ? current
        : null;
    });
    if (!control) {
      reportFailure(
        "system-prompt-input",
        "システムプロンプトを入力可能な状態にできませんでした."
      );
      return false;
    }
    control.applyButton.click();

    const committed = await waitFor(() => {
      const current = findSystemPromptControl();
      return current?.textarea.value === SYSTEM_PROMPT &&
        current.applyButton.disabled
        ? current
        : null;
    });
    if (!committed) {
      reportFailure("system-prompt-commit", "システムプロンプトを適用できませんでした.");
      return false;
    }

    handledPromptFields.add(committed.textarea);
    console.info("[GAI Force] システムプロンプトを適用しました.");
    return true;
  }

  function reportFailure(key, message) {
    const scopedKey = `${location.pathname}:${key}`;
    if (reportedFailures.has(scopedKey)) {
      return;
    }
    reportedFailures.add(scopedKey);
    console.error(`[GAI Force] ${message}`);
  }

  async function reconcile() {
    if (!(await ensureModel())) {
      return;
    }
    if (!(await ensureThinking())) {
      return;
    }
    if (!(await ensureEffort())) {
      return;
    }
    await ensureSystemPrompt();
  }

  async function runReconcile() {
    reconcileTimer = null;
    if (reconcileRunning) {
      reconcileRequested = true;
      return;
    }
    reconcileRunning = true;
    reconcileRequested = false;
    try {
      await reconcile();
    } catch (error) {
      reportFailure("unexpected", String(error));
    } finally {
      reconcileRunning = false;
      if (reconcileRequested) {
        scheduleReconcile();
      }
    }
  }

  function scheduleReconcile() {
    reconcileRequested = true;
    if (reconcileRunning || reconcileTimer !== null) {
      return;
    }
    reconcileTimer = setTimeout(runReconcile, RECONCILE_DELAY_MS);
  }

  const observer = new MutationObserver(scheduleReconcile);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "aria-expanded", "disabled"],
  });
  document.addEventListener("change", scheduleReconcile, true);
  window.addEventListener("popstate", scheduleReconcile);

  scheduleReconcile();
})();
