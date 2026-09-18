import { afterEach, describe, expect, it, vi } from "vitest";
import { handleRequest } from "../src/index.js";
import { installCopyController } from "../../kakomonn-reader/src/copy-controller.js";

const SITE = "chushoks.kakomonn.com";
const ISSUE_URL = "https://api.github.com/repos/expgolemclone/kakomonn/issues/29";
const AUTHORIZATION = { Authorization: "Bearer test-sync-token" };
const ENV = {
  SYNC_TOKEN: "test-sync-token",
  GITHUB_COPY_FAILURE_TOKEN: "test-github-secret",
};

function reportRequest(body) {
  return new Request("https://example.test/v12/copy-failures", {
    method: "POST",
    headers: AUTHORIZATION,
    body: JSON.stringify(body),
  });
}

function failureBody(reason = "markdown_unavailable") {
  return { site: SITE, questionId: "57531", reason };
}

function fakeReader(copyResult, clipboardResult = true) {
  const app = {
    SITE_ID: SITE,
    syncToken: "test-sync-token",
    isIPhoneSafari: false,
    pendingAttempt: {
      operationId: "a".repeat(32),
      questionId: "57531",
      phase: "recorded",
      copy: { state: "required" },
    },
    frameDocument: {},
    answerCopyOperation: null,
    buildCopyMarkdown: vi.fn(() => copyResult),
    updatePendingAttempt: vi.fn(async (operationId, change) => {
      expect(operationId).toBe("a".repeat(32));
      app.pendingAttempt = change(app.pendingAttempt);
      return app.pendingAttempt;
    }),
    requestSyncResponse: vi.fn(async () => ({ reported: true })),
    maybePreparePendingDestination: vi.fn(async () => true),
    updateSyncDependentControls: vi.fn(),
    showReaderError: vi.fn(),
  };
  vi.stubGlobal("GM", { setClipboard: vi.fn(async () => clipboardResult) });
  installCopyController(app);
  return app;
}

async function flushBackgroundReports() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Reader automatic copy failure", () => {
  it("continues after unsupported question markup and reports the question ID", async () => {
    const app = fakeReader({ state: "unavailable", markdown: "" });
    await expect(app.processPendingAutomaticCopy()).resolves.toBe(true);
    await flushBackgroundReports();
    expect(app.pendingAttempt.copy).toEqual({ state: "not-required" });
    expect(app.maybePreparePendingDestination).toHaveBeenCalled();
    expect(app.requestSyncResponse).toHaveBeenCalledWith(
      "POST",
      "/v12/copy-failures",
      "test-sync-token",
      expect.any(Function),
      failureBody(),
    );
    expect(app.showReaderError).not.toHaveBeenCalled();
  });

  it("continues after clipboard rejection without posting clipboard contents", async () => {
    const app = fakeReader({ state: "ready", markdown: "private markdown" }, false);
    await expect(app.processPendingAutomaticCopy()).resolves.toBe(true);
    await flushBackgroundReports();
    expect(app.pendingAttempt.copy).toEqual({ state: "not-required" });
    expect(app.requestSyncResponse.mock.calls[0][4]).toEqual(failureBody("clipboard_write_failed"));
    expect(app.maybePreparePendingDestination).toHaveBeenCalled();
  });

  it("keeps successful copy behavior and sends no report", async () => {
    const app = fakeReader({ state: "ready", markdown: "safe markdown" });
    await expect(app.processPendingAutomaticCopy()).resolves.toBe(true);
    expect(app.pendingAttempt.copy).toEqual({ state: "completed" });
    expect(app.requestSyncResponse).not.toHaveBeenCalled();
    expect(app.maybePreparePendingDestination).toHaveBeenCalled();
  });

  it("continues even when reporting is unavailable", async () => {
    const app = fakeReader({ state: "unavailable", markdown: "" });
    app.requestSyncResponse.mockRejectedValue(new Error("GitHub unavailable"));
    await expect(app.processPendingAutomaticCopy()).resolves.toBe(true);
    await flushBackgroundReports();
    expect(app.pendingAttempt.copy).toEqual({ state: "not-required" });
    expect(app.maybePreparePendingDestination).toHaveBeenCalled();
    expect(app.showReaderError).not.toHaveBeenCalled();
  });
});

describe("v12 copy failure reporting", () => {
  it("appends a redacted and deduplicatable link to Issue #29", async () => {
    const calls = [];
    const response = await handleRequest(reportRequest(failureBody()), ENV, async (url, init) => {
      calls.push({ url, init });
      if (init.method === "PATCH") return new Response("{}", { status: 200 });
      return Response.json({ body: "## 調査候補" });
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ reported: true });
    expect(calls).toHaveLength(2);
    expect(calls.map(({ url }) => url)).toEqual([ISSUE_URL, ISSUE_URL]);
    expect(calls[0].init.headers.Authorization).toBe("Bearer test-github-secret");
    const patch = JSON.parse(calls[1].init.body);
    expect(patch.body).toContain("https://chushoks.kakomonn.com/questions/57531");
    expect(patch.body).toContain("<!-- copy-failure:chushoks.kakomonn.com:57531 -->");
    expect(patch.body).not.toContain("test-sync-token");
  });

  it("does not append the same problem twice", async () => {
    const github = vi.fn(async () => Response.json({
      body: "<!-- copy-failure:chushoks.kakomonn.com:57531 -->",
    }));
    const response = await handleRequest(reportRequest(failureBody()), ENV, github);
    expect(response.status).toBe(200);
    expect(github).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed input, missing secret, and unauthorized requests", async () => {
    const neverFetch = vi.fn();
    const malformed = await handleRequest(
      reportRequest({ ...failureBody(), markdown: "sensitive" }), ENV, neverFetch,
    );
    const missingSecret = await handleRequest(
      reportRequest(failureBody()), { SYNC_TOKEN: "test-sync-token" }, neverFetch,
    );
    const unauthorized = await handleRequest(
      new Request("https://example.test/v12/copy-failures", {
        method: "POST", body: JSON.stringify(failureBody()),
      }), ENV, neverFetch,
    );
    expect(malformed.status).toBe(400);
    expect(missingSecret.status).toBe(500);
    expect(unauthorized.status).toBe(401);
    expect(neverFetch).not.toHaveBeenCalled();
  });

  it("does not report success when GitHub rejects the update", async () => {
    const response = await handleRequest(reportRequest(failureBody()), ENV, async (url, init) =>
      init.method === "PATCH"
        ? new Response("denied", { status: 403 })
        : Response.json({ body: "Issue body" }),
    );
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "github_report_failed" });
  });
});
