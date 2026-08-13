const UINT32_RANGE = 0x1_0000_0000;

function isSafeEntry(entry, id) {
  return (
    typeof entry === "string" &&
    entry === `experiences/${id}/index.html`
  );
}

export function validateManifest(manifest) {
  if (
    manifest === null ||
    typeof manifest !== "object" ||
    !Array.isArray(manifest.experiences) ||
    manifest.experiences.length !== 13
  ) {
    throw new TypeError("Celebration manifest is invalid.");
  }
  const ids = new Set();
  const entries = new Set();
  for (const experience of manifest.experiences) {
    if (
      experience === null ||
      typeof experience !== "object" ||
      typeof experience.id !== "string" ||
      !/^[a-z0-9-]+$/.test(experience.id) ||
      typeof experience.label !== "string" ||
      experience.label.trim().length === 0 ||
      !isSafeEntry(experience.entry, experience.id) ||
      ids.has(experience.id) ||
      entries.has(experience.entry)
    ) {
      throw new TypeError("Celebration manifest contains an invalid experience.");
    }
    ids.add(experience.id);
    entries.add(experience.entry);
  }
  return manifest;
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
  const experiences = validateManifest(manifest).experiences;
  return experiences[randomIndex(experiences.length, cryptoSource)];
}
