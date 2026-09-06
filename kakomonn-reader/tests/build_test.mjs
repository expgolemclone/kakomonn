import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildReader } from "../build.mjs";

const fingerprintPlaceholder = "__KAKOMONN_READER_BUILD_FINGERPRINT__";

test("reader build is reproducible, bundled, and content-addressed", async () => {
  const first = await buildReader();
  const second = await buildReader();
  assert.equal(second.source, first.source);
  assert.equal(first.source.includes("\r\n"), false);
  assert.equal(first.source.startsWith("// ==UserScript==\n"), true);
  assert.equal(first.source.includes("data:audio/mpeg;base64,"), true);
  assert.equal(first.source.match(/data:audio\/mpeg;base64,/g)?.length, 5);
  assert.equal(first.source.includes(fingerprintPlaceholder), false);
  assert.equal(first.source.includes("from \"../../contracts/kakomonn.mjs\""), false);

  const template = first.source.replace(first.fingerprint, fingerprintPlaceholder);
  assert.equal(createHash("sha256").update(template).digest("hex"), first.fingerprint);
  assert.equal(await readFile(first.outputPath, "utf8"), first.source);
});
