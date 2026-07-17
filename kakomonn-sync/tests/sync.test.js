import { env, runInDurableObject, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker, { getTokyoDate, initializeSchema } from "../src/index.js";

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

  it("migrates the capped schema without replaying its operations", async () => {
    const stub = stubFor("legacy-migration");
    await runInDurableObject(stub, (_instance, durableState) => {
      durableState.storage.sql.exec(`
        DROP TABLE processed_operations;
        DROP TABLE daily_state;
        CREATE TABLE daily_state (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          date TEXT NOT NULL,
          count INTEGER NOT NULL CHECK (count BETWEEN 0 AND 50)
        );
        CREATE TABLE processed_operations (
          operation_id TEXT PRIMARY KEY
        ) WITHOUT ROWID;
      `);
      durableState.storage.sql.exec(
        "INSERT INTO daily_state (singleton, date, count) VALUES (1, ?, 50)",
        "2026-07-17"
      );
      durableState.storage.sql.exec(
        "INSERT INTO processed_operations (operation_id) VALUES (?)",
        operationId(1)
      );

      initializeSchema(durableState.storage);
    });

    expect(await stub.recordCorrect("2026-07-17", operationId(1))).toEqual(
      result("2026-07-17", 50)
    );
    expect(await stub.recordCorrect("2026-07-17", operationId(2))).toEqual(
      result("2026-07-17", 51)
    );
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
