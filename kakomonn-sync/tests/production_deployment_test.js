const assert = require("node:assert/strict");
const { readdir, readFile } = require("node:fs/promises");
const { extname, resolve } = require("node:path");
const test = require("node:test");

const productionOrigin = "https://kakomonn-count-sync.expgolem-lab.workers.dev";
const publicDirectory = resolve(__dirname, "..", "public");
const assetControlFiles = new Set(["_headers"]);
const textAssetExtensions = new Set([".css", ".html", ".js"]);

function canonicalAsset(assetName, value) {
  return textAssetExtensions.has(extname(assetName))
    ? Buffer.from(value.toString("utf8").replaceAll("\r\n", "\n"))
    : value;
}

test("production assets match the repository", async (context) => {
  const entries = await readdir(publicDirectory, { withFileTypes: true });
  const assetNames = entries
    .filter((entry) => entry.isFile() && !assetControlFiles.has(entry.name))
    .map((entry) => entry.name)
    .sort();

  assert.notEqual(assetNames.length, 0, "public assets must not be empty");

  for (const assetName of assetNames) {
    await context.test(assetName, async () => {
      const expected = canonicalAsset(
        assetName,
        await readFile(resolve(publicDirectory, assetName))
      );
      const assetUrl = new URL(`/${assetName}`, productionOrigin);
      assetUrl.searchParams.set("deployment-test", String(Date.now()));
      const response = await fetch(assetUrl, {
        headers: { "cache-control": "no-cache" },
      });

      assert.equal(response.status, 200, `${assetUrl.pathname} must be published`);
      const actual = canonicalAsset(
        assetName,
        Buffer.from(await response.arrayBuffer())
      );
      assert.deepEqual(
        actual,
        expected,
        `${assetUrl.pathname} does not match the repository`
      );
    });
  }
});
