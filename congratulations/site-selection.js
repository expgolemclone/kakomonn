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
  for (const site of manifest.sites) {
    if (
      site === null ||
      typeof site !== "object" ||
      typeof site.id !== "string" ||
      !/^[a-z0-9-]+$/.test(site.id) ||
      !isSafeEntry(site.entry) ||
      ids.has(site.id) ||
      entries.has(site.entry)
    ) {
      throw new TypeError("Celebration manifest contains an invalid site.");
    }
    ids.add(site.id);
    entries.add(site.entry);
  }

  return manifest;
}

export function parseMilestone(search, interval) {
  const raw = new URLSearchParams(search).get("milestone");
  if (raw === null || !/^[1-9]\d*$/.test(raw)) {
    throw new TypeError("milestone must be a positive integer.");
  }

  const milestone = Number(raw);
  if (!Number.isSafeInteger(milestone) || milestone % interval !== 0) {
    throw new TypeError(`milestone must be a multiple of ${interval}.`);
  }
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

export function chooseCelebration(manifest, cryptoSource = globalThis.crypto) {
  const validated = validateManifest(manifest);
  return validated.sites[randomIndex(validated.sites.length, cryptoSource)];
}
