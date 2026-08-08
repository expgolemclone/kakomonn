import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateManifest } from "../site-selection.js";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), "..");

export function createPreviewTargets(manifest, origin) {
  const validated = validateManifest(manifest);
  const baseUrl = new URL("/", origin);
  const shellUrl = new URL(baseUrl);
  shellUrl.searchParams.set(
    "milestone",
    String(validated.milestoneInterval),
  );

  return [
    { id: "shell", url: shellUrl.href },
    ...validated.tiers.flatMap((tier) =>
      tier.sites.map((site) => {
        const siteUrl = new URL(site.entry, baseUrl);
        siteUrl.searchParams.set("milestone", String(tier.milestone));
        return { id: site.id, url: siteUrl.href };
      }),
    ),
  ];
}

async function run() {
  const [{ createServer }, { chromium }] = await Promise.all([
    import("vite"),
    import("playwright"),
  ]);
  const manifest = validateManifest(
    JSON.parse(
      await readFile(resolve(projectRoot, "celebrations.json"), "utf8"),
    ),
  );

  let server = null;
  let browser = null;
  let stopping = false;
  let shutdownQueue = Promise.resolve();

  function shutdown() {
    shutdownQueue = shutdownQueue.then(async () => {
      const activeBrowser = browser;
      browser = null;
      if (activeBrowser?.isConnected()) {
        await activeBrowser.close();
      }

      const activeServer = server;
      server = null;
      if (activeServer !== null) {
        await activeServer.close();
      }
    });
    return shutdownQueue;
  }

  function handleSignal() {
    stopping = true;
    void shutdown();
  }

  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);

  try {
    server = await createServer({
      configFile: resolve(projectRoot, "vite.config.js"),
      root: projectRoot,
      server: { open: false },
    });
    await server.listen();
    if (stopping) {
      return;
    }

    const origin = server.resolvedUrls?.local[0];
    if (origin === undefined) {
      throw new Error("Vite did not expose a local preview URL.");
    }
    const targets = createPreviewTargets(manifest, origin);

    browser = await chromium.launch({ headless: false });
    if (stopping) {
      return;
    }
    const context = await browser.newContext({ viewport: null });
    const pages = [];

    for (const target of targets) {
      const page = await context.newPage();
      const response = await page.goto(target.url, {
        waitUntil: "domcontentloaded",
      });
      if (response === null || !response.ok()) {
        throw new Error(`Failed to open ${target.id}: ${target.url}`);
      }
      pages.push(page);
    }

    await pages[0].bringToFront();
    console.log(`Opened ${targets.length} celebration preview tabs at ${origin}`);
    await new Promise((resolveClosed) => {
      function resolveWhenClosed() {
        if (
          browser === null ||
          !browser.isConnected() ||
          context.pages().length === 0
        ) {
          resolveClosed();
        }
      }

      browser.once("disconnected", resolveWhenClosed);
      for (const page of pages) {
        page.once("close", resolveWhenClosed);
      }
      resolveWhenClosed();
    });
  } catch (error) {
    if (!stopping) {
      throw error;
    }
  } finally {
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
    await shutdown();
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
