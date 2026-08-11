import { errorResponse, jsonResponse } from "./http.js";

const TOKEN_URL = "https://japaneast.api.cognitive.microsoft.com/sts/v1.0/issueToken";
const TOKEN_TTL_SECONDS = 600;

export async function issueSpeechToken(env, fetcher = fetch) {
  if (typeof env.AZURE_SPEECH_KEY !== "string" || env.AZURE_SPEECH_KEY.length === 0) {
    return errorResponse("server_misconfigured", 500);
  }
  let response;
  try {
    response = await fetcher(TOKEN_URL, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": env.AZURE_SPEECH_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "",
    });
  } catch {
    return errorResponse("speech_service_unavailable", 502);
  }
  if (!response.ok) {
    return errorResponse(
      response.status === 401 || response.status === 403
        ? "server_misconfigured"
        : "speech_service_unavailable",
      response.status === 401 || response.status === 403 ? 500 : 502
    );
  }
  const token = (await response.text()).trim();
  if (!token || token.length > 8192 || /\s/.test(token)) {
    return errorResponse("invalid_speech_response", 502);
  }
  return jsonResponse({ token, expiresInSeconds: TOKEN_TTL_SECONDS });
}
