const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const puppeteer = require("puppeteer-core");
const {
  remoteDebugApprovalEnvironment,
  remoteDebugApprovalPowerShell,
} = require("../kakomonn-reader/tests/live_sync_e2e_test.js");

const userDataDir =
  process.env.KAKOMONN_EDGE_USER_DATA_DIR ??
  "C:\\Users\\0000250059\\AppData\\Local\\kakomonn-edge-e2e";

function readEndpoint() {
  const content = fs
    .readFileSync(path.join(userDataDir, "DevToolsActivePort"), "utf8")
    .trim();
  const [portLine, ...rest] = content.split("\n");
  return `ws://127.0.0.1:${portLine.trim()}${rest.join("\n").trim()}`;
}

const approval = spawn(
  path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
  ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", remoteDebugApprovalPowerShell],
  {
    env: remoteDebugApprovalEnvironment(userDataDir, 120_000),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);
approval.stdout.on("data", (chunk) => process.stdout.write(`[approval] ${chunk}`));
approval.stderr.on("data", (chunk) => process.stderr.write(`[approval-err] ${chunk}`));
approval.on("exit", (code) => console.log(`[approval] exited code=${code}`));

const endpoint = readEndpoint();
console.log("endpoint:", endpoint);
const startedAt = Date.now();
puppeteer
  .connect({ browserWSEndpoint: endpoint })
  .then(async (browser) => {
    console.log(`connected after ${Date.now() - startedAt}ms`);
    const version = await browser.version();
    console.log("browser version:", version);
    browser.disconnect();
    approval.kill();
    process.exit(0);
  })
  .catch((error) => {
    console.error(`connect failed after ${Date.now() - startedAt}ms:`, error);
    approval.kill();
    process.exit(1);
  });

setTimeout(() => {
  console.error("probe timed out at 100s");
  approval.kill();
  process.exit(2);
}, 100_000);
