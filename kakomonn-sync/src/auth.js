export const SITE_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.kakomonn\.com$/;

export function isSite(value) {
  return typeof value === "string" && SITE_PATTERN.test(value);
}

async function secretsEqual(received, expected) {
  if (typeof received !== "string" || typeof expected !== "string") {
    return false;
  }
  const encoder = new TextEncoder();
  const [receivedDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(received)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const receivedBytes = new Uint8Array(receivedDigest);
  const expectedBytes = new Uint8Array(expectedDigest);
  let difference = receivedBytes.length ^ expectedBytes.length;
  for (let index = 0; index < receivedBytes.length; index += 1) {
    difference |= receivedBytes[index] ^ expectedBytes[index];
  }
  return difference === 0;
}

export async function isAuthorized(request, env) {
  if (typeof env.SYNC_TOKEN !== "string" || env.SYNC_TOKEN.length === 0) {
    return null;
  }
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return false;
  }
  return secretsEqual(authorization.slice(7), env.SYNC_TOKEN);
}
