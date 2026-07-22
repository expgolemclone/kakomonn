const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const syncApiOrigin =
  "https://kakomonn-count-sync.expgolem-lab.workers.dev";
const currentQuestionUrl = "https://chushoks.kakomonn.com/questions/86956";
const nextQuestionUrl = "https://chushoks.kakomonn.com/questions/86957";
const correctAnswerText = "輸入の減少は、GDPを増加させる。";
const requestTimeoutMs = 30_000;
const browserApprovalTimeoutMs = 120_000;

function readSyncToken() {
  const token = process.env.KAKOMONN_SYNC_TOKEN ?? "";
  if (token.length < 32 || /\s/.test(token)) {
    throw new Error(
      "KAKOMONN_SYNC_TOKEN must contain the deployed secret token",
    );
  }
  return token;
}

function defaultEdgeUserDataDir() {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) {
      throw new Error("LOCALAPPDATA is not set");
    }
    return path.join(localAppData, "Microsoft", "Edge", "User Data");
  }
  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "Microsoft Edge",
    );
  }
  return path.join(os.homedir(), ".config", "microsoft-edge");
}

function readEdgeUserDataDir() {
  const userDataDir = path.resolve(
    process.env.KAKOMONN_EDGE_USER_DATA_DIR ?? defaultEdgeUserDataDir(),
  );
  const activePortPath = path.join(userDataDir, "DevToolsActivePort");
  if (!fs.existsSync(activePortPath)) {
    throw new Error(
      `Remote debugging is not active. Enable it at edge://inspect/#remote-debugging before running the E2E. Missing: ${activePortPath}`,
    );
  }
  return userDataDir;
}

function chromeDevToolsMcpEntry() {
  const packageMain = require.resolve("chrome-devtools-mcp");
  const packageRoot = path.resolve(path.dirname(packageMain), "..", "..");
  const entry = path.join(
    packageRoot,
    "build",
    "src",
    "bin",
    "chrome-devtools-mcp.js",
  );
  if (!fs.existsSync(entry)) {
    throw new Error(`chrome-devtools-mcp entry was not found: ${entry}`);
  }
  return entry;
}

function assertSyncState(state) {
  assert.match(state.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(Number.isSafeInteger(state.counts?.correct), true);
  assert.equal(Number.isSafeInteger(state.counts?.answered), true);
  assert.equal(state.counts.answered >= state.counts.correct, true);
  assert.equal(state.milestoneInterval, 50);
  return state;
}

async function requestSyncState(token) {
  const response = await fetch(`${syncApiOrigin}/v2/state`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.status, 200);
  return assertSyncState(await response.json());
}

function nextMilestone(correctCount) {
  return (Math.floor(correctCount / 50) + 1) * 50;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

class McpClient {
  constructor(userDataDir) {
    this.nextId = 1;
    this.pending = new Map();
    this.stdoutBuffer = "";
    this.stderr = "";
    this.process = spawn(
      process.execPath,
      [
        chromeDevToolsMcpEntry(),
        "--autoConnect",
        `--user-data-dir=${userDataDir}`,
        "--no-usage-statistics",
        "--no-performance-crux",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    this.process.stdout.on("data", (chunk) => this.onStdout(chunk));
    this.process.stderr.on("data", (chunk) => {
      this.stderr += chunk.toString();
      if (this.stderr.length > 16_000) {
        this.stderr = this.stderr.slice(-16_000);
      }
    });
    this.process.once("exit", (code, signal) => {
      const error = new Error(
        `chrome-devtools-mcp exited before completion: code=${code}, signal=${signal}\n${this.stderr}`,
      );
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(error);
      }
      this.pending.clear();
    });
  }

  onStdout(chunk) {
    this.stdoutBuffer += chunk.toString();
    for (;;) {
      const newline = this.stdoutBuffer.indexOf("\n");
      if (newline < 0) {
        return;
      }
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line.startsWith("{")) {
        continue;
      }
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.id === undefined || !this.pending.has(message.id)) {
        continue;
      }
      const request = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) {
        request.reject(new Error(JSON.stringify(message.error)));
      } else {
        request.resolve(message.result);
      }
    }
  }

  request(method, params, timeoutMs = requestTimeoutMs) {
    const id = this.nextId++;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `MCP request timed out: ${method}\n${this.stderr.slice(-4000)}`,
          ),
        );
      }, timeoutMs);
      this.pending.set(id, { reject, resolve, timer });
    });
    this.process.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
    );
    return promise;
  }

  notify(method, params) {
    this.process.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`,
    );
  }

  async initialize() {
    await this.request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "kakomonn-live-e2e", version: "1.0.0" },
    });
    this.notify("notifications/initialized", {});
  }

  async tool(name, args = {}, timeoutMs = requestTimeoutMs) {
    const result = await this.request(
      "tools/call",
      { name, arguments: args },
      timeoutMs,
    );
    if (result.isError) {
      throw new Error(toolText(result));
    }
    return result;
  }

  close() {
    this.process.stdin.end();
    this.process.kill();
  }
}

function toolText(result) {
  return (result.content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

function parseEvaluation(result) {
  const text = toolText(result);
  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (!fenced) {
    throw new Error(`Evaluation did not return JSON: ${text}`);
  }
  return JSON.parse(fenced[1]);
}

function findUid(snapshot, role, accessibleName) {
  const expected = `${role} ${JSON.stringify(accessibleName)}`;
  for (const line of snapshot.split("\n")) {
    if (!line.includes(expected)) {
      continue;
    }
    const match = line.match(/uid=(\S+)/);
    if (match) {
      return match[1];
    }
  }
  return null;
}

function findChoiceLabelUid(snapshot, choiceNumber) {
  const lines = snapshot.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const label = lines[index].match(/uid=(\S+) LabelText/);
    if (!label) {
      continue;
    }
    const descendants = lines
      .slice(index + 1, index + 7)
      .join("\n");
    if (descendants.includes(`StaticText ${JSON.stringify(choiceNumber)}`)) {
      return label[1];
    }
  }
  return null;
}

function selectedPageId(pageList, url) {
  for (const line of pageList.split("\n")) {
    if (!line.includes(url) || !line.includes("[selected]")) {
      continue;
    }
    const match = line.match(/^\s*(\d+):/);
    if (match) {
      return Number(match[1]);
    }
  }
  return null;
}

async function evaluate(mcp, functionDeclaration) {
  return parseEvaluation(
    await mcp.tool("evaluate_script", { function: functionDeclaration }),
  );
}

async function snapshot(mcp, verbose = false) {
  return toolText(await mcp.tool("take_snapshot", { verbose }));
}

async function waitUntil(description, callback, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  let lastError;
  while (Date.now() < deadline) {
    try {
      lastValue = await callback();
      if (lastValue) {
        return lastValue;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }
  throw new Error(
    `Timed out waiting for ${description}. Last value: ${JSON.stringify(lastValue)}. Last error: ${String(lastError ?? "none")}`,
  );
}

async function readReaderState(mcp) {
  return evaluate(
    mcp,
    `() => {
      const frame = document.querySelector("#kakomonn-reader-frame");
      const next = document.querySelector("#kakomonn-reader-next");
      const settings = document.querySelector("#kakomonn-reader-sync-settings");
      const settingsButton = document.querySelector("#kakomonn-reader-sync-settings-button");
      return {
        actionsPresent: Boolean(document.querySelector("#kakomonn-reader-actions")),
        count: document.querySelector("#kakomonn-reader-count")?.textContent ?? null,
        frameURL: frame?.contentWindow?.location?.href ?? null,
        nextDisabled: next?.disabled ?? null,
        nextText: next?.textContent ?? null,
        outerURL: location.href,
        settingsButtonDisabled: settingsButton?.disabled ?? null,
        settingsHidden: settings?.hidden ?? null,
        status: document.querySelector("#kakomonn-reader-status")?.textContent ?? null
      };
    }`,
  );
}

async function configureSyncToken(mcp, token, baseline) {
  const ready = await waitUntil(
    "the installed Tampermonkey userscript",
    async () => {
      const state = await readReaderState(mcp);
      return state.actionsPresent && state.frameURL ? state : null;
    },
    60_000,
  );
  assert.equal(ready.outerURL, currentQuestionUrl);
  assert.equal(ready.frameURL, currentQuestionUrl);

  let currentSnapshot = await snapshot(mcp);
  let tokenInput = findUid(currentSnapshot, "textbox", "同期トークン");
  if (!tokenInput) {
    await waitUntil("the enabled sync settings button", async () => {
      const state = await readReaderState(mcp);
      return state.settingsButtonDisabled === false ? state : null;
    });
    currentSnapshot = await snapshot(mcp);
    const settingsButton = findUid(
      currentSnapshot,
      "button",
      "学習記録の同期設定を開く",
    );
    assert.notEqual(settingsButton, null, currentSnapshot);
    await mcp.tool("click", { uid: settingsButton });
    currentSnapshot = await snapshot(mcp);
    tokenInput = findUid(currentSnapshot, "textbox", "同期トークン");
  }

  const saveButton = findUid(currentSnapshot, "button", "確認して保存");
  assert.notEqual(tokenInput, null, currentSnapshot);
  assert.notEqual(saveButton, null, currentSnapshot);
  await mcp.tool("fill", { uid: tokenInput, value: token });
  await mcp.tool("click", { uid: saveButton });

  const expectedCount = `${baseline.counts.correct}問,次は${nextMilestone(
    baseline.counts.correct,
  )}問`;
  return waitUntil("the production sync baseline", async () => {
    const state = await readReaderState(mcp);
    return state.settingsHidden && state.count === expectedCount ? state : null;
  });
}

async function submitCorrectAnswer(mcp) {
  const verboseSnapshot = await snapshot(mcp, true);
  assert.equal(verboseSnapshot.includes(correctAnswerText), true);
  const choice = findChoiceLabelUid(verboseSnapshot, "5");
  assert.notEqual(choice, null, verboseSnapshot);
  await mcp.tool("click", { uid: choice });

  const selected = await evaluate(
    mcp,
    `() => document
      .querySelector("#kakomonn-reader-frame")
      .contentDocument
      .querySelector('input[name="intAnswerData"][value="5"]')
      .checked`,
  );
  assert.equal(selected, true, "The visible answer 5 control was not selected");

  const answerSnapshot = await snapshot(mcp);
  const answerButton = findUid(answerSnapshot, "button", "解答する");
  assert.notEqual(answerButton, null, answerSnapshot);
  await mcp.tool("click", { uid: answerButton });

  await waitUntil("the real site correct result", async () =>
    evaluate(
      mcp,
      `() => document
        .querySelector("#kakomonn-reader-frame")
        .contentDocument
        .querySelector("#js-answer-result-box")
        ?.classList.contains("is-correct") === true`,
    ),
  );
}

async function clickNextQuestion(mcp, expectedCorrectCount) {
  await waitUntil("the enabled next question button", async () => {
    const state = await readReaderState(mcp);
    return state.nextDisabled === false && state.nextText === "次の問題へ"
      ? state
      : null;
  });
  const nextSnapshot = await snapshot(mcp);
  const nextButton = findUid(nextSnapshot, "button", "次の問題へ移動");
  assert.notEqual(nextButton, null, nextSnapshot);

  const hitTest = await evaluate(
    mcp,
    `() => {
      const button = document.querySelector("#kakomonn-reader-next");
      const rect = button.getBoundingClientRect();
      const target = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2
      );
      return { targetId: target?.id ?? null };
    }`,
  );
  assert.equal(hitTest.targetId, "kakomonn-reader-next", JSON.stringify(hitTest));
  await mcp.tool("click", { uid: nextButton });

  const expectedCount = `${expectedCorrectCount}問,次は${nextMilestone(
    expectedCorrectCount,
  )}問`;
  return waitUntil("question 86957 and the incremented count", async () => {
    const state = await readReaderState(mcp);
    return state.outerURL === nextQuestionUrl &&
      state.frameURL === nextQuestionUrl &&
      state.count === expectedCount
      ? state
      : null;
  });
}

async function writeFailureDiagnostics(mcp) {
  const screenshotPath = path.join(
    os.tmpdir(),
    `kakomonn-live-e2e-${Date.now()}.png`,
  );
  const diagnostics = await readReaderState(mcp).catch((error) => ({
    error: String(error),
  }));
  await mcp
    .tool(
      "take_screenshot",
      { format: "png", fullPage: false, filePath: screenshotPath },
      60_000,
    )
    .catch(() => null);
  console.error(JSON.stringify({ diagnostics, screenshotPath }));
}

async function main() {
  const token = readSyncToken();
  const userDataDir = readEdgeUserDataDir();
  const baseline = await requestSyncState(token);
  if ((baseline.counts.correct + 1) % baseline.milestoneInterval === 0) {
    throw new Error(
      "The next correct answer reaches a milestone. Run the milestone flow separately before this navigation E2E.",
    );
  }

  const mcp = new McpClient(userDataDir);
  let pageId = null;
  try {
    await mcp.initialize();
    console.error(
      "Edgeにリモートデバッグの承認が表示された場合は,許可してください.",
    );
    await mcp.tool("list_pages", {}, browserApprovalTimeoutMs);
    const opened = toolText(
      await mcp.tool(
        "new_page",
        { url: currentQuestionUrl, timeout: 60_000 },
        75_000,
      ),
    );
    pageId = selectedPageId(opened, currentQuestionUrl);
    assert.notEqual(pageId, null, opened);

    const configuredState = await configureSyncToken(mcp, token, baseline);
    assert.equal(configuredState.count, `${baseline.counts.correct}問,次は${nextMilestone(baseline.counts.correct)}問`);
    await submitCorrectAnswer(mcp);
    const browserState = await clickNextQuestion(
      mcp,
      baseline.counts.correct + 1,
    );
    const finalState = await requestSyncState(token);
    assert.equal(finalState.date, baseline.date);
    assert.equal(finalState.counts.correct, baseline.counts.correct + 1);
    assert.equal(finalState.counts.answered, baseline.counts.answered + 1);
    console.log(
      JSON.stringify({
        answeredAfter: finalState.counts.answered,
        answeredBefore: baseline.counts.answered,
        browser: "Microsoft Edge with Tampermonkey",
        correctAfter: finalState.counts.correct,
        correctBefore: baseline.counts.correct,
        frameUrl: browserState.frameURL,
        status: "passed",
      }),
    );
  } catch (error) {
    await writeFailureDiagnostics(mcp).catch(() => null);
    throw error;
  } finally {
    if (pageId !== null) {
      await mcp.tool("close_page", { pageId }).catch(() => null);
    }
    mcp.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
