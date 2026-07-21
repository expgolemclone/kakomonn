const assert = require("node:assert/strict");
const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const { Builder, By, Capabilities } = require("selenium-webdriver");
const { Command } = require("selenium-webdriver/lib/command");
const { Origin, Pointer } = require("selenium-webdriver/lib/input");
const {
  createSyncMockConfiguration,
  installSyncMockInWindow,
} = require("./sync_mock");

const projectRoot = path.resolve(__dirname, "..");
const defaultScriptPath = path.join(projectRoot, "kakomonn-reader.user.js");
const resultRoot = path.join(projectRoot, "test-results", "ios-safari");
const currentQuestionURL = "https://chushoks.kakomonn.com/questions/86956";
const nextQuestionURL = "https://chushoks.kakomonn.com/questions/86957";
const correctAnswerText = "輸入の減少は、GDPを増加させる。";
const appiumServerURL = "http://127.0.0.1:4723";
const appiumLogPath = path.join(resultRoot, "appium.log");
const getAppiumContextCommand = "getAppiumContext";
const setAppiumContextCommand = "setAppiumContext";
const safariOnboardingTitle = "View Bookmarks, Share Menu, and Open Tabs";
const liveCorrectAnswerAccessibilityLabel = "iOS Safari correct answer";
const liveSubmitAnswerAccessibilityLabel = "iOS Safari submit answer";

const fixtureBody = `
  <div id="meta">中小企業診断士試験 令和7年度 第4問</div>
  <p>iOS Safari動作確認用の問題文です.</p>
  <div id="js-answer-result-box"></div>
  <h2>この過去問の解説</h2>
  <p id="explanation-lock">解説は問題に回答すると表示されます.</p>
  <p id="explanation" hidden>iOS Safari動作確認用の解説です.</p>
  <button type="button">次の問題へ</button>
  <p class="next">
    <a id="next" href="${nextQuestionURL}">次の問題（問5）へ</a>
  </p>
`;

function loadUserscript() {
  const configuredPath = process.env.KAKOMONN_READER_SCRIPT_PATH;
  if (configuredPath) {
    return fs.readFileSync(path.resolve(configuredPath), "utf8");
  }

  execFileSync("python3", ["build.py"], {
    cwd: projectRoot,
    stdio: "inherit",
  });
  return fs.readFileSync(defaultScriptPath, "utf8");
}

function createSafariCapabilities() {
  const deviceUDID = process.env.IOS_SAFARI_DEVICE_UDID;
  if (!deviceUDID) {
    throw new Error("IOS_SAFARI_DEVICE_UDID is required");
  }

  return new Capabilities()
    .setBrowserName("Safari")
    .set("platformName", "iOS")
    .set("appium:automationName", "XCUITest")
    .set("appium:udid", deviceUDID)
    .set("appium:deviceName", "iPhone")
    .set("appium:simulatorTracePointer", true)
    .set("appium:safariInitialUrl", currentQuestionURL)
    .set("appium:wdaLaunchTimeout", 300_000)
    .set("appium:wdaStartupRetries", 1)
    .set("appium:webviewConnectTimeout", 30_000);
}

function registerAppiumContextCommands(driver) {
  const executor = driver.getExecutor();
  executor.defineCommand(
    getAppiumContextCommand,
    "GET",
    "/session/:sessionId/context",
  );
  executor.defineCommand(
    setAppiumContextCommand,
    "POST",
    "/session/:sessionId/context",
  );
}

function getAppiumContext(driver) {
  return driver.execute(new Command(getAppiumContextCommand));
}

function setAppiumContext(driver, name) {
  return driver.execute(
    new Command(setAppiumContextCommand).setParameter("name", name),
  );
}

async function dismissSafariOnboarding(driver) {
  await delay(1_000);
  const webContext = await getAppiumContext(driver);
  assert.match(webContext, /^WEBVIEW_/);
  await setAppiumContext(driver, "NATIVE_APP");

  try {
    const source = await driver.getPageSource();
    if (!source.includes(safariOnboardingTitle)) {
      console.log("Safari onboarding was already absent");
      return;
    }

    const windowRect = await driver.manage().window().getRect();
    const titleElements = await driver.findElements(
      new By("accessibility id", safariOnboardingTitle),
    );
    assert.equal(
      titleElements.length,
      1,
      `Safari onboarding title was not unique: ${titleElements.length}`,
    );
    const titleRect = await titleElements[0].getRect();
    const closePoint = {
      x: windowRect.width - 38,
      y: titleRect.y + 18,
    };
    assert.ok(closePoint.y > 0 && closePoint.y < windowRect.height);
    console.log(
      `Safari onboarding close point: ${JSON.stringify({
        windowRect,
        titleRect,
        closePoint,
      })}`,
    );
    await driver.executeScript("mobile: tap", closePoint);
    await delay(750);
    assert.equal(
      (await driver.getPageSource()).includes(safariOnboardingTitle),
      false,
      "Safari onboarding did not close",
    );
    console.log("Safari onboarding dismissed");
  } finally {
    await setAppiumContext(driver, webContext);
  }
}

async function waitForAppiumServer(serverProcess) {
  const deadline = Date.now() + 60_000;
  let lastError = null;

  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) {
      throw new Error(
        `Appium server exited before startup with code ${serverProcess.exitCode}`,
      );
    }

    try {
      const response = await fetch(`${appiumServerURL}/status`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        return;
      }
      lastError = new Error(`Appium status returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }

  throw new Error(`Appium server did not start: ${lastError?.message}`);
}

async function startAppiumServer() {
  fs.mkdirSync(resultRoot, { recursive: true });
  const serverProcess = spawn(
    process.execPath,
    [
      require.resolve("appium"),
      "--address",
      "127.0.0.1",
      "--port",
      "4723",
      "--log",
      appiumLogPath,
      "--log-level",
      "warn:debug",
      "--log-no-colors",
    ],
    {
      cwd: path.resolve(projectRoot, ".."),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  serverProcess.stdout.pipe(process.stdout);
  serverProcess.stderr.pipe(process.stderr);
  try {
    await waitForAppiumServer(serverProcess);
  } catch (error) {
    await stopAppiumServer(serverProcess);
    throw error;
  }
  return serverProcess;
}

async function stopAppiumServer(serverProcess) {
  if (serverProcess.exitCode !== null) {
    return;
  }

  const exited = new Promise((resolve) => {
    serverProcess.once("exit", resolve);
  });
  serverProcess.kill("SIGTERM");
  await Promise.race([exited, delay(10_000)]);
  if (serverProcess.exitCode === null) {
    throw new Error("Appium server did not stop after SIGTERM");
  }
}

async function waitForScript(driver, description, script, timeout = 30_000) {
  let lastError = null;
  try {
    return await driver.wait(
      async () => {
        try {
          return (await driver.executeScript(script)) || false;
        } catch (error) {
          lastError = error;
          return false;
        }
      },
      timeout,
      description,
    );
  } catch (error) {
    const cause = lastError ?? error;
    throw new Error(`${description}: ${cause.message}`, { cause });
  }
}

async function installHarness(driver, userscript) {
  await driver.executeScript(`
    window.__iosSafariErrors = [];
    window.__iosSafariInputEvents = [];
    for (const eventName of [
      "touchstart",
      "touchend",
      "pointerdown",
      "pointerup",
      "mousedown",
      "mouseup",
      "click",
    ]) {
      document.addEventListener(
        eventName,
        (event) => {
          window.__iosSafariInputEvents.push({
            type: event.type,
            targetId: event.target?.id || null,
            targetTag: event.target?.tagName || null,
            isTrusted: event.isTrusted,
            pointerType: event.pointerType || null,
          });
        },
        true,
      );
    }
    window.addEventListener("error", (event) => {
      window.__iosSafariErrors.push(String(event.error || event.message));
    });
    window.addEventListener("unhandledrejection", (event) => {
      window.__iosSafariErrors.push(String(event.reason));
    });
    Object.defineProperty(window, "Audio", {
      configurable: true,
      value: undefined,
    });
  `);
  await driver.executeScript(
    `return (${installSyncMockInWindow.toString()})(arguments[0]);`,
    createSyncMockConfiguration({ userscriptsPromise: true }),
  );
  await driver.executeScript(userscript);
  await waitForScript(
    driver,
    "reader controls did not initialize",
    `return Boolean(
      document.querySelector("#kakomonn-reader-frame") &&
      document.querySelector("#kakomonn-reader-next") &&
      document.querySelector("#kakomonn-reader-count")?.textContent ===
        "0問,次は50問"
    );`,
  );
}

async function replaceQuestionWithFixture(driver) {
  await waitForScript(
    driver,
    "fixture iframe document did not initialize",
    `return Boolean(
      document.querySelector("#kakomonn-reader-frame")?.contentDocument?.body
    );`,
  );
  await driver.executeScript(
    `
      const frameDocument = document.querySelector(
        "#kakomonn-reader-frame"
      ).contentDocument;
      frameDocument.body.innerHTML = arguments[0];
      Object.defineProperty(
        frameDocument.querySelector("#next"),
        "getClientRects",
        { configurable: true, value: () => [] }
      );
    `,
    fixtureBody,
  );
}

async function buttonState(driver) {
  return driver.executeScript(`
    const button = document.querySelector("#kakomonn-reader-next");
    return button === null
      ? null
      : { text: button.textContent, disabled: button.disabled };
  `);
}

async function answerRequestCount(driver) {
  return driver.executeScript(`
    return window.__syncMock.calls.filter(
      (call) =>
        call.method === "POST" &&
        new URL(call.url).pathname === "/v2/answers"
    ).length;
  `);
}

async function tapElementNatively(driver, accessibilityLabel) {
  const webContext = await getAppiumContext(driver);
  assert.match(webContext, /^WEBVIEW_/);
  await setAppiumContext(driver, "NATIVE_APP");

  try {
    const elements = await driver.findElements(
      new By("accessibility id", accessibilityLabel),
    );
    if (elements.length !== 1) {
      const source = await driver.getPageSource();
      const matchingLabels = [
        ...source.matchAll(/(?:name|label|value)="([^"]+)"/g),
      ]
        .map((match) => match[1])
        .filter(
          (label) =>
            label.includes(accessibilityLabel) ||
            label.includes("iOS Safari") ||
            label.includes("次"),
        );
      assert.equal(
        elements.length,
        1,
        `native element was not unique for ${JSON.stringify(
          accessibilityLabel,
        )}: ${JSON.stringify([...new Set(matchingLabels)])}`,
      );
    }
    const target = elements[0];
    const rect = await target.getRect();
    const x = Math.floor(rect.x + rect.width / 2);
    const y = Math.floor(rect.y + rect.height / 2);
    console.log(
      `native tap target: ${JSON.stringify({
        accessibilityLabel,
        rect,
        coordinate: { x, y },
      })}`,
    );
    const finger = new Pointer("native touch finger", Pointer.Type.TOUCH);
    const actions = driver.actions({ async: true });
    actions.insert(
      finger,
      finger.move({ duration: 0, origin: Origin.VIEWPORT, x, y }),
      finger.press(),
      finger.release(),
    );
    await actions.perform();
    await delay(750);
  } finally {
    await setAppiumContext(driver, webContext);
  }
}

async function assertNavigationCompleted(driver) {
  await waitForScript(
    driver,
    "iframe did not navigate to the next question",
    `return document.querySelector("#kakomonn-reader-frame")
      ?.contentWindow.location.href === "${nextQuestionURL}";`,
  );
  await waitForScript(
    driver,
    "answer count did not update after navigation",
    `return document.querySelector("#kakomonn-reader-count")?.textContent ===
      "1問,次は50問";`,
  );
  await waitForScript(
    driver,
    "top-level URL did not follow the iframe navigation",
    `return location.href === "${nextQuestionURL}";`,
  );
  assert.equal(await answerRequestCount(driver), 1);
  assert.equal(await driver.getCurrentUrl(), nextQuestionURL);
  const inputEvents = await driver.executeScript(
    "return window.__iosSafariInputEvents;",
  );
  assert.ok(
    inputEvents.some(
      (event) =>
        event.type === "click" &&
        event.targetId === "kakomonn-reader-next" &&
        event.isTrusted === true,
    ),
    `native coordinate tap did not produce a trusted click: ${JSON.stringify(
      inputEvents,
    )}`,
  );
  assert.deepEqual(
    await driver.executeScript("return window.__iosSafariErrors;"),
    [],
  );
}

async function runFixtureCase(driver, userscript) {
  await driver.get(currentQuestionURL);
  await dismissSafariOnboarding(driver);
  await installHarness(driver, userscript);
  await replaceQuestionWithFixture(driver);
  assert.deepEqual(await buttonState(driver), {
    text: "次の問題へ",
    disabled: true,
  });

  await driver.executeScript(`
    const frameDocument = document.querySelector(
      "#kakomonn-reader-frame"
    ).contentDocument;
    frameDocument
      .querySelector("#js-answer-result-box")
      .classList.add("is-correct");
  `);
  await waitForScript(
    driver,
    "fixture next-question button did not become enabled",
    `return document.querySelector("#kakomonn-reader-next")?.disabled === false;`,
  );
  await tapElementNatively(driver, "次の問題へ移動");
  await assertNavigationCompleted(driver);
}

async function runLiveSiteCase(driver, userscript) {
  await driver.get(currentQuestionURL);
  await dismissSafariOnboarding(driver);
  await installHarness(driver, userscript);
  await waitForScript(
    driver,
    "live answer form did not initialize",
    `return Boolean(
      document.querySelector("#kakomonn-reader-frame")?.contentDocument
        ?.querySelector("#send_exam_btn")
    );`,
  );
  const selection = await driver.executeScript(
    `
      const frameDocument = document.querySelector(
        "#kakomonn-reader-frame"
      ).contentDocument;
      const normalize = (value) => value.replace(/\\s+/g, "").trim();
      const choices = [
        ...frameDocument.querySelectorAll(".problem_detail ul.list > li"),
      ];
      const choiceIndex = choices.findIndex(
        (choice) => normalize(choice.textContent) === normalize(arguments[0])
      );
      if (choiceIndex < 0) {
        return null;
      }
      const labels = [
        ...frameDocument.querySelectorAll(
          ".problem_detail ul.check > li > label"
        ),
      ];
      const answerInputs = [
        ...frameDocument.querySelectorAll(
          ".problem_detail ul.check input[name='intAnswerData']"
        ),
      ];
      if (
        labels.length !== choices.length ||
        answerInputs.length !== choices.length
      ) {
        throw new Error(
          "live answer form count mismatch: choices=" + choices.length +
            ", labels=" + labels.length +
            ", inputs=" + answerInputs.length
        );
      }
      const label = labels[choiceIndex];
      label.setAttribute("aria-label", arguments[1]);
      label.setAttribute("role", "button");
      label.setAttribute("tabindex", "0");
      label.scrollIntoView({ block: "center", inline: "nearest" });
      return {
        choiceIndex,
        choiceText: choices[choiceIndex].textContent,
        answerValue: answerInputs[choiceIndex].value,
      };
    `,
    correctAnswerText,
    liveCorrectAnswerAccessibilityLabel,
  );
  assert.notEqual(selection, null);
  console.log(`live answer prepared: ${JSON.stringify(selection)}`);
  await delay(500);
  await tapElementNatively(driver, liveCorrectAnswerAccessibilityLabel);
  await waitForScript(
    driver,
    "native answer tap did not select the correct radio input",
    `
      const frameDocument = document.querySelector(
        "#kakomonn-reader-frame"
      ).contentDocument;
      const answerInputs = frameDocument.querySelectorAll(
        ".problem_detail ul.check input[name='intAnswerData']"
      );
      return answerInputs[${selection.choiceIndex}]?.checked === true;
    `,
  );
  await driver.executeScript(
    `
      const submitButton = document.querySelector(
        "#kakomonn-reader-frame"
      ).contentDocument.querySelector("#send_exam_btn");
      submitButton.setAttribute("aria-label", arguments[0]);
      submitButton.scrollIntoView({ block: "center", inline: "nearest" });
    `,
    liveSubmitAnswerAccessibilityLabel,
  );
  await delay(500);
  await tapElementNatively(driver, liveSubmitAnswerAccessibilityLabel);
  await waitForScript(
    driver,
    "live answer result did not become correct",
    `return document.querySelector("#kakomonn-reader-frame")
      ?.contentDocument.querySelector("#js-answer-result-box")
      ?.classList.contains("is-correct");`,
  );
  await waitForScript(
    driver,
    "live next-question button did not become enabled",
    `return document.querySelector("#kakomonn-reader-next")?.disabled === false;`,
  );
  await tapElementNatively(driver, "次の問題へ移動");
  await assertNavigationCompleted(driver);
}

async function collectDiagnostics(driver, scenario, error) {
  fs.mkdirSync(resultRoot, { recursive: true });
  let state = { collectionError: null };
  try {
    state = await driver.executeScript(`
      const frame = document.querySelector("#kakomonn-reader-frame");
      const frameDocument = frame?.contentDocument;
      const candidates = frameDocument
        ? [...frameDocument.querySelectorAll(
            "a[href], button, input[type='button'], input[type='submit']"
          )]
            .filter((element) => /次の問題/.test(
              element.innerText || element.textContent || element.value || ""
            ))
            .map((element) => {
              const style = frameDocument.defaultView.getComputedStyle(element);
              const rects = [...element.getClientRects()].map((rect) => ({
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
              }));
              return {
                tag: element.tagName,
                id: element.id,
                className: element.className,
                label: element.innerText || element.textContent || element.value,
                href: element.href || null,
                ariaDisabled: element.getAttribute("aria-disabled"),
                display: style.display,
                visibility: style.visibility,
                rects,
              };
            })
        : [];
      const button = document.querySelector("#kakomonn-reader-next");
      const buttonRect = button?.getBoundingClientRect();
      const buttonStyle = button ? getComputedStyle(button) : null;
      const hitTest = buttonRect
        ? document
            .elementsFromPoint(
              buttonRect.left + buttonRect.width / 2,
              buttonRect.top + buttonRect.height / 2
            )
            .map((element) => ({
              tag: element.tagName,
              id: element.id,
              className: element.className,
            }))
        : [];
      return {
        topURL: location.href,
        frameURL: frame?.contentWindow.location.href || null,
        button: button
          ? {
              text: button.textContent,
              disabled: button.disabled,
              position: buttonStyle.position,
              pointerEvents: buttonStyle.pointerEvents,
              zIndex: buttonStyle.zIndex,
              rect: {
                x: buttonRect.x,
                y: buttonRect.y,
                width: buttonRect.width,
                height: buttonRect.height,
              },
            }
          : null,
        status: document.querySelector("#kakomonn-reader-status")?.textContent,
        count: document.querySelector("#kakomonn-reader-count")?.textContent,
        errors: window.__iosSafariErrors || [],
        inputEvents: window.__iosSafariInputEvents || [],
        syncCalls: window.__syncMock?.calls || [],
        candidates,
        hitTest,
        frameBody: frameDocument?.body?.outerHTML || null,
      };
    `);
  } catch (collectionError) {
    state = { collectionError: String(collectionError) };
  }
  state.scenario = scenario;
  state.failure = String(error?.stack || error);
  fs.writeFileSync(
    path.join(resultRoot, `${scenario}.json`),
    `${JSON.stringify(state, null, 2)}\n`,
  );
  try {
    const screenshot = await driver.takeScreenshot();
    fs.writeFileSync(
      path.join(resultRoot, `${scenario}.png`),
      screenshot,
      "base64",
    );
    if (process.env.GITHUB_ACTIONS === "true") {
      console.error("IOS_SAFARI_SCREENSHOT_BEGIN");
      for (let index = 0; index < screenshot.length; index += 12_000) {
        console.error(
          `IOS_SAFARI_SCREENSHOT_CHUNK ${screenshot.slice(index, index + 12_000)}`,
        );
      }
      console.error("IOS_SAFARI_SCREENSHOT_END");
    }
  } catch (screenshotError) {
    fs.writeFileSync(
      path.join(resultRoot, `${scenario}-screenshot-error.txt`),
      `${String(screenshotError)}\n`,
    );
  }
  return state;
}

function printAppiumLogTail() {
  if (!fs.existsSync(appiumLogPath)) {
    return;
  }
  const appiumLog = fs.readFileSync(appiumLogPath, "utf8");
  const tail = appiumLog.slice(-50_000);
  console.error(`APPIUM_LOG_TAIL_BEGIN\n${tail}\nAPPIUM_LOG_TAIL_END`);
}

async function runCase(driver, name, callback) {
  console.log(`${name} started`);
  try {
    await callback();
    console.log(`${name} passed`);
  } catch (error) {
    const diagnostics = await collectDiagnostics(driver, name, error);
    const { frameBody, ...summary } = diagnostics;
    console.error(
      `${name} diagnostics:\n${JSON.stringify(
        {
          ...summary,
          frameBodyExcerpt: frameBody?.slice(0, 4_000) ?? null,
        },
        null,
        2,
      )}`,
    );
    throw error;
  }
}

async function main() {
  if (process.platform !== "darwin") {
    throw new Error("iOS Safari E2E requires macOS");
  }
  const userscript = loadUserscript();
  console.log("Appium server startup started");
  const appiumServer = await startAppiumServer();
  console.log("Appium server started");
  let driver = null;

  try {
    console.log("XCUITest Mobile Safari session creation started");
    driver = await new Builder()
      .usingServer(appiumServerURL)
      .withCapabilities(createSafariCapabilities())
      .build();
    console.log("XCUITest Mobile Safari session created");
    registerAppiumContextCommands(driver);
    await runCase(driver, "fixture", () => runFixtureCase(driver, userscript));
    await runCase(driver, "live-site", () =>
      runLiveSiteCase(driver, userscript),
    );
  } finally {
    try {
      if (driver !== null) {
        await driver.quit();
      }
    } finally {
      await stopAppiumServer(appiumServer);
    }
  }

  console.log("kakomonn iOS Safari E2E passed");
}

main().catch((error) => {
  console.error(error);
  printAppiumLogTail();
  process.exitCode = 1;
});
