import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import test from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { focusSecureTextField, typeNativeText, resolveAppiumCli, resolveAppiumRuntimeDirectory, safariCapabilities, clickWebElementNatively } = require('../kakomonn-reader/tests/ios_safari_e2e_test.js');

test('iOS runner loads in a clean CI home without machine-local configuration', () => {
  const home = mkdtempSync(join(tmpdir(), 'kakomonn-ios-ci-home-'));
  try {
    const runner = fileURLToPath(new URL('../kakomonn-reader/tests/ios_safari_e2e_test.js', import.meta.url));
    const result = spawnSync(process.execPath, ['-e', `
      require('node:assert/strict').equal(require('node:os').homedir(), process.argv[2]);
      require(process.argv[1]);
    `, runner, home], {
      env: { ...process.env, HOME: home, USERPROFILE: home },
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(home, { recursive: true });
  }
});

test('Safari capabilities enable native accessibility taps without forcing coordinates', () => {
  assert.equal(safariCapabilities["appium:nativeWebTap"], true);
  assert.equal(Object.hasOwn(safariCapabilities, "appium:nativeWebTapStrict"), false);
  assert.equal(safariCapabilities.browserName, "Safari");
  assert.equal(safariCapabilities["appium:automationName"], "XCUITest");
  assert.equal(safariCapabilities["appium:simulatorPasteboardAutomaticSync"], "off");
});

test('native web tap scrolls and hit-tests its target before clicking the actual element', async () => {
  const calls = [];
  const target = {
    scrollIntoView: (options) => calls.push(['scroll', options]),
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 40 }),
    contains: (element) => element === target,
  };
  const element = { click: async () => calls.push(['native-click']) };
  const driver = {
    execute: async (script, ...args) => {
      calls.push(['execute', ...args]);
      return Function('document', 'innerWidth', 'innerHeight', 'args', `return (${script.toString()})(...args)`)(
        { querySelectorAll: () => [null, target], elementFromPoint: () => target }, 402, 714, args,
      );
    },
    waitUntil: async (condition) => assert.equal(await condition(), true),
    $$: async (selector) => { calls.push(['lookup', selector]); return [null, element]; },
  };
  assert.equal(await clickWebElementNatively(driver, '#target', 1), element);
  assert.deepEqual(calls, [
    ['execute', '#target', 1],
    ['scroll', { block: 'center', inline: 'center', behavior: 'instant' }],
    ['execute', '#target', 1],
    ['lookup', '#target'],
    ['native-click'],
  ]);
  for (const obstructed of [false, true]) {
    calls.length = 0;
    target.getBoundingClientRect = () => ({ left: 10, top: obstructed ? 20 : 1300, width: 100, height: 40 });
    target.contains = () => !obstructed;
    driver.waitUntil = async (condition) => {
      assert.equal(await condition(), false);
      throw new Error('not interactable');
    };
    await assert.rejects(clickWebElementNatively(driver, '#target', 1), /not interactable/);
    assert.equal(calls.some(([kind]) => kind === 'native-click'), false);
  }
});

test('focuses the native secure field and restores Safari context on errors', async () => {
  for (const fail of [false, true]) {
    const calls = [];
    const driver = {
      getContext: async () => "WEBVIEW_fixture",
      switchContext: async context => calls.push(context),
      $: async selector => {
        assert.equal(selector, "-ios class chain:**/XCUIElementTypeSecureTextField");
        return {
          waitForDisplayed: async () => {},
          click: async () => { if (fail) throw new Error("native tap failed"); },
        };
      },
    };
    if (fail) await assert.rejects(focusSecureTextField(driver), /native tap failed/);
    else await focusSecureTextField(driver);
    assert.deepEqual(calls, ["NATIVE_APP", "WEBVIEW_fixture"]);
  }
});

test('types through the actual focused native field and refuses other element types', async () => {
  for (const type of ["XCUIElementTypeTextField", "XCUIElementTypeSecureTextField", "XCUIElementTypeButton"]) {
    const calls = [];
    const driver = {
      getContext: async () => "WEBVIEW_fixture",
      switchContext: async context => calls.push(context),
      getActiveElement: async () => ({ "element-6066-11e4-a52e-4f735466cecf": "focused" }),
      getElementAttribute: async (id, attribute) => {
        assert.equal(id, "focused"); assert.equal(attribute, "type"); return type;
      },
      elementSendKeys: async (id, value) => calls.push([id, value]),
    };
    if (type.endsWith("Button")) await assert.rejects(typeNativeText(driver, "fixture"), /TextField/);
    else await typeNativeText(driver, "fixture");
    assert.equal(calls[0], "NATIVE_APP");
    assert.equal(calls.at(-1), "WEBVIEW_fixture");
    assert.equal(calls.length, type.endsWith("Button") ? 2 : 3);
  }
});

test('launches the installed Appium CLI contract, not its programmatic main export', () => {
  const manifestPath = require.resolve('appium/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const cli = resolveAppiumCli();
  assert.equal(cli, resolve(dirname(manifestPath), manifest.bin.appium));
  assert.notEqual(cli, require.resolve('appium'));
  const version = execFileSync(process.execPath, [cli, '--version'], {
    cwd: resolveAppiumRuntimeDirectory(), encoding: 'utf8', timeout: 60_000,
  }).trim();
  assert.equal(version, manifest.version);
});

test('discovers the XCUITest driver and owns its cache in the native project', () => {
  const cwd = resolveAppiumRuntimeDirectory();
  const manifest = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8'));
  const declared = manifest.dependencies?.['appium-xcuitest-driver'] ?? manifest.devDependencies?.['appium-xcuitest-driver'];
  assert.equal(typeof declared, 'string');
  const installed = JSON.parse(execFileSync(process.execPath, [resolveAppiumCli(), 'driver', 'list', '--installed', '--json'], {
    cwd, encoding: 'utf8', timeout: 60_000,
  }));
  const driver = JSON.parse(readFileSync(require.resolve('appium-xcuitest-driver/package.json'), 'utf8'));
  assert.equal(installed.xcuitest.version, driver.version);
  assert.equal(installed.xcuitest.installed, true);
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  assert.equal(cwd, projectRoot);
  assert.equal(driver.version, declared);
  assert.equal(existsSync(resolve(projectRoot, 'node_modules/.cache/appium')), true);
  assert.equal(resolveAppiumCli().startsWith(resolve(projectRoot, 'node_modules') + sep), true);
});
