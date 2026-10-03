import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { resolveAppiumCli, resolveAppiumRuntimeDirectory } = require('../kakomonn-reader/tests/ios_safari_e2e_test.js');

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

test('discovers the XCUITest driver from the shared npm project without a consumer cache', () => {
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
  const consumerModules = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules');
  assert.equal(existsSync(consumerModules), false, 'Appium must not recreate a repository-local cache');
});
