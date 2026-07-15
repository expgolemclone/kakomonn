const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { chromium } = require("playwright");

const projectRoot = path.resolve(__dirname, "..");
const repositoryRoot = path.resolve(projectRoot, "..");
const scriptPath = path.join(projectRoot, "chatgpt-initial-prompt.user.js");
const promptPath = path.join(repositoryRoot, "system-prompt.md");
const script = fs.readFileSync(scriptPath, "utf8");
const systemPrompt = fs.readFileSync(promptPath, "utf8");
const leadingBlankLines = 3;
const expectedPrompt = "\n".repeat(leadingBlankLines) + systemPrompt;

async function preparePage(browser) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.addInitScript({ content: script });
  await page.route("https://chatgpt.com/**", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: "<!doctype html><html><body><main id=\"app\"></main></body></html>",
    }),
  );
  await page.goto("https://chatgpt.com/");

  return { page, errors };
}

async function testTextarea(browser) {
  const { page, errors } = await preparePage(browser);
  try {
    await page.evaluate(() => {
      window.__inputEvents = [];
      document.addEventListener("input", (event) => {
        window.__inputEvents.push({
          data: event.data,
          inputType: event.inputType,
        });
      });

      const editor = document.createElement("textarea");
      editor.id = "prompt-textarea";
      document.getElementById("app").append(editor);
    });

    await page.waitForFunction(
      () =>
        document.getElementById("prompt-textarea")?.value.includes(
          "# Guided Learning Tutor",
        ),
    );
    await page.waitForTimeout(200);

    const state = await page.evaluate(() => {
      const editor = document.getElementById("prompt-textarea");
      return {
        active: document.activeElement === editor,
        eventCount: window.__inputEvents.length,
        eventDataMatches: window.__inputEvents[0]?.data === editor.value,
        eventInputType: window.__inputEvents[0]?.inputType,
        selectionEnd: editor.selectionEnd,
        selectionStart: editor.selectionStart,
        scrollTop: editor.scrollTop,
        value: editor.value,
      };
    });

    assert.equal(state.value, expectedPrompt);
    assert.equal(state.value.includes("# 1. use this skill"), true);
    assert.equal(state.value.includes("name: guided-learning-tutor"), true);
    assert.equal(state.value.includes("# 2. user's query"), true);
    assert.equal(state.active, true);
    assert.equal(state.selectionStart, state.value.length);
    assert.equal(state.selectionEnd, state.value.length);
    assert.equal(state.scrollTop > 0, true);
    assert.equal(state.eventCount, 1);
    assert.equal(state.eventDataMatches, true);
    assert.equal(state.eventInputType, "insertText");

    await page.evaluate(() => {
      document.getElementById("prompt-textarea").remove();
      const replacement = document.createElement("textarea");
      replacement.id = "prompt-textarea";
      document.getElementById("app").append(replacement);
    });
    await page.waitForTimeout(200);
    assert.equal(
      await page.locator("#prompt-textarea").inputValue(),
      "",
      "the prompt must not be inserted a second time",
    );
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

async function testContentEditable(browser) {
  const { page, errors } = await preparePage(browser);
  try {
    await page.evaluate(() => {
      const editor = document.createElement("div");
      editor.id = "prompt-textarea";
      editor.contentEditable = "true";
      editor.style.height = "40px";
      editor.style.overflowY = "auto";
      document.getElementById("app").append(editor);
    });

    await page.waitForFunction(() =>
      document
        .getElementById("prompt-textarea")
        ?.innerText.includes("# Guided Learning Tutor"),
    );
    await page.waitForTimeout(200);

    const state = await page.evaluate(() => {
      const editor = document.getElementById("prompt-textarea");
      const selection = window.getSelection();
      const range = selection.getRangeAt(0);
      return {
        active: document.activeElement === editor,
        atEnd:
          range.startContainer === editor &&
          range.startOffset === editor.childNodes.length,
        collapsed: range.collapsed,
        scrollTop: editor.scrollTop,
        text: editor.innerText,
      };
    });

    assert.equal(state.text.includes("# 1. use this skill"), true);
    assert.equal(state.text.includes("# 2. user's query"), true);
    assert.equal(state.active, true);
    assert.equal(state.collapsed, true);
    assert.equal(state.atEnd, true);
    assert.equal(state.scrollTop > 0, true);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

async function testExistingText(browser) {
  const { page, errors } = await preparePage(browser);
  try {
    await page.evaluate(() => {
      const editor = document.createElement("textarea");
      editor.id = "prompt-textarea";
      editor.value = "入力済みの文章";
      document.getElementById("app").append(editor);
    });
    await page.waitForTimeout(200);

    assert.equal(
      await page.locator("#prompt-textarea").inputValue(),
      "入力済みの文章",
    );
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

async function main() {
  assert.equal(script.includes("// @version      1.4.0"), true);
  assert.equal(script.includes("// @match        https://chatgpt.com/*"), true);

  const browser = await chromium.launch({ headless: true });
  try {
    await testTextarea(browser);
    await testContentEditable(browser);
    await testExistingText(browser);
  } finally {
    await browser.close();
  }

  console.log("chatgpt initial prompt smoke test passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
