const UINT32_RANGE = 0x1_0000_0000;
const TIER_COUNT = 5;

function isSafeEntry(entry, milestone) {
  return (
    typeof entry === "string" &&
    entry.startsWith(`${milestone}/`) &&
    entry.endsWith("/index.html") &&
    !entry.startsWith("/") &&
    !entry.includes("\\") &&
    !entry.split("/").includes("..")
  );
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
    !Array.isArray(manifest.tiers) ||
    manifest.tiers.length !== TIER_COUNT
  ) {
    throw new TypeError("Celebration manifest is invalid.");
  }

  const ids = new Set();
  const entries = new Set();
  for (let index = 0; index < manifest.tiers.length; index += 1) {
    const tier = manifest.tiers[index];
    const expectedMilestone = manifest.milestoneInterval * (index + 1);
    if (
      tier === null ||
      typeof tier !== "object" ||
      tier.milestone !== expectedMilestone ||
      !Array.isArray(tier.sites) ||
      tier.sites.length === 0
    ) {
      throw new TypeError("Celebration manifest contains an invalid tier.");
    }

    for (const site of tier.sites) {
      if (
        site === null ||
        typeof site !== "object" ||
        typeof site.id !== "string" ||
        !/^[a-z0-9-]+$/.test(site.id) ||
        typeof site.label !== "string" ||
        site.label.trim().length === 0 ||
        !isSafeEntry(site.entry, tier.milestone) ||
        ids.has(site.id) ||
        entries.has(site.entry)
      ) {
        throw new TypeError("Celebration manifest contains an invalid site.");
      }
      ids.add(site.id);
      entries.add(site.entry);
    }
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

export function allCelebrations(manifest) {
  const validated = validateManifest(manifest);
  return validated.tiers.flatMap((tier) => tier.sites);
}

export function resolveCelebrationTier(manifest, milestone) {
  const validated = validateManifest(manifest);
  assertMilestone(milestone, validated.milestoneInterval);
  const maximumTier = validated.tiers[validated.tiers.length - 1].milestone;
  const tierMilestone = Math.min(milestone, maximumTier);
  return validated.tiers.find((tier) => tier.milestone === tierMilestone);
}

export function celebrationsForMilestone(manifest, milestone) {
  return resolveCelebrationTier(manifest, milestone).sites;
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

export function chooseCelebrationForMilestone(
  manifest,
  milestone,
  cryptoSource = globalThis.crypto,
) {
  const candidates = celebrationsForMilestone(manifest, milestone);
  return candidates[randomIndex(candidates.length, cryptoSource)];
}
