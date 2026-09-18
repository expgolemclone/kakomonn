import { isQuestionId } from "../contracts.js";
import { isSite } from "../auth.js";
import { errorResponse, jsonResponse } from "../http.js";

const ISSUE_URL = "https://api.github.com/repos/expgolemclone/kakomonn/issues/29";
const REASONS = new Set([
  "markdown_unavailable",
  "clipboard_write_failed",
  "clipboard_write_timeout",
]);

function githubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "kakomonn-sync",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export async function handleCopyFailures(request, env, fetcher = fetch) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_request", 400);
  }
  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).sort().join(",") !== "questionId,reason,site" ||
    !isSite(body.site) ||
    !isQuestionId(body.questionId) ||
    !REASONS.has(body.reason)
  ) {
    return errorResponse("invalid_request", 400);
  }
  if (typeof env.GITHUB_COPY_FAILURE_TOKEN !== "string" || !env.GITHUB_COPY_FAILURE_TOKEN) {
    return errorResponse("server_misconfigured", 500);
  }

  const headers = githubHeaders(env.GITHUB_COPY_FAILURE_TOKEN);
  const marker = `<!-- copy-failure:${body.site}:${body.questionId} -->`;
  try {
    const issueResponse = await fetcher(ISSUE_URL, { headers });
    if (!issueResponse.ok) {
      return errorResponse("github_report_failed", 502);
    }
    const issue = await issueResponse.json();
    if (typeof issue.body !== "string") {
      return errorResponse("github_report_failed", 502);
    }
    if (issue.body.includes(marker)) {
      return jsonResponse({ reported: true });
    }
    const questionURL = `https://${body.site}/questions/${body.questionId}`;
    const logHeader = issue.body.includes("## 自動収集ログ") ? "" : "\n\n## 自動収集ログ";
    const newBody = `${issue.body}${logHeader}\n- ${questionURL} (${body.reason}) ${marker}`;
    const updateResponse = await fetcher(ISSUE_URL, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ body: newBody }),
    });
    if (!updateResponse.ok) {
      return errorResponse("github_report_failed", 502);
    }
    return jsonResponse({ reported: true });
  } catch {
    return errorResponse("github_report_failed", 502);
  }
}
