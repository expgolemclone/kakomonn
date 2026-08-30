import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  celebrationSearch,
  parseCelebration,
} from "../shared/celebration-contract.js";
import {
  chooseCelebration,
  randomIndex,
  validateManifest,
} from "../celebration-selection.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expectedIds = [
  "aperture-lab",
  "conche",
  "driftline-ocean",
  "fathom",
  "formwork-chroma",
  "formwork-contour",
  "formwork-heliodon",
  "formwork-isometria",
  "formwork-meridian",
  "formwork-nebula",
  "formwork-neon",
  "glyphica",
  "halcyon-ring",
  "halfstep",
  "northbound-ev",
  "perigee-astro",
];
const manifest = validateManifest(
  JSON.parse(await readFile(resolve(projectRoot, "celebrations.json"), "utf8")),
);
assert.deepEqual(manifest.experiences.map(({ id }) => id), expectedIds);

const celebration = {
  site: "chushoks.kakomonn.com",
  date: "2026-08-13",
  dailyKpiCompleted: true,
};
const search = celebrationSearch(celebration);
assert.deepEqual(parseCelebration(search), celebration);
for (const invalidSearch of [
  "",
  `${search}&extra=1`,
  search.replace("2026-08-13", "2026-02-30"),
  search.replace("dailyKpiCompleted=true", "dailyKpiCompleted=false"),
  `${search}&site=chushoks.kakomonn.com`,
]) {
  assert.throws(() => parseCelebration(invalidSearch), /invalid/i);
}

assert.throws(() => randomIndex(0), /positive safe integer/);
for (const [index, expectedId] of expectedIds.entries()) {
  const cryptoSource = {
    getRandomValues(values) {
      values[0] = index;
      return values;
    },
  };
  assert.equal(chooseCelebration(manifest, cryptoSource).id, expectedId);
}

for (const experience of manifest.experiences) {
  await access(resolve(projectRoot, experience.entry));
  await access(resolve(projectRoot, "dist", experience.entry));
}
await access(resolve(projectRoot, "dist", "index.html"));
await access(resolve(projectRoot, "dist", "shared", "celebration-contract.js"));
await access(resolve(projectRoot, "dist", "shared", "experience-runtime.js"));

for (const sourcePath of [
  resolve(projectRoot, "index.html"),
  resolve(projectRoot, "router.js"),
]) {
  const source = await readFile(sourcePath, "utf8");
  assert.equal(source.includes("data-milestone"), false);
  assert.equal(/[\u3040-\u30ff\u3400-\u9fff]/u.test(source), false);
}

const routerSource = await readFile(resolve(projectRoot, "router.js"), "utf8");
assert.equal(routerSource.includes("entryUrl.search"), false);

console.log("Congratulations smoke assertions passed for all experiences");
