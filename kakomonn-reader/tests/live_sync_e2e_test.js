const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const userscriptPath = path.resolve(
  __dirname,
  "..",
  "kakomonn-reader.user.js",
);
const syncApiOrigin =
  "https://kakomonn-count-sync.expgolem-lab.workers.dev";
const currentQuestionUrl = "https://chushoks.kakomonn.com/questions/86956";
const nextQuestionUrl = "https://chushoks.kakomonn.com/questions/86957";
const correctAnswerText = "輸入の減少は、GDPを増加させる。";
const expectedMarkdownHeading =
  "# 中小企業診断士試験 令和7年度（2025年） 問4（経済学・経済政策 問4）";
const requestTimeoutMs = 30_000;
const browserApprovalTimeoutMs = 120_000;
const edgeViewport = { height: 900, width: 1440 };
const buildFingerprintPattern =
  /const BUILD_FINGERPRINT = "([0-9a-f]{64})";/g;

function extractBuildFingerprint(userscript) {
  const matches = [...userscript.matchAll(buildFingerprintPattern)];
  if (matches.length !== 1) {
    throw new Error(
      `Built userscript must contain exactly one build fingerprint: found ${matches.length}`,
    );
  }
  return matches[0][1];
}

function readExpectedBuildFingerprint() {
  if (!fs.existsSync(userscriptPath)) {
    throw new Error(
      `Built userscript was not found. Run the build first: ${userscriptPath}`,
    );
  }
  return extractBuildFingerprint(fs.readFileSync(userscriptPath, "utf8"));
}

function assertRuntimeIdentity(state, expectedBuildFingerprint) {
  assert.equal(
    typeof state.userAgent,
    "string",
    "The connected browser did not expose a user agent",
  );
  assert.match(
    state.userAgent,
    /\bEdg\/\d+/,
    "The remote-debugging target must be Microsoft Edge",
  );
  assert.equal(
    state.scriptHandler,
    "Tampermonkey",
    "The userscript must be injected by Tampermonkey",
  );
  assert.equal(
    state.buildFingerprint,
    expectedBuildFingerprint,
    "The installed Tampermonkey userscript is stale. Save the latest kakomonn-reader.user.js in Tampermonkey and rerun the test",
  );
}

function readSyncToken() {
  const token = process.env.KAKOMONN_SYNC_TOKEN ?? "";
  if (token.length < 32 || /\s/.test(token)) {
    throw new Error(
      "KAKOMONN_SYNC_TOKEN must contain the deployed secret token",
    );
  }
  return token;
}

function windowsPowerShellExecutable() {
  if (process.platform !== "win32") {
    throw new Error("The real clipboard E2E requires Windows");
  }
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot) {
    throw new Error("SystemRoot is not set");
  }
  const executable = path.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  if (!fs.existsSync(executable)) {
    throw new Error(`Windows PowerShell was not found: ${executable}`);
  }
  return executable;
}

function runClipboardPowerShell(command, environment = {}) {
  const childEnvironment = { ...process.env, ...environment };
  delete childEnvironment.KAKOMONN_SYNC_TOKEN;
  const result = spawnSync(
    windowsPowerShellExecutable(),
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
    {
      encoding: "utf8",
      env: childEnvironment,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    },
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `Windows clipboard command failed: ${result.stderr.trim()}`,
    );
  }
  return result.stdout.replace(/\r\n/g, "\n").trimEnd();
}

function prepareClipboardNonce() {
  const nonce = `kakomonn-live-e2e-${randomUUID()}`;
  runClipboardPowerShell(
    "Set-Clipboard -Value $env:KAKOMONN_E2E_CLIPBOARD_NONCE",
    { KAKOMONN_E2E_CLIPBOARD_NONCE: nonce },
  );
  return nonce;
}

function readWindowsClipboard() {
  return runClipboardPowerShell("Get-Clipboard -Raw");
}

function defaultEdgeUserDataDir(
  environment = process.env,
  platform = process.platform,
) {
  if (platform === "win32") {
    const localAppData = environment.LOCALAPPDATA;
    if (!localAppData) {
      throw new Error("LOCALAPPDATA is not set");
    }
    return path.join(localAppData, "Microsoft", "Edge", "User Data");
  }
  if (platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "Microsoft Edge",
    );
  }
  return path.join(os.homedir(), ".config", "microsoft-edge");
}

function isSameOrDescendantPath(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function readEdgeUserDataDir({
  environment = process.env,
  existsSync = fs.existsSync,
  platform = process.platform,
} = {}) {
  const configuredPath = environment.KAKOMONN_EDGE_USER_DATA_DIR ?? "";
  if (!configuredPath.trim()) {
    throw new Error(
      "KAKOMONN_EDGE_USER_DATA_DIR must point to a dedicated Edge E2E user data directory",
    );
  }
  const userDataDir = path.resolve(configuredPath);
  const standardUserDataDir = path.resolve(
    defaultEdgeUserDataDir(environment, platform),
  );
  if (isSameOrDescendantPath(standardUserDataDir, userDataDir)) {
    throw new Error(
      "KAKOMONN_EDGE_USER_DATA_DIR must be outside the standard Edge user data directory",
    );
  }
  const activePortPath = path.join(userDataDir, "DevToolsActivePort");
  if (!existsSync(activePortPath)) {
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
      const shell = document.querySelector("#kakomonn-reader-shell");
      const frame = document.querySelector("#kakomonn-reader-frame");
      const next = document.querySelector("#kakomonn-reader-next");
      const settings = document.querySelector("#kakomonn-reader-sync-settings");
      const settingsButton = document.querySelector("#kakomonn-reader-sync-settings-button");
      return {
        actionsPresent: Boolean(document.querySelector("#kakomonn-reader-actions")),
        buildFingerprint: shell?.dataset.buildFingerprint ?? null,
        count: document.querySelector("#kakomonn-reader-count")?.textContent ?? null,
        frameURL: frame?.contentWindow?.location?.href ?? null,
        nextDisabled: next?.disabled ?? null,
        nextText: next?.textContent ?? null,
        outerURL: location.href,
        scriptHandler: shell?.dataset.scriptHandler ?? null,
        settingsButtonDisabled: settingsButton?.disabled ?? null,
        settingsHidden: settings?.hidden ?? null,
        status: document.querySelector("#kakomonn-reader-status")?.textContent ?? null,
        userAgent: navigator.userAgent
      };
    }`,
  );
}

async function configureSyncToken(
  mcp,
  token,
  baseline,
  expectedBuildFingerprint,
) {
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
  assertRuntimeIdentity(ready, expectedBuildFingerprint);

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
  await waitUntil("the visible answer 5 label", async () => {
    const clickTarget = await evaluate(
      mcp,
      `async () => {
      const frame = window.document
        .querySelector("#kakomonn-reader-frame");
      const frameWindow = frame.contentWindow;
      const document = frame.contentDocument;
      const input = document
        .querySelector('input[name="intAnswerData"][value="5"]');
      const label = input?.closest("label");
      if (!label) {
        return { hittable: false, innerTarget: null, outerTarget: null };
      }
      const initialRect = label.getBoundingClientRect();
      const desiredCenters = [
        frame.clientHeight - initialRect.height / 2 - 14,
        frame.clientHeight * 0.75,
        frame.clientHeight * 0.5
      ];
      let result = {
        hittable: false,
        innerTarget: null,
        outerTarget: null
      };
      for (const desiredCenter of desiredCenters) {
        const beforeScroll = label.getBoundingClientRect();
        frameWindow.scrollTo({
          top:
            frameWindow.scrollY +
            beforeScroll.top +
            beforeScroll.height / 2 -
            desiredCenter,
          behavior: "instant"
        });
        await new Promise((resolve) =>
          frameWindow.requestAnimationFrame(() =>
            frameWindow.requestAnimationFrame(resolve)
          )
        );
        const rect = label.getBoundingClientRect();
        const innerTarget = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2
        );
        const frameRect = frame.getBoundingClientRect();
        const outerTarget = window.document.elementFromPoint(
          frameRect.left + rect.left + rect.width / 2,
          frameRect.top + rect.top + rect.height / 2
        );
        result = {
          hittable:
            (innerTarget === label || label.contains(innerTarget)) &&
            outerTarget === frame,
          innerTarget: innerTarget?.tagName ?? null,
          outerTarget: outerTarget?.tagName ?? null
        };
        if (result.hittable) {
          return result;
        }
      }
      return result;
    }`,
    );
    return clickTarget.hittable ? clickTarget : null;
  });

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

async function copyMarkdownInRealEdge(mcp) {
  const clipboardNonce = prepareClipboardNonce();
  await waitUntil("the ready Markdown copy button", async () =>
    evaluate(
      mcp,
      `() => {
        const button = document.querySelector("#kakomonn-reader-copy");
        return button?.disabled === false &&
          button.textContent === "Markdownをコピー";
      }`,
    ),
  );
  const copySnapshot = await snapshot(mcp);
  const copyButton = findUid(
    copySnapshot,
    "button",
    "問題文と解説をMarkdownでコピー",
  );
  assert.notEqual(copyButton, null, copySnapshot);
  await mcp.tool("click", { uid: copyButton });
  await waitUntil("the successful real clipboard copy", async () =>
    evaluate(
      mcp,
      `() => document
        .querySelector("#kakomonn-reader-copy")
        ?.textContent === "コピー済み"`,
    ),
  );

  const copiedMarkdown = readWindowsClipboard();
  assert.notEqual(copiedMarkdown, clipboardNonce);
  assert.equal(copiedMarkdown.includes(clipboardNonce), false);
  assert.equal(copiedMarkdown.split("\n")[0], expectedMarkdownHeading);
  assert.equal(copiedMarkdown.includes(correctAnswerText), true);
  assert.match(copiedMarkdown, /^## 解説$/m);
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
  const expectedBuildFingerprint = readExpectedBuildFingerprint();
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
    await mcp.tool("resize_page", edgeViewport);
    const viewport = await evaluate(
      mcp,
      `() => ({
        height: window.innerHeight,
        width: window.innerWidth
      })`,
    );
    assert.deepEqual(viewport, edgeViewport);

    const configuredState = await configureSyncToken(
      mcp,
      token,
      baseline,
      expectedBuildFingerprint,
    );
    assert.equal(configuredState.count, `${baseline.counts.correct}問,次は${nextMilestone(baseline.counts.correct)}問`);
    await submitCorrectAnswer(mcp);
    await copyMarkdownInRealEdge(mcp);
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
        buildFingerprint: expectedBuildFingerprint,
        frameUrl: browserState.frameURL,
        markdownHeading: expectedMarkdownHeading,
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

module.exports = {
  McpClient,
  assertRuntimeIdentity,
  extractBuildFingerprint,
  readEdgeUserDataDir,
  toolText,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
