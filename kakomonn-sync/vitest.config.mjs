import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
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
