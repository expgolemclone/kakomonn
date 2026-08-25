import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { celebrationSearch, parseCelebration } from "../celebration-contract.js";
import {
  chooseCelebration,
  randomIndex,
  validateManifest,
} from "../celebration-selection.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = validateManifest(
  JSON.parse(await readFile(resolve(projectRoot, "celebrations.json"), "utf8")),
);
assert.deepEqual(manifest.experiences, []);

const celebration = {
  site: "chushoks.kakomonn.com",
  date: "2026-08-13",
  dueCardsCompleted: true,
};
const search = celebrationSearch(celebration);
assert.deepEqual(parseCelebration(search), celebration);
for (const invalidSearch of [
  "",
  `${search}&extra=1`,
  search.replace("2026-08-13", "2026-02-30"),
  search.replace("dueCardsCompleted=true", "dueCardsCompleted=false"),
  `${search}&site=chushoks.kakomonn.com`,
]) {
  assert.throws(() => parseCelebration(invalidSearch), /invalid/i);
}

assert.throws(() => randomIndex(0), /positive safe integer/);
assert.throws(() => chooseCelebration(manifest), /positive safe integer/);

const sourceFiles = [
  resolve(projectRoot, "index.html"),
  resolve(projectRoot, "router.js"),
];
for (const sourcePath of sourceFiles) {
  const source = await readFile(sourcePath, "utf8");
  assert.equal(source.includes("data-milestone"), false);
  assert.equal(source.includes("問達成"), false);
}

await access(resolve(projectRoot, "dist", "index.html"));

console.log("Congratulations smoke assertions passed with no installed design");
