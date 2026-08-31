import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const publicDirectory = new URL("../kakomonn-sync/public/", import.meta.url);

test("the fixed URL serves the dashboard bridge to the configured userscript origin", async () => {
  const openScript = await readFile(new URL("open.js", publicDirectory), "utf8");
  const publicFiles = await readdir(publicDirectory);

  const htmlFiles = publicFiles.filter((file) => file.endsWith(".html"));
  const targets = (await Promise.all(
    htmlFiles.map(async (file) => [
      ...(await readFile(new URL(file, publicDirectory), "utf8")).matchAll(
        /<meta name="kakomonn-next-question-url" content="([^"]+)">/g,
      ),
    ]),
  )).flat();
  assert.equal(targets.length, 1);
  const target = new URL(targets[0][1]);
  assert.equal(target.protocol, "https:");
  assert.equal(target.hostname, "chushoks.kakomonn.com");
  assert.equal(target.hash, "#kakomonn-next");
  assert.equal(openScript.includes("location.replace(target)"), true);
  assert.equal(openScript.includes('location.replace("/")'), true);
  assert.equal(publicFiles.includes("_redirects"), false);
});
