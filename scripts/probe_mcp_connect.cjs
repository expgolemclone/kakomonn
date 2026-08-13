const {
  McpClient,
  remoteDebugApprovalEnvironment,
  remoteDebugApprovalPowerShell,
} = require("../kakomonn-reader/tests/live_sync_e2e_test.js");
const { spawn } = require("node:child_process");
const path = require("node:path");

const userDataDir =
  process.env.KAKOMONN_EDGE_USER_DATA_DIR ??
  "C:\\Users\\0000250059\\AppData\\Local\\kakomonn-edge-e2e";

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

(async () => {
  const mcp = new McpClient(userDataDir);
  const startedAt = Date.now();
  const stderrWatcher = setInterval(() => {
    process.stderr.write(`[mcp-stderr-tick] ${mcp.stderr.slice(-500)}\n`);
  }, 5000);
  try {
    const initialized = await mcp.request(
      "initialize",
      {
        capabilities: {},
        clientInfo: { name: "probe", version: "0.0.0" },
        protocolVersion: "2025-03-26",
      },
      15_000,
    );
    console.log(`initialize ok after ${Date.now() - startedAt}ms:`, initialized.serverInfo);
    mcp.notify("notifications/initialized", {});
    const pages = await mcp.tool("list_pages", {}, 60_000);
    console.log(`list_pages ok after ${Date.now() - startedAt}ms`);
    console.log(JSON.stringify(pages).slice(0, 500));
  } catch (error) {
    console.error(`failed after ${Date.now() - startedAt}ms:`, error);
  } finally {
    clearInterval(stderrWatcher);
    approval.kill();
    mcp.process.kill();
    process.exit(0);
  }
})();
