import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function headersSource(relativePath) {
  return (await readFile(new URL(relativePath, projectRoot), "utf8"))
    .replaceAll("\r\n", "\n")
    .trim();
}

async function jsonFile(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, projectRoot), "utf8"));
}

test("sync static assets are stored for revalidation", async () => {
  const source = await headersSource("kakomonn-sync/public/_headers");
  assert.match(source, /^\/\*\n  Cache-Control: no-cache\n/);
  assert.equal(source.includes("Cache-Control: no-store"), false);
});

test("sync invokes the Worker only for APIs and disables persistent telemetry", async () => {
  const config = await jsonFile("kakomonn-sync/wrangler.jsonc");
  assert.deepEqual(config.assets.run_worker_first, ["/v10/*"]);
  assert.deepEqual(config.observability, { enabled: false });
});

test("congratulations caches stable and content-addressed assets", async () => {
  const source = await headersSource("congratulations/public/_headers");
  assert.match(source, /^\/\*\n  Cache-Control: no-cache\n/);
  assert.equal(source.includes("Cache-Control: no-store"), false);

  for (const path of [
    "/assets/*",
    "/vendor/*",
    "/experiences/conche/_astro/*",
    "/experiences/glyphica/_next/static/*",
    "/experiences/halfstep/assets/*",
  ]) {
    assert.match(
      source,
      new RegExp(
        `${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n` +
          "  ! Cache-Control\\n" +
          "  Cache-Control: public, max-age=31536000, immutable",
      ),
    );
  }
});
