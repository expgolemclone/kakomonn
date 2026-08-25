import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateManifest } from "../celebration-selection.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = validateManifest(
  JSON.parse(await readFile(resolve(projectRoot, "celebrations.json"), "utf8")),
);
const marker = "data-celebration-runtime";

for (const experience of manifest.experiences) {
  const entryPath = resolve(projectRoot, experience.entry);
  let source;
  try {
    source = await readFile(entryPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      continue;
    }
    throw error;
  }
  if (source.includes(marker) || source.includes('/shared/experience-runtime.js')) {
    continue;
  }
  const closingBody = source.lastIndexOf("</body>");
  if (closingBody === -1) {
    throw new Error(`${experience.entry} does not contain a closing body tag.`);
  }
  const runtime = [
    `<script type="module" ${marker}>`,
    '  import { announceCelebration } from "/shared/experience-runtime.js";',
    `  announceCelebration(${JSON.stringify(experience.id)});`,
    "</script>",
    "",
  ].join("\n");
  const updated = `${source.slice(0, closingBody)}${runtime}${source.slice(closingBody)}`;
  await writeFile(entryPath, updated, "utf8");
}
