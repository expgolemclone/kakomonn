import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

import { allCelebrations, validateManifest } from "./site-selection.js";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const manifest = validateManifest(
  JSON.parse(readFileSync(resolve(projectRoot, "celebrations.json"), "utf8")),
);
const input = {
  shell: resolve(projectRoot, "index.html"),
  ...Object.fromEntries(
    allCelebrations(manifest).map((site) => [
      site.id,
      resolve(projectRoot, site.entry),
    ]),
  ),
};

export default defineConfig({
  root: projectRoot,
  base: "./",
  build: {
    outDir: resolve(projectRoot, "dist"),
    emptyOutDir: true,
    target: "es2020",
    rollupOptions: { input },
  },
  server: {
    host: "127.0.0.1",
    port: 4173,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
  },
});
