const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const {
  remoteDebugApprovalEnvironment,
  remoteDebugApprovalPowerShell,
} = require("../kakomonn-reader/tests/live_sync_e2e_test.js");

const TAMPERMONKEY_EXTENSION_ID = "dhdgffkkebhmkfjojejmpbldmpobfkfo";

function windowsPowerShellExecutable() {
  return path.join(
    process.env.SystemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
}

function startRemoteDebugApproval(userDataDir) {
  const child = spawn(
    windowsPowerShellExecutable(),
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      remoteDebugApprovalPowerShell,
    ],
    {
      env: remoteDebugApprovalEnvironment(userDataDir),
      stdio: ["ignore", "ignore", "ignore"],
      windowsHide: true,
    },
  );
  return {
    stop() {
      if (child.exitCode === null && !child.killed) child.kill();
    },
  };
}

function readActivePort() {
  const content = fs
    .readFileSync(
      path.join(process.env.LOCALAPPDATA, "kakomonn-edge-e2e", "DevToolsActivePort"),
      "utf8",
    )
    .split(/\r?\n/);
  return { port: content[0], browserPath: content[1] };
}

class CdpSession {
  constructor(socket, sessionId = undefined) {
    this.socket = socket;
    this.sessionId = sessionId;
    this.nextId = 1;
    this.pending = new Map();
  }

  send(method, params = {}, timeoutMs = 30000) {
    const id = this.nextId++;
    const message = { id, method, params };
    if (this.sessionId !== undefined) message.sessionId = this.sessionId;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    this.socket.send(JSON.stringify(message));
    return promise;
  }

  dispatch(message) {
    if (message.id === undefined || !this.pending.has(message.id)) return false;
    const request = this.pending.get(message.id);
    this.pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
    return true;
  }
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function main() {
  const scriptPath = path.resolve(__dirname, "..", "kakomonn-reader", "kakomonn-reader.user.js");
  assert.ok(fs.existsSync(scriptPath), `missing userscript: ${scriptPath}`);
  const { port, browserPath } = readActivePort();

  const socket = new WebSocket(`ws://127.0.0.1:${port}${browserPath}`);
  const approval = startRemoteDebugApproval(
    path.join(process.env.LOCALAPPDATA, "kakomonn-edge-e2e"),
  );
  const browser = new CdpSession(socket);
  const sessions = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data));
    if (message.sessionId !== undefined && sessions.has(message.sessionId)) {
      if (sessions.get(message.sessionId).dispatch(message)) return;
    }
    browser.dispatch(message);
  };
  try {
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = () => reject(new Error("WebSocket did not open"));
      setTimeout(() => reject(new Error("WebSocket open timeout")), 120000);
    });
  } finally {
    approval.stop();
  }

  const { targetId } = await browser.send("Target.createTarget", {
    url: `chrome-extension://${TAMPERMONKEY_EXTENSION_ID}/options.html#nav=utils`,
  });
  const { sessionId } = await browser.send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const page = new CdpSession(socket, sessionId);
  sessions.set(sessionId, page);

  try {
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    await page.send("DOM.enable");

    const evaluate = (expression) =>
      page.send("Runtime.evaluate", { expression, returnByValue: true });

    for (let index = 0; index < 30; index += 1) {
      const { result } = await evaluate("document.readyState");
      if (result.value === "complete") break;
      await delay(500);
    }

    const { root } = await page.send("DOM.getDocument", { depth: -1 });
    const { nodeId } = await page.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: "input[type=file]",
    });
    assert.ok(nodeId, "file input was not found on the Tampermonkey utilities page");
    await page.send("DOM.setFileInputFiles", {
      files: [scriptPath.replaceAll("/", "\\")],
      nodeId,
    });

    let clicked = false;
    for (let index = 0; index < 30 && !clicked; index += 1) {
      await delay(1000);
      const { result } = await evaluate(`(() => {
        const buttons = [...document.querySelectorAll("button, a.button, input[type=button]")];
        const target = buttons.find((button) => /^(インストール|更新|Install|Update)$/.test((button.textContent || button.value || "").trim()));
        if (!target) return "";
        target.click();
        return (target.textContent || target.value || "").trim();
      })()`);
      if (result.value) {
        console.log("clicked:", result.value);
        clicked = true;
      }
    }
    assert.ok(clicked, "install/update confirmation button was not found");

    let confirmed = false;
    for (let index = 0; index < 20 && !confirmed; index += 1) {
      await delay(1000);
      const { result } = await evaluate(
        "(document.body && document.body.innerText || '').slice(0, 4000)",
      );
      if (/(インストール済み|保存しました|Installed|is installed|Updated)/i.test(result.value)) {
        confirmed = true;
      }
    }
    assert.ok(confirmed, "install confirmation text was not found");
    console.log("tampermonkey userscript install done");
  } finally {
    await browser.send("Target.closeTarget", { targetId }).catch(() => {});
    socket.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
