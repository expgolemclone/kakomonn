import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const publicDirectory = new URL("../kakomonn-sync/public/", import.meta.url);

test("the fixed URL serves the dashboard bridge to the configured userscript origin", async () => {
  const openScript = await readFile(new URL("open.js", publicDirectory), "utf8");
  const openPage = await readFile(new URL("open.html", publicDirectory), "utf8");
  const publicFiles = await readdir(publicDirectory);

  assert.equal(
    openPage.includes('name="kakomonn-next-question-url"'),
    false,
  );
  assert.equal(
    openScript.includes('"data-kakomonn-reader-bridge-state"'),
    true,
  );
  assert.equal(
    openScript.includes('"data-kakomonn-reader-bridge-target"'),
    true,
  );
  assert.equal(openScript.includes('/^\\/questions\\/\\d+$/'), true);
  assert.equal(openScript.includes("/createques"), false);
  assert.equal(openScript.includes('state === "ready"'), true);
  assert.equal(openScript.includes('state === "error"'), true);
  assert.equal(openScript.includes('"reader_ready_timeout"'), true);
  assert.equal(openPage.includes("Readerを準備しています"), true);
  assert.equal(openScript.includes("location.replace(target)"), true);
  assert.equal(openScript.includes('location.replace("/")'), true);
  assert.equal(publicFiles.includes("_redirects"), false);
});
