const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { chromium } = require("playwright");

const projectRoot = path.resolve(__dirname, "..");
const scriptPath = path.join(projectRoot, "chatgpt-initial-prompt.user.js");
const script = fs.readFileSync(scriptPath, "utf8");

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
        value: editor.value,
      };
    });

    assert.equal(
      state.value.startsWith("\n".repeat(5) + "## 以下のskillに従え"),
      true,
    );
    assert.equal(state.value.includes("name: guided-learning-tutor"), true);
    assert.equal(
      state.value.includes("各応答の末尾を必ず質問にする必要はない."),
      true,
    );
    assert.equal(state.active, true);
    assert.equal(state.selectionStart, 0);
    assert.equal(state.selectionEnd, 0);
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
        collapsed: range.collapsed,
        atStart: range.startContainer === editor && range.startOffset === 0,
        text: editor.innerText,
      };
    });

    assert.equal(state.text.includes("## 以下のskillに従え"), true);
    assert.equal(state.text.includes("name: guided-learning-tutor"), true);
    assert.equal(state.active, true);
    assert.equal(state.collapsed, true);
    assert.equal(state.atStart, true);
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
  assert.equal(script.includes("// @version      1.3.0"), true);
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
