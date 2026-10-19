import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readJson = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));

test("the native lock uses only the supported Vitest 5 Worker integration", () => {
  const manifest = readJson("../package.json");
  const { packages } = readJson("../package-lock.json");
  for (const group of ["dependencies", "devDependencies"]) {
    assert.deepEqual(packages[""][group], manifest[group]);
  }
  assert.equal(packages["node_modules/vitest"].version, manifest.devDependencies.vitest);
  assert.equal(packages["node_modules/@cloudflare/vitest-plugin"].version,
    manifest.devDependencies["@cloudflare/vitest-plugin"]);
  for (const [path, dependency] of Object.entries(packages)) {
    if (/(?:^|\/)node_modules\/(?:vitest|@vitest\/[^/]+)$/.test(path)) {
      assert.match(dependency.version, /^5\./, path);
    }
    assert(!path.endsWith("/vitest-pool-workers"), `Retired Workers pool: ${path}`);
  }
  const config = readFileSync(new URL("../kakomonn-sync/vitest.config.mjs", import.meta.url), "utf8");
  assert.match(config, /from "@cloudflare\/vitest-plugin"/);
  assert.doesNotMatch(config, /envx-runtime|nodeCacheDirectory|fsModuleCachePath/);
});
