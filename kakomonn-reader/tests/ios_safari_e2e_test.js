const assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const {
  kakomonnFreeEnvironment,
  readKakomonnConfiguration,
} = require("../../scripts/kakomonn-config.cjs");

const {
  createSyncMockConfiguration,
  installSyncMockInWindow,
} = require("./sync_mock");
const {
  assertMarkdownCopy,
  MARKDOWN_CHOICES,
  MARKDOWN_INCORRECT_ANSWER_SUMMARY,
  MARKDOWN_INCORRECT_ANSWER_TEXT,
  MARKDOWN_EXPLANATION_IMAGE_URLS,
  MARKDOWN_EXPLANATION_PREFIXES,
  MARKDOWN_QUESTION_HEADING,
  MARKDOWN_QUESTION_IMAGE_URLS,
  MARKDOWN_QUESTION_TEXT,
  MARKDOWN_QUESTION_URL,
  normalizeContent,
} = require("./support/markdown_copy_fixture");

const projectRoot = path.resolve(__dirname, "..");
const repositoryRoot = path.resolve(projectRoot, "..");
const scriptPath = path.join(projectRoot, "kakomonn-reader.user.js");
const resultDirectory = path.join(projectRoot, "test-results", "ios-safari");
const appiumLogPath = path.join(resultDirectory, "appium.log");
const simulatorLogPath = path.join(resultDirectory, "simulator.log");
const failureScreenshotPath = path.join(
  resultDirectory,
  "failure-screenshot.png",
);
const failureSourcePath = path.join(resultDirectory, "failure-source.xml");
const safariNativeSourcePath = path.join(
  resultDirectory,
  "safari-native-source.xml",
);
const failureDiagnosticsPath = path.join(
  resultDirectory,
  "failure-diagnostics.json",
);
const readerSourceURL = "kakomonn-reader.user.js";
const nextQuestionOpenURL =
  "https://kakomonn-sync.kakomonn.workers.dev/open";
const nextQuestionLauncherURL =
  "https://chushoks.kakomonn.com/createques#kakomonn-next";
const kakomonnConfiguration = readKakomonnConfiguration();
const expectedXcodeVersion =
  kakomonnConfiguration.KAKOMONN_XCODE_VERSION ?? "26.6";
const simulatorPlatformVersion =
  kakomonnConfiguration.KAKOMONN_IOS_VERSION ?? "26.5";
const simulatorDeviceName =
  kakomonnConfiguration.KAKOMONN_IOS_DEVICE ?? "iPhone 17";
const nextQuestionURL = "https://chushoks.kakomonn.com/questions/86957";
const testTimeout = 60_000;
const webDriverElementKey = "element-6066-11e4-a52e-4f735466cecf";

class IOSWebElement {
  constructor(driver, reference) {
    this.driver = driver;
    this.reference = reference;
  }

  async click() {
    await this.driver.sessionRequest(
      "POST",
      `/element/${encodeURIComponent(this.id)}/click`,
      {},
    );
  }

  async getText() {
    return this.driver.sessionRequest(
      "GET",
      `/element/${encodeURIComponent(this.id)}/text`,
    );
  }

  async isDisplayed() {
    return this.driver.sessionRequest(
      "GET",
      `/element/${encodeURIComponent(this.id)}/displayed`,
    );
  }

  async isSelected() {
    return this.driver.sessionRequest(
      "GET",
      `/element/${encodeURIComponent(this.id)}/selected`,
    );
  }

  async setValue(value) {
    await this.driver.sessionRequest(
      "POST",
      `/element/${encodeURIComponent(this.id)}/value`,
      { text: value, value: Array.from(value) },
    );
  }

  async waitForDisplayed({ timeout = testTimeout } = {}) {
    await this.driver.waitUntil(() => this.isDisplayed(), {
      interval: 250,
      timeout,
      timeoutMsg: `Element was not displayed: ${this.id}`,
    });
  }

  get id() {
    const id = this.reference?.[webDriverElementKey];
    assert.equal(typeof id, "string", "Invalid WebDriver element reference");
    return id;
  }
}

class IOSWebDriver {
  constructor(port, sessionId = null) {
    this.port = port;
    this.sessionId = sessionId;
  }

  static async create(port, capabilities) {
    const client = new IOSWebDriver(port);
    const session = await client.request(
      "POST",
      "/session",
      {
        capabilities: {
          alwaysMatch: capabilities,
          firstMatch: [{}],
        },
      },
      1_200_000,
    );
    assert.equal(typeof session?.sessionId, "string");
    client.sessionId = session.sessionId;
    return client;
  }

  async $(selector) {
    return this.findElement("css selector", selector);
  }

  async $$(selector) {
    const references = await this.sessionRequest("POST", "/elements", {
      using: "css selector",
      value: selector,
    });
    return references.map((reference) => new IOSWebElement(this, reference));
  }

  async deleteSession() {
    if (this.sessionId === null) {
      return;
    }
    const sessionId = this.sessionId;
    this.sessionId = null;
    await this.request("DELETE", `/session/${encodeURIComponent(sessionId)}`);
  }

  async findElement(using, value) {
    const reference = await this.sessionRequest("POST", "/element", {
      using,
      value,
    });
    return new IOSWebElement(this, reference);
  }

  async getContext() {
    return this.sessionRequest("GET", "/context");
  }

  async getContexts() {
    return this.sessionRequest("GET", "/contexts");
  }

  async execute(script, ...args) {
    const source =
      typeof script === "function"
        ? `return (${script.toString()}).apply(null, arguments)`
        : script;
    return this.sessionRequest("POST", "/execute/sync", {
      args,
      script: source,
    });
  }

  async executeScript(script, args) {
    return this.sessionRequest("POST", "/execute/sync", { args, script });
  }

  async calibrateNativeWebTap() {
    const calibration = await this.executeScript(
      "mobile: calibrateWebToRealCoordinatesTranslation",
      [],
    );
    for (const key of ["offsetX", "offsetY", "pixelRatioX", "pixelRatioY"]) {
      assert.equal(
        Number.isFinite(calibration?.[key]),
        true,
        `Invalid native web tap calibration: ${key}`,
      );
    }
  }

  async getLogs(type) {
    return this.sessionRequest("POST", "/log", { type });
  }

  async getPageSource() {
    return this.sessionRequest("GET", "/source");
  }

  async getUrl() {
    return this.sessionRequest("GET", "/url");
  }

  async navigateTo(url) {
    await this.sessionRequest("POST", "/url", { url });
  }

  async navigateForward() {
    await this.sessionRequest("POST", "/forward", {});
  }

  async request(method, endpoint, body, timeout = 180_000) {
    const requestBody = body === undefined ? null : JSON.stringify(body);
    const response = await new Promise((resolve, reject) => {
      const request = http.request(
        {
          host: "127.0.0.1",
          port: this.port,
          path: endpoint,
          method,
          headers:
            requestBody === null
              ? undefined
              : {
                  "content-length": Buffer.byteLength(requestBody),
                  "content-type": "application/json",
                },
        },
        (incoming) => {
          const chunks = [];
          incoming.on("data", (chunk) => chunks.push(chunk));
          incoming.once("error", reject);
          incoming.once("end", () => {
            resolve({
              body: Buffer.concat(chunks).toString("utf8"),
              statusCode: incoming.statusCode,
              statusMessage: incoming.statusMessage,
            });
          });
        },
      );
      request.once("error", reject);
      request.setTimeout(timeout, () => {
        request.destroy(
          new Error(
            `WebDriver command timed out after ${timeout}ms for ${method} ${endpoint}`,
          ),
        );
      });
      if (requestBody !== null) {
        request.write(requestBody);
      }
      request.end();
    });
    const responseText = response.body;
    let payload;
    try {
      payload = JSON.parse(responseText);
    } catch {
      throw new Error(
        `WebDriver returned invalid JSON for ${method} ${endpoint}: ${responseText}`,
      );
    }
    if (
      response.statusCode === undefined ||
      response.statusCode < 200 ||
      response.statusCode >= 300 ||
      payload.value?.error
    ) {
      const message =
        payload.value?.message ??
        payload.value?.error ??
        `${response.statusCode ?? "unknown"} ${response.statusMessage ?? ""}`.trim();
      const error = new Error(
        `WebDriver command failed for ${method} ${endpoint}: ${message}`,
      );
      if (typeof payload.value?.stacktrace === "string") {
        error.stack += `\n${payload.value.stacktrace}`;
      }
      throw error;
    }
    return payload.value;
  }

  async saveScreenshot(filePath) {
    const screenshot = await this.sessionRequest("GET", "/screenshot");
    fs.writeFileSync(filePath, Buffer.from(screenshot, "base64"));
  }

  async getClipboardText() {
    const content = await this.executeScript("mobile: getClipboard", [
      { contentType: "plaintext" },
    ]);
    assert.equal(typeof content, "string");
    return Buffer.from(content, "base64").toString("utf8");
  }

  async setClipboardText(content) {
    await this.executeScript("mobile: setClipboard", [
      {
        content: Buffer.from(content, "utf8").toString("base64"),
        contentType: "plaintext",
      },
    ]);
  }

  async sessionRequest(method, endpoint, body, timeout) {
    assert.notEqual(this.sessionId, null, "WebDriver session is not active");
    return this.request(
      method,
      `/session/${encodeURIComponent(this.sessionId)}${endpoint}`,
      body,
      timeout,
    );
  }

  async switchToFrame(element) {
    await this.sessionRequest("POST", "/frame", { id: element.reference });
  }

  async switchToTopFrame() {
    await this.sessionRequest("POST", "/frame", { id: null });
  }

  async switchToContext(name) {
    await this.sessionRequest("POST", "/context", { name });
  }

  async waitUntil(
    condition,
    { interval = 250, timeout = testTimeout, timeoutMsg = "Condition timed out" },
  ) {
    const deadline = Date.now() + timeout;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        if (await condition()) {
          return;
        }
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    const error = new Error(timeoutMsg);
    if (lastError !== null) {
      error.cause = lastError;
    }
    throw error;
  }
}

function verifyHostEnvironment() {
  assert.equal(
    process.platform,
    "darwin",
    "The iOS Safari E2E requires macOS",
  );

  const xcodeVersion = execFileSync("xcodebuild", ["-version"], {
    encoding: "utf8",
    env: kakomonnFreeEnvironment(),
  });
  assert.match(
    xcodeVersion,
    new RegExp(`^Xcode ${expectedXcodeVersion.replace(/\./g, "\\.")}\\r?$`, "m"),
    `Xcode ${expectedXcodeVersion} is required:\n${xcodeVersion}`,
  );

  const simulatorList = JSON.parse(
    execFileSync("xcrun", ["simctl", "list", "devices", "available", "--json"], {
      encoding: "utf8",
      env: kakomonnFreeEnvironment(),
    }),
  );
  const runtimeKey = `com.apple.CoreSimulator.SimRuntime.iOS-${simulatorPlatformVersion.replace(/\./g, "-")}`;
  const availableDevices = simulatorList.devices?.[runtimeKey] ?? [];
  assert.equal(
    availableDevices.some(
      (device) => device.name === simulatorDeviceName && device.isAvailable,
    ),
    true,
    `${simulatorDeviceName} with iOS ${simulatorPlatformVersion} is required`,
  );
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function waitForAppium(port, appiumProcess) {
  const statusURL = `http://127.0.0.1:${port}/status`;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (appiumProcess.exitCode !== null) {
      throw new Error(
        `Appium exited before becoming ready with code ${appiumProcess.exitCode}`,
      );
    }
    try {
      const response = await fetch(statusURL);
      if (response.ok) {
        const status = await response.json();
        if (status.value?.ready === true) {
          return;
        }
      }
    } catch {
      // Appium has not bound its HTTP listener yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Appium did not become ready within 90 seconds");
}

async function startAppium() {
  const port = await reservePort();
  const appiumEntryPoint = require.resolve("appium");
  const appiumProcess = spawn(
    process.execPath,
    [
      appiumEntryPoint,
      "server",
      "--address",
      "127.0.0.1",
      "--port",
      String(port),
      "--use-drivers",
      "xcuitest",
      "--log",
      appiumLogPath,
      "--log-level",
      "info:debug",
      "--log-no-colors",
      "--log-timestamp",
      "--keep-alive-timeout",
      "1500",
      "--shutdown-timeout",
      "0",
    ],
    {
      cwd: repositoryRoot,
      env: kakomonnFreeEnvironment(),
      stdio: "ignore",
      windowsHide: true,
    },
  );
  await waitForAppium(port, appiumProcess);
  return { appiumProcess, port };
}

async function stopAppium(appiumProcess) {
  if (appiumProcess === null || appiumProcess.exitCode !== null) {
    return;
  }
  const exited = new Promise((resolve) => appiumProcess.once("exit", resolve));
  appiumProcess.kill("SIGTERM");
  const stopped = await Promise.race([
    exited.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 10_000)),
  ]);
  if (!stopped && appiumProcess.exitCode === null) {
    appiumProcess.kill("SIGKILL");
    await exited;
  }
}

async function waitForElement(driver, selector, timeout = testTimeout) {
  await driver.waitUntil(
    async () => {
      try {
        const element = await driver.$(selector);
        return await element.isDisplayed();
      } catch {
        return false;
      }
    },
    { interval: 250, timeout, timeoutMsg: `Element was not visible: ${selector}` },
  );
  return driver.$(selector);
}

async function waitForElementPresent(driver, selector, timeout = testTimeout) {
  await driver.waitUntil(
    async () => {
      try {
        await driver.$(selector);
        return true;
      } catch {
        return false;
      }
    },
    { interval: 250, timeout, timeoutMsg: `Element was not present: ${selector}` },
  );
  return driver.$(selector);
}

async function waitForElementText(
  driver,
  selector,
  expectedText,
  timeout = testTimeout,
) {
  await driver.waitUntil(
    async () => {
      try {
        const element = await driver.$(selector);
        return (await element.getText()) === expectedText;
      } catch {
        return false;
      }
    },
    {
      interval: 250,
      timeout,
      timeoutMsg: `Element did not contain expected text: ${selector}`,
    },
  );
  return driver.$(selector);
}

async function clickWebElementNatively(driver, selector, index = 0) {
  const elements = await driver.$$(selector);
  assert.equal(
    index < elements.length,
    true,
    `Native web tap target was not present: ${selector}[${index}]`,
  );
  const element = elements[index];
  await element.click();
  return element;
}

async function readNativeWebTapViewport(driver) {
  return driver.execute(() => {
    const visualViewport = window.visualViewport;
    return {
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
      isScrolledToTop:
        document.documentElement.scrollTop === 0 && document.body.scrollTop === 0,
      visualViewportHeight: visualViewport?.height ?? window.innerHeight,
      visualViewportOffsetLeft: visualViewport?.offsetLeft ?? 0,
      visualViewportOffsetTop: visualViewport?.offsetTop ?? 0,
      visualViewportScale: visualViewport?.scale ?? 1,
      visualViewportWidth: visualViewport?.width ?? window.innerWidth,
    };
  });
}

async function prepareSafariInitialPage(driver) {
  const webContext = await driver.getContext();
  assert.match(webContext, /^WEBVIEW_/);
  assert.ok((await driver.getContexts()).includes("NATIVE_APP"));

  const closeSafariToolbarTip = async (nativeSource) => {
    const showsToolbarTip =
      nativeSource.includes('name="TipView"') &&
      nativeSource.includes(
        'name="View Bookmarks, Share Menu, and Open Tabs"',
      );
    if (!showsToolbarTip) {
      return;
    }
    const closeButton = await driver.findElement(
      "accessibility id",
      "xmark.circle.fill",
    );
    await closeButton.waitForDisplayed();
    await closeButton.click();
  };

  await driver.switchToContext("NATIVE_APP");
  try {
    const nativeSource = await driver.getPageSource();
    assert.match(nativeSource, /width="402" height="874"/);
    const showsStartPage = nativeSource.includes("StartPageCollectionView");
    const showsStartPageOnboarding = nativeSource.includes(
      'name="onboardingButton-CustomizeStartPage"',
    );
    const showsLoadedPage = /name="TabDocument[^\"]*IsPageLoaded=true/.test(
      nativeSource,
    );

    if (showsStartPageOnboarding) {
      assert.equal(showsStartPage, true);
      assert.equal(showsLoadedPage, false);
      const closeButton = await driver.findElement("accessibility id", "close");
      await closeButton.waitForDisplayed();
      await closeButton.click();
    } else {
      assert.equal(
        showsLoadedPage && !showsStartPage,
        true,
        "Safari must show either the configured page or its known start-page onboarding",
      );
    }
  } finally {
    await driver.switchToContext(webContext);
  }
  await driver.waitUntil(() => driver.getUrl().then((url) => url === MARKDOWN_QUESTION_URL), {
    interval: 250,
    timeout: 60_000,
    timeoutMsg: "Safari did not load the configured initial URL",
  });

  await driver.switchToContext("NATIVE_APP");
  try {
    const loadedNativeSource = await driver.getPageSource();
    fs.writeFileSync(safariNativeSourcePath, loadedNativeSource, "utf8");
    assert.match(loadedNativeSource, /width="402" height="874"/);
    assert.match(
      loadedNativeSource,
      /name="TabDocument[^"]*IsPageLoaded=true/,
    );
    assert.equal(
      loadedNativeSource.includes("StartPageCollectionView"),
      false,
    );
    await closeSafariToolbarTip(loadedNativeSource);
  } finally {
    await driver.switchToContext(webContext);
  }
}

async function installReader(driver, script, syncOptions = {}) {
  await driver.execute(() => {
    localStorage.clear();
    Object.defineProperty(window, "Audio", {
      configurable: true,
      value: undefined,
    });
    window.__kakomonnReaderErrors = [];
    window.__kakomonnReaderRejections = [];
    window.addEventListener("error", (event) => {
      window.__kakomonnReaderErrors.push({
        column: event.colno,
        filename: event.filename,
        line: event.lineno,
        message: event.message,
      });
    });
    window.addEventListener("unhandledrejection", (event) => {
      window.__kakomonnReaderRejections.push(
        event.reason?.stack ?? event.reason?.message ?? String(event.reason),
      );
    });
  });

  const syncConfiguration = createSyncMockConfiguration({
    nextQuestionId: new URL(nextQuestionURL).pathname.split("/").at(-1),
    ...syncOptions,
  });
  await driver.execute(
    `(${installSyncMockInWindow.toString()})(${JSON.stringify(syncConfiguration)});`,
  );
  await driver.execute(`${script}\n//# sourceURL=${readerSourceURL}`);
}

async function readQuestionContent(driver) {
  const heading = await driver.execute(() =>
    Array.from(document.querySelector(".problem_detail > .when").childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.nodeValue || "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim(),
  );
  const questionTitle = await driver.$(".problem_detail > .ttl");
  const questionText = normalizeContent(await questionTitle.getText());
  const choiceElements = await driver.$$(".problem_detail > ul.list > li");
  const choices = [];
  for (const choice of choiceElements) {
    choices.push((await choice.getText()).replace(/\s+/g, " ").trim());
  }
  const questionImageURLs = await driver.execute(() =>
    Array.from(
      document.querySelectorAll(".problem_detail > .zoomin img[src]"),
      (image) => image.src,
    ),
  );
  return { choices, heading, questionImageURLs, questionText };
}

async function switchToReaderFrame(driver) {
  await driver.switchToTopFrame();
  const readerFrame = await driver.$("#kakomonn-reader-frame");
  await driver.switchToFrame(readerFrame);
}

async function submitAnswer(driver, answerText) {
  const choiceElements = await driver.$$(".problem_detail ul.list > li");
  const choiceTexts = [];
  for (const choice of choiceElements) {
    choiceTexts.push(normalizeContent(await choice.getText()));
  }
  const choiceIndex = choiceTexts.findIndex(
    (choice) => choice === normalizeContent(answerText),
  );
  assert.notEqual(choiceIndex, -1, `Answer choice was not found: ${answerText}`);

  const answerInputs = await driver.$$(
    ".problem_detail ul.check input[name='intAnswerData']",
  );
  const answerLabels = await driver.$$(
    ".problem_detail ul.check > li > label",
  );
  assert.equal(answerInputs.length, choiceTexts.length);
  assert.equal(answerLabels.length, choiceTexts.length);
  await clickWebElementNatively(
    driver,
    ".problem_detail ul.check > li > label",
    choiceIndex,
  );
  await switchToReaderFrame(driver);
  const selectedAnswerInputs = await driver.$$(
    ".problem_detail ul.check input[name='intAnswerData']",
  );
  assert.equal(selectedAnswerInputs.length, choiceTexts.length);
  assert.equal(await selectedAnswerInputs[choiceIndex].isSelected(), true);
  await clickWebElementNatively(driver, "#send_exam_btn");
  await switchToReaderFrame(driver);
}

async function readExplanationContents(driver) {
  await waitForElement(driver, "#js-answer-result-box.is-wrong", 30_000);
  const explanationElements = await driver.$$(
    "#js-commentary-wrap > .item > .text",
  );
  assert.equal(explanationElements.length, 3);
  for (const explanation of explanationElements) {
    await explanation.waitForDisplayed({ timeout: 30_000 });
  }
  const explanationContents = (
    await driver.execute(() =>
      Array.from(
        document.querySelectorAll("#js-commentary-wrap > .item > .text"),
        (element) => element.innerText,
      ),
    )
  ).map(normalizeContent);
  const explanationImageURLs = await driver.execute(() =>
    Array.from(
      document.querySelectorAll("#js-commentary-wrap > .item .text img[src]"),
      (image) => image.src,
    ),
  );
  return { explanationContents, explanationImageURLs };
}

async function captureFailureArtifacts(driver, error) {
  const diagnostics = {
    error: error?.stack ?? String(error),
    simulatorDeviceName,
    simulatorPlatformVersion,
    url: null,
  };
  if (driver !== null) {
    diagnostics.url = await driver.getUrl().catch(() => null);
    await driver.saveScreenshot(failureScreenshotPath).catch(() => {});
    const source = await driver.getPageSource().catch(() => null);
    if (source !== null) {
      fs.writeFileSync(failureSourcePath, source, "utf8");
    }
    const safariConsole = await driver.getLogs("safariConsole").catch(() => []);
    diagnostics.safariConsole = safariConsole;
  }
  fs.writeFileSync(
    failureDiagnosticsPath,
    `${JSON.stringify(diagnostics, null, 2)}\n`,
    "utf8",
  );
  try {
    const simulatorLog = execFileSync(
      "xcrun",
      [
        "simctl",
        "spawn",
        "booted",
        "log",
        "show",
        "--last",
        "5m",
        "--predicate",
        'process == "MobileSafari" OR process == "WebDriverAgentRunner"',
        "--style",
        "compact",
      ],
      {
        encoding: "utf8",
        env: kakomonnFreeEnvironment(),
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    fs.writeFileSync(simulatorLogPath, simulatorLog, "utf8");
  } catch (simulatorLogError) {
    fs.appendFileSync(
      failureDiagnosticsPath,
      `${JSON.stringify({ simulatorLogError: String(simulatorLogError) })}\n`,
      "utf8",
    );
  }
}

async function runTest() {
  verifyHostEnvironment();
  fs.mkdirSync(resultDirectory, { recursive: true });
  execFileSync("python3", ["build.py"], {
    cwd: projectRoot,
    env: kakomonnFreeEnvironment(),
    stdio: "inherit",
  });
  const script = fs.readFileSync(scriptPath, "utf8");

  let appiumProcess = null;
  let driver = null;
  try {
    const appium = await startAppium();
    appiumProcess = appium.appiumProcess;
    driver = await IOSWebDriver.create(appium.port, {
      platformName: "iOS",
      browserName: "Safari",
      "appium:automationName": "XCUITest",
      "appium:deviceName": simulatorDeviceName,
      "appium:platformVersion": simulatorPlatformVersion,
      "appium:enforceFreshSimulatorCreation": true,
      "appium:isHeadless": true,
      "appium:nativeWebTap": true,
      "appium:nativeWebTapStrict": true,
      "appium:reduceMotion": true,
      "appium:safariInitialUrl": MARKDOWN_QUESTION_URL,
      "appium:showSafariConsoleLog": true,
      "appium:showXcodeLog": true,
      "appium:simulatorPasteboardAutomaticSync": "off",
      "appium:simulatorStartupTimeout": 300_000,
      "appium:wdaLaunchTimeout": 600_000,
      "appium:webviewConnectTimeout": 60_000,
    });

    await prepareSafariInitialPage(driver);
    await waitForElement(driver, "#send_exam_btn");
    // A modal dialog occupies the browser top layer and would intercept the
    // temporary DOM overlay Appium uses to fit its native-tap coordinates.
    await driver.calibrateNativeWebTap();
    const browserIdentity = await driver.execute(() => ({
      clipboardWrite: typeof navigator.clipboard?.write,
      secureContext: window.isSecureContext,
      userAgent: navigator.userAgent,
    }));
    assert.equal(browserIdentity.clipboardWrite, "function");
    assert.equal(browserIdentity.secureContext, true);
    assert.match(browserIdentity.userAgent, /iPhone/);
    assert.match(browserIdentity.userAgent, /Version\/\d+(?:\.\d+)+/);
    assert.match(browserIdentity.userAgent, /Mobile\/\S+ Safari\//);

    await installReader(driver, script);
    await waitForElement(driver, "#kakomonn-reader-frame");
    await driver.waitUntil(
      () => driver.execute(() => document.querySelector("#kakomonn-reader-error-dialog")?.open === true),
      { interval: 250, timeout: 30_000, timeoutMsg: "The speech error dialog did not open" },
    );
    assert.equal(
      await driver.execute(() => document.querySelector("#kakomonn-reader-error-title")?.textContent),
      "読み上げを利用できません",
    );
    await clickWebElementNatively(driver, "#kakomonn-reader-error-close");
    const layout = await driver.execute(() => {
      const shell = document.querySelector("#kakomonn-reader-shell");
      const frame = document.querySelector("#kakomonn-reader-frame");
      const progress = document.querySelector("#kakomonn-reader-time-limit");
      const shellRect = shell.getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();
      const progressRect = progress.getBoundingClientRect();
      return {
        frameFillsShell:
          Math.abs(frameRect.top - shellRect.top) <= 1 &&
          Math.abs(frameRect.right - shellRect.right) <= 1 &&
          Math.abs(frameRect.bottom - shellRect.bottom) <= 1 &&
          Math.abs(frameRect.left - shellRect.left) <= 1,
        noHorizontalOverflow:
          shell.scrollWidth <= shell.clientWidth,
        shellFillsViewport:
          Math.abs(shellRect.top) <= 1 &&
          Math.abs(shellRect.right - innerWidth) <= 1 &&
          Math.abs(shellRect.bottom - innerHeight) <= 1 &&
          shellRect.height > 0,
        timeBarOverlay:
          Math.abs(progressRect.top - shellRect.top) <= 1 &&
          Math.abs(progressRect.left - shellRect.left) <= 1 &&
          Math.abs(progressRect.right - shellRect.right) <= 1 &&
          Math.abs(progressRect.height - 4) <= 1,
      };
    });
    assert.deepEqual(layout, {
      frameFillsShell: true,
      noHorizontalOverflow: true,
      shellFillsViewport: true,
      timeBarOverlay: true,
    });

    const historyLengthBefore = await driver.execute(() => history.length);
    const clipboardNonce = `kakomonn-ios-copy-before-${Date.now()}`;
    await driver.setClipboardText(clipboardNonce);
    assert.equal(await driver.getClipboardText(), clipboardNonce);
    await switchToReaderFrame(driver);
    await waitForElement(driver, "#send_exam_btn");
    await waitForElementPresent(driver, "#kakomonn-reader-dark-mode");
    const { choices, heading, questionImageURLs, questionText } =
      await readQuestionContent(driver);
    assert.equal(heading, MARKDOWN_QUESTION_HEADING);
    assert.equal(questionText, MARKDOWN_QUESTION_TEXT);
    assert.deepEqual(choices, MARKDOWN_CHOICES);
    assert.deepEqual(questionImageURLs, MARKDOWN_QUESTION_IMAGE_URLS);

    await submitAnswer(driver, MARKDOWN_INCORRECT_ANSWER_TEXT);
    const { explanationContents, explanationImageURLs } =
      await readExplanationContents(driver);
    for (
      let index = 0;
      index < MARKDOWN_EXPLANATION_PREFIXES.length;
      index += 1
    ) {
      assert.equal(
        explanationContents[index].startsWith(
          MARKDOWN_EXPLANATION_PREFIXES[index],
        ),
        true,
      );
    }
    assert.deepEqual(
      explanationImageURLs,
      MARKDOWN_EXPLANATION_IMAGE_URLS,
    );

    await driver.switchToTopFrame();
    await driver.waitUntil(
      async () => (await driver.getClipboardText()) !== clipboardNonce,
      {
        interval: 250,
        timeout: 30_000,
        timeoutMsg: "The answer was not copied automatically",
      },
    );
    const copiedMarkdown = (await driver.getClipboardText()).replace(
      /\r\n/g,
      "\n",
    );
    assert.notEqual(copiedMarkdown, clipboardNonce);
    assertMarkdownCopy({
      answerSummary: MARKDOWN_INCORRECT_ANSWER_SUMMARY,
      choices,
      copiedMarkdown,
      explanationContents,
      questionText,
    });
    assert.deepEqual(
      await driver.execute(() => window.__syncMock.clipboardWrites),
      [],
    );

    await driver.waitUntil(
      () => driver.execute(
        (previousLength) =>
          history.length > previousLength &&
          history.state?.entryType === "current",
        historyLengthBefore,
      ),
      {
        interval: 250,
        timeout: 30_000,
        timeoutMsg: "Browser forward was not prepared",
      },
    );
    await driver.navigateForward();
    await driver.waitUntil(
      () =>
        driver.execute(
          (expectedURL) =>
            document.querySelector("#kakomonn-reader-frame")?.contentWindow
              .location.href === expectedURL,
          nextQuestionURL,
        ),
      {
        interval: 250,
        timeout: 30_000,
        timeoutMsg: "The reader did not navigate to the scheduled question",
      },
    );
    assert.equal(
      await driver.execute(
        () =>
          window.__syncMock.calls.filter(
            (call) =>
              call.method === "POST" &&
              new URL(call.url).pathname === "/v9/attempts",
          ).length,
      ),
      1,
    );

    const readerDiagnostics = await driver.execute(() => ({
      errors: window.__kakomonnReaderErrors.filter(
        (error) => error.filename === "kakomonn-reader.user.js",
      ),
      rejections: window.__kakomonnReaderRejections.filter((rejection) =>
        rejection.includes("kakomonn-reader.user.js"),
      ),
    }));
    assert.deepEqual(readerDiagnostics, { errors: [], rejections: [] });

    await driver.navigateTo(nextQuestionOpenURL);
    await driver.waitUntil(
      () =>
        driver
          .getUrl()
          .then((url) => url === nextQuestionLauncherURL),
      {
        interval: 250,
        timeout: 60_000,
        timeoutMsg: "The production /open URL did not reach the launcher",
      },
    );
    await driver.execute(() => {
      window.__launcherDocumentSentinel = "same-document";
    });
    await installReader(driver, script, { configured: false });
    await waitForElement(driver, "#kakomonn-reader-sync-settings");
    await waitForElement(
      driver,
      "#kakomonn-reader-sync-token",
    );
    const syncSettingsLayout = await driver.execute(() => {
      const settings = document.querySelector(
        "#kakomonn-reader-sync-settings",
      );
      const panel = document.querySelector(
        "#kakomonn-reader-sync-settings-panel",
      );
      const input = document.querySelector("#kakomonn-reader-sync-token");
      const save = document.querySelector(
        "#kakomonn-reader-sync-settings-save",
      );
      const panelRect = panel.getBoundingClientRect();
      return {
        horizontalOverflow: settings.scrollWidth > settings.clientWidth,
        inputHeight: input.getBoundingClientRect().height,
        panelInsideViewport:
          panelRect.left >= 0 && panelRect.right <= innerWidth,
        saveHeight: save.getBoundingClientRect().height,
      };
    });
    assert.equal(
      syncSettingsLayout.horizontalOverflow,
      false,
      JSON.stringify(syncSettingsLayout),
    );
    assert.equal(
      syncSettingsLayout.panelInsideViewport,
      true,
      JSON.stringify(syncSettingsLayout),
    );
    assert.equal(
      syncSettingsLayout.inputHeight >= 44,
      true,
      JSON.stringify(syncSettingsLayout),
    );
    assert.equal(
      syncSettingsLayout.saveHeight >= 44,
      true,
      JSON.stringify(syncSettingsLayout),
    );

    const syncSettingsViewport = await readNativeWebTapViewport(driver);
    const syncTokenInput = await clickWebElementNatively(
      driver,
      "#kakomonn-reader-sync-token",
    );
    await syncTokenInput.setValue("test-sync-token");
    assert.equal(
      await driver.execute(
        () => document.querySelector("#kakomonn-reader-sync-token").value,
      ),
      "test-sync-token",
    );
    await driver.execute(() => document.activeElement?.blur());
    await driver.waitUntil(
      () =>
        readNativeWebTapViewport(driver).then(
          (viewport) =>
            JSON.stringify(viewport) === JSON.stringify(syncSettingsViewport),
        ),
      {
        interval: 250,
        timeout: 10_000,
        timeoutMsg: "Safari did not restore the pre-keyboard viewport",
      },
    );
    await waitForElement(
      driver,
      "#kakomonn-reader-sync-settings-save",
    );
    await clickWebElementNatively(
      driver,
      "#kakomonn-reader-sync-settings-save",
    );
    await driver.waitUntil(
      () => driver.getUrl().then((url) => url === nextQuestionURL),
      {
        interval: 250,
        timeout: 30_000,
        timeoutMsg: "The configured launcher did not open the next question",
      },
    );
    const launcherTransition = await driver.execute(() => ({
      documentSentinel: window.__launcherDocumentSentinel,
      frameURL: document.querySelector("#kakomonn-reader-frame")?.contentWindow
        ?.location.href,
      readerControlsVisible:
        document.querySelector("#kakomonn-reader-controls") !== null,
      settingsButtonVisible:
        document.querySelector("#kakomonn-reader-sync-settings-button") !== null,
    }));
    assert.deepEqual(launcherTransition, {
      documentSentinel: "same-document",
      frameURL: nextQuestionURL,
      readerControlsVisible: false,
      settingsButtonVisible: false,
    });

    console.log(
      JSON.stringify({
        browser: "iOS Simulator Mobile Safari",
        device: simulatorDeviceName,
        iOS: simulatorPlatformVersion,
        status: "passed",
        xcode: expectedXcodeVersion,
      }),
    );
  } catch (error) {
    await captureFailureArtifacts(driver, error);
    throw error;
  } finally {
    if (driver !== null) {
      await driver.deleteSession().catch(() => {});
    }
    await stopAppium(appiumProcess);
  }
}

runTest().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
