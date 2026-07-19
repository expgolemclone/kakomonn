import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseMilestone,
  randomIndex,
  validateManifest,
} from "../site-selection.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = validateManifest(
  JSON.parse(await readFile(resolve(projectRoot, "celebrations.json"), "utf8")),
);

assert.equal(manifest.milestoneInterval, 50);
assert.equal(manifest.sites.length, 3);
assert.equal(parseMilestone("?milestone=50", 50), 50);
assert.equal(parseMilestone("?milestone=150", 50), 150);
assert.throws(() => parseMilestone("", 50), /positive integer/);
assert.throws(() => parseMilestone("?milestone=51", 50), /multiple/);

for (let index = 0; index < manifest.sites.length; index += 1) {
  const values = [index];
  const cryptoSource = {
    getRandomValues(array) {
      array[0] = values.shift();
      return array;
    },
  };
  assert.equal(randomIndex(manifest.sites.length, cryptoSource), index);
}

const rejectionValues = [0xffff_ffff, 2];
assert.equal(
  randomIndex(manifest.sites.length, {
    getRandomValues(array) {
      array[0] = rejectionValues.shift();
      return array;
    },
  }),
  2,
);

const shellHTML = await readFile(resolve(projectRoot, "dist", "index.html"), "utf8");
assert.match(shellHTML, /id="celebration-frame"/);
assert.match(shellHTML, /id="open-study-log"/);
assert.match(shellHTML, /週間の記録を見る/);

for (const site of manifest.sites) {
  const sourcePath = resolve(projectRoot, site.entry);
  const outputPath = resolve(projectRoot, "dist", site.entry);
  await Promise.all([access(sourcePath), access(outputPath)]);
  const output = await readFile(outputPath, "utf8");
  assert.equal(output.includes("node_modules/"), false, `${site.id} exposes node_modules`);
}

console.log(`Congratulations smoke assertions passed for ${manifest.sites.length} sites`);
