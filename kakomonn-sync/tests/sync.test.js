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

function state(date, correct, answered) {
  return {
    date,
    counts: { correct, answered },
    milestoneInterval: MILESTONE_INTERVAL,
  };
}

function result(date, correct, answered, completedMilestone = null) {
  return {
    state: state(date, correct, answered),
    completedMilestone,
  };
}

function stubFor(name) {
  return env.DAILY_COUNT.get(env.DAILY_COUNT.idFromName(name));
}

async function resetPrimaryObject() {
  const stub = stubFor("primary");
  await runInDurableObject(stub, (_instance, durableState) => {
    durableState.storage.sql.exec("DELETE FROM processed_answers");
    durableState.storage.sql.exec("DELETE FROM daily_history");
    durableState.storage.sql.exec("DELETE FROM tracking_metadata");
    durableState.storage.sql.exec("DELETE FROM daily_state");
  });
}

function replaceWithLegacySchema(storage, { history }) {
  storage.sql.exec(`
    DROP TABLE processed_answers;
    DROP TABLE daily_history;
    DROP TABLE tracking_metadata;
    DROP TABLE daily_state;
    CREATE TABLE daily_state (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      date TEXT NOT NULL,
      count INTEGER NOT NULL CHECK (count >= 0)
    );
    CREATE TABLE processed_operations (
      operation_id TEXT PRIMARY KEY,
      resulting_count INTEGER CHECK (
        resulting_count IS NULL OR resulting_count >= 1
      )
    ) WITHOUT ROWID;
  `);
  if (history) {
    storage.sql.exec(`
      CREATE TABLE daily_history (
        date TEXT PRIMARY KEY,
        count INTEGER NOT NULL CHECK (count >= 0)
      ) WITHOUT ROWID;
      CREATE TABLE tracking_metadata (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        available_from TEXT NOT NULL
      );
    `);
  }
}

beforeEach(resetPrimaryObject);

describe("DailyCount", () => {
  it("records both outcomes and treats retries as idempotent", async () => {
    const stub = stubFor("answer-idempotency");

    expect(
      await stub.recordAnswer("2026-07-17", operationId(1), "correct")
    ).toEqual(result("2026-07-17", 1, 1));
    expect(
      await stub.recordAnswer("2026-07-17", operationId(1), "correct")
    ).toEqual(result("2026-07-17", 1, 1));
    expect(
      await stub.recordAnswer("2026-07-17", operationId(2), "incorrect")
    ).toEqual(result("2026-07-17", 1, 2));
    expect(
      await stub.recordAnswer("2026-07-17", operationId(2), "incorrect")
    ).toEqual(result("2026-07-17", 1, 2));
  });

  it("rejects a different outcome for a processed operation", async () => {
    const stub = stubFor("answer-conflict");
    const id = operationId(1);

    await stub.recordAnswer("2026-07-17", id, "incorrect");
    expect(await stub.recordAnswer("2026-07-17", id, "correct")).toEqual({
      error: "operation_conflict",
      state: state("2026-07-17", 0, 1),
    });
    expect(await stub.getState("2026-07-17")).toEqual(
      state("2026-07-17", 0, 1)
    );
  });

  it("bases milestones only on correct answers and preserves retry results", async () => {
    const stub = stubFor("milestone-retry");
    for (let index = 1; index < 50; index += 1) {
      await stub.recordAnswer("2026-07-17", operationId(index), "correct");
    }
    expect(
      await stub.recordAnswer("2026-07-17", operationId(100), "incorrect")
    ).toEqual(result("2026-07-17", 49, 50));

    const milestoneId = operationId(50);
    expect(
      await stub.recordAnswer("2026-07-17", milestoneId, "correct")
    ).toEqual(result("2026-07-17", 50, 51, 50));
    expect(
      await stub.recordAnswer("2026-07-17", milestoneId, "correct")
    ).toEqual(result("2026-07-17", 50, 51, 50));
  });

  it("serializes concurrent additions without capping either total", async () => {
    const stub = stubFor("concurrency");
    const results = await Promise.all(
      Array.from({ length: 150 }, (_value, index) =>
        stub.recordAnswer(
          "2026-07-17",
          operationId(index + 1),
          index % 3 === 0 ? "incorrect" : "correct"
        )
      )
    );

    expect(
      results
        .map((entry) => entry.completedMilestone)
        .filter((milestone) => milestone !== null)
        .sort((left, right) => left - right)
    ).toEqual([50, 100]);
    expect(await stub.getState("2026-07-17")).toEqual(
      state("2026-07-17", 100, 150)
    );
  });

  it("migrates history without inventing answered totals", async () => {
    const stub = stubFor("history-migration-v2");
    await runInDurableObject(stub, (_instance, durableState) => {
      replaceWithLegacySchema(durableState.storage, { history: true });
      durableState.storage.sql.exec(
        "INSERT INTO daily_state (singleton, date, count) VALUES (1, ?, 50)",
        "2026-07-17"
      );
      durableState.storage.sql.exec(
        `INSERT INTO processed_operations (operation_id, resulting_count)
         VALUES (?, 50)`,
        operationId(50)
      );
      durableState.storage.sql.exec(
        "INSERT INTO daily_history (date, count) VALUES (?, 12)",
        "2026-07-16"
      );
      durableState.storage.sql.exec(
        `INSERT INTO tracking_metadata (singleton, available_from)
         VALUES (1, ?)`,
        "2026-07-16"
      );

      initializeSchema(durableState.storage);
    });

    expect(await stub.getState("2026-07-17")).toEqual(
      state("2026-07-17", 50, null)
    );
    expect(
      await stub.recordAnswer("2026-07-17", operationId(50), "correct")
    ).toEqual(result("2026-07-17", 50, null, 50));
    expect(
      await stub.recordAnswer("2026-07-17", operationId(51), "incorrect")
    ).toEqual(result("2026-07-17", 50, null));
    expect(
      await stub.getHistory("2026-07-17", "2026-07-16", "2026-07-18")
    ).toEqual({
      timeZone: "Asia/Tokyo",
      today: "2026-07-17",
      availableFrom: { correct: "2026-07-16", answered: "2026-07-18" },
      from: "2026-07-16",
      to: "2026-07-18",
      days: [
        { date: "2026-07-16", counts: { correct: 12, answered: null } },
        { date: "2026-07-17", counts: { correct: 50, answered: null } },
        { date: "2026-07-18", counts: { correct: null, answered: null } },
      ],
    });

    expect(await stub.getState("2026-07-18")).toEqual(
      state("2026-07-18", 0, 0)
    );
    expect(
      await stub.recordAnswer("2026-07-18", operationId(52), "incorrect")
    ).toEqual(result("2026-07-18", 0, 1));
  });

  it("starts both migrated availability ranges without exposing old state", async () => {
    const stub = stubFor("daily-migration-v2");
    await runInDurableObject(stub, (_instance, durableState) => {
      replaceWithLegacySchema(durableState.storage, { history: false });
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
      await stub.getHistory("2026-07-18", "2026-07-17", "2026-07-19")
    ).toEqual({
      timeZone: "Asia/Tokyo",
      today: "2026-07-18",
      availableFrom: { correct: "2026-07-18", answered: "2026-07-19" },
      from: "2026-07-17",
      to: "2026-07-19",
      days: [
        { date: "2026-07-17", counts: { correct: null, answered: null } },
        { date: "2026-07-18", counts: { correct: 0, answered: null } },
        { date: "2026-07-19", counts: { correct: null, answered: null } },
      ],
    });
  });

  it("treats an empty legacy metadata table as a migration", async () => {
    const stub = stubFor("empty-history-migration-v2");
    await runInDurableObject(stub, (_instance, durableState) => {
      replaceWithLegacySchema(durableState.storage, { history: true });
      initializeSchema(durableState.storage);
    });

    expect(await stub.getState("2026-07-17")).toEqual(
      state("2026-07-17", 0, null)
    );
    expect(
      await stub.getHistory("2026-07-17", "2026-07-17", "2026-07-18")
    ).toEqual({
      timeZone: "Asia/Tokyo",
      today: "2026-07-17",
      availableFrom: { correct: "2026-07-17", answered: "2026-07-18" },
      from: "2026-07-17",
      to: "2026-07-18",
      days: [
        { date: "2026-07-17", counts: { correct: 0, answered: null } },
        { date: "2026-07-18", counts: { correct: null, answered: null } },
      ],
    });
  });

  it("archives completed days and distinguishes zero, unavailable, and future", async () => {
    const stub = stubFor("history-v2");

    await stub.recordAnswer("2026-07-17", operationId(1), "correct");
    await stub.recordAnswer("2026-07-17", operationId(2), "incorrect");
    expect(
      await stub.getHistory("2026-07-19", "2026-07-16", "2026-07-20")
    ).toEqual({
      timeZone: "Asia/Tokyo",
      today: "2026-07-19",
      availableFrom: { correct: "2026-07-17", answered: "2026-07-17" },
      from: "2026-07-16",
      to: "2026-07-20",
      days: [
        { date: "2026-07-16", counts: { correct: null, answered: null } },
        { date: "2026-07-17", counts: { correct: 1, answered: 2 } },
        { date: "2026-07-18", counts: { correct: 0, answered: 0 } },
        { date: "2026-07-19", counts: { correct: 0, answered: 0 } },
        { date: "2026-07-20", counts: { correct: null, answered: null } },
      ],
    });
  });

  it("does not roll state back when an older answer arrives late", async () => {
    const stub = stubFor("late-old-answer");

    await stub.recordAnswer("2026-07-18", operationId(1), "correct");
    expect(
      await stub.recordAnswer("2026-07-17", operationId(2), "incorrect")
    ).toEqual({
      error: "date_changed",
      state: state("2026-07-18", 1, 1),
    });
    expect(await stub.getState("2026-07-17")).toEqual(
      state("2026-07-18", 1, 1)
    );
  });
});

describe("HTTP API", () => {
  it("distinguishes missing, incorrect, and unconfigured bearer tokens", async () => {
    const missing = await SELF.fetch("https://example.test/v2/state");
    const incorrect = await SELF.fetch("https://example.test/v2/state", {
      headers: { Authorization: "Bearer incorrect-token" },
    });
    const unconfigured = await worker.fetch(
      new Request("https://example.test/v2/state"),
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

  it("records correct and incorrect answers once", async () => {
    const initialResponse = await SELF.fetch("https://example.test/v2/state", {
      headers: AUTHORIZATION,
    });
    const initial = await initialResponse.json();
    const answerRequest = (id, answerResult) => ({
      method: "POST",
      headers: {
        ...AUTHORIZATION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        date: initial.date,
        operationId: id,
        result: answerResult,
      }),
    });

    const correct = await SELF.fetch(
      "https://example.test/v2/answers",
      answerRequest(operationId(1), "correct")
    );
    const incorrect = await SELF.fetch(
      "https://example.test/v2/answers",
      answerRequest(operationId(2), "incorrect")
    );
    const retry = await SELF.fetch(
      "https://example.test/v2/answers",
      answerRequest(operationId(2), "incorrect")
    );

    expect(correct.status).toBe(200);
    await expect(correct.json()).resolves.toEqual(
      result(initial.date, 1, 1)
    );
    expect(incorrect.status).toBe(200);
    await expect(incorrect.json()).resolves.toEqual(
      result(initial.date, 1, 2)
    );
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toEqual(
      result(initial.date, 1, 2)
    );
  });

  it("returns an authenticated inclusive history range", async () => {
    const stateResponse = await SELF.fetch("https://example.test/v2/state", {
      headers: AUTHORIZATION,
    });
    const current = await stateResponse.json();
    const response = await SELF.fetch(
      `https://example.test/v2/history?from=${current.date}&to=${current.date}`,
      { headers: AUTHORIZATION }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      timeZone: "Asia/Tokyo",
      today: current.date,
      availableFrom: { correct: current.date, answered: current.date },
      from: current.date,
      to: current.date,
      days: [
        { date: current.date, counts: { correct: 0, answered: 0 } },
      ],
    });
  });

  it("rejects invalid history ranges, methods, and v1 routes", async () => {
    const invalidRequests = [
      "https://example.test/v2/history",
      "https://example.test/v2/history?from=2026-02-30&to=2026-03-01",
      "https://example.test/v2/history?from=2026-01-01&to=2026-02-01",
      "https://example.test/v2/history?from=2026-07-01&from=2026-07-02&to=2026-07-03",
      "https://example.test/v2/history?from=2026-07-01&to=2026-07-03&extra=1",
    ];
    for (const url of invalidRequests) {
      const response = await SELF.fetch(url, { headers: AUTHORIZATION });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "invalid_request",
      });
    }

    const methodResponse = await SELF.fetch(
      "https://example.test/v2/history?from=2026-07-01&to=2026-07-07",
      { method: "POST", headers: AUTHORIZATION }
    );
    expect(methodResponse.status).toBe(405);
    expect(methodResponse.headers.get("Allow")).toBe("GET");

    const legacy = await SELF.fetch("https://example.test/v1/count", {
      headers: AUTHORIZATION,
    });
    expect(legacy.status).toBe(404);
  });

  it("rejects malformed, stale, and conflicting answer operations", async () => {
    const malformedBodies = [
      {},
      {
        date: getTokyoDate(),
        operationId: operationId(1),
        result: "unknown",
      },
      {
        date: getTokyoDate(),
        operationId: operationId(1),
        result: "correct",
        extra: true,
      },
    ];
    for (const body of malformedBodies) {
      const response = await SELF.fetch("https://example.test/v2/answers", {
        method: "POST",
        headers: {
          ...AUTHORIZATION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "invalid_request",
      });
    }

    const stale = await SELF.fetch("https://example.test/v2/answers", {
      method: "POST",
      headers: {
        ...AUTHORIZATION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        date: "2000-01-01",
        operationId: operationId(2),
        result: "incorrect",
      }),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      error: "date_changed",
      state: { counts: { correct: 0, answered: 0 } },
    });

    const current = await (
      await SELF.fetch("https://example.test/v2/state", {
        headers: AUTHORIZATION,
      })
    ).json();
    const request = (answerResult) => ({
      method: "POST",
      headers: {
        ...AUTHORIZATION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        date: current.date,
        operationId: operationId(3),
        result: answerResult,
      }),
    });
    await SELF.fetch(
      "https://example.test/v2/answers",
      request("incorrect")
    );
    const conflict = await SELF.fetch(
      "https://example.test/v2/answers",
      request("correct")
    );
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: "operation_conflict",
      state: { counts: { correct: 0, answered: 1 } },
    });
  });

  it("exchanges the shared secret for a short-lived Azure speech token", async () => {
    let upstreamCall = null;
    const response = await handleRequest(
      new Request("https://example.test/v2/speech-token", {
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
      "https://example.test/v2/speech-token",
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
