const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readdir, readFile } = require("node:fs/promises");
const { extname, resolve } = require("node:path");
const test = require("node:test");

const productionOrigin = "https://kakomonn-count-sync.expgolem-lab.workers.dev";
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

test("production serves only the authenticated v5 API backed by LearningState", async () => {
  const unauthorized = await fetch(new URL("/v5/sites", productionOrigin));
  assert.equal(unauthorized.status, 401);
  assert.deepEqual(await unauthorized.json(), { error: "unauthorized" });

  const removedV3 = await authorizedGet("/v3/sites");
  assert.equal(removedV3.status, 404);
  const removedV4 = await authorizedGet("/v4/sites");
  assert.equal(removedV4.status, 404);

  const sitesResponse = await authorizedGet("/v5/sites");
  assert.equal(sitesResponse.status, 200);
  const sitesBody = await sitesResponse.json();
  assert.equal(Array.isArray(sitesBody.sites), true);
  assert.equal(sitesBody.sites.every((site) => sitePattern.test(site)), true);

  if (sitesBody.sites.length > 0) {
    const site = sitesBody.sites[0];
    const settingsResponse = await authorizedGet(
      `/v5/settings?${new URLSearchParams({ site })}`,
    );
    assert.equal(settingsResponse.status, 200);
    const settingsBody = await settingsResponse.json();
    assert.deepEqual(Object.keys(settingsBody), ["site", "dailyStabilityDaysGoal"]);
    assert.equal(settingsBody.site, site);
    assert.equal(Number.isSafeInteger(settingsBody.dailyStabilityDaysGoal), true);
    assert.equal(settingsBody.dailyStabilityDaysGoal >= 1, true);

    const stateResponse = await authorizedGet(`/v5/state?${new URLSearchParams({ site })}`);
    assert.equal(stateResponse.status, 200);
    const stateBody = await stateResponse.json();
    assert.equal(stateBody.site, site);
    assert.equal(Number.isSafeInteger(stateBody.stabilityDays), true);
    assert.equal(stateBody.stabilityDays >= 0, true);
    assert.equal(Number.isSafeInteger(stateBody.solved), true);
    assert.equal(stateBody.solved >= 0, true);
    assert.equal(Number.isSafeInteger(stateBody.todaySolved), true);
    assert.equal(stateBody.todaySolved >= 0, true);
    assert.equal(Object.hasOwn(stateBody, "attempted"), false);
    assert.equal(Number.isSafeInteger(stateBody.todayStabilityDaysDelta), true);

    const historyResponse = await authorizedGet(
      `/v5/history?${new URLSearchParams({ site, days: "7" })}`,
    );
    assert.equal(historyResponse.status, 200);
    const historyBody = await historyResponse.json();
    assert.equal(historyBody.days.length, 7);
    assert.equal(
      historyBody.days.every(
        (day) =>
          (day.stabilityDays === null ||
            (Number.isSafeInteger(day.stabilityDays) && day.stabilityDays >= 0)) &&
          Number.isSafeInteger(day.solved) &&
          day.solved >= 0,
      ),
      true,
    );
  }
});
