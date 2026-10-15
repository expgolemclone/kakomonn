import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import { nodeCacheDirectory } from "@expgolemclone/envx-runtime";

export default defineConfig({
  cacheDir: nodeCacheDirectory('kakomonn-vitest'),
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: "./kakomonn-sync/wrangler.jsonc",
      },
      miniflare: {
        bindings: {
          SYNC_TOKEN: "test-sync-token",
        },
      },
    }),
  ],
  test: {
    deps: {
      optimizer: {
        ssr: {
          enabled: true,
          include: ["ts-fsrs"],
        },
      },
    },
    include: ["kakomonn-sync/tests/**/*.test.js"],
  },
});
