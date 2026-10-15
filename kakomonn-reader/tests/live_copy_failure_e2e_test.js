const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { readKakomonnConfiguration } = require("../../scripts/kakomonn-config.cjs");
const {
  CURRENT_QUESTION_URL, DEFAULT_SYNC_API_ORIGIN, launchChromeWithCurrentUserscript,
  readChromeUserDataDir, resolveSyncToken,
} = require("./support/chrome_tampermonkey");
const { configureSyncToken, extractBuildFingerprint, readReaderState, waitUntil } = require("./live_sync_e2e_test");

const userscriptPath = path.resolve(__dirname, "..", "kakomonn-reader.user.js");
const envFilePath = path.resolve(__dirname, "..", "..", ".env");
const questionId = new URL(CURRENT_QUESTION_URL).pathname.split("/").at(-1);
const marker = `<!-- copy-failure:chushoks.kakomonn.com:${questionId}:markdown -->`;
const explanation = "本番検証: 解説番号のDOMを欠落させた制御下のMarkdown生成失敗です. 元の問題page自体の不具合を示す記録ではありません.";

function comments() {
  const pages = JSON.parse(execFileSync("gh", ["api", "--paginate", "--slurp",
    "repos/expgolemclone/kakomonn/issues/29/comments?per_page=100"], { encoding: "utf8", windowsHide: true }));
  return pages.flat().filter((comment) => comment.body.includes(marker));
}
async function postReport(token) {
  const response = await fetch(`${DEFAULT_SYNC_API_ORIGIN}/v12/copy-failures`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ site: "chushoks.kakomonn.com", questionId, reason: "markdown_unavailable" }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { accepted: true });
}
async function main() {
  const configuration = readKakomonnConfiguration({ envFilePath });
  const token = await resolveSyncToken({ configuration, envFilePath });
  const fingerprint = extractBuildFingerprint(fs.readFileSync(userscriptPath, "utf8"));
  const chrome = await launchChromeWithCurrentUserscript({
    configuration, userDataDir: readChromeUserDataDir({ configuration, envFilePath }), userscriptPath,
  });
  try {
    const setup = await chrome.context.newPage();
    await setup.goto(CURRENT_QUESTION_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await configureSyncToken(setup, token, fingerprint);
    await setup.close();
    const page = await chrome.context.newPage();
    await page.goto(CURRENT_QUESTION_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await configureSyncToken(page, token, fingerprint);
    const frame = page.frameLocator("#kakomonn-reader-frame");
    await frame.getByRole("button", { name: "解答する", exact: true }).waitFor();
    const numbers = frame.locator("#js-commentary-wrap > .item > .num");
    assert.ok(await numbers.count() > 0);
    // Fault injection changes only the page DOM. All GM, clipboard, sync and GitHub APIs remain real.
    await numbers.evaluateAll((elements) => elements.forEach((element) => element.remove()));
    await frame.locator('input[name="intAnswerData"][value="5"]').locator("xpath=ancestor::label[1]").click();
    await frame.getByRole("button", { name: "解答する", exact: true }).click();
    await waitUntil("navigation after confirmed Markdown generation failure", async () => {
      if (page.url().startsWith("https://kakomonn-congratulations.kakomonn.workers.dev/")) return true;
      const state = await readReaderState(page);
      assert.equal(state.errorOpen, false);
      return state.frameURL !== CURRENT_QUESTION_URL && state.frameURL?.includes("/questions/");
    });
    let found = [];
    for (let attempt = 0; attempt < 30; attempt++) {
      found = comments();
      if (found.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    assert.equal(found.length, 1, "confirmed failure must arrive exactly once in Issue #29");
    assert.ok(found[0].body.includes(`https://chushoks.kakomonn.com/questions/${questionId}`));
    assert.ok(found[0].body.includes("stage=markdown, code=markdown_unavailable"));
    assert.equal(found[0].body.includes(token), false);
    if (!found[0].body.includes(explanation)) {
      const body = JSON.stringify({ body: `${found[0].body}\n\n${explanation}` });
      execFileSync("gh", ["api", "--method", "PATCH",
        `repos/expgolemclone/kakomonn/issues/comments/${found[0].id}`, "--input", "-"],
      { input: body, encoding: "utf8", windowsHide: true, stdio: ["pipe", "ignore", "pipe"] });
    }
    await Promise.all([postReport(token), postReport(token)]);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    assert.equal(comments().length, 1, "duplicate API submissions must not create comments");
    console.log(JSON.stringify({ status: "passed", browser: "Chrome with real Tampermonkey Beta",
      fault: "removed explanation number DOM", questionId, commentURL: found[0].html_url }));
  } finally {
    await chrome.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
