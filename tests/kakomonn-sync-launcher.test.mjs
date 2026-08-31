import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const publicDirectory = new URL("../kakomonn-sync/public/", import.meta.url);

test("the fixed URL serves the dashboard bridge to the configured userscript origin", async () => {
  const redirects = await readFile(new URL("_redirects", publicDirectory), "utf8");
  const index = await readFile(new URL("index.html", publicDirectory), "utf8");
  const publicFiles = await readdir(publicDirectory);

  assert.equal(redirects.trim(), "/open /index.html 200");
  const targets = [
    ...index.matchAll(
      /<meta name="kakomonn-next-question-url" content="([^"]+)">/g,
    ),
  ];
  assert.equal(targets.length, 1);
  const target = new URL(targets[0][1]);
  assert.equal(target.protocol, "https:");
  assert.match(target.hostname, /\.kakomonn\.com$/);
  assert.equal(target.hash, "#kakomonn-next");
  assert.equal(publicFiles.includes("open.html"), false);
});
