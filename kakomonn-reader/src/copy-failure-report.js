const COPY_FAILURE_REASONS = new Set([
  "markdown_unavailable",
  "clipboard_write_failed",
  "clipboard_write_timeout",
]);

export async function reportCopyFailure(app, questionId, reason) {
  if (
    !app.syncToken ||
    !/^\d+$/.test(questionId ?? "") ||
    !COPY_FAILURE_REASONS.has(reason)
  ) {
    return false;
  }
  try {
    await app.requestSyncResponse(
      "POST",
      "/v12/copy-failures",
      app.syncToken,
      (response) =>
        response !== null &&
        typeof response === "object" &&
        Object.keys(response).length === 1 &&
        response.reported === true,
      { site: app.SITE_ID, questionId, reason },
    );
    return true;
  } catch {
    // GitHub reporting must never prevent the next question from opening.
    return false;
  }
}
