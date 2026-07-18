const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { mkdtemp, rm } = require("node:fs/promises");
const { createServer } = require("node:net");
const { join, resolve, sep } = require("node:path");
const { tmpdir } = require("node:os");

const { chromium } = require("playwright");

const projectRoot = resolve(__dirname, "..", "..");
const wranglerBin = resolve(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const configPath = resolve(projectRoot, "kakomonn-sync", "wrangler.jsonc");
const token = "test-dashboard-token";
const today = "2026-07-18";
const availableFrom = {
  correct: "2026-07-01",
  answered: "2026-07-15",
};
const correctCounts = new Map([
  ["2026-07-13", 2],
  ["2026-07-15", 4],
  ["2026-07-16", 6],
  ["2026-07-17", 8],
  ["2026-07-18", 10],
]);
const answeredCounts = new Map([
  ["2026-07-15", 6],
  ["2026-07-16", 9],
  ["2026-07-17", 11],
  ["2026-07-18", 14],
]);

function productionWorker() {
  const configuredOrigin = process.env.KAKOMONN_DASHBOARD_ORIGIN;
  assert(configuredOrigin, "KAKOMONN_DASHBOARD_ORIGIN is required");
  const url = new URL(configuredOrigin);
  assert.equal(url.pathname, "/", "dashboard origin must not include a path");
  assert.equal(url.search, "", "dashboard origin must not include a query");
  assert.equal(url.hash, "", "dashboard origin must not include a fragment");
  return {
    origin: url.origin,
    async stop() {},
  };
}

function dateOrdinal(value) {
  return Math.floor(new Date(`${value}T00:00:00.000Z`).getTime() / 86_400_000);
}

function dateFromOrdinal(ordinal) {
  return new Date(ordinal * 86_400_000).toISOString().slice(0, 10);
}

async function getAvailablePort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  assert(address !== null && typeof address === "object");
  await new Promise((resolveClose, rejectClose) => {
    probe.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
  return address.port;
}

async function waitForServer(origin, child, readOutput) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`wrangler dev exited with ${child.exitCode}.\n${readOutput()}`);
    }
    try {
      const response = await fetch(origin);
      if (response.status === 200) {
        return;
      }
    } catch {
      // The port is not ready yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`wrangler dev did not become ready.\n${readOutput()}`);
}

async function startWorker() {
  const port = await getAvailablePort();
  const persistencePath = await mkdtemp(join(tmpdir(), "kakomonn-dashboard-"));
  const child = spawn(
    process.execPath,
    [
      wranglerBin,
      "dev",
      "--config",
      configPath,
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--local",
      "--persist-to",
      persistencePath,
      "--var",
      "SYNC_TOKEN:test-sync-token",
      "--log-level",
      "error",
      "--show-interactive-dev-session=false",
    ],
    {
      cwd: projectRoot,
      env: { ...process.env, NODE_OPTIONS: "--use-system-ca" },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  const origin = `http://127.0.0.1:${port}`;
  try {
    await waitForServer(origin, child, () => output);
  } catch (error) {
    if (child.exitCode === null) {
      child.kill();
      await once(child, "exit");
    }
    throw error;
  }

  return {
    origin,
    async stop() {
      if (child.exitCode === null) {
        const exited = once(child, "exit");
        child.kill();
        await exited;
      }
      const resolvedTemp = resolve(tmpdir());
      const resolvedPersistence = resolve(persistencePath);
      assert(
        resolvedPersistence.startsWith(`${resolvedTemp}${sep}`),
        "wrangler persistence must stay in the OS temp directory"
      );
      await rm(resolvedPersistence, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 100,
      });
    },
  };
}

function historyResponse(url) {
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const days = [];
  for (
    let ordinal = dateOrdinal(from);
    ordinal <= dateOrdinal(to);
    ordinal += 1
  ) {
    const date = dateFromOrdinal(ordinal);
    days.push({
      date,
      counts: {
        correct:
          date < availableFrom.correct || date > today
            ? null
            : (correctCounts.get(date) ?? 0),
        answered:
          date < availableFrom.answered || date > today
            ? null
            : (answeredCounts.get(date) ?? 0),
      },
    });
  }
  return {
    timeZone: "Asia/Tokyo",
    today,
    availableFrom,
    from,
    to,
    days,
  };
}

async function main() {
  const worker = process.env.KAKOMONN_DASHBOARD_ORIGIN
    ? productionWorker()
    : await startWorker();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
  });
  const browserErrors = [];
  const apiCalls = [];
  let failNextHistory = false;
  page.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => browserErrors.push(String(error)));

  await page.route(`${worker.origin}/v2/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const authorization = request.headers().authorization ?? "";
    apiCalls.push({ pathname: url.pathname, authorization });
    if (authorization !== `Bearer ${token}`) {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "unauthorized" }),
      });
      return;
    }
    if (url.pathname === "/v2/state") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          date: today,
          counts: { correct: 10, answered: 14 },
          milestoneInterval: 50,
        }),
      });
      return;
    }
    if (url.pathname === "/v2/history") {
      if (failNextHistory) {
        failNextHistory = false;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "service_unavailable" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(historyResponse(url)),
      });
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "not_found" }),
    });
  });

  try {
    const response = await page.goto(worker.origin, { waitUntil: "domcontentloaded" });
    assert.equal(response?.status(), 200);
    assert.match(response?.headers()["content-security-policy"] ?? "", /default-src 'self'/);
    await page.locator("#auth-panel").waitFor({ state: "visible" });
    assert.equal(await page.locator("#dashboard").isHidden(), true);

    await page.locator("#auth-token").fill(token);
    await page.locator("#auth-submit").click();
    await page.locator("#dashboard").waitFor({ state: "visible" });
    assert.equal(await page.locator("#period-title").textContent(), "2026年7月13日 - 19日");
    assert.equal(await page.locator("#total-count").textContent(), "30");
    assert.equal(await page.locator("#total-answered").textContent(), "40");
    assert.equal(await page.locator("#average-count").textContent(), "5.0");
    assert.equal(await page.locator("#average-answered").textContent(), "10.0");
    assert.equal(await page.locator("#bar-chart .bar-slot").count(), 7);
    assert.equal(await page.locator(".today-marker").textContent(), "今日");
    assert.match(
      await page.locator("#day-detail").textContent(),
      /2026年7月18日 土曜日, 正解10問, 解答14問/
    );
    assert.equal(await page.locator(".bar-fill-correct").count(), 6);
    assert.equal(await page.locator(".bar-fill-answered").count(), 4);
    assert.equal(await page.locator(".chart-legend").getAttribute("aria-label"), "graphの凡例");
    assert.equal(
      await page.locator(".bar-fill").first().evaluate((element) =>
        getComputedStyle(element).animationName
      ),
      "none"
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem("kakomonn-dashboard.sync-token")),
      token
    );

    const desktopScreenshot = join(tmpdir(), "kakomonn-dashboard-desktop.png");
    await page.screenshot({ path: desktopScreenshot, fullPage: true });

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#dashboard").waitFor({ state: "visible" });
    assert.equal(await page.locator("#auth-panel").isHidden(), true);

    await page.locator("#month-view").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#period-title")?.textContent === "2026年7月" &&
        document.querySelectorAll("#bar-chart .bar-slot").length === 31
    );
    assert.equal(await page.locator("#bar-chart .bar-slot").count(), 31);
    assert.equal(await page.locator("#total-count").textContent(), "30");
    assert.equal(await page.locator("#total-answered").textContent(), "40");
    assert.equal(await page.locator("#average-count").textContent(), "1.7");
    assert.equal(await page.locator("#average-answered").textContent(), "10.0");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(
      () => document.querySelector("#chart-scroller").scrollLeft > 0
    );
    const mobileLayout = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      chartScrollWidth: document.querySelector("#chart-scroller").scrollWidth,
      chartClientWidth: document.querySelector("#chart-scroller").clientWidth,
      todayMarker: document.querySelector(".today-marker").getBoundingClientRect().toJSON(),
      chartScroller: document.querySelector("#chart-scroller").getBoundingClientRect().toJSON(),
    }));
    assert.equal(mobileLayout.documentWidth <= mobileLayout.viewportWidth, true);
    assert.equal(mobileLayout.chartScrollWidth > mobileLayout.chartClientWidth, true);
    assert.equal(mobileLayout.todayMarker.width > mobileLayout.todayMarker.height, true);
    assert.equal(
      mobileLayout.todayMarker.left >= mobileLayout.chartScroller.left &&
        mobileLayout.todayMarker.right <= mobileLayout.chartScroller.right,
      true
    );
    const mobileScreenshot = join(tmpdir(), "kakomonn-dashboard-mobile.png");
    await page.screenshot({ path: mobileScreenshot, fullPage: true });
    assert.deepEqual(browserErrors, []);

    await page.locator("#settings-button").click();
    await page.locator("#settings-token").fill("incorrect-token");
    await page.locator("#save-token").click();
    await page.locator("#settings-message").filter({ hasText: "正しくありません" }).waitFor();
    assert.equal(await page.locator("#settings-dialog").getAttribute("open"), "");
    assert.equal(
      await page.evaluate(() => localStorage.getItem("kakomonn-dashboard.sync-token")),
      token
    );
    await page.locator("#settings-close").click();

    failNextHistory = true;
    await page.locator("#refresh-button").click();
    await page.locator("#load-error").waitFor({ state: "visible" });
    assert.equal(await page.locator("#dashboard").isHidden(), true);
    await page.locator("#retry-button").click();
    await page.locator("#dashboard").waitFor({ state: "visible" });

    await page.locator("#settings-button").click();
    await page.locator("#forget-token").click();
    await page.locator("#auth-panel").waitFor({ state: "visible" });
    assert.equal(
      await page.evaluate(() => localStorage.getItem("kakomonn-dashboard.sync-token")),
      null
    );
    assert.equal(apiCalls.every((call) => call.pathname.startsWith("/v2/")), true);
    assert.equal(
      apiCalls.some((call) => call.authorization === `Bearer ${token}`),
      true
    );
    assert.deepEqual(
      browserErrors.filter(
        (message) =>
          !/Failed to load resource: the server responded with a status of (401|503)/.test(
            message
          )
      ),
      []
    );
    console.log(`dashboard E2E passed, screenshots: ${desktopScreenshot}, ${mobileScreenshot}`);
  } finally {
    await page.close();
    await browser.close();
    await worker.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
