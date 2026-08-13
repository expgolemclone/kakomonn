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
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const targets = browser.targets();
  console.log("target count:", targets.length);
  for (const target of targets) {
    console.log(JSON.stringify({ type: target.type(), url: target.url().slice(0, 80) }));
  }
  for (const target of targets) {
    if (target.type() !== "page") continue;
    const timer = setTimeout(() => {
      console.log("STUCK attaching to:", target.url().slice(0, 100));
    }, 8000);
    try {
      const page = await Promise.race([
        target.page(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("attach timeout")), 8000),
        ),
      ]);
      clearTimeout(timer);
      console.log("ok:", target.url().slice(0, 100));
    } catch (error) {
      clearTimeout(timer);
      console.log("FAIL:", target.url().slice(0, 100), "-", error.message);
    }
  }
  browser.disconnect();
  approval.kill();
  process.exit(0);
})().catch((error) => {
  console.error("ERR", error.message);
  approval.kill();
  process.exit(1);
});
