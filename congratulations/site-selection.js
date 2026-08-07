const UINT32_RANGE = 0x1_0000_0000;

function isSafeEntry(entry) {
  return (
    typeof entry === "string" &&
    entry.endsWith("/index.html") &&
    !entry.startsWith("/") &&
    !entry.includes("\\") &&
    !entry.split("/").includes("..")
  );
}

function isValidMilestoneList(milestones, interval) {
  if (milestones === undefined) {
    return true;
  }
  if (!Array.isArray(milestones) || milestones.length === 0) {
    return false;
  }

  const uniqueMilestones = new Set();
  for (const milestone of milestones) {
    if (
      !Number.isSafeInteger(milestone) ||
      milestone <= 0 ||
      milestone % interval !== 0 ||
      uniqueMilestones.has(milestone)
    ) {
      return false;
    }
    uniqueMilestones.add(milestone);
  }
  return true;
}

function assertMilestone(milestone, interval) {
  if (
    !Number.isSafeInteger(milestone) ||
    milestone <= 0 ||
    milestone % interval !== 0
  ) {
    throw new TypeError(`milestone must be a positive multiple of ${interval}.`);
  }
}

export function validateManifest(manifest) {
  if (
    manifest === null ||
    typeof manifest !== "object" ||
    !Number.isInteger(manifest.milestoneInterval) ||
    manifest.milestoneInterval <= 0 ||
    !Array.isArray(manifest.sites) ||
    manifest.sites.length === 0
  ) {
    throw new TypeError("Celebration manifest is invalid.");
  }

  const ids = new Set();
  const entries = new Set();
  let generalSiteCount = 0;
  for (const site of manifest.sites) {
    if (
      site === null ||
      typeof site !== "object" ||
      typeof site.id !== "string" ||
      !/^[a-z0-9-]+$/.test(site.id) ||
      !isSafeEntry(site.entry) ||
      !isValidMilestoneList(site.milestones, manifest.milestoneInterval) ||
      ids.has(site.id) ||
      entries.has(site.entry)
    ) {
      throw new TypeError("Celebration manifest contains an invalid site.");
    }
    if (site.milestones === undefined) {
      generalSiteCount += 1;
    }
    ids.add(site.id);
    entries.add(site.entry);
  }

  if (generalSiteCount === 0) {
    throw new TypeError("Celebration manifest must contain a general site.");
  }

  return manifest;
}

export function parseMilestone(search, interval) {
  const raw = new URLSearchParams(search).get("milestone");
  if (raw === null || !/^[1-9]\d*$/.test(raw)) {
    throw new TypeError("milestone must be a positive integer.");
  }

  const milestone = Number(raw);
  assertMilestone(milestone, interval);
  return milestone;
}

export function randomIndex(length, cryptoSource = globalThis.crypto) {
  if (!Number.isSafeInteger(length) || length <= 0) {
    throw new RangeError("length must be a positive safe integer.");
  }
  if (typeof cryptoSource?.getRandomValues !== "function") {
    throw new TypeError("Crypto random values are unavailable.");
  }

  const limit = UINT32_RANGE - (UINT32_RANGE % length);
  const values = new Uint32Array(1);
  do {
    cryptoSource.getRandomValues(values);
  } while (values[0] >= limit);
  return values[0] % length;
}

export function eligibleCelebrations(manifest, milestone) {
  const validated = validateManifest(manifest);
  assertMilestone(milestone, validated.milestoneInterval);

  const dedicatedSites = validated.sites.filter((site) =>
    site.milestones?.includes(milestone),
  );
  if (dedicatedSites.length > 0) {
    return dedicatedSites;
  }
  return validated.sites.filter((site) => site.milestones === undefined);
}

export function chooseCelebration(manifest, cryptoSource = globalThis.crypto) {
  const validated = validateManifest(manifest);
  const generalSites = validated.sites.filter(
    (site) => site.milestones === undefined,
  );
  return generalSites[randomIndex(generalSites.length, cryptoSource)];
}

export function chooseCelebrationForMilestone(
  manifest,
  milestone,
  cryptoSource = globalThis.crypto,
) {
  const candidates = eligibleCelebrations(manifest, milestone);
  return candidates[randomIndex(candidates.length, cryptoSource)];
}
