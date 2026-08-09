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
const site = "chushoks.kakomonn.com";
const otherSite = "nurse.kakomonn.com";
const today = "2026-07-18";
const availableFrom = {
  correct: "2026-06-01",
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

function historyRange(view, anchorDate) {
  if (view === "all") {
    return { from: availableFrom.correct, to: anchorDate };
  }
  const anchorOrdinal = dateOrdinal(anchorDate);
  if (view === "week") {
    const weekday = new Date(anchorOrdinal * 86_400_000).getUTCDay();
    const fromOrdinal = anchorOrdinal - ((weekday + 6) % 7);
    return {
      from: dateFromOrdinal(fromOrdinal),
      to: dateFromOrdinal(fromOrdinal + 6),
    };
  }
  if (view === "month") {
    const [year, month] = anchorDate.split("-").map(Number);
    const prefix = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
    return {
      from: `${prefix}-01`,
      to: `${prefix}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`,
    };
  }
  throw new TypeError(`Unsupported history view: ${view}`);
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
  const deadline = Date.now() + 30_000;
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

function historyResponse(url, responseToday) {
  const requestedSite = url.searchParams.get("site");
  const view = url.searchParams.get("view");
  const requestedAnchor = url.searchParams.get("anchor");
  const anchorDate = requestedAnchor === "today" ? responseToday : requestedAnchor;
  const { from, to } = historyRange(view, anchorDate);
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
          date < availableFrom.correct || date > responseToday
            ? null
            : requestedSite === site
              ? (correctCounts.get(date) ?? 0)
              : 0,
        answered:
          date < availableFrom.answered || date > responseToday
            ? null
            : requestedSite === site
              ? (answeredCounts.get(date) ?? 0)
              : 0,
      },
    });
  }
  return {
    site: requestedSite,
    timeZone: "Asia/Tokyo",
    today: responseToday,
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
  let returnNoSites = false;
  let currentToday = today;
  page.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => browserErrors.push(String(error)));

  await page.route(`${worker.origin}/v3/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const authorization = request.headers().authorization ?? "";
    apiCalls.push({
      pathname: url.pathname,
      search: url.search,
      authorization,
    });
    if (authorization !== `Bearer ${token}`) {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "unauthorized" }),
      });
      return;
    }
    if (url.pathname === "/v3/sites") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          sites: returnNoSites ? [] : [site, otherSite],
        }),
      });
      return;
    }
    if (url.pathname === "/v3/history") {
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
        body: JSON.stringify(historyResponse(url, currentToday)),
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
    assert.equal(await page.locator("#all-view").getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator("#period-title").textContent(), "全期間");
    assert.equal(await page.locator("#bar-chart .bar-slot").count(), 48);
    assert.equal(await page.locator("#total-count").textContent(), "30");
    assert.equal(await page.locator("#total-answered").textContent(), "40");
    assert.equal(await page.locator("#average-count").textContent(), "0.6");
    assert.equal(await page.locator("#average-answered").textContent(), "10.0");
    assert.equal(await page.locator("#previous-period").isDisabled(), true);
    assert.equal(await page.locator("#next-period").isDisabled(), true);
    assert.equal(await page.locator("#today-button").isDisabled(), true);
    await page.locator("#week-view").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#period-title")?.textContent ===
        "2026年7月13日 - 19日"
    );
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
    assert.deepEqual(await page.locator("#site-select option").allTextContents(), [
      site,
      otherSite,
    ]);
    assert.equal(await page.locator("#site-select").inputValue(), site);
    assert.equal(
      await page.evaluate(() => localStorage.getItem("kakomonn-dashboard.site")),
      site
    );

    await page.locator("#site-select").selectOption(otherSite);
    await page.waitForFunction(
      () => document.querySelector("#total-count")?.textContent === "0"
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem("kakomonn-dashboard.site")),
      otherSite
    );
    await page.locator("#site-select").selectOption(site);
    await page.waitForFunction(
      () => document.querySelector("#total-count")?.textContent === "30"
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

    const chartScroller = page.locator("#chart-scroller");
    await chartScroller.evaluate((element) => {
      element.scrollLeft = 0;
    });
    await chartScroller.hover();
    await page.mouse.wheel(0, -120);
    await page.waitForFunction(
      () => document.querySelector("#period-title")?.textContent === "2026年6月"
    );
    assert.equal(await page.locator("#bar-chart .bar-slot").count(), 30);
    assert.equal(await page.locator("#previous-period").isDisabled(), true);

    await page.waitForTimeout(350);
    await chartScroller.evaluate((element) => {
      element.scrollLeft = element.scrollWidth - element.clientWidth;
    });
    await chartScroller.hover();
    await page.mouse.wheel(0, 120);
    await page.waitForFunction(
      () => document.querySelector("#period-title")?.textContent === "2026年7月"
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(
      () => {
        const marker = document.querySelector(".today-marker")?.getBoundingClientRect();
        const scroller = document.querySelector("#chart-scroller")?.getBoundingClientRect();
        return (
          marker !== undefined &&
          scroller !== undefined &&
          marker.left >= scroller.left &&
          marker.right <= scroller.right
        );
      }
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
      true,
      JSON.stringify({
        chartScroller: mobileLayout.chartScroller,
        todayMarker: mobileLayout.todayMarker,
      })
    );
    const mobileScreenshot = join(tmpdir(), "kakomonn-dashboard-mobile.png");
    await page.screenshot({ path: mobileScreenshot, fullPage: true });
    assert.deepEqual(browserErrors, []);

    currentToday = "2026-08-01";
    await page.locator("#refresh-button").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#period-title")?.textContent === "2026年8月" &&
        document.querySelector(".today-marker")?.textContent === "今日"
    );
    assert.equal(await page.locator("#load-error").isHidden(), true);

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
    assert.equal(
      await page.evaluate(() => localStorage.getItem("kakomonn-dashboard.site")),
      null
    );
    returnNoSites = true;
    await page.locator("#auth-token").fill(token);
    await page.locator("#auth-submit").click();
    await page.locator("#site-empty").waitFor({ state: "visible" });
    returnNoSites = false;
    await page.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange"))
    );
    await page.locator("#dashboard").waitFor({ state: "visible" });
    assert.equal(await page.locator("#site-select").inputValue(), site);
    assert.equal(apiCalls.every((call) => call.pathname.startsWith("/v3/")), true);
    assert.equal(
      apiCalls.some((call) => call.pathname === "/v3/state"),
      false
    );
    const historyCalls = apiCalls.filter(
      (call) => call.pathname === "/v3/history"
    );
    assert.equal(historyCalls.length > 0, true);
    assert.equal(
      historyCalls.every((call) => {
        const query = new URLSearchParams(call.search);
        return (
          query.getAll("site").length === 1 &&
          query.getAll("view").length === 1 &&
          query.getAll("anchor").length === 1 &&
          [...query.keys()].length === 3
        );
      }),
      true
    );
    assert.equal(
      historyCalls.some(
        (call) => new URLSearchParams(call.search).get("anchor") === "today"
      ),
      true
    );
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
