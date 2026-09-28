import assert from "node:assert/strict";
import test from "node:test";
import { installCopyController } from "../src/copy-controller.js";
import { reportCopyFailure } from "../src/copy-failure-report.js";

function reader(t, { state = "ready", iphone = false, clipboard = async () => true } = {}) {
  t.mock.method(globalThis, "setTimeout", globalThis.setTimeout);
  globalThis.window = globalThis;
  globalThis.GM = { setClipboard: clipboard };
  t.after(() => { delete globalThis.window; delete globalThis.GM; });
  const reports = [], destinations = [], errors = [];
  const app = {
    SITE_ID: "chushoks.kakomonn.com", syncToken: "private-token", isIPhoneSafari: iphone,
    pendingAttempt: { operationId: "a".repeat(32), questionId: "45124", copy: { state: "required" } },
    answerCopyOperation: null, frameDocument: {},
    buildCopyMarkdown: () => ({ state, markdown: "private markdown" }),
    async updatePendingAttempt(id, update) { if (this.pendingAttempt?.operationId === id) this.pendingAttempt = update(this.pendingAttempt); },
    async requestSyncResponse(...args) { reports.push(args); return { accepted: true }; },
    async maybePreparePendingDestination() { destinations.push(app.pendingAttempt); },
    updateSyncDependentControls() {}, showReaderError(...args) { errors.push(args); },
  };
  installCopyController(app);
  return { app, reports, destinations, errors };
}

test("Markdown failures are terminal and never display a dialog", async (t) => {
  for (const throws of [false, true]) {
    const { app, reports, destinations, errors } = reader(t, { state: "unavailable" });
    if (throws) app.buildCopyMarkdown = () => { throw new Error("private source"); };
    assert.equal(await app.processPendingAutomaticCopy(), true);
    assert.deepEqual(app.pendingAttempt.copy, { state: "failed" });
    assert.deepEqual(reports[0][4], { site: app.SITE_ID, questionId: "45124", reason: "markdown_unavailable" });
    assert.equal(destinations.length, 1);
    assert.deepEqual(errors, []);
    await app.processPendingAutomaticCopy();
    assert.equal(reports.length, 1);
  }
});

test("clipboard rejection is reported without contents and does not wait for reporting", async (t) => {
  const { app, reports, errors } = reader(t, { clipboard: async () => false });
  app.requestSyncResponse = (...args) => { reports.push(args); return new Promise(() => {}); };
  assert.equal(await app.processPendingAutomaticCopy(), true);
  assert.deepEqual(app.pendingAttempt.copy, { state: "failed" });
  assert.equal(reports[0][4].reason, "clipboard_write_failed");
  assert.deepEqual(errors, []);
});

test("successful copy completes once and sends no report", async (t) => {
  let copies = 0;
  const { app, reports } = reader(t, { clipboard: async () => { copies++; return true; } });
  assert.equal(await app.processPendingAutomaticCopy(), true);
  await app.processPendingAutomaticCopy();
  assert.deepEqual(app.pendingAttempt.copy, { state: "completed" });
  assert.equal(copies, 1);
  assert.deepEqual(reports, []);
});

test("clipboard timeout releases Windows navigation", async (t) => {
  const { app, reports } = reader(t, { clipboard: () => new Promise(() => {}) });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const completion = app.processPendingAutomaticCopy();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  t.mock.timers.tick(5001);
  assert.equal(await completion, true);
  assert.equal(app.pendingAttempt.copy.state, "failed");
  assert.equal(reports[0][4].reason, "clipboard_write_timeout");
});

test("late iPhone failure reports the original question without changing a newer attempt", async (t) => {
  const { app, reports, errors } = reader(t, { iphone: true });
  let rejectWrite;
  app.answerCopyOperation = {
    operationId: app.pendingAttempt.operationId, resolveMarkdown() {}, rejectMarkdown: null,
    writePromise: new Promise((_, reject) => { rejectWrite = reject; }),
  };
  assert.equal(await app.processPendingAutomaticCopy(), true);
  app.pendingAttempt = { operationId: "b".repeat(32), questionId: "45125", copy: { state: "required" } };
  const newer = app.pendingAttempt;
  rejectWrite(new Error("denied"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.pendingAttempt, newer);
  assert.equal(reports[0][4].questionId, "45124");
  assert.deepEqual(errors, []);
});

test("temporary explanation lock resumes on mutation and permanent lock times out", async (t) => {
  const { app, reports } = reader(t, { state: "locked" });
  let inspect;
  let disconnected = false;
  globalThis.MutationObserver = class {
    constructor(callback) { inspect = callback; }
    observe() {} disconnect() { disconnected = true; }
  };
  t.after(() => delete globalThis.MutationObserver);
  const completion = app.processPendingAutomaticCopy();
  app.buildCopyMarkdown = () => ({ state: "ready", markdown: "private" });
  inspect();
  assert.equal(await completion, true);
  assert.equal(disconnected, true);
  assert.deepEqual(reports, []);
  app.pendingAttempt.copy = { state: "required" };
  app.buildCopyMarkdown = () => ({ state: "locked" });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const timeout = app.processPendingAutomaticCopy();
  t.mock.timers.tick(5001);
  assert.equal(await timeout, true);
  assert.equal(reports[0][4].reason, "markdown_unavailable");
});

test("report transport failures stay silent and invalid reports never leave Reader", async (t) => {
  const { app, reports } = reader(t);
  app.requestSyncResponse = async () => { throw new Error("network"); };
  assert.equal(await reportCopyFailure(app, "45124", "clipboard_write_failed"), false);
  assert.equal(await reportCopyFailure(app, "45124", "toString"), false);
  assert.deepEqual(reports, []);
});
