const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium, webkit } = require("playwright");

const projectRoot = path.resolve(__dirname, "..");
const scriptPath = path.join(projectRoot, "kakomonn-reader.user.js");
const syncApiOrigin =
  "https://kakomonn-count-sync.expgolem-lab.workers.dev";
const syncTokenKey = "kakomonn-reader.sync-token";
const pendingAnswerKey = "kakomonn-reader.pending-answer";
const currentQuestionUrl = "https://chushoks.kakomonn.com/questions/86956";
const nextQuestionUrl = "https://chushoks.kakomonn.com/questions/86957";
const incorrectAnswerText = "GDPは、フローとストックの混合概念である。";
const iosUserAgent =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 " +
  "Mobile/15E148 Safari/604.1";

function readBrowserName() {
  const browserArgument = process.argv[2] ?? "--browser=chromium";
  if (browserArgument === "--browser=chromium") {
    return "chromium";
  }
  if (browserArgument === "--browser=webkit") {
    return "webkit";
  }
  throw new Error("Usage: live_sync_e2e_test.js [--browser=chromium|webkit]");
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

async function installRealUserscriptApi(page, token) {
  await page.exposeFunction("__kakomonnRealRequest", async (request) => {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.data,
      signal: AbortSignal.timeout(request.timeout),
    });
    const responseHeaders = [...response.headers.entries()]
      .map(([name, value]) => `${name}: ${value}`)
      .join("\r\n");
    if (request.responseType === "arraybuffer") {
      return {
        responseBytes: [...new Uint8Array(await response.arrayBuffer())],
        responseHeaders,
        status: response.status,
      };
    }
    return {
      responseText: await response.text(),
      responseHeaders,
      status: response.status,
    };
  });

  await page.evaluate(
    ({ storedToken, tokenKey }) => {
      const values = new Map([[tokenKey, storedToken]]);
      const calls = [];
      window.__kakomonnRealGM = {
        calls,
        readValue(key) {
          return values.has(key) ? structuredClone(values.get(key)) : null;
        },
      };
      window.GM = {
        async getValue(key, defaultValue) {
          return values.has(key)
            ? structuredClone(values.get(key))
            : defaultValue;
        },
        async setValue(key, value) {
          values.set(key, structuredClone(value));
        },
        async deleteValue(key) {
          values.delete(key);
        },
        xmlHttpRequest(details) {
          const contentType = details.headers?.["Content-Type"] ?? "";
          const call = {
            body:
              details.data === undefined
                ? null
                : contentType === "application/json"
                  ? JSON.parse(details.data)
                  : details.data,
            method: details.method,
            status: null,
            url: details.url,
          };
          calls.push(call);
          let aborted = false;
          const request = window
            .__kakomonnRealRequest({
              data: details.data,
              headers: details.headers,
              method: details.method,
              responseType: details.responseType,
              timeout: details.timeout,
              url: details.url,
            })
            .then(
              (response) => {
                call.status = response.status;
                if (Array.isArray(response.responseBytes)) {
                  response.response = new Uint8Array(
                    response.responseBytes,
                  ).buffer;
                  delete response.responseBytes;
                }
                if (aborted) {
                  details.onabort?.({});
                  return response;
                }
                details.onload?.(response);
                return response;
              },
              (error) => {
                if (aborted) {
                  details.onabort?.({});
                } else if (error?.name === "TimeoutError") {
                  details.ontimeout?.({});
                } else {
                  details.onerror?.({});
                }
                throw error;
              },
            );
          request.abort = () => {
            aborted = true;
          };
          return request;
        },
      };
    },
    { storedToken: token, tokenKey: syncTokenKey },
  );
}

async function blockThirdPartyAds(context) {
  await context.route("**/*", async (route) => {
    const hostname = new URL(route.request().url()).hostname;
    if (
      hostname.endsWith(".googlesyndication.com") ||
      hostname.endsWith(".doubleclick.net") ||
      hostname === "googletagmanager.com" ||
      hostname.endsWith(".googletagmanager.com") ||
      hostname === "anymind360.com" ||
      hostname.endsWith(".anymind360.com")
    ) {
      await route.abort();
      return;
    }
    await route.continue();
  });
}

async function activateControl(control, hasTouch) {
  if (hasTouch) {
    await control.tap({ force: true });
    return;
  }
  await control.click({ force: true });
}

async function submitIncorrectAnswer(frame, hasTouch) {
  const normalize = (value) => value.replace(/\s+/g, "").trim();
  const choices = await frame.locator(".problem_detail ul.list > li").allInnerTexts();
  const choiceIndex = choices.findIndex(
    (choice) => normalize(choice) === normalize(incorrectAnswerText),
  );
  assert.notEqual(choiceIndex, -1);
  const answerInput = frame
    .locator(".problem_detail ul.check input[name='intAnswerData']")
    .nth(choiceIndex);
  await activateControl(
    frame.locator(".problem_detail ul.check > li > label").nth(choiceIndex),
    hasTouch,
  );
  assert.equal(await answerInput.isChecked(), true);
  await activateControl(frame.locator("#send_exam_btn"), hasTouch);
  await frame.getByText("残念...", { exact: true }).waitFor({
    state: "visible",
    timeout: 15_000,
  });
}

async function readDiagnostics(page, pageErrors) {
  return page.evaluate(
    ({ errors, pendingKey }) => {
      const frame = document.querySelector("#kakomonn-reader-frame");
      const frameDocument = frame?.contentDocument;
      return {
        answerResultClass:
          frameDocument?.querySelector("#js-answer-result-box")?.className ??
          null,
        button: (() => {
          const button = document.querySelector("#kakomonn-reader-next");
          return button
            ? { disabled: button.disabled, text: button.textContent }
            : null;
        })(),
        calls: (window.__kakomonnRealGM?.calls ?? []).map((call) => ({
          body:
            new URL(call.url).origin ===
            "https://kakomonn-count-sync.expgolem-lab.workers.dev"
              ? call.body
              : null,
          method: call.method,
          origin: new URL(call.url).origin,
          path: new URL(call.url).pathname,
          status: call.status,
        })),
        errors,
        frameUrl: frame?.contentWindow.location.href ?? null,
        inputEvents: window.__kakomonnNextInputEvents ?? [],
        nextCandidates: frameDocument
          ? [...frameDocument.querySelectorAll("a[href]")]
              .filter((link) => /次の問題/.test(link.textContent ?? ""))
              .map((link) => ({ href: link.href, text: link.textContent }))
          : [],
        pendingAnswer:
          window.__kakomonnRealGM?.readValue(pendingKey) ?? null,
        status: document.querySelector("#kakomonn-reader-status")?.textContent,
        syncSettingsHidden:
          document.querySelector("#kakomonn-reader-sync-settings")?.hidden ??
          null,
        topUrl: location.href,
      };
    },
    { errors: pageErrors, pendingKey: pendingAnswerKey },
  );
}

async function runLiveSyncCase(
  browser,
  script,
  token,
  initialState,
  { contextOptions, hasTouch, readyStatus },
) {
  const context = await browser.newContext(contextOptions);
  await blockThirdPartyAds(context);
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  try {
    const response = await page.goto(currentQuestionUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    assert.equal(response?.ok(), true);
    await page.getByText("解答する", { exact: true }).waitFor({
      state: "visible",
    });
    await installRealUserscriptApi(page, token);
    await page.evaluate((source) => (0, eval)(source), script);

    const frame = page.locator("#kakomonn-reader-frame").contentFrame();
    await frame.getByText("解答する", { exact: true }).waitFor({
      state: "visible",
    });
    await page.waitForFunction(
      (expectedCount) =>
        document.querySelector("#kakomonn-reader-count")?.textContent ===
        `${expectedCount}問,次は50問`,
      initialState.counts.correct,
      { timeout: 30_000 },
    );
    await page.waitForFunction(
      (expectedStatus) =>
        document.querySelector("#kakomonn-reader-status")?.textContent ===
        expectedStatus,
      readyStatus,
      { timeout: 30_000 },
    );

    await submitIncorrectAnswer(frame, hasTouch);
    await page.waitForFunction(
      () => document.querySelector("#kakomonn-reader-next")?.disabled === false,
      null,
      { timeout: 15_000 },
    );
    await page.evaluate(() => {
      window.__kakomonnNextInputEvents = [];
      for (const eventName of ["touchend", "pointerup", "click"]) {
        document.addEventListener(
          eventName,
          (event) => {
            window.__kakomonnNextInputEvents.push({
              isTrusted: event.isTrusted,
              pointerType: event.pointerType ?? null,
              targetId: event.target?.id ?? null,
              type: event.type,
            });
          },
          true,
        );
      }
    });
    await activateControl(page.locator("#kakomonn-reader-next"), hasTouch);
    await page.waitForFunction(
      (expectedUrl) =>
        document.querySelector("#kakomonn-reader-frame")?.contentWindow.location
          .href === expectedUrl,
      nextQuestionUrl,
      { timeout: 30_000 },
    );
    await page.waitForFunction(
      (expectedUrl) => location.href === expectedUrl,
      nextQuestionUrl,
      { timeout: 30_000 },
    );

    const state = await page.evaluate((pendingKey) => {
      const answerCalls = window.__kakomonnRealGM.calls.filter(
        (call) =>
          call.method === "POST" &&
          new URL(call.url).pathname === "/v2/answers",
      );
      return {
        answerCalls,
        count: document.querySelector("#kakomonn-reader-count")?.textContent,
        frameUrl: document.querySelector("#kakomonn-reader-frame")?.contentWindow
          .location.href,
        inputEvents: window.__kakomonnNextInputEvents,
        pendingAnswer: window.__kakomonnRealGM.readValue(pendingKey),
        status: document.querySelector("#kakomonn-reader-status")?.textContent,
        topUrl: location.href,
      };
    }, pendingAnswerKey);
    assert.equal(state.answerCalls.length, 1);
    assert.equal(state.answerCalls[0].status, 200);
    assert.equal(state.answerCalls[0].body.result, "incorrect");
    assert.match(state.answerCalls[0].body.operationId, /^[0-9a-f]{32}$/);
    assert.equal(state.pendingAnswer, null);
    assert.equal(state.frameUrl, nextQuestionUrl);
    assert.equal(state.topUrl, nextQuestionUrl);
    assert.equal(state.count, `${initialState.counts.correct}問,次は50問`);
    const expectedInputType = hasTouch ? "pointerup" : "click";
    assert.equal(
      state.inputEvents.some(
        (event) =>
          event.type === expectedInputType &&
          event.targetId === "kakomonn-reader-next" &&
          event.isTrusted &&
          (!hasTouch || event.pointerType === "touch"),
      ),
      true,
    );
    assert.deepEqual(pageErrors, []);
    return state;
  } catch (error) {
    console.error(
      JSON.stringify({
        diagnostics: await readDiagnostics(page, pageErrors).catch(
          (diagnosticError) => ({ error: String(diagnosticError) }),
        ),
        failure: String(error),
      }),
    );
    throw error;
  } finally {
    await context.close();
  }
}

async function main() {
  const browserName = readBrowserName();
  const token = readSyncToken();
  const script = fs.readFileSync(scriptPath, "utf8");
  const initialState = await requestSyncState(token);
  const browserType = browserName === "webkit" ? webkit : chromium;
  const browser = await browserType.launch({ headless: true });
  const browserOptions =
    browserName === "webkit"
      ? {
          contextOptions: {
            deviceScaleFactor: 3,
            hasTouch: true,
            isMobile: true,
            userAgent: iosUserAgent,
            viewport: { height: 844, width: 390 },
          },
          hasTouch: true,
          readyStatus: "画面をクリックまたはタップすると読み上げます",
        }
      : {
          contextOptions: {},
          hasTouch: false,
          readyStatus: "読み上げ非対応",
        };
  let browserState;
  try {
    browserState = await runLiveSyncCase(
      browser,
      script,
      token,
      initialState,
      browserOptions,
    );
  } finally {
    await browser.close();
  }

  const finalState = await requestSyncState(token);
  assert.equal(finalState.date, initialState.date);
  assert.equal(finalState.counts.correct, initialState.counts.correct);
  assert.equal(finalState.counts.answered, initialState.counts.answered + 1);
  console.log(
    JSON.stringify({
      answeredAfter: finalState.counts.answered,
      answeredBefore: initialState.counts.answered,
      browser: browserName,
      correct: finalState.counts.correct,
      frameUrl: browserState.frameUrl,
      status: "passed",
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
