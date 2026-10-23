import assert from "node:assert/strict";
import test from "node:test";
import { build } from "vite";
import { chromium } from "playwright";
import configuration from "../../scripts/kakomonn-config.cjs";

const fixture = `<div id="js-answer-result-box" class="is-correct"></div>
  <div class="problem_detail"><div class="when">Question 問1</div>
    <div class="ttl">Question text <span hidden>hidden question</span></div>
    <ul class="list"><li><label><input type="radio" name="answer" checked>Answer A</label></li>
      <li><label><input type="radio" name="answer">Answer B</label></li></ul>
    <button>解答する</button></div>
  <div id="js-commentary-wrap"><div class="item"><div class="num">01</div>
    <div class="text"><ul><li>Parent<ul><li>Child</li></ul></li><li>Sibling</li></ul>
      <ol start="3"><li>Third<ol><li>Nested ordered</li></ol></li></ol>
      <p><a href="javascript:alert(1)">Unsafe link text</a></p>
      <p><a href="/reference">Reference</a></p>
      <img src="/diagram.png"><a href="/diagram.png"><img src="/diagram.png"></a>
      <span style="display:none">hidden explanation</span>
    </div></div></div>`;

test("Markdown preserves nested lists and excludes hidden content and duplicate images", async () => {
  const output = await build({ configFile: false, logLevel: "silent", build: {
    write: false, minify: false,
    lib: { entry: "kakomonn-reader/src/markdown.js", name: "MarkdownTest", formats: ["iife"] },
  } });
  const code = (Array.isArray(output) ? output[0] : output).output.find(item => item.type === "chunk").code;
  const local = configuration.readKakomonnConfiguration();
  const browser = await chromium.launch({ headless: true,
    env: configuration.kakomonnFreeEnvironment(),
    ...(local.KAKOMONN_CHROMIUM_EXECUTABLE ? { executablePath: local.KAKOMONN_CHROMIUM_EXECUTABLE } : {}),
  });
  try {
    const page = await browser.newPage();
    await page.route("https://chushoks.kakomonn.com/**", route => route.fulfill({
      status: 200, contentType: "text/html; charset=utf-8", body: fixture,
    }));
    await page.goto("https://chushoks.kakomonn.com/questions/1");
    await page.addScriptTag({ content: code });
    const { state, markdown } = await page.evaluate(() => MarkdownTest.buildCopyMarkdown(document));
    assert.equal(state, "ready");
    assert.match(markdown, /- +Parent\n +- +Child\n- +Sibling/);
    assert.match(markdown, /3\. +Third\n +1\. +Nested ordered/);
    assert.match(markdown, /Unsafe link text/);
    assert.doesNotMatch(markdown, /javascript:|hidden question|hidden explanation/);
    assert.match(markdown, /\[Reference\]\(https:\/\/chushoks.kakomonn.com\/reference\)/);
    assert.equal(markdown.split("https://chushoks.kakomonn.com/diagram.png").length - 1, 1);
  } finally {
    await browser.close();
  }
});
