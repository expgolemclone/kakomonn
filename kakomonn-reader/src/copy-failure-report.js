import { isCopyFailure, isCopyFailureAcceptance } from "../../contracts/kakomonn.mjs";

export async function reportCopyFailure(app, questionId, reason) {
  const report = { site: app.SITE_ID, questionId, reason };
  if (!app.syncToken || !isCopyFailure(report)) return false;
  try {
    await app.requestSyncResponse(
      "POST",
      "/v12/copy-failures",
      app.syncToken,
      isCopyFailureAcceptance,
      report,
    );
    return true;
  } catch {
    // GitHub reporting must never prevent the next question from opening.
    return false;
  }
}
