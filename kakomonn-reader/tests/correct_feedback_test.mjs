import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const sourceUrl = new URL("../src/correct-feedback.js", import.meta.url);

async function loadSelectionApi() {
  const source = await readFile(sourceUrl, "utf8");
  const context = vm.createContext({});
  vm.runInContext(
    `${source}\n` +
      `globalThis.__correctFeedbackTest = {\n` +
      `  calculateKpiQuestionsRemaining,\n` +
      `  chooseCorrectFeedbackVariant,\n` +
      `  randomIntegerBelow,\n` +
      `  variants: CORRECT_FEEDBACK_VARIANTS,\n` +
      `};`,
    context,
    { filename: sourceUrl.pathname },
  );
  return context.__correctFeedbackTest;
}

test("combines due and new question work into one KPI number", async () => {
  const { calculateKpiQuestionsRemaining } = await loadSelectionApi();
  assert.equal(
    calculateKpiQuestionsRemaining({
      dueCardsRemaining: 12,
      newQuestionsRemaining: 49,
    }),
    61,
  );
  assert.equal(
    calculateKpiQuestionsRemaining({
      dueCardsRemaining: 0,
      newQuestionsRemaining: 0,
    }),
    0,
  );
  assert.throws(
    () =>
      calculateKpiQuestionsRemaining({
        dueCardsRemaining: Number.MAX_SAFE_INTEGER,
        newQuestionsRemaining: 1,
      }),
    /KPI questions remaining is invalid/,
  );
});

function queuedCrypto(values) {
  const queue = [...values];
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    getRandomValues(target) {
      calls += 1;
      assert.equal(target.constructor.name, "Uint16Array");
      assert.notEqual(queue.length, 0, "random value queue was exhausted");
      target[0] = queue.shift();
      return target;
    },
  };
}

test("correct feedback variants expose the agreed copy and tier labels", async () => {
  const { variants } = await loadSelectionApi();
  assert.deepEqual(
    Array.from(variants, (variant) => ({
      displayText: variant.displayText,
      id: variant.id,
      label: variant.label,
      speechText: variant.speechText,
    })),
    [
      {
        displayText: "That's Right!!",
        id: "normal",
        label: "NORMAL",
        speechText: "That's right!",
      },
      {
        displayText: "Nice! That's Right!!",
        id: "rare",
        label: "RARE",
        speechText: "Nice! That's right!",
      },
      {
        displayText: "Amazing! That's Right!!",
        id: "super-rare",
        label: "SUPER RARE",
        speechText: "Amazing! That's right!",
      },
      {
        displayText: "Legendary! That's Right!!",
        id: "ssr",
        label: "SSR",
        speechText: "Legendary! That's right!",
      },
    ],
  );
});

test("correct feedback selection has exact 889, 100, 10, and 1 buckets", async () => {
  const { chooseCorrectFeedbackVariant } = await loadSelectionApi();
  const counts = new Map();
  for (let bucket = 0; bucket < 1000; bucket += 1) {
    const variant = chooseCorrectFeedbackVariant(queuedCrypto([bucket]));
    counts.set(variant.id, (counts.get(variant.id) ?? 0) + 1);
  }
  assert.deepEqual(Object.fromEntries(counts), {
    ssr: 1,
    "super-rare": 10,
    rare: 100,
    normal: 889,
  });
});

test("correct feedback random selection rejects modulo-biased values", async () => {
  const { chooseCorrectFeedbackVariant } = await loadSelectionApi();
  const cryptoSource = queuedCrypto([65000, 0]);
  assert.equal(chooseCorrectFeedbackVariant(cryptoSource).id, "ssr");
  assert.equal(cryptoSource.calls, 2);
});

test("correct feedback random selection has no insecure fallback", async () => {
  const { randomIntegerBelow } = await loadSelectionApi();
  assert.throws(
    () => randomIntegerBelow(1000, {}),
    /Crypto random values are unavailable/,
  );
});
