import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const publicDirectory = new URL("../kakomonn-sync/public/", import.meta.url);

test("the fixed URL redirects to the existing Kakomonn userscript origin", async () => {
  const redirects = await readFile(new URL("_redirects", publicDirectory), "utf8");
  const publicFiles = await readdir(publicDirectory);

  assert.equal(
    redirects.trim(),
    "/open https://chushoks.kakomonn.com/createques#kakomonn-next 302",
  );
  assert.equal(publicFiles.includes("open.html"), false);
});
