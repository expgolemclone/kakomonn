const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const WebSocket = require("ws");
const {
  remoteDebugApprovalEnvironment,
  remoteDebugApprovalPowerShell,
} = require("../kakomonn-reader/tests/live_sync_e2e_test.js");

const userDataDir =
  process.env.KAKOMONN_EDGE_USER_DATA_DIR ??
  "C:\\Users\\0000250059\\AppData\\Local\\kakomonn-edge-e2e";

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
const content = fs
  .readFileSync(path.join(userDataDir, "DevToolsActivePort"), "utf8")
  .trim()
  .split("\n");
const endpoint = `ws://127.0.0.1:${content[0].trim()}${content.slice(1).join("").trim()}`;

const socket = new WebSocket(endpoint);
let nextId = 1;
const pending = new Map();

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${method}`)), 8_000);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

socket.on("message", (data) => {
  const message = JSON.parse(data.toString());
  if (message.id !== undefined && pending.has(message.id)) {
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
  }
});

socket.on("open", async () => {
  try {
    const { targetInfos } = await send("Target.getTargets");
    for (const info of targetInfos) {
      console.log(JSON.stringify({ id: info.targetId, type: info.type, attached: info.attached, url: info.url.slice(0, 70) }));
    }
    const todoist = targetInfos.filter((info) => info.url.includes("todoist"));
    for (const info of todoist) {
      console.log("closing todoist", info.targetId);
      console.log(await send("Target.closeTarget", { targetId: info.targetId }));
    }
    socket.close();
    approval.kill();
    process.exit(0);
  } catch (error) {
    console.error("ERR", error.message);
    approval.kill();
    process.exit(1);
  }
});
socket.on("error", (error) => {
  console.error("ws error:", error.message);
  approval.kill();
  process.exit(1);
});
