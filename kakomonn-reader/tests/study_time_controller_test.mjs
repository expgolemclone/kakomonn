import assert from 'node:assert/strict';
import test from 'node:test';
import { installStudyTimeController } from '../src/study-time-controller.js';

async function fixture(run) {
  const names = ['window', 'document', 'navigator', 'performance', 'MutationObserver', 'GM'];
  const descriptors = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const originalNow = Date.now;
  let wall = Date.parse('2026-10-12T00:00:00Z');
  let perf = 0;
  const storage = new Map();
  const locks = new Map();
  const events = new Map();
  const timers = new Map();
  let timerId = 0;
  const on = (name, callback) => events.set(name, [...(events.get(name) ?? []), callback]);
  const globals = {
    window: {
      setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
      clearTimeout: id => timers.delete(id),
      setInterval: callback => { timers.set(++timerId, callback); return timerId; },
      addEventListener: on,
    },
    document: { visibilityState: 'visible', hasFocus: () => true, addEventListener: on },
    navigator: { locks: { request(name, run) {
      const task = (locks.get(name) ?? Promise.resolve()).then(run);
      locks.set(name, task.catch(() => {}));
      return task;
    } } },
    performance: { now: () => perf },
    MutationObserver: class { observe() {} },
    GM: {
      listValues: async () => [...storage.keys()],
      getValue: async (key, initial) => storage.has(key) ? structuredClone(storage.get(key)) : initial,
      setValue: async (key, value) => { storage.set(key, structuredClone(value)); },
      deleteValue: async key => { storage.delete(key); },
    },
  };
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  Date.now = () => wall;
  const createApp = () => {
    const app = {
      SITE_ID: 'chushoks.kakomonn.com',
      syncSettings: { open: false }, errorDialog: { open: false },
      frameDocument: { body: {} }, currentQuestionControls: () => ({}),
      syncToken: '', syncInProgress: false, nextQuestionOperationInProgress: false,
    };
    installStudyTimeController(app);
    return app;
  };
  try {
    await run({
      createApp, storage, timers,
      advance: ms => { wall += ms; perf += ms; },
      emit: name => { for (const callback of events.get(name) ?? []) callback(); },
    });
  } finally {
    Date.now = originalNow;
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}
const activeTotal = snapshots => snapshots.reduce((sum, value) => sum + value.activeMs, 0);

for (const stop of ['checkpoint', 'blur', 'pagehide', 'visibilitychange', 'idle-timer']) {
  test(`delayed ${stop} caps study time at the engagement deadline`, () => fixture(async ({ createApp, advance, emit, timers }) => {
    const app = createApp();
    await app.initializeStudyTime();
    advance(360_000);
    if (stop === 'visibilitychange') document.visibilityState = 'hidden';
    if (stop === 'idle-timer') [...timers.values()].at(-1)();
    else if (stop !== 'checkpoint') emit(stop);
    assert.equal(activeTotal(await app.prepareStudyTimeSnapshots()), 300_000);
  }));
}

test('renewed activity does not count the idle gap when the idle timer was delayed', () => fixture(async ({ createApp, advance }) => {
  const app = createApp();
  await app.initializeStudyTime();
  advance(360_000);
  app.refreshStudyTracking({ engage: true });
  advance(60_000);
  assert.equal(activeTotal(await app.prepareStudyTimeSnapshots()), 360_000);
}));

test('engagement renewed before expiry extends the active interval', () => fixture(async ({ createApp, advance }) => {
  const app = createApp();
  await app.initializeStudyTime();
  advance(240_000);
  app.refreshStudyTracking({ engage: true });
  advance(240_000);
  assert.equal(activeTotal(await app.prepareStudyTimeSnapshots()), 480_000);
}));

test('active durations are split at Tokyo midnight', () => fixture(async ({ createApp, advance }) => {
  advance(15 * 3_600_000 - 60_000);
  const app = createApp();
  await app.initializeStudyTime();
  advance(120_000);
  const snapshots = await app.prepareStudyTimeSnapshots();
  assert.deepEqual(snapshots.map(({ date, activeMs }) => ({ date, activeMs })), [
    { date: '2026-10-12', activeMs: 60_000 }, { date: '2026-10-13', activeMs: 60_000 },
  ]);
}));

test('acknowledging an imported stale snapshot preserves a newer persisted duration across reload', () => fixture(async ({ createApp, advance, storage }) => {
  const a = createApp();
  await a.initializeStudyTime();
  advance(60_000);
  const first = await a.prepareStudyTimeSnapshots();
  const sessionId = first[0].sessionId;
  const key = [...storage.keys()].find(key => key.endsWith(sessionId));
  const b = createApp();
  b.navigationInProgress = true;
  await b.initializeStudyTime();
  advance(60_000);
  await a.prepareStudyTimeSnapshots();
  a.navigationInProgress = true;
  a.refreshStudyTracking();
  await b.acknowledgeStudyTimeSnapshots(first);
  assert.deepEqual(storage.get(key).days[first[0].date], { activeMs: 120_000, acknowledgedMs: 60_000 });
  const reopened = createApp();
  reopened.navigationInProgress = true;
  await reopened.initializeStudyTime();
  assert.equal((await reopened.prepareStudyTimeSnapshots()).find(value => value.sessionId === sessionId).activeMs, 120_000);
}));

test('a writer preserves another tab acknowledgement and stale acknowledgements cannot move it backward', () => fixture(async ({ createApp, advance, storage }) => {
  const a = createApp();
  await a.initializeStudyTime();
  advance(60_000);
  const first = await a.prepareStudyTimeSnapshots();
  const b = createApp();
  b.navigationInProgress = true;
  await b.initializeStudyTime();
  advance(60_000);
  const latest = await a.prepareStudyTimeSnapshots();
  await b.acknowledgeStudyTimeSnapshots(first);
  advance(60_000);
  await a.prepareStudyTimeSnapshots();
  const key = [...storage.keys()].find(key => key.endsWith(first[0].sessionId));
  assert.equal(storage.get(key).days[first[0].date].acknowledgedMs, 60_000);
  await Promise.all([a.acknowledgeStudyTimeSnapshots(latest), b.acknowledgeStudyTimeSnapshots(first)]);
  assert.deepEqual(storage.get(key).days[first[0].date], { activeMs: 180_000, acknowledgedMs: 120_000 });
}));

test('completed imported records are removed without resurrection by another stale tab', () => fixture(async ({ createApp, advance, storage }) => {
  const a = createApp();
  await a.initializeStudyTime();
  advance(60_000);
  const first = await a.prepareStudyTimeSnapshots();
  const b = createApp();
  b.navigationInProgress = true;
  await b.initializeStudyTime();
  const c = createApp();
  c.navigationInProgress = true;
  await c.initializeStudyTime();
  const key = [...storage.keys()].find(key => key.endsWith(first[0].sessionId));
  await Promise.all([b.acknowledgeStudyTimeSnapshots(first), c.acknowledgeStudyTimeSnapshots(first)]);
  assert.equal(storage.has(key), false);
  assert.equal((await c.prepareStudyTimeSnapshots()).some(value => value.sessionId === first[0].sessionId), false);
}));
