const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readdir, readFile } = require("node:fs/promises");
const { extname, relative, resolve, sep } = require("node:path");
const test = require("node:test");
const {
  readKakomonnConfiguration,
  requireKakomonnConfiguration,
} = require("../../scripts/kakomonn-config.cjs");

const productionOrigin = "https://kakomonn-sync.kakomonn.workers.dev";
const distDirectory = resolve(__dirname, "..", "dist");
const assetControlFiles = new Set(["_headers", "_redirects"]);
const textAssetExtensions = new Set([".css", ".html", ".js"]);
const kakomonnConfiguration = readKakomonnConfiguration();
const contracts = import("../../contracts/kakomonn.mjs");

function syncToken() {
  return requireKakomonnConfiguration(
    kakomonnConfiguration,
    "KAKOMONN_SYNC_TOKEN",
  );
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

async function repositoryAssets(directory = distDirectory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedAssets = await Promise.all(entries.map(async (entry) => {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) return repositoryAssets(absolutePath);
    if (!entry.isFile() || assetControlFiles.has(entry.name)) return [];
    return [relative(distDirectory, absolutePath).split(sep).join("/")];
  }));
  return nestedAssets.flat().sort();
}

test("production assets match the repository", async (context) => {
  const assetNames = await repositoryAssets();

  assert.notEqual(assetNames.length, 0, "built assets must not be empty");

  for (const assetName of assetNames) {
    await context.test(assetName, async () => {
      const expected = canonicalAsset(
        assetName,
        await readFile(resolve(distDirectory, assetName))
      );
      const assetUrl = new URL(`/${assetName}`, productionOrigin);
      assetUrl.searchParams.set("deployment-test", String(Date.now()));
      const response = await fetch(assetUrl, {
        headers: { "cache-control": "no-cache" },
      });

      assert.equal(response.status, 200, `${assetUrl.pathname} must be published`);
      const expectedCacheControl = assetName.startsWith("assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache";
      assert.equal(response.headers.get("cache-control"), expectedCacheControl);
      const actual = canonicalAsset(
        assetName,
        Buffer.from(await response.arrayBuffer())
      );
      assert.equal(
        sha256(actual),
        sha256(expected),
        `${assetUrl.pathname} does not match the repository`
      );

      if (assetName.startsWith("assets/") && extname(assetName) === ".js") {
        const etag = response.headers.get("etag");
        assert.notEqual(etag, null, `${assetUrl.pathname} must publish an ETag`);
        const revalidated = await fetch(assetUrl, {
          headers: { "if-none-match": etag },
        });
        assert.equal(revalidated.status, 304);
      }
    });
  }
});

test("production /open serves the repository dashboard bridge", async () => {
  const response = await fetch(new URL("/open", productionOrigin), {
    headers: { "cache-control": "no-cache" },
    redirect: "manual",
  });
  assert.equal(response.status, 200);
  const expected = canonicalAsset(
    "open.html",
    await readFile(resolve(distDirectory, "open.html")),
  );
  const actual = canonicalAsset(
    "open.html",
    Buffer.from(await response.arrayBuffer()),
  );
  assert.equal(sha256(actual), sha256(expected));
});

test("production serves only the authenticated v11 API backed by LearningState", async () => {
  const {
    isDailyDetailsResponse,
    isDashboardResponse,
    isHistoryResponse,
    isLearningState,
    isSitesResponse,
  } = await contracts;
  const unauthorized = await fetch(new URL("/v11/sites", productionOrigin));
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers.get("cache-control"), "no-store");
  assert.deepEqual(await unauthorized.json(), { error: "unauthorized" });

  for (const version of ["v3", "v4", "v5", "v6", "v7", "v8", "v9", "v10"]) {
    const removed = await authorizedGet(`/${version}/sites`);
    assert.equal(removed.status, 404, `/${version}/sites must be removed`);
  }

  const sitesResponse = await authorizedGet("/v11/sites");
  assert.equal(sitesResponse.status, 200);
  const sitesBody = await sitesResponse.json();
  assert.equal(isSitesResponse(sitesBody), true);

  if (sitesBody.sites.length === 0) {
    return;
  }

  const site = sitesBody.sites[0];
  const dashboardResponse = await authorizedGet(
    `/v11/dashboard?${new URLSearchParams({ site })}`,
  );
  assert.equal(dashboardResponse.status, 200);
  const dashboardBody = await dashboardResponse.json();
  assert.equal(isDashboardResponse(dashboardBody), true);
  assert.deepEqual(dashboardBody.sites, sitesBody.sites);
  assert.equal(dashboardBody.selectedSite, site);

  const stateResponse = await authorizedGet(`/v11/state?${new URLSearchParams({ site })}`);
  assert.equal(stateResponse.status, 200);
  const stateBody = await stateResponse.json();
  assert.equal(isLearningState(stateBody, site), true);

  const historyResponse = await authorizedGet(
    `/v11/history?${new URLSearchParams({ site, days: "7" })}`,
  );
  assert.equal(historyResponse.status, 200);
  const historyBody = await historyResponse.json();
  assert.equal(isHistoryResponse(historyBody, site, 7), true);

  const detailsResponse = await authorizedGet(
    `/v11/daily-details?${new URLSearchParams({ site, date: historyBody.today })}`,
  );
  assert.equal(detailsResponse.status, 200);
  const detailsBody = await detailsResponse.json();
  assert.equal(
    isDailyDetailsResponse(detailsBody, site, historyBody.today),
    true,
  );
});

test("production issues Azure speech tokens with the configured key", async () => {
  const { isSpeechTokenResponse } = await contracts;
  const unauthorized = await fetch(new URL("/v11/speech-token", productionOrigin), {
    method: "POST",
  });
  assert.equal(unauthorized.status, 401);

  const response = await fetch(new URL("/v11/speech-token", productionOrigin), {
    method: "POST",
    headers: { Authorization: `Bearer ${syncToken()}` },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(isSpeechTokenResponse(body), true);
});
