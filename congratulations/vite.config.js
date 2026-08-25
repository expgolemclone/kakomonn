import { cpSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

import { validateManifest } from "./celebration-selection.js";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const manifest = validateManifest(
  JSON.parse(readFileSync(resolve(projectRoot, "celebrations.json"), "utf8")),
);

function copyCelebrationAssets() {
  return {
    name: "copy-celebration-assets",
    closeBundle() {
      cpSync(
        resolve(projectRoot, "experiences"),
        resolve(projectRoot, "dist", "experiences"),
        { recursive: true },
      );
      cpSync(
        resolve(projectRoot, "shared"),
        resolve(projectRoot, "dist", "shared"),
        { recursive: true },
      );
    },
  };
}

export default defineConfig({
  root: projectRoot,
  base: "./",
  plugins: [copyCelebrationAssets()],
  build: {
    outDir: resolve(projectRoot, "dist"),
    emptyOutDir: true,
    target: "es2020",
    rollupOptions: { input: { shell: resolve(projectRoot, "index.html") } },
  },
  server: { host: "127.0.0.1", port: 4173 },
  preview: { host: "127.0.0.1", port: 4173 },
});
