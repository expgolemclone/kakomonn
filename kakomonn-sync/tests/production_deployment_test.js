const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readdir, readFile } = require("node:fs/promises");
const { extname, resolve } = require("node:path");
const test = require("node:test");

const productionOrigin = "https://kakomonn-sync.kakomonn.workers.dev";
const publicDirectory = resolve(__dirname, "..", "public");
const assetControlFiles = new Set(["_headers"]);
const textAssetExtensions = new Set([".css", ".html", ".js"]);
const sitePattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.kakomonn\.com$/;

function syncToken() {
  const value = process.env.KAKOMONN_SYNC_TOKEN;
  assert.equal(
    typeof value === "string" && value.length > 0,
    true,
    "KAKOMONN_SYNC_TOKEN must be configured for production verification",
  );
  return value;
}

async function authorizedGet(path) {
  return fetch(new URL(path, productionOrigin), {
    headers: {
      Authorization: `Bearer ${syncToken()}`,
      "cache-control": "no-cache",
    },
  });
}

function canonicalAsset(assetName, value) {
  return textAssetExtensions.has(extname(assetName))
    ? Buffer.from(value.toString("utf8").replaceAll("\r\n", "\n"))
    : value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("production assets match the repository", async (context) => {
  const entries = await readdir(publicDirectory, { withFileTypes: true });
  const assetNames = entries
    .filter((entry) => entry.isFile() && !assetControlFiles.has(entry.name))
    .map((entry) => entry.name)
    .sort();

  assert.notEqual(assetNames.length, 0, "public assets must not be empty");

  for (const assetName of assetNames) {
    await context.test(assetName, async () => {
      const expected = canonicalAsset(
        assetName,
        await readFile(resolve(publicDirectory, assetName))
      );
      const assetUrl = new URL(`/${assetName}`, productionOrigin);
      assetUrl.searchParams.set("deployment-test", String(Date.now()));
      const response = await fetch(assetUrl, {
        headers: { "cache-control": "no-cache" },
      });

      assert.equal(response.status, 200, `${assetUrl.pathname} must be published`);
      const actual = canonicalAsset(
        assetName,
        Buffer.from(await response.arrayBuffer())
      );
      assert.equal(
        sha256(actual),
        sha256(expected),
        `${assetUrl.pathname} does not match the repository`
      );
    });
  }
});

test("production serves the canonical next-question launcher", async () => {
  const response = await fetch(new URL("/open", productionOrigin), {
    headers: { "cache-control": "no-cache" },
  });
  assert.equal(response.status, 200);
  assert.equal(new URL(response.url).pathname, "/open");
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(
    response.headers.get("content-security-policy") ?? "",
    /default-src 'self'/,
  );
  const body = await response.text();
  assert.match(body, /id="next-question-status"/);
  assert.match(body, /id="next-question-retry"/);
});

test("production serves only the authenticated v7 API backed by LearningState", async () => {
  const unauthorized = await fetch(new URL("/v7/sites", productionOrigin));
  assert.equal(unauthorized.status, 401);
  assert.deepEqual(await unauthorized.json(), { error: "unauthorized" });

  for (const version of ["v3", "v4", "v5", "v6"]) {
    const removed = await authorizedGet(`/${version}/sites`);
    assert.equal(removed.status, 404, `/${version}/sites must be removed`);
  }

  const sitesResponse = await authorizedGet("/v7/sites");
  assert.equal(sitesResponse.status, 200);
  const sitesBody = await sitesResponse.json();
  assert.equal(Array.isArray(sitesBody.sites), true);
  assert.equal(sitesBody.sites.every((site) => sitePattern.test(site)), true);

  if (sitesBody.sites.length === 0) {
    return;
  }

  const site = sitesBody.sites[0];
  const dashboardResponse = await authorizedGet(
    `/v7/dashboard?${new URLSearchParams({ site })}`,
  );
  assert.equal(dashboardResponse.status, 200);
  const dashboardBody = await dashboardResponse.json();
  assert.deepEqual(Object.keys(dashboardBody), [
    "sites",
    "selectedSite",
    "state",
    "history",
    "settings",
  ]);
  assert.deepEqual(dashboardBody.sites, sitesBody.sites);
  assert.equal(dashboardBody.selectedSite, site);
  assert.equal(dashboardBody.state.site, site);
  assert.equal(dashboardBody.history.site, site);
  assert.equal(dashboardBody.history.days.length, 31);
  assert.equal(dashboardBody.settings.site, site);

  const settingsResponse = await authorizedGet(
    `/v7/settings?${new URLSearchParams({ site })}`,
  );
  assert.equal(settingsResponse.status, 200);
  const settingsBody = await settingsResponse.json();
  assert.deepEqual(Object.keys(settingsBody), ["site", "dailyStabilityDaysDeltaGoal"]);
  assert.equal(settingsBody.site, site);
  assert.equal(Number.isSafeInteger(settingsBody.dailyStabilityDaysDeltaGoal), true);
  assert.equal(settingsBody.dailyStabilityDaysDeltaGoal >= 1, true);

  const stateResponse = await authorizedGet(`/v7/state?${new URLSearchParams({ site })}`);
  assert.equal(stateResponse.status, 200);
  const stateBody = await stateResponse.json();
  assert.deepEqual(Object.keys(stateBody).sort(), [
    "catalog",
    "learningMetrics",
    "site",
    "today",
  ]);
  assert.equal(stateBody.site, site);
  assert.match(stateBody.today, /^\d{4}-\d{2}-\d{2}$/);
  const metrics = stateBody.learningMetrics;
  assert.deepEqual(Object.keys(metrics).sort(), [
    "attemptedQuestionCount",
    "stabilityDays",
    "todayAttemptedQuestionCount",
    "todayStabilityDaysDelta",
  ]);
  assert.equal(Number.isSafeInteger(metrics.stabilityDays), true);
  assert.equal(metrics.stabilityDays >= 0, true);
  assert.equal(Number.isSafeInteger(metrics.todayStabilityDaysDelta), true);
  assert.equal(Number.isSafeInteger(metrics.attemptedQuestionCount), true);
  assert.equal(metrics.attemptedQuestionCount >= 0, true);
  assert.equal(Number.isSafeInteger(metrics.todayAttemptedQuestionCount), true);
  assert.equal(metrics.todayAttemptedQuestionCount >= 0, true);
  assert.equal(
    stateBody.catalog === null ||
      (Number.isSafeInteger(stateBody.catalog.questionCount) &&
        stateBody.catalog.questionCount > 0 &&
        Number.isSafeInteger(stateBody.catalog.generation) &&
        stateBody.catalog.generation > 0),
    true,
  );

  const historyResponse = await authorizedGet(
    `/v7/history?${new URLSearchParams({ site, days: "7" })}`,
  );
  assert.equal(historyResponse.status, 200);
  const historyBody = await historyResponse.json();
  assert.equal(historyBody.days.length, 7);
  assert.equal(
    historyBody.days.every(
      (day) =>
        (day.closingStabilityDays === null ||
          (Number.isSafeInteger(day.closingStabilityDays) &&
            day.closingStabilityDays >= 0)) &&
        (day.stabilityDaysDelta === null ||
          Number.isSafeInteger(day.stabilityDaysDelta)) &&
        Number.isSafeInteger(day.dailyAttemptedQuestionCount) &&
        day.dailyAttemptedQuestionCount >= 0,
    ),
    true,
  );

  const detailsResponse = await authorizedGet(
    `/v7/daily-details?${new URLSearchParams({ site, date: historyBody.today })}`,
  );
  assert.equal(detailsResponse.status, 200);
  const detailsBody = await detailsResponse.json();
  assert.deepEqual(Object.keys(detailsBody), ["site", "date", "timeZone", "tables"]);
  assert.equal(detailsBody.site, site);
  assert.equal(detailsBody.date, historyBody.today);
  assert.equal(detailsBody.timeZone, "Asia/Tokyo");
  assert.deepEqual(Object.keys(detailsBody.tables), ["stability_history", "attempts"]);
  assert.equal(Array.isArray(detailsBody.tables.stability_history), true);
  assert.equal(detailsBody.tables.stability_history.length <= 1, true);
  assert.equal(Array.isArray(detailsBody.tables.attempts), true);
  assert.equal(
    detailsBody.tables.stability_history.every(
      (row) =>
        row.site === site &&
        row.date === historyBody.today &&
        Number.isSafeInteger(row.opening_stability_days) &&
        Number.isSafeInteger(row.closing_stability_days),
    ),
    true,
  );
  assert.equal(
    detailsBody.tables.attempts.every(
      (row) =>
        row.site === site &&
        typeof row.operation_id === "string" &&
        typeof row.question_id === "string" &&
        Number.isSafeInteger(row.attempted_at_ms) &&
        (row.answer_result === "correct" || row.answer_result === "incorrect") &&
        Number.isFinite(row.previous_card_stability_days) &&
        Number.isFinite(row.resulting_card_stability_days),
    ),
    true,
  );
});

test("production issues Azure speech tokens with the configured key", async () => {
  const unauthorized = await fetch(new URL("/v7/speech-token", productionOrigin), {
    method: "POST",
  });
  assert.equal(unauthorized.status, 401);

  const response = await fetch(new URL("/v7/speech-token", productionOrigin), {
    method: "POST",
    headers: { Authorization: `Bearer ${syncToken()}` },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ["expiresInSeconds", "token"]);
  assert.equal(typeof body.token, "string");
  assert.equal(body.token.length > 0, true);
  assert.equal(body.expiresInSeconds, 600);
});
