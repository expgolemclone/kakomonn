import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

const SCAN_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".mjs",
  ".md",
  ".py",
  ".yaml",
  ".yml",
]);

const SKIP_DIRECTORIES = new Set([
  ".claude",
  ".env.cloudflare-migration",
  ".git",
  ".jj",
  ".qoder",
  ".wrangler",
  "node_modules",
]);

const SKIP_FILES = new Set(["package-lock.json", "kakomonn-reader.user.js"]);

// legacy migration code and fixtures intentionally keep the retired names.
const EXEMPT_FILES = new Set([
  "kakomonn-sync/src/storage/schema.js",
  "kakomonn-sync/tests/learning-state.test.js",
  "tests/repository_naming_test.mjs",
]);

const RETIRED_PATTERNS = [
  /pendingAnswer/i,
  /countBadge/,
  /\brenderCount\b/,
  /StabilityState/,
  /kakomonn-count-sync/,
  /completedMilestone/,
  /masteryDelta/,
  /MASTERY/,
  /mastery_history/,
  /learning_metadata/,
  /highest_mastery_milestone/,
  /\bdailyStabilityDaysGoal\b/,
  /dailyStabilityDaysDeltaGoal/,
  /daily_stability_days_delta_goal/,
  /answered_at_ms/,
  /\bprevious_stability\b/,
  /\bresulting_stability\b/,
  /\/v6\//,
  /\/v7\//,
  /v6\.pending-attempt/,
  /v7\.pending-(?:attempt|celebration)/,
  /(?<![a-z_])result: "(correct|incorrect)"/,
];

const RETIRED_RUNTIME_PATTERNS = [
  /isWindowsEdge/,
  /KAKOMONN_EDGE_/,
  /edge_tampermonkey/,
  /launchDedicatedEdge/,
  /readEdgeUserDataDir/,
  /edgeLaunchArguments/,
  /stopDedicatedEdge/,
  /kakomonn-edge-e2e/,
];

const UNSUPPORTED_HANDLER_FIXTURES = new Set([
  "kakomonn-reader/tests/live_sync_e2e_unit_test.js",
  "kakomonn-reader/tests/smoke_test.js",
]);

const CONFIGURATION_RUNTIME_EXEMPT_FILES = new Set([
  "kakomonn-reader/tests/live_sync_e2e_unit_test.js",
  "tests/kakomonn-config.test.mjs",
  "tests/repository_naming_test.mjs",
]);

const RETIRED_CONFIGURATION_PATTERNS = [
  /(?:process\.env|environment|systemEnvironment)\.KAKOMONN_/,
  /\$env:KAKOMONN_/,
  /--env-file(?:-if-exists)?(?:=|\s)/,
  /KAKOMONN_E2E_/,
];

async function* listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      yield* listFiles(join(directory, entry.name));
      continue;
    }
    if (!entry.isFile()) continue;
    if (SKIP_FILES.has(entry.name)) continue;
    if (!SCAN_EXTENSIONS.has(extname(entry.name))) continue;
    yield join(directory, entry.name);
  }
}

test("retired learning metric names stay out of the repository", async () => {
  const violations = [];
  for await (const filePath of listFiles(repositoryRoot)) {
    const relativePath = relative(repositoryRoot, filePath).replaceAll("\\", "/");
    if (EXEMPT_FILES.has(relativePath)) continue;
    const lines = (await readFile(filePath, "utf8")).split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const pattern of RETIRED_PATTERNS) {
        if (pattern.test(line)) {
          violations.push(`${relativePath}:${index + 1}: ${pattern} => ${line.trim()}`);
        }
      }
    });
  }
  assert.deepEqual(
    violations,
    [],
    `retired names were found outside legacy migrations:\n${violations.join("\n")}`,
  );
});

test("retired runtime names stay out of production code and support files", async () => {
  const violations = [];
  for await (const filePath of listFiles(repositoryRoot)) {
    const relativePath = relative(repositoryRoot, filePath).replaceAll("\\", "/");
    if (relativePath === "tests/repository_naming_test.mjs") continue;
    const lines = (await readFile(filePath, "utf8")).split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const pattern of RETIRED_RUNTIME_PATTERNS) {
        if (pattern.test(line)) {
          violations.push(`${relativePath}:${index + 1}: ${pattern} => ${line.trim()}`);
        }
      }
      if (
        line.includes("Userscripts") &&
        !UNSUPPORTED_HANDLER_FIXTURES.has(relativePath)
      ) {
        violations.push(
          `${relativePath}:${index + 1}: unsupported handler => ${line.trim()}`,
        );
      }
    });
  }
  assert.deepEqual(
    violations,
    [],
    `retired runtime names were found:\n${violations.join("\n")}`,
  );
});

test("Kakomonn settings are read only through the repository env loader", async () => {
  const violations = [];
  for await (const filePath of listFiles(repositoryRoot)) {
    const relativePath = relative(repositoryRoot, filePath).replaceAll("\\", "/");
    if (CONFIGURATION_RUNTIME_EXEMPT_FILES.has(relativePath)) continue;
    const lines = (await readFile(filePath, "utf8")).split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const pattern of RETIRED_CONFIGURATION_PATTERNS) {
        if (pattern.test(line)) {
          violations.push(
            `${relativePath}:${index + 1}: ${pattern} => ${line.trim()}`,
          );
        }
      }
    });
  }
  assert.deepEqual(
    violations,
    [],
    `retired Kakomonn configuration access was found:\n${violations.join("\n")}`,
  );
});
