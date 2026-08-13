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
const expectedIds = [
  "hikakin",
  "void-conductor",
  "midnight-emcee",
  "midnight-orbit",
  "clearance-officer",
  "night-archivist",
  "gouten-stomp",
  "imura-rally",
  "taiko-oni",
  "night-examiner",
  "kotonoha",
  "forge-fury",
  "study-complete",
];
assert.deepEqual(manifest.experiences.map((item) => item.id), expectedIds);

const celebration = {
  site: "chushoks.kakomonn.com",
  date: "2026-08-13",
  todayStabilityDaysDelta: 31,
  dailyStabilityDaysDeltaGoal: 30,
};
const search = celebrationSearch(celebration);
assert.deepEqual(parseCelebration(search), celebration);
for (const invalidSearch of [
  "",
  `${search}&extra=1`,
  search.replace("2026-08-13", "2026-02-30"),
  search.replace("todayStabilityDaysDelta=31", "todayStabilityDaysDelta=29"),
  search.replace("dailyStabilityDaysDeltaGoal=30", "dailyStabilityDaysDeltaGoal=0"),
  `${search}&site=chushoks.kakomonn.com`,
]) {
  assert.throws(() => parseCelebration(invalidSearch), /invalid|integer/i);
}

for (let index = 0; index < manifest.experiences.length; index += 1) {
  const cryptoSource = {
    getRandomValues(values) {
      values[0] = index;
      return values;
    },
  };
  assert.equal(randomIndex(manifest.experiences.length, cryptoSource), index);
  assert.equal(chooseCelebration(manifest, cryptoSource).id, expectedIds[index]);
}

const sourceFiles = [
  resolve(projectRoot, "index.html"),
  resolve(projectRoot, "router.js"),
  resolve(projectRoot, "shared", "celebration.js"),
];
for (const sourcePath of sourceFiles) {
  const source = await readFile(sourcePath, "utf8");
  assert.equal(source.includes("data-milestone"), false);
  assert.equal(source.includes("問達成"), false);
}

await access(resolve(projectRoot, "dist", "index.html"));
for (const experience of manifest.experiences) {
  await Promise.all([
    access(resolve(projectRoot, experience.entry)),
    access(resolve(projectRoot, "dist", experience.entry)),
  ]);
}

console.log(`Congratulations smoke assertions passed for ${expectedIds.length} experiences`);
