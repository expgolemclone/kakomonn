import { describe, expect, it } from "vitest";
import { handleRequest } from "../src/index.js";
import { issueSpeechToken } from "../src/speech.js";

const AUTHORIZATION = { Authorization: "Bearer test-sync-token" };

describe("v4 speech token", () => {
  it("exchanges the shared secret for a short-lived Azure token", async () => {
    let upstreamCall = null;
    const response = await handleRequest(
      new Request("https://example.test/v4/speech-token", {
        method: "POST",
        headers: AUTHORIZATION,
      }),
      {
        SYNC_TOKEN: "test-sync-token",
        AZURE_SPEECH_KEY: "test-speech-key",
      },
      async (url, options) => {
        upstreamCall = { url, options };
        return new Response("test-azure-token");
      }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
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

  it("fails closed when credentials or Azure responses are invalid", async () => {
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
    const response = await handleRequest(
      new Request("https://example.test/v4/speech-token", {
        headers: AUTHORIZATION,
      }),
      { SYNC_TOKEN: "test-sync-token" }
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
  });
});
