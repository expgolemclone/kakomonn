const assert = require("node:assert/strict");
const { remote } = require("webdriverio");
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { createSyncFixtureConfiguration, installSyncFixtureInWindow } = require("./support/sync-fixture.cjs");
const {
  assertMarkdownCopy,
  assertMarkdownExplanationContents,
  MARKDOWN_CHOICES,
  MARKDOWN_INCORRECT_ANSWER_SUMMARY,
  MARKDOWN_INCORRECT_ANSWER_TEXT,
  MARKDOWN_EXPLANATION_IMAGE_URLS,
  MARKDOWN_QUESTION_HEADING,
  MARKDOWN_QUESTION_IMAGE_URLS,
  MARKDOWN_QUESTION_TEXT,
  MARKDOWN_QUESTION_URL,
  normalizeContent,
} = require("./support/markdown_copy_fixture");

const projectRoot = path.resolve(__dirname, "..");
const repositoryRoot = path.resolve(projectRoot, "..");
const scriptPath = path.join(projectRoot, "dist", "kakomonn-reader.user.js");
const resultDirectory = path.join(projectRoot, "test-results", "ios-safari");
const appiumLogPath = path.join(resultDirectory, "appium.log");
const simulatorLogPath = path.join(resultDirectory, "simulator.log");
const failureScreenshotPath = path.join(resultDirectory, "failure-screenshot.png");
const failureSourcePath = path.join(resultDirectory, "failure-source.xml");
const safariNativeSourcePath = path.join(resultDirectory, "safari-native-source.xml");
const failureDiagnosticsPath = path.join(resultDirectory, "failure-diagnostics.json");
const readerSourceURL = "kakomonn-reader.user.js";
const nextQuestionOpenURL = "https://kakomonn-sync.kakomonn.workers.dev/open";
const nextQuestionLauncherURL = "https://chushoks.kakomonn.com/createques#kakomonn-next";
const expectedXcodeVersion = "26.6";
const simulatorPlatformVersion = "26.5";
const simulatorDeviceName = "iPhone 17";
const correctQuestionURL = "https://chushoks.kakomonn.com/questions/86956";
const correctAnswerText = "輸入の減少は、GDPを増加させる。";
const nextQuestionURL = "https://chushoks.kakomonn.com/questions/86957";
const testTimeout = 60_000;
const webDriverElementKey = "element-6066-11e4-a52e-4f735466cecf";
const safariCapabilities = Object.freeze({
  platformName: "iOS",
  browserName: "Safari",
  "appium:automationName": "XCUITest",
  "appium:deviceName": simulatorDeviceName,
  "appium:platformVersion": simulatorPlatformVersion,
  "appium:enforceFreshSimulatorCreation": true,
  "appium:isHeadless": true,
  // Prefer Appium's native accessibility tap; strict mode forces stale DOM
  // coordinates and can tap an advertisement instead of the answer button.
  "appium:nativeWebTap": true,
  "appium:reduceMotion": true,
  "appium:safariInitialUrl": MARKDOWN_QUESTION_URL,
  "appium:showSafariConsoleLog": true,
  "appium:showXcodeLog": true,
  "appium:simulatorPasteboardAutomaticSync": "off",
  "appium:simulatorStartupTimeout": 300_000,
  "appium:wdaLaunchTimeout": 600_000,
  "appium:webviewConnectTimeout": 60_000,
});

async function focusSecureTextField(driver) {
  const context = await driver.getContext();
  await driver.switchContext("NATIVE_APP");
  try {
    const field = await driver.$("-ios class chain:**/XCUIElementTypeSecureTextField");
    await field.waitForDisplayed();
    await field.click();
  } finally {
    await driver.switchContext(context);
  }
}

async function typeNativeText(driver, value) {
  const context = await driver.getContext();
  await driver.switchContext("NATIVE_APP");
  try {
    const reference = await driver.getActiveElement();
    const type = await driver.getElementAttribute(reference[webDriverElementKey], "type");
    assert.match(type, /^XCUIElementType(?:Secure)?TextField$/);
    await driver.elementSendKeys(reference[webDriverElementKey], value);
  } finally {
    await driver.switchContext(context);
  }
}

function verifyHostEnvironment() {
  assert.equal(process.platform, "darwin", "The iOS Safari E2E requires macOS");

  const xcodeVersion = execFileSync("xcodebuild", ["-version"], {
    encoding: "utf8",
  });
  assert.match(
    xcodeVersion,
    new RegExp(`^Xcode ${expectedXcodeVersion.replace(/\./g, "\\.")}\\r?$`, "m"),
    `Xcode ${expectedXcodeVersion} is required:\n${xcodeVersion}`,
  );

  const simulatorList = JSON.parse(
    execFileSync("xcrun", ["simctl", "list", "devices", "available", "--json"], {
      encoding: "utf8",
    }),
  );
  const runtimeKey = `com.apple.CoreSimulator.SimRuntime.iOS-${simulatorPlatformVersion.replace(/\./g, "-")}`;
  const availableDevices = simulatorList.devices?.[runtimeKey] ?? [];
  assert.equal(
    availableDevices.some((device) => device.name === simulatorDeviceName && device.isAvailable),
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
      throw new Error(`Appium exited before becoming ready with code ${appiumProcess.exitCode}`);
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

function resolveAppiumCli() {
  const manifestPath = require.resolve('appium/package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const entry = manifest.bin?.appium;
  assert.equal(typeof entry, 'string', 'Appium must declare its appium CLI');
  return path.resolve(path.dirname(manifestPath), entry);
}

function resolveAppiumRuntimeDirectory() {
  // Appium discovers npm-managed drivers and writes its cache relative to cwd.
  // The repository's native npm project owns the driver graph and local cache.
  return path.resolve(path.dirname(require.resolve('appium/package.json')), '..', '..');
}

async function startAppium() {
  const port = await reservePort();
  const appiumEntryPoint = resolveAppiumCli();
  const output = fs.openSync(path.join(resultDirectory, 'appium-process.log'), 'a');
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
      cwd: resolveAppiumRuntimeDirectory(),
      stdio: ['ignore', output, output],
      windowsHide: true,
    },
  );
  fs.closeSync(output);
  try {
    await waitForAppium(port, appiumProcess);
    return { appiumProcess, port };
  } catch (error) {
    await stopAppium(appiumProcess);
    throw error;
  }
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

async function clickWebElementNatively(driver, selector, index = 0) {
  // Appium's native accessibility tap does not scroll DOM targets. Unlike a
  // JavaScript click, a real tap must land on an unobstructed visible target.
  await driver.execute((targetSelector, targetIndex) => {
    const target = document.querySelectorAll(targetSelector)[targetIndex];
    if (!target) throw new Error(`Native web tap target was not present: ${targetSelector}[${targetIndex}]`);
    target.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  }, selector, index);
  await driver.waitUntil(() => driver.execute((targetSelector, targetIndex) => {
    const target = document.querySelectorAll(targetSelector)[targetIndex];
    if (!target) return false;
    const rect = target.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    return rect.width > 0 && rect.height > 0 && x > 0 && y > 0 &&
      x < innerWidth && y < innerHeight && target.contains(document.elementFromPoint(x, y));
  }, selector, index), {
    interval: 100,
    timeout: 10_000,
    timeoutMsg: `Native web tap target was not visible and unobstructed: ${selector}[${index}]`,
  });
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
      isScrolledToTop: document.documentElement.scrollTop === 0 && document.body.scrollTop === 0,
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
      nativeSource.includes('name="View Bookmarks, Share Menu, and Open Tabs"');
    if (!showsToolbarTip) {
      return;
    }
    const closeButton = await driver.$("~xmark.circle.fill");
    await closeButton.waitForDisplayed();
    await closeButton.click();
  };

  await driver.switchContext("NATIVE_APP");
  try {
    const nativeSource = await driver.getPageSource();
    assert.match(nativeSource, /width="402" height="874"/);
    const showsStartPage = nativeSource.includes("StartPageCollectionView");
    const showsStartPageOnboarding = nativeSource.includes(
      'name="onboardingButton-CustomizeStartPage"',
    );
    const showsLoadedPage = /name="TabDocument[^\"]*IsPageLoaded=true/.test(nativeSource);

    // Safari can retain an inactive StartPageCollectionView in the native
    // accessibility tree after the configured page has finished loading.
    // The loaded tab is authoritative and does not need onboarding dismissal.
    if (!showsLoadedPage && showsStartPageOnboarding) {
      assert.equal(showsStartPage, true);
      const closeButton = await driver.$("~close");
      await closeButton.waitForDisplayed();
      await closeButton.click();
    } else {
      assert.equal(
        showsLoadedPage,
        true,
        "Safari must show either the configured page or its known start-page onboarding",
      );
    }
  } finally {
    await driver.switchContext(webContext);
  }
  await driver.waitUntil(() => driver.getUrl().then((url) => url === MARKDOWN_QUESTION_URL), {
    interval: 250,
    timeout: 60_000,
    timeoutMsg: "Safari did not load the configured initial URL",
  });

  await driver.switchContext("NATIVE_APP");
  try {
    const loadedNativeSource = await driver.getPageSource();
    fs.writeFileSync(safariNativeSourcePath, loadedNativeSource, "utf8");
    assert.match(loadedNativeSource, /width="402" height="874"/);
    assert.match(loadedNativeSource, /name="TabDocument[^"]*IsPageLoaded=true/);
    await closeSafariToolbarTip(loadedNativeSource);
  } finally {
    await driver.switchContext(webContext);
  }
}

async function installReaderInCurrentDocument(driver, script, syncOptions) {
  const documentURL = new URL(await driver.getUrl());
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

  const syncConfiguration = createSyncFixtureConfiguration({
    nextQuestionId: new URL(nextQuestionURL).pathname.split("/").at(-1),
    ...syncOptions,
  });
  await driver.execute(
    `(${installSyncFixtureInWindow.toString()})(${JSON.stringify(syncConfiguration)});`,
  );
  await driver.execute(
    (source, sourceURL) => {
      const injectedDocuments = new WeakSet();
      window.__kakomonnReaderFrameInstaller = window.setInterval(() => {
        const frame = document.querySelector("#kakomonn-reader-frame");
        if (frame === null) {
          return;
        }

        const frameDocument = frame.contentDocument;
        const frameWindow = frame.contentWindow;
        if (
          frameDocument === null ||
          frameWindow === null ||
          frameDocument.readyState === "loading" ||
          injectedDocuments.has(frameDocument)
        ) {
          return;
        }

        const frameURL = new URL(frameWindow.location.href);
        if (frameURL.href === "about:blank" || !frameURL.hostname.endsWith(".kakomonn.com")) {
          return;
        }

        injectedDocuments.add(frameDocument);
        frameWindow.eval(`${source}\n//# sourceURL=${sourceURL}`);
      }, 25);
    },
    script,
    readerSourceURL,
  );
  await driver.execute(`${script}\n//# sourceURL=${readerSourceURL}`);

  if (!/^\/questions\/(?:next\/)?\d+$/.test(documentURL.pathname)) {
    return documentURL;
  }

  await driver.waitUntil(
    () =>
      driver.execute(() => {
        const frame = document.querySelector("#kakomonn-reader-frame");
        return (
          frame !== null &&
          frame?.contentDocument?.readyState !== "loading" &&
          frame?.contentWindow?.location.href === location.href
        );
      }),
    {
      interval: 100,
      timeout: 30_000,
      timeoutMsg: "The question iframe did not reach document-end",
    },
  );
  await driver.waitUntil(
    () =>
      driver.execute(
        () =>
          document
            .querySelector("#kakomonn-reader-frame")
            ?.contentDocument?.getElementById("kakomonn-reader-dark-mode") !== null,
      ),
    {
      interval: 100,
      timeout: 30_000,
      timeoutMsg: "The question iframe did not initialize the Reader",
    },
  );
  return documentURL;
}

async function installReader(driver, script, syncOptions = {}) {
  const documentURL = await installReaderInCurrentDocument(driver, script, syncOptions);
  if (documentURL.href !== nextQuestionOpenURL) {
    return;
  }

  await driver.waitUntil(() => driver.getUrl().then((url) => url === nextQuestionURL), {
    interval: 100,
    timeout: 30_000,
    timeoutMsg: "The production /open bridge did not navigate",
  });
  await installReaderInCurrentDocument(driver, script, syncOptions);
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
  await driver.switchToFrame(null);
  const readerFrame = await driver.$("#kakomonn-reader-frame");
  await driver.switchToFrame(readerFrame);
}

async function submitAnswer(driver, answerText) {
  const choiceElements = await driver.$$(".problem_detail ul.list > li");
  const choiceTexts = [];
  for (const choice of choiceElements) {
    choiceTexts.push(normalizeContent(await choice.getText()));
  }
  const choiceIndex = choiceTexts.findIndex((choice) => choice === normalizeContent(answerText));
  assert.notEqual(choiceIndex, -1, `Answer choice was not found: ${answerText}`);

  const answerInputs = await driver.$$(".problem_detail ul.check input[name='intAnswerData']");
  const answerLabels = await driver.$$(".problem_detail ul.check > li > label");
  assert.equal(answerInputs.length, choiceTexts.length);
  assert.equal(answerLabels.length, choiceTexts.length);
  await driver.execute((index) => {
    document
      .querySelectorAll(".problem_detail ul.check input[name='intAnswerData']")
      [index].click();
  }, choiceIndex);
  const selectedAnswerInputs = await driver.$$(
    ".problem_detail ul.check input[name='intAnswerData']",
  );
  assert.equal(selectedAnswerInputs.length, choiceTexts.length);
  assert.equal(await selectedAnswerInputs[choiceIndex].isSelected(), true);
  await clickWebElementNatively(driver, "#send_exam_btn");
}

async function dispatchNextQuestionSwipe(driver) {
  await switchToReaderFrame(driver);
  const result = await driver.execute(() => {
    const target = document.body;
    const startX = innerWidth * 0.75;
    const endX = innerWidth * 0.25;
    const y = innerHeight * 0.5;
    const createTouch = (clientX) =>
      new Touch({
        clientX,
        clientY: y,
        force: 1,
        identifier: 1,
        pageX: clientX + scrollX,
        pageY: y + scrollY,
        radiusX: 1,
        radiusY: 1,
        rotationAngle: 0,
        screenX: clientX,
        screenY: y,
        target,
      });
    const startTouch = createTouch(startX);
    const endTouch = createTouch(endX);
    target.dispatchEvent(
      new TouchEvent("touchstart", {
        bubbles: true,
        cancelable: true,
        changedTouches: [startTouch],
        targetTouches: [startTouch],
        touches: [startTouch],
      }),
    );
    const endEvent = new TouchEvent("touchend", {
      bubbles: true,
      cancelable: true,
      changedTouches: [endTouch],
      targetTouches: [],
      touches: [],
    });
    const dispatchResult = target.dispatchEvent(endEvent);
    return {
      dispatchResult,
      endDefaultPrevented: endEvent.defaultPrevented,
      touchConstructor: typeof Touch,
      touchEventConstructor: typeof TouchEvent,
    };
  });
  assert.equal(result.touchConstructor, "function");
  assert.equal(result.touchEventConstructor, "function");
  assert.equal(result.dispatchResult, false);
  assert.equal(result.endDefaultPrevented, true);
  await driver.switchToFrame(null);
}

async function readExplanationContents(driver) {
  await driver.$("#js-answer-result-box.is-wrong").waitForDisplayed({ timeout: 30_000 });
  const explanationElements = await driver.$$("#js-commentary-wrap > .item > .text");
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
  const explanationSegments = await driver.execute(() => {
    const nonReadableSelector =
      "script, style, noscript, template, [hidden], [aria-hidden='true'], [inert]";
    const visibleTextSegments = (root) => {
      const segments = [];
      const visit = (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          segments.push(node.nodeValue ?? "");
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE || node.tagName === "IMG") {
          return;
        }
        const style = getComputedStyle(node);
        if (
          node.matches(nonReadableSelector) ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.visibility === "collapse" ||
          style.contentVisibility === "hidden" ||
          style.opacity === "0"
        ) {
          return;
        }
        for (const child of node.childNodes) {
          visit(child);
        }
      };
      visit(root);
      return segments;
    };
    return Array.from(
      document.querySelectorAll("#js-commentary-wrap > .item > .text"),
      visibleTextSegments,
    );
  });
  const explanationImageURLs = await driver.execute(() =>
    Array.from(
      document.querySelectorAll("#js-commentary-wrap > .item .text img[src]"),
      (image) => image.src,
    ),
  );
  return {
    explanationContents,
    explanationImageURLs,
    explanationSegments,
  };
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
  fs.writeFileSync(failureDiagnosticsPath, `${JSON.stringify(diagnostics, null, 2)}\n`, "utf8");
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
  execFileSync(process.execPath, ["build.mjs"], {
    cwd: projectRoot,
    stdio: "inherit",
  });
  const script = fs.readFileSync(scriptPath, "utf8");

  let appiumProcess = null;
  let driver = null;
  try {
    const appium = await startAppium();
    appiumProcess = appium.appiumProcess;
    driver = await remote({
      hostname: "127.0.0.1", port: appium.port, path: "/",
      capabilities: safariCapabilities, logLevel: "error",
      connectionRetryTimeout: 1_200_000, connectionRetryCount: 0,
      waitforTimeout: testTimeout, waitforInterval: 250,
    });

    await prepareSafariInitialPage(driver);
    await driver.$("#send_exam_btn").waitForDisplayed();
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
    await driver.$("#kakomonn-reader-frame").waitForDisplayed();
    await driver.waitUntil(
      () =>
        driver.execute(
          () => document.querySelector("#kakomonn-reader-error-dialog")?.open === true,
        ),
      { interval: 250, timeout: 30_000, timeoutMsg: "The speech error dialog did not open" },
    );
    assert.equal(
      await driver.execute(
        () => document.querySelector("#kakomonn-reader-error-title")?.textContent,
      ),
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
        noHorizontalOverflow: shell.scrollWidth <= shell.clientWidth,
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
    await driver.execute("mobile: setClipboard", { content: Buffer.from(clipboardNonce, "utf8").toString("base64"), contentType: "plaintext" });
    assert.equal(await driver.execute("mobile: getClipboard", { contentType: "plaintext" }).then(value => Buffer.from(value, "base64").toString("utf8")), clipboardNonce);
    await switchToReaderFrame(driver);
    await driver.$("#send_exam_btn").waitForDisplayed();
    await driver.$("#kakomonn-reader-dark-mode").waitForExist();
    assert.deepEqual(
      await driver.execute(() =>
        Array.from(
          document.querySelectorAll(
            ".p-post > .fixed_btn, .p-post > .fixed_btn_menu, .l-footer > .pagetop",
          ),
          (element) => getComputedStyle(element).display,
        ),
      ),
      ["none", "none", "none"],
    );
    const { choices, heading, questionImageURLs, questionText } = await readQuestionContent(driver);
    assert.equal(heading, MARKDOWN_QUESTION_HEADING);
    assert.equal(questionText, MARKDOWN_QUESTION_TEXT);
    assert.deepEqual(choices, MARKDOWN_CHOICES);
    assert.deepEqual(questionImageURLs, MARKDOWN_QUESTION_IMAGE_URLS);

    await submitAnswer(driver, MARKDOWN_INCORRECT_ANSWER_TEXT);
    const { explanationContents, explanationImageURLs, explanationSegments } =
      await readExplanationContents(driver);
    assertMarkdownExplanationContents(explanationContents);
    assert.deepEqual(explanationImageURLs, MARKDOWN_EXPLANATION_IMAGE_URLS);

    await driver.switchToFrame(null);
    await driver.waitUntil(async () => (await driver.execute("mobile: getClipboard", { contentType: "plaintext" }).then(value => Buffer.from(value, "base64").toString("utf8"))) !== clipboardNonce, {
      interval: 250,
      timeout: 30_000,
      timeoutMsg: "The answer was not copied automatically",
    });
    const copiedMarkdown = (await driver.execute("mobile: getClipboard", { contentType: "plaintext" }).then(value => Buffer.from(value, "base64").toString("utf8"))).replace(/\r\n/g, "\n");
    assert.notEqual(copiedMarkdown, clipboardNonce);
    assertMarkdownCopy({
      answerSummary: MARKDOWN_INCORRECT_ANSWER_SUMMARY,
      choices,
      copiedMarkdown,
      explanationContents: [],
      explanationSegments,
      questionText,
    });
    assert.deepEqual(await driver.execute(() => window.__syncFixture.clipboardWrites), []);

    await driver.waitUntil(
      () =>
        driver.execute(
          (previousLength) =>
            window.__syncFixture.attemptCount === 1 &&
            history.length === previousLength &&
            history.state?.entryType === "current",
          historyLengthBefore,
        ),
      {
        interval: 250,
        timeout: 30_000,
        timeoutMsg: "The iPhone reader changed browser history before swipe",
      },
    );
    await dispatchNextQuestionSwipe(driver);
    await driver.waitUntil(
      () =>
        driver.execute(
          (expectedURL) =>
            document.querySelector("#kakomonn-reader-frame")?.contentWindow.location.href ===
            expectedURL,
          nextQuestionURL,
        ),
      {
        interval: 250,
        timeout: 30_000,
        timeoutMsg: "The reader did not navigate to the scheduled question",
      },
    );
    assert.equal(await driver.execute(() => history.length), historyLengthBefore);
    assert.equal(
      await driver.execute(
        () =>
          window.__syncFixture.calls.filter(
            (call) => call.method === "POST" && new URL(call.url).pathname === "/v12/attempts",
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

    await driver.url(correctQuestionURL);
    await driver.$("#send_exam_btn").waitForDisplayed();
    await installReader(driver, script);
    await driver.waitUntil(
      () =>
        driver.execute(
          () => document.querySelector("#kakomonn-reader-error-dialog")?.open === true,
        ),
      {
        interval: 250,
        timeout: 30_000,
        timeoutMsg: "The correct-answer speech error dialog did not open",
      },
    );
    await clickWebElementNatively(driver, "#kakomonn-reader-error-close");
    const correctClipboardNonce = `kakomonn-ios-correct-copy-before-${Date.now()}`;
    await driver.execute("mobile: setClipboard", { content: Buffer.from(correctClipboardNonce, "utf8").toString("base64"), contentType: "plaintext" });
    await switchToReaderFrame(driver);
    await submitAnswer(driver, correctAnswerText);
    await driver.switchToFrame(null);
    await driver.waitUntil(
      () =>
        driver.execute(
          (expectedURL) =>
            document.querySelector("#kakomonn-reader-frame")?.contentWindow.location.href ===
            expectedURL,
          nextQuestionURL,
        ),
      {
        interval: 250,
        timeout: 30_000,
        timeoutMsg: "The correct answer did not advance automatically",
      },
    );
    await driver.waitUntil(async () => (await driver.execute("mobile: getClipboard", { contentType: "plaintext" }).then(value => Buffer.from(value, "base64").toString("utf8"))) !== correctClipboardNonce, {
      interval: 250,
      timeout: 30_000,
      timeoutMsg: "The correct answer was not copied automatically",
    });
    assert.equal(await driver.execute(() => window.__syncFixture.attemptCount), 1);

    await driver.url(nextQuestionOpenURL);
    await driver.$("#open-bridge").waitForDisplayed();
    await installReader(driver, script);
    await driver.waitUntil(() => driver.getUrl().then((url) => url === nextQuestionURL), {
      interval: 250,
      timeout: 30_000,
      timeoutMsg: "The production /open bridge did not open the next question",
    });

    await driver.url(nextQuestionLauncherURL);
    const launcherViewport = await readNativeWebTapViewport(driver);
    await driver.execute(() => {
      window.__launcherDocumentSentinel = "same-document";
    });
    await installReader(driver, script, { configured: false });
    await driver.$("#kakomonn-reader-sync-settings").waitForDisplayed();
    await driver.$("#kakomonn-reader-sync-token").waitForDisplayed();
    // The dialog intentionally focuses the input. Restore the pre-keyboard
    // viewport before validating a real tap on that input.
    await driver.waitUntil(
      () => driver.execute(() => document.activeElement?.id === "kakomonn-reader-sync-token"),
      {
        interval: 100,
        timeout: 10_000,
        timeoutMsg: "The sync token input did not receive initial focus",
      },
    );
    await driver.execute(() => document.activeElement.blur());
    await driver.waitUntil(
      () =>
        readNativeWebTapViewport(driver).then(
          (viewport) => JSON.stringify(viewport) === JSON.stringify(launcherViewport),
        ),
      {
        interval: 250,
        timeout: 10_000,
        timeoutMsg: "Safari did not restore the pre-keyboard launcher viewport",
      },
    );
    const syncSettingsLayout = await driver.execute(() => {
      const settings = document.querySelector("#kakomonn-reader-sync-settings");
      const panel = document.querySelector("#kakomonn-reader-sync-settings-panel");
      const input = document.querySelector("#kakomonn-reader-sync-token");
      const save = document.querySelector("#kakomonn-reader-sync-settings-save");
      const panelRect = panel.getBoundingClientRect();
      return {
        horizontalOverflow: settings.scrollWidth > settings.clientWidth,
        inputHeight: input.getBoundingClientRect().height,
        panelInsideViewport: panelRect.left >= 0 && panelRect.right <= innerWidth,
        saveHeight: save.getBoundingClientRect().height,
      };
    });
    assert.equal(syncSettingsLayout.horizontalOverflow, false, JSON.stringify(syncSettingsLayout));
    assert.equal(syncSettingsLayout.panelInsideViewport, true, JSON.stringify(syncSettingsLayout));
    assert.equal(syncSettingsLayout.inputHeight >= 44, true, JSON.stringify(syncSettingsLayout));
    assert.equal(syncSettingsLayout.saveHeight >= 44, true, JSON.stringify(syncSettingsLayout));

    const syncSettingsViewport = await readNativeWebTapViewport(driver);
    // WebKit exposes a password input as a native SecureTextField; the
    // Appium DOM marker is not reflected in that field's accessibility label.
    await focusSecureTextField(driver);
    await driver.waitUntil(
      () => driver.execute(() => document.activeElement?.id === "kakomonn-reader-sync-token"),
      { interval: 100, timeout: 10_000, timeoutMsg: "Native tap did not focus the sync token input" },
    );
    await typeNativeText(driver, "test-sync-token");
    assert.equal(
      await driver.execute(() => document.querySelector("#kakomonn-reader-sync-token").value),
      "test-sync-token",
    );
    await driver.execute(() => document.activeElement?.blur());
    await driver.waitUntil(
      () =>
        readNativeWebTapViewport(driver).then(
          (viewport) => JSON.stringify(viewport) === JSON.stringify(syncSettingsViewport),
        ),
      {
        interval: 250,
        timeout: 10_000,
        timeoutMsg: "Safari did not restore the pre-keyboard viewport",
      },
    );
    await driver.$("#kakomonn-reader-sync-settings-save").waitForDisplayed();
    await clickWebElementNatively(driver, "#kakomonn-reader-sync-settings-save");
    await driver.waitUntil(() => driver.getUrl().then((url) => url === nextQuestionURL), {
      interval: 250,
      timeout: 30_000,
      timeoutMsg: "The configured launcher did not open the next question",
    });
    const launcherTransition = await driver.execute(() => ({
      documentSentinel: window.__launcherDocumentSentinel,
      frameURL: document.querySelector("#kakomonn-reader-frame")?.contentWindow?.location.href,
      frameInitialized:
        document
          .querySelector("#kakomonn-reader-frame")
          ?.contentDocument?.getElementById("kakomonn-reader-dark-mode") !== null,
      readerControlsVisible: document.querySelector("#kakomonn-reader-controls") !== null,
      settingsButtonVisible:
        document.querySelector("#kakomonn-reader-sync-settings-button") !== null,
    }));
    assert.deepEqual(launcherTransition, {
      documentSentinel: "same-document",
      frameURL: nextQuestionURL,
      frameInitialized: true,
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

module.exports = { focusSecureTextField, typeNativeText, resolveAppiumCli, resolveAppiumRuntimeDirectory, safariCapabilities, clickWebElementNatively };

if (require.main === module) {
  runTest().then(
    () => process.exit(0),
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
}
