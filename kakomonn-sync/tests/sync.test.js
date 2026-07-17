import { env, runInDurableObject, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker, {
  getTokyoDate,
  handleRequest,
  initializeSchema,
  issueSpeechToken,
} from "../src/index.js";

const TOKEN = "test-sync-token";
const AUTHORIZATION = { Authorization: `Bearer ${TOKEN}` };
const MILESTONE_INTERVAL = 50;

function operationId(value) {
  return value.toString(16).padStart(32, "0");
}

function state(date, count) {
  return { date, count, milestoneInterval: MILESTONE_INTERVAL };
}

function result(date, count, completedMilestone = null) {
  return {
    state: state(date, count),
    completedMilestone,
  };
}

function stubFor(name) {
  return env.DAILY_COUNT.get(env.DAILY_COUNT.idFromName(name));
}

async function resetPrimaryObject() {
  const stub = stubFor("primary");
  await runInDurableObject(stub, (_instance, durableState) => {
    durableState.storage.sql.exec("DELETE FROM processed_operations");
    durableState.storage.sql.exec("DELETE FROM daily_history");
    durableState.storage.sql.exec("DELETE FROM tracking_metadata");
    durableState.storage.sql.exec("DELETE FROM daily_state");
  });
}

beforeEach(resetPrimaryObject);

describe("DailyCount", () => {
  it("adds distinct operations and treats a retry as idempotent", async () => {
    const stub = stubFor("idempotency");

    expect(await stub.recordCorrect("2026-07-17", operationId(1))).toEqual(
      result("2026-07-17", 1)
    );
    expect(await stub.recordCorrect("2026-07-17", operationId(1))).toEqual(
      result("2026-07-17", 1)
    );
    expect(await stub.recordCorrect("2026-07-17", operationId(2))).toEqual(
      result("2026-07-17", 2)
    );
  });

  it("returns the same completed milestone when its operation is retried", async () => {
    const stub = stubFor("milestone-retry");
    for (let index = 1; index < 50; index += 1) {
      await stub.recordCorrect("2026-07-17", operationId(index));
    }

    const milestoneId = operationId(50);
    expect(await stub.recordCorrect("2026-07-17", milestoneId)).toEqual(
      result("2026-07-17", 50, 50)
    );
    expect(await stub.recordCorrect("2026-07-17", milestoneId)).toEqual(
      result("2026-07-17", 50, 50)
    );
  });

  it("serializes concurrent additions without capping the daily total", async () => {
    const stub = stubFor("concurrency");
    const results = await Promise.all(
      Array.from({ length: 150 }, (_value, index) =>
        stub.recordCorrect("2026-07-17", operationId(index + 1))
      )
    );

    expect(
      results
        .map((entry) => entry.completedMilestone)
        .filter((milestone) => milestone !== null)
        .sort((left, right) => left - right)
    ).toEqual([50, 100, 150]);
    expect(await stub.getCount("2026-07-17")).toEqual(
      state("2026-07-17", 150)
    );
  });

  it("migrates the current daily schema without losing state or retries", async () => {
    const stub = stubFor("history-migration");
    await runInDurableObject(stub, (_instance, durableState) => {
      durableState.storage.sql.exec("DROP TABLE tracking_metadata");
      durableState.storage.sql.exec("DROP TABLE daily_history");
      durableState.storage.sql.exec(
        "INSERT INTO daily_state (singleton, date, count) VALUES (1, ?, 50)",
        "2026-07-17"
      );
      durableState.storage.sql.exec(
        `INSERT INTO processed_operations (operation_id, resulting_count)
         VALUES (?, 50)`,
        operationId(50)
      );

      initializeSchema(durableState.storage);
    });

    expect(await stub.recordCorrect("2026-07-17", operationId(50))).toEqual(
      result("2026-07-17", 50, 50)
    );
    expect(await stub.recordCorrect("2026-07-17", operationId(51))).toEqual(
      result("2026-07-17", 51)
    );
    expect(
      await stub.getHistory("2026-07-17", "2026-07-17", "2026-07-17")
    ).toEqual({
      timeZone: "Asia/Tokyo",
      today: "2026-07-17",
      availableFrom: "2026-07-17",
      from: "2026-07-17",
      to: "2026-07-17",
      days: [{ date: "2026-07-17", count: 51 }],
    });
  });

  it("starts migrated history today without exposing an older daily state", async () => {
    const stub = stubFor("old-history-migration");
    await runInDurableObject(stub, (_instance, durableState) => {
      durableState.storage.sql.exec("DROP TABLE tracking_metadata");
      durableState.storage.sql.exec("DROP TABLE daily_history");
      durableState.storage.sql.exec(
        "INSERT INTO daily_state (singleton, date, count) VALUES (1, ?, 12)",
        "2026-07-10"
      );
      durableState.storage.sql.exec(
        `INSERT INTO processed_operations (operation_id, resulting_count)
         VALUES (?, 12)`,
        operationId(12)
      );

      initializeSchema(durableState.storage);
    });

    expect(
      await stub.getHistory("2026-07-18", "2026-07-10", "2026-07-18")
    ).toEqual({
      timeZone: "Asia/Tokyo",
      today: "2026-07-18",
      availableFrom: "2026-07-18",
      from: "2026-07-10",
      to: "2026-07-18",
      days: [
        { date: "2026-07-10", count: null },
        { date: "2026-07-11", count: null },
        { date: "2026-07-12", count: null },
        { date: "2026-07-13", count: null },
        { date: "2026-07-14", count: null },
        { date: "2026-07-15", count: null },
        { date: "2026-07-16", count: null },
        { date: "2026-07-17", count: null },
        { date: "2026-07-18", count: 0 },
      ],
    });
  });

  it("resets the total and idempotency keys when the date changes", async () => {
    const stub = stubFor("rollover");
    const id = operationId(1);

    await stub.recordCorrect("2026-07-17", id);
    expect(await stub.getCount("2026-07-18")).toEqual(
      state("2026-07-18", 0)
    );
    expect(await stub.recordCorrect("2026-07-18", id)).toEqual(
      result("2026-07-18", 1)
    );
  });

  it("archives completed days and distinguishes zero, unavailable, and future days", async () => {
    const stub = stubFor("history");

    await stub.recordCorrect("2026-07-17", operationId(1));
    await stub.recordCorrect("2026-07-17", operationId(2));
    expect(
      await stub.getHistory("2026-07-19", "2026-07-16", "2026-07-20")
    ).toEqual({
      timeZone: "Asia/Tokyo",
      today: "2026-07-19",
      availableFrom: "2026-07-17",
      from: "2026-07-16",
      to: "2026-07-20",
      days: [
        { date: "2026-07-16", count: null },
        { date: "2026-07-17", count: 2 },
        { date: "2026-07-18", count: 0 },
        { date: "2026-07-19", count: 0 },
        { date: "2026-07-20", count: null },
      ],
    });
  });

  it("does not roll state back when an older request arrives late", async () => {
    const stub = stubFor("late-old-request");

    await stub.recordCorrect("2026-07-18", operationId(1));
    expect(await stub.recordCorrect("2026-07-17", operationId(2))).toEqual({
      error: "date_changed",
      state: state("2026-07-18", 1),
    });
    expect(await stub.getCount("2026-07-17")).toEqual(
      state("2026-07-18", 1)
    );
  });
});

describe("HTTP API", () => {
  it("distinguishes missing, incorrect, and unconfigured bearer tokens", async () => {
    const missing = await SELF.fetch("https://example.test/v1/count");
    const incorrect = await SELF.fetch("https://example.test/v1/count", {
      headers: { Authorization: "Bearer incorrect-token" },
    });
    const unconfigured = await worker.fetch(
      new Request("https://example.test/v1/count"),
      {}
    );

    expect(missing.status).toBe(401);
    await expect(missing.json()).resolves.toEqual({ error: "unauthorized" });
    expect(incorrect.status).toBe(401);
    await expect(incorrect.json()).resolves.toEqual({ error: "unauthorized" });
    expect(unconfigured.status).toBe(500);
    await expect(unconfigured.json()).resolves.toEqual({
      error: "server_misconfigured",
    });
  });

  it("returns the current Tokyo date and increments once", async () => {
    const initialResponse = await SELF.fetch("https://example.test/v1/count", {
      headers: AUTHORIZATION,
    });
    const initial = await initialResponse.json();
    const request = {
      method: "POST",
      headers: {
        ...AUTHORIZATION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        date: initial.date,
        operationId: operationId(1),
      }),
    };

    const first = await SELF.fetch("https://example.test/v1/correct", request);
    const retry = await SELF.fetch("https://example.test/v1/correct", request);

    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toEqual(
      result(initial.date, 1)
    );
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toEqual(
      result(initial.date, 1)
    );
  });

  it("returns an authenticated inclusive history range", async () => {
    const countResponse = await SELF.fetch("https://example.test/v1/count", {
      headers: AUTHORIZATION,
    });
    const current = await countResponse.json();
    const response = await SELF.fetch(
      `https://example.test/v1/history?from=${current.date}&to=${current.date}`,
      { headers: AUTHORIZATION }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      timeZone: "Asia/Tokyo",
      today: current.date,
      availableFrom: current.date,
      from: current.date,
      to: current.date,
      days: [{ date: current.date, count: 0 }],
    });
  });

  it("rejects invalid history ranges and methods", async () => {
    const invalidRequests = [
      "https://example.test/v1/history",
      "https://example.test/v1/history?from=2026-02-30&to=2026-03-01",
      "https://example.test/v1/history?from=2026-01-01&to=2026-02-01",
      "https://example.test/v1/history?from=2026-07-01&from=2026-07-02&to=2026-07-03",
      "https://example.test/v1/history?from=2026-07-01&to=2026-07-03&extra=1",
    ];
    for (const url of invalidRequests) {
      const response = await SELF.fetch(url, { headers: AUTHORIZATION });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "invalid_request",
      });
    }

    const methodResponse = await SELF.fetch(
      "https://example.test/v1/history?from=2026-07-01&to=2026-07-07",
      { method: "POST", headers: AUTHORIZATION }
    );
    expect(methodResponse.status).toBe(405);
    expect(methodResponse.headers.get("Allow")).toBe("GET");
  });

  it("rejects malformed and stale correct operations", async () => {
    const malformed = await SELF.fetch("https://example.test/v1/correct", {
      method: "POST",
      headers: {
        ...AUTHORIZATION,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    const stale = await SELF.fetch("https://example.test/v1/correct", {
      method: "POST",
      headers: {
        ...AUTHORIZATION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        date: "2000-01-01",
        operationId: operationId(2),
      }),
    });

    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toEqual({
      error: "invalid_request",
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      error: "date_changed",
      state: { count: 0, milestoneInterval: 50 },
    });
  });

  it("exchanges the shared secret for a short-lived Azure speech token", async () => {
    let upstreamCall = null;
    const response = await handleRequest(
      new Request("https://example.test/v1/speech-token", {
        method: "POST",
        headers: AUTHORIZATION,
      }),
      {
        SYNC_TOKEN: TOKEN,
        AZURE_SPEECH_KEY: "test-speech-key",
      },
      async (url, options) => {
        upstreamCall = { url, options };
        return new Response("test-azure-token");
      }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      token: "test-azure-token",
      expiresInSeconds: 600,
    });
    expect(upstreamCall.url).toBe(
      "https://japaneast.api.cognitive.microsoft.com/sts/v1.0/issueToken"
    );
    expect(upstreamCall.options).toEqual({
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": "test-speech-key",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "",
    });
  });

  it("fails closed when speech credentials or Azure responses are invalid", async () => {
    const unconfigured = await issueSpeechToken({}, async () => {
      throw new Error("must not be called");
    });
    const rejected = await issueSpeechToken(
      { AZURE_SPEECH_KEY: "incorrect" },
      async () => new Response("denied", { status: 401 })
    );
    const malformed = await issueSpeechToken(
      { AZURE_SPEECH_KEY: "configured" },
      async () => new Response("invalid token with spaces")
    );
    const unavailable = await issueSpeechToken(
      { AZURE_SPEECH_KEY: "configured" },
      async () => {
        throw new Error("network failed");
      }
    );

    expect(unconfigured.status).toBe(500);
    await expect(unconfigured.json()).resolves.toEqual({
      error: "server_misconfigured",
    });
    expect(rejected.status).toBe(500);
    await expect(rejected.json()).resolves.toEqual({
      error: "server_misconfigured",
    });
    expect(malformed.status).toBe(502);
    await expect(malformed.json()).resolves.toEqual({
      error: "invalid_speech_response",
    });
    expect(unavailable.status).toBe(502);
    await expect(unavailable.json()).resolves.toEqual({
      error: "speech_service_unavailable",
    });
  });

  it("requires POST for the speech token route", async () => {
    const response = await SELF.fetch(
      "https://example.test/v1/speech-token",
      { headers: AUTHORIZATION }
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
  });
});

describe("Tokyo date", () => {
  it("changes at midnight in Asia/Tokyo", () => {
    expect(getTokyoDate(new Date("2026-07-17T14:59:59.999Z"))).toBe(
      "2026-07-17"
    );
    expect(getTokyoDate(new Date("2026-07-17T15:00:00.000Z"))).toBe(
      "2026-07-18"
    );
  });
});
