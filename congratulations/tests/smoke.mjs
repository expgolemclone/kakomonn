import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  allCelebrations,
  celebrationsForMilestone,
  chooseCelebrationForMilestone,
  parseMilestone,
  randomIndex,
  resolveCelebrationTier,
  validateManifest,
} from "../site-selection.js";
import { createPreviewTargets } from "../scripts/open-previews.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = validateManifest(
  JSON.parse(await readFile(resolve(projectRoot, "celebrations.json"), "utf8")),
);

const expectedTiers = [
  [50, ["hikakin", "void-conductor", "midnight-emcee"]],
  [100, ["midnight-orbit", "clearance-officer", "night-archivist"]],
  [150, ["gouten-stomp", "imura-rally", "taiko-oni"]],
  [200, ["night-examiner", "kotonoha"]],
  [250, ["forge-fury", "study-complete"]],
];

assert.equal(manifest.milestoneInterval, 50);
assert.deepEqual(
  manifest.tiers.map((tier) => [
    tier.milestone,
    tier.sites.map((site) => site.id),
  ]),
  expectedTiers,
);

const sites = allCelebrations(manifest);
assert.equal(sites.length, 13);
assert.equal(new Set(sites.map((site) => site.id)).size, 13);

assert.equal(parseMilestone("?milestone=50", 50), 50);
assert.equal(parseMilestone("?milestone=300", 50), 300);
assert.throws(() => parseMilestone("", 50), /positive integer/);
assert.throws(() => parseMilestone("?milestone=51", 50), /positive multiple/);

for (const [milestone, expectedIds] of expectedTiers) {
  assert.equal(resolveCelebrationTier(manifest, milestone).milestone, milestone);
  assert.deepEqual(
    celebrationsForMilestone(manifest, milestone).map((site) => site.id),
    expectedIds,
  );
}
for (const milestone of [300, 350, 1_000]) {
  assert.equal(resolveCelebrationTier(manifest, milestone).milestone, 250);
  assert.deepEqual(
    celebrationsForMilestone(manifest, milestone).map((site) => site.id),
    ["forge-fury", "study-complete"],
  );
}

assert.equal(
  chooseCelebrationForMilestone(manifest, 100, {
    getRandomValues(array) {
      array[0] = 1;
      return array;
    },
  }).id,
  "clearance-officer",
);
assert.equal(
  chooseCelebrationForMilestone(manifest, 300, {
    getRandomValues(array) {
      array[0] = 1;
      return array;
    },
  }).id,
  "study-complete",
);

function cloneManifest() {
  return structuredClone(manifest);
}

const missingTier = cloneManifest();
missingTier.tiers.pop();
assert.throws(() => validateManifest(missingTier), /invalid/);

const emptyTier = cloneManifest();
emptyTier.tiers[2].sites = [];
assert.throws(() => validateManifest(emptyTier), /invalid tier/);

const wrongMilestone = cloneManifest();
wrongMilestone.tiers[2].milestone = 200;
assert.throws(() => validateManifest(wrongMilestone), /invalid tier/);

const wrongFolder = cloneManifest();
wrongFolder.tiers[1].sites[0].entry = "50/midnight-orbit/index.html";
assert.throws(() => validateManifest(wrongFolder), /invalid site/);

const duplicateId = cloneManifest();
duplicateId.tiers[1].sites[0].id = duplicateId.tiers[0].sites[0].id;
assert.throws(() => validateManifest(duplicateId), /invalid site/);

const previewOrigin = "http://127.0.0.1:4173/";
const previewTargets = createPreviewTargets(manifest, previewOrigin);
assert.deepEqual(previewTargets, [
  { id: "shell", url: `${previewOrigin}?milestone=50` },
  ...manifest.tiers.flatMap((tier) =>
    tier.sites.map((site) => ({
      id: site.id,
      url: `${previewOrigin}${site.entry}?milestone=${tier.milestone}`,
    })),
  ),
]);
assert.equal(
  new Set(previewTargets.map((target) => target.url)).size,
  sites.length + 1,
);

for (let index = 0; index < sites.length; index += 1) {
  const cryptoSource = {
    getRandomValues(array) {
      array[0] = index;
      return array;
    },
  };
  assert.equal(randomIndex(sites.length, cryptoSource), index);
}

const rejectionValues = [0xffff_ffff, 2];
assert.equal(
  randomIndex(3, {
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

for (const site of sites) {
  const sourcePath = resolve(projectRoot, site.entry);
  const outputPath = resolve(projectRoot, "dist", site.entry);
  await Promise.all([access(sourcePath), access(outputPath)]);
  const output = await readFile(outputPath, "utf8");
  assert.equal(output.includes("node_modules/"), false, `${site.id} exposes node_modules`);
}

console.log(`Congratulations smoke assertions passed for ${sites.length} sites`);
