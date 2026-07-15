const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { chromium } = require("playwright");

const projectRoot = path.resolve(__dirname, "..");
const scriptPath = path.join(projectRoot, "gai.user.js");
const promptPath = path.join(projectRoot, "system-prompt.md");

async function installMockGAI(page) {
  await page.evaluate(() => {
    const TARGET_MODEL = "Claude Opus 4.8";
    const THINKING_PATH =
      "M230,136.49A102.12,102.12,0,1,1,119.51,26a6,6,0,0,1,1,12";
    const SETTINGS_PATH =
      "M40,88H73a32,32,0,0,0,62,0h81a8,8,0,0,0,0-16";
    const APPLY_PATH =
      "M244,56v48a12,12,0,0,1-12,12H184a12,12,0,1,1,0-24";
    const MODEL_OPTIONS = [
      "Claude Sonnet 4.6",
      TARGET_MODEL,
      "Nova Lite",
    ];
    const DEFAULT_PROMPT = "GAI default system prompt";

    const state = {
      route: "chat",
      conversation: 1,
      model: "Claude Sonnet 4.6",
      thinking: false,
      effort: "high",
      systemPrompt: DEFAULT_PROMPT,
      draftSystemPrompt: DEFAULT_PROMPT,
      irrelevantListClicks: 0,
      modelListClicks: 0,
      modelSelections: 0,
      thinkingClicks: 0,
      settingsClicks: 0,
      effortChanges: 0,
      promptInputEvents: 0,
      promptApplyClicks: 0,
      promptHeadingClicks: 0,
      promptExpanded: false,
    };

    const icon = (pathData) => {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", pathData);
      svg.append(path);
      return svg;
    };

    const createListboxButton = ({ id, text, options, onSelect, onOpen }) => {
      const button = document.createElement("button");
      button.id = id;
      button.type = "button";
      button.textContent = text;
      button.setAttribute("aria-haspopup", "listbox");
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-controls", `${id}-options`);
      button.addEventListener("click", () => {
        const existing = document.getElementById(`${id}-options`);
        if (existing) {
          existing.remove();
          button.setAttribute("aria-expanded", "false");
          return;
        }
        onOpen();
        button.setAttribute("aria-expanded", "true");
        const listbox = document.createElement("div");
        listbox.id = `${id}-options`;
        listbox.setAttribute("role", "listbox");
        for (const optionText of options) {
          const option = document.createElement("button");
          option.type = "button";
          option.setAttribute("role", "option");
          option.textContent = optionText;
          option.addEventListener("click", (event) => {
            event.stopPropagation();
            onSelect(optionText);
          });
          listbox.append(option);
        }
        button.after(listbox);
      });
      return button;
    };

    const openEffortDialog = () => {
      if (document.querySelector('[role="dialog"]')) {
        return;
      }
      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");

      const title = document.createElement("h3");
      title.textContent = "詳細設定";
      dialog.append(title);

      const close = document.createElement("button");
      close.type = "button";
      close.title = "閉じる";
      close.textContent = "閉じる";
      close.addEventListener("click", () => dialog.remove());
      dialog.append(close);

      const label = document.createElement("div");
      label.textContent = "推論の労力";
      dialog.append(label);

      const select = document.createElement("select");
      for (const [value, text] of [
        ["max", "Max"],
        ["high", "High"],
        ["medium", "Medium"],
        ["low", "Low"],
      ]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = text;
        select.append(option);
      }
      select.value = state.effort;
      select.addEventListener("change", () => {
        state.effort = select.value;
        state.effortChanges += 1;
      });
      dialog.append(select);
      document.body.append(dialog);
    };

    const render = () => {
      const app = document.getElementById("app");
      app.replaceChildren();

      if (state.route !== "chat") {
        const text = document.createElement("p");
        text.textContent = "対象コントロールがない画面";
        app.append(text);
        return;
      }

      const irrelevant = createListboxButton({
        id: "category-select",
        text: "カテゴリ",
        options: ["一般", "専門"],
        onOpen: () => {
          state.irrelevantListClicks += 1;
        },
        onSelect: () => {},
      });
      app.append(irrelevant);

      const model = createListboxButton({
        id: "model-select",
        text: state.model,
        options: MODEL_OPTIONS,
        onOpen: () => {
          state.modelListClicks += 1;
        },
        onSelect: (selected) => {
          state.model = selected;
          state.modelSelections += 1;
          if (selected === TARGET_MODEL) {
            state.thinking = false;
            state.effort = "high";
            state.systemPrompt = DEFAULT_PROMPT;
            state.draftSystemPrompt = DEFAULT_PROMPT;
          }
          render();
        },
      });
      app.append(model);

      if (state.model !== TARGET_MODEL) {
        return;
      }

      const composer = document.createElement("section");
      composer.id = "composer";

      const thinking = document.createElement("button");
      thinking.id = "thinking";
      thinking.type = "button";
      thinking.className = state.thinking
        ? "text-aws-smile border-aws-smile"
        : "text-gray-400 border-gray-400";
      thinking.append(icon(THINKING_PATH));
      thinking.addEventListener("click", () => {
        state.thinking = !state.thinking;
        state.thinkingClicks += 1;
        render();
      });
      composer.append(thinking);

      const settings = document.createElement("button");
      settings.id = "settings";
      settings.type = "button";
      settings.append(icon(SETTINGS_PATH));
      settings.addEventListener("click", () => {
        state.settingsClicks += 1;
        openEffortDialog();
      });
      composer.append(settings);

      const promptSection = document.createElement("section");
      promptSection.id = "system-prompt-control";
      const heading = document.createElement("div");
      heading.append(icon("M9 18l6-6-6-6"));
      heading.append("システムプロンプト");
      heading.addEventListener("click", () => {
        state.promptHeadingClicks += 1;
        state.promptExpanded = !state.promptExpanded;
        render();
      });
      promptSection.append(heading);

      if (!state.promptExpanded) {
        composer.append(promptSection);
        app.append(composer);
        return;
      }

      const textarea = document.createElement("textarea");
      textarea.id = "system-prompt";
      textarea.value = state.draftSystemPrompt;
      textarea.addEventListener("input", (event) => {
        state.draftSystemPrompt = event.target.value;
        state.promptInputEvents += 1;
        render();
      });
      promptSection.append(textarea);

      const apply = document.createElement("button");
      apply.id = "apply-system-prompt";
      apply.type = "button";
      apply.disabled = state.draftSystemPrompt === state.systemPrompt;
      apply.append(icon(APPLY_PATH));
      apply.addEventListener("click", () => {
        if (apply.disabled) {
          return;
        }
        state.systemPrompt = state.draftSystemPrompt;
        state.promptApplyClicks += 1;
        render();
      });
      promptSection.append(apply);

      composer.append(promptSection);
      app.append(composer);
    };

    window.mockGAI = {
      state,
      render,
      startNewConversation() {
        state.conversation += 1;
        state.model = "Claude Sonnet 4.6";
        state.thinking = false;
        state.effort = "high";
        state.systemPrompt = DEFAULT_PROMPT;
        state.draftSystemPrompt = DEFAULT_PROMPT;
        state.promptExpanded = false;
        render();
      },
      editPromptWithinConversation(value) {
        state.systemPrompt = value;
        state.draftSystemPrompt = value;
        const textarea = document.getElementById("system-prompt");
        textarea.disabled = false;
        textarea.value = value;
        textarea.dispatchEvent(new Event("change", { bubbles: true }));
      },
      showSaveDialog() {
        const dialog = document.createElement("div");
        dialog.id = "save-dialog";
        dialog.setAttribute("role", "dialog");
        const label = document.createElement("span");
        label.textContent = "システムプロンプト";
        const textarea = document.createElement("textarea");
        textarea.id = "saved-prompt";
        textarea.value = "保存ダイアログの内容";
        dialog.append(label, textarea);
        document.body.append(dialog);
      },
      showEmptyRoute() {
        state.route = "empty";
        history.pushState({}, "", "/other/");
        render();
      },
      addMutationBurst() {
        for (let index = 0; index < 25; index += 1) {
          const noise = document.createElement("span");
          noise.textContent = `noise-${index}`;
          document.getElementById("app").append(noise);
        }
      },
    };

    render();
  });
}

async function main() {
  execFileSync("python3", ["build.py"], {
    cwd: projectRoot,
    stdio: "inherit",
  });

  const script = fs.readFileSync(scriptPath, "utf8");
  const systemPrompt = fs.readFileSync(promptPath, "utf8");
  assert.equal(script.includes("// @version"), false);
  assert.equal(systemPrompt.includes("`説明済みだが適用未確認`"), true);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    const scriptErrors = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") {
        scriptErrors.push(message.text());
      }
    });

    await page.route("https://ddu8kbg9xidvx.cloudfront.net/**", (route) =>
      route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: "<!doctype html><html><body><main id=\"app\"></main></body></html>",
      }),
    );
    await page.goto("https://ddu8kbg9xidvx.cloudfront.net/chat/");
    await installMockGAI(page);
    await page.addScriptTag({ content: script });

    await page.waitForFunction(
      ({ prompt }) => {
        const state = window.mockGAI.state;
        return (
          state.model === "Claude Opus 4.8" &&
          state.thinking === true &&
          state.effort === "max" &&
          state.systemPrompt === prompt &&
          document.getElementById("apply-system-prompt")?.disabled === true
        );
      },
      { prompt: systemPrompt },
    );
    await page.waitForTimeout(700);

    const firstState = await page.evaluate(() => ({ ...window.mockGAI.state }));
    assert.equal(firstState.irrelevantListClicks, 1);
    assert.equal(firstState.modelSelections, 1);
    assert.equal(firstState.thinkingClicks, 1);
    assert.equal(firstState.effortChanges, 1);
    assert.equal(firstState.promptApplyClicks, 1);
    assert.equal(firstState.promptHeadingClicks, 1);

    await page.evaluate(() => window.mockGAI.addMutationBurst());
    await page.waitForTimeout(700);
    const stableState = await page.evaluate(() => ({ ...window.mockGAI.state }));
    assert.equal(stableState.modelSelections, firstState.modelSelections);
    assert.equal(stableState.thinkingClicks, firstState.thinkingClicks);
    assert.equal(stableState.settingsClicks, firstState.settingsClicks);
    assert.equal(stableState.promptApplyClicks, firstState.promptApplyClicks);

    await page.evaluate(() => {
      window.mockGAI.editPromptWithinConversation("会話内で編集した内容");
    });
    await page.waitForTimeout(500);
    assert.equal(
      await page.locator("#system-prompt").inputValue(),
      "会話内で編集した内容",
    );
    assert.equal(
      await page.evaluate(() => window.mockGAI.state.promptApplyClicks),
      1,
    );

    await page.evaluate(() => window.mockGAI.showSaveDialog());
    await page.waitForTimeout(500);
    assert.equal(
      await page.locator("#saved-prompt").inputValue(),
      "保存ダイアログの内容",
    );

    await page.evaluate(() => {
      document.getElementById("save-dialog").remove();
      window.mockGAI.startNewConversation();
    });
    await page.waitForFunction(
      ({ prompt }) => {
        const state = window.mockGAI.state;
        return (
          state.conversation === 2 &&
          state.model === "Claude Opus 4.8" &&
          state.thinking === true &&
          state.effort === "max" &&
          state.systemPrompt === prompt &&
          state.promptApplyClicks === 2
        );
      },
      { prompt: systemPrompt },
    );

    await page.evaluate(() => window.mockGAI.showEmptyRoute());
    await page.waitForTimeout(500);
    assert.equal(
      await page.locator("#app").innerText(),
      "対象コントロールがない画面",
    );

    assert.deepEqual(pageErrors, []);
    assert.deepEqual(scriptErrors, []);
  } finally {
    await browser.close();
  }

  console.log("gai smoke test passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
