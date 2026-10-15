import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import { nodeCacheDirectory } from "@expgolemclone/envx-runtime";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(projectRoot, "web");

export default defineConfig({
  cacheDir: nodeCacheDirectory('kakomonn-vite'),
  root: webRoot,
  base: "/",
  publicDir: resolve(projectRoot, "public"),
  build: {
    outDir: resolve(projectRoot, "dist"),
    emptyOutDir: true,
    target: "es2020",
    rollupOptions: {
      input: {
        dashboard: resolve(webRoot, "index.html"),
        open: resolve(webRoot, "open.html"),
      },
    },
  },
});
