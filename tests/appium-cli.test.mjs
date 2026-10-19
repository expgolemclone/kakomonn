import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve, sep } from 'node:path';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { IOSWebDriver, resolveAppiumCli, resolveAppiumRuntimeDirectory, safariCapabilities, clickWebElementNatively } = require('../kakomonn-reader/tests/ios_safari_e2e_test.js');

test('Safari session enables native accessibility taps without forcing coordinate-only interaction', async () => {
  const original = IOSWebDriver.prototype.request;
  let sent;
  IOSWebDriver.prototype.request = async (method, endpoint, body) => {
    assert.equal(method, 'POST');
    assert.equal(endpoint, '/session');
    sent = body.capabilities.alwaysMatch;
    return { sessionId: 'fixture' };
  };
  try {
    const driver = await IOSWebDriver.create(0, safariCapabilities);
    assert.equal(driver.sessionId, 'fixture');
    assert.equal(sent['appium:nativeWebTap'], true);
    assert.equal(Object.hasOwn(sent, 'appium:nativeWebTapStrict'), false);
    assert.equal(sent.browserName, 'Safari');
    assert.equal(sent['appium:automationName'], 'XCUITest');
    assert.equal(sent['appium:simulatorPasteboardAutomaticSync'], 'off');
    assert.equal(driver.calibrateNativeWebTap, undefined);
  } finally {
    IOSWebDriver.prototype.request = original;
  }
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

test('focuses the actual native secure field and restores Safari context even when tap fails', async () => {
  for (const failure of [false, true]) {
    const driver = new IOSWebDriver(0, 'fixture');
    const calls = [];
    driver.sessionRequest = async (method, endpoint, body) => {
      calls.push([method, endpoint, body]);
      if (endpoint === '/context' && method === 'GET') return 'WEBVIEW_fixture';
      if (endpoint === '/element') return { 'element-6066-11e4-a52e-4f735466cecf': 'secure-field' };
      if (endpoint.endsWith('/displayed')) return true;
      if (endpoint.endsWith('/click') && failure) throw new Error('native tap failed');
    };
    if (failure) await assert.rejects(driver.focusSecureTextField(), /native tap failed/);
    else await driver.focusSecureTextField();
    assert.deepEqual(calls, [
      ['GET', '/context', undefined],
      ['POST', '/context', { name: 'NATIVE_APP' }],
      ['POST', '/element', { using: 'class name', value: 'XCUIElementTypeSecureTextField' }],
      ['GET', '/element/secure-field/displayed', undefined],
      ['POST', '/element/secure-field/click', {}],
      ['POST', '/context', { name: 'WEBVIEW_fixture' }],
    ]);
  }
});

test('types text once through the actual focused native field and restores Safari context', async () => {
  for (const failure of [false, true]) {
    const driver = new IOSWebDriver(0, 'fixture');
    const calls = [];
    driver.sessionRequest = async (method, endpoint, body) => {
      calls.push([method, endpoint, body]);
      if (endpoint === '/context' && method === 'GET') return 'WEBVIEW_fixture';
      if (endpoint === '/element/active') return { 'element-6066-11e4-a52e-4f735466cecf': 'focused-field' };
      if (endpoint.endsWith('/attribute/type')) return 'XCUIElementTypeSecureTextField';
      if (endpoint.endsWith('/value') && failure) throw new Error('native typing failed');
    };
    if (failure) await assert.rejects(driver.typeText('fixture token'), /native typing failed/);
    else await driver.typeText('fixture token');
    assert.deepEqual(calls, [
      ['GET', '/context', undefined],
      ['POST', '/context', { name: 'NATIVE_APP' }],
      ['GET', '/element/active', undefined],
      ['GET', '/element/focused-field/attribute/type', undefined],
      ['POST', '/element/focused-field/value', { text: 'fixture token' }],
      ['POST', '/context', { name: 'WEBVIEW_fixture' }],
    ]);
  }
});

test('refuses to type into the wrong native element and restores context', async () => {
  const driver = new IOSWebDriver(0, 'fixture');
  const calls = [];
  driver.sessionRequest = async (method, endpoint, body) => {
    calls.push([method, endpoint, body]);
    if (endpoint === '/context' && method === 'GET') return 'WEBVIEW_fixture';
    if (endpoint === '/element/active') return { 'element-6066-11e4-a52e-4f735466cecf': 'wrong-control' };
    if (endpoint.endsWith('/attribute/type')) return 'XCUIElementTypeButton';
  };
  await assert.rejects(driver.typeText('fixture token'), /XCUIElementTypeButton/);
  assert.equal(calls.some(([, endpoint]) => endpoint.endsWith('/value')), false);
  assert.deepEqual(calls.at(-1), ['POST', '/context', { name: 'WEBVIEW_fixture' }]);
});

test('launches the installed Appium CLI contract, not its programmatic main export', () => {
  const manifestPath = require.resolve('appium/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const cli = resolveAppiumCli();
  assert.equal(cli, resolve(dirname(manifestPath), manifest.bin.appium));
  assert.notEqual(cli, require.resolve('appium'));
  const version = execFileSync(process.execPath, [cli, '--version'], {
    cwd: resolveAppiumRuntimeDirectory(), encoding: 'utf8', timeout: 15_000,
  }).trim();
  assert.equal(version, manifest.version);
});

test('discovers the XCUITest driver and owns its cache in the native project', () => {
  const cwd = resolveAppiumRuntimeDirectory();
  const manifest = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8'));
  const declared = manifest.dependencies?.['appium-xcuitest-driver'] ?? manifest.devDependencies?.['appium-xcuitest-driver'];
  assert.equal(typeof declared, 'string');
  const installed = JSON.parse(execFileSync(process.execPath, [resolveAppiumCli(), 'driver', 'list', '--installed', '--json'], {
    cwd, encoding: 'utf8', timeout: 15_000,
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
