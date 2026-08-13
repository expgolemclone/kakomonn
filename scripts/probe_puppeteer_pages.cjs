const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const puppeteer = require("puppeteer-core");
const {
  remoteDebugApprovalEnvironment,
  remoteDebugApprovalPowerShell,
} = require("../kakomonn-reader/tests/live_sync_e2e_test.js");

const userDataDir =
  process.env.KAKOMONN_EDGE_USER_DATA_DIR ??
  "C:\\Users\\0000250059\\AppData\\Local\\kakomonn-edge-e2e";
const content = fs
  .readFileSync(path.join(userDataDir, "DevToolsActivePort"), "utf8")
  .trim()
  .split("\n");
const endpoint = `ws://127.0.0.1:${content[0].trim()}${content.slice(1).join("").trim()}`;

const approval = spawn(
  path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
  ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", remoteDebugApprovalPowerShell],
  {
    env: remoteDebugApprovalEnvironment(userDataDir, 90_000),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);
approval.stdout.on("data", (c) => process.stdout.write(`[approval] ${c}`));

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: endpoint });
  console.log("connected, version:", await browser.version());
  const t0 = Date.now();
  console.log("targets() immediate count:", browser.targets().length);
  const pages = await Promise.race([
    browser.pages(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("pages() timed out")), 30_000),
    ),
  ]);
  console.log("pages() ok in", Date.now() - t0, "ms, count:", pages.length);
  for (const page of pages) console.log("-", page.url().slice(0, 90));
  browser.disconnect();
  approval.kill();
  process.exit(0);
})().catch((error) => {
  console.error("ERR", error.message);
  approval.kill();
  process.exit(1);
});
