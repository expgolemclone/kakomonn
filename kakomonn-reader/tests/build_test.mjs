import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildReader } from "../build.mjs";

const fingerprintPlaceholder = "__KAKOMONN_READER_BUILD_FINGERPRINT__";

test("reader build uses clean isolated output and preserves its source inputs", async () => {
  const inputs = ["../vite.config.mjs", "../src/main.js", "../src/userscript.meta.txt"]
    .map((path) => new URL(path, import.meta.url));
  const originals = await Promise.all(inputs.map((path) => readFile(path, "utf8")));
  const first = await buildReader();
  assert.equal(first.outputPath, fileURLToPath(new URL("../dist/kakomonn-reader.user.js", import.meta.url)));
  await writeFile(new URL("../dist/stale-output.txt", import.meta.url), "obsolete output");
  const second = await buildReader();
  assert.deepEqual(await readdir(new URL("../dist/", import.meta.url)), ["kakomonn-reader.user.js"]);
  assert.deepEqual(await Promise.all(inputs.map((path) => readFile(path, "utf8"))), originals);
  assert.equal(second.source, first.source);
  assert.equal(first.source.includes("\r\n"), false);
  assert.equal(first.source.startsWith("// ==UserScript==\n"), true);
  assert.equal(first.source.includes("data:audio/mpeg;base64,"), true);
  assert.equal(first.source.match(/data:audio\/mpeg;base64,/g)?.length, 5);
  assert.equal(first.source.includes('import.meta.url'), false);
  assert.equal(first.source.includes('document.currentScript.src'), false);
  assert.equal(first.source.includes(fingerprintPlaceholder), false);
  assert.equal(first.source.includes('from "../../contracts/kakomonn.mjs"'), false);

  const template = first.source.replace(first.fingerprint, fingerprintPlaceholder);
  assert.equal(createHash("sha256").update(template).digest("hex"), first.fingerprint);
  assert.equal(await readFile(first.outputPath, "utf8"), first.source);
});
