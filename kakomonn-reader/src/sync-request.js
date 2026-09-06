export function createSyncRequest({ apiURL, gmXMLHttpRequest, SyncRequestError }) {
  return async function requestSyncResponse(
    method,
    path,
    token,
    validator,
    body = null,
  ) {
    const response = await gmXMLHttpRequest({
      method,
      url: `${apiURL}${path}`,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === null ? {} : { "Content-Type": "application/json" }),
      },
      data: body === null ? undefined : JSON.stringify(body),
    });
    let responseBody;
    try {
      responseBody = JSON.parse(response.responseText);
    } catch {
      throw new SyncRequestError("invalid_response", response.status);
    }
    if (response.status === 200) {
      if (!validator(responseBody)) {
        throw new SyncRequestError("invalid_response", response.status);
      }
      return responseBody;
    }
    throw new SyncRequestError(
      typeof responseBody?.error === "string"
        ? responseBody.error
        : "request_failed",
      response.status,
      responseBody,
    );
  };
}
