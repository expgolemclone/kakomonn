import { cpSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

import { validateManifest } from "./celebration-selection.mjs";

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
    rollupOptions: {
      preserveEntrySignatures: "strict",
      input: {
        shell: resolve(projectRoot, "index.html"),
        "experience-runtime": resolve(projectRoot, "shared", "experience-runtime.js"),
      },
      output: {
        entryFileNames(chunk) {
          return chunk.name === "experience-runtime"
            ? "shared/experience-runtime.js"
            : "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  server: { host: "127.0.0.1", port: 4173 },
  preview: { host: "127.0.0.1", port: 4173 },
});
