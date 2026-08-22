import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const headersPath = new URL("../kakomonn-sync/public/_headers", import.meta.url);

test("the next-question launcher permits Safari userscript injection", async () => {
  const headers = await readFile(headersPath, "utf8");

  assert.match(
    headers,
    /^\/\*\r?\n(?: {2}[^\r\n]+\r?\n)+/m,
    "the default security headers must remain configured",
  );
  assert.match(
    headers,
    /^\/open\r?\n {2}! Content-Security-Policy\r?\n {2}X-Frame-Options: DENY\r?$/m,
    "the launcher must detach CSP while denying framing",
  );
});
