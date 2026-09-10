import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const scriptPath = new URL("../kakomonn-reader.user.js", import.meta.url);
const expectedMatches = new Set([
  "https://*.kakomonn.com/*",
  "https://kakomonn-sync.kakomonn.workers.dev/",
  "https://kakomonn-sync.kakomonn.workers.dev/open",
]);
const updateURL = "https://github.com/expgolemclone/kakomonn/releases/latest/download/kakomonn-reader.user.js";

function metadataEntries(source) {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  assert.equal(lines[0], "// ==UserScript==");
  const end = lines.indexOf("// ==/UserScript==", 1);
  assert.equal(end > 1, true);
  assert.equal(lines[end + 1], "");
  const entries = new Map();
  for (const [index, line] of lines.slice(1, end).entries()) {
    const match = line.match(/^\/\/\s+@([A-Za-z][A-Za-z0-9:-]*)\s+(.+?)\s*$/);
    assert.ok(match, `invalid metadata at line ${index + 2}: ${line}`);
    const values = entries.get(match[1]) ?? [];
    values.push(match[2]);
    entries.set(match[1], values);
  }
  return entries;
}

function single(entries, key) {
  const values = entries.get(key) ?? [];
  assert.equal(values.length, 1, `@${key} must occur exactly once`);
  return values[0];
}

test("generated userscript metadata is valid", async () => {
  const entries = metadataEntries(await readFile(scriptPath, "utf8"));
  single(entries, "name");
  single(entries, "namespace");
  single(entries, "description");
  assert.equal(single(entries, "version"), "2.3.0");
  assert.equal(single(entries, "run-at"), "document-end");
  assert.equal(entries.has("noframes"), false);
  assert.deepEqual(new Set(entries.get("match")), expectedMatches);
  assert.equal(single(entries, "updateURL"), updateURL);
  assert.equal(single(entries, "downloadURL"), updateURL);
  assert.equal(entries.get("grant")?.includes("none"), false);
});
