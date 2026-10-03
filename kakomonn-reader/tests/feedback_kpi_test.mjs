import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const { calculateKpiQuestionsRemaining, waitForCorrectFeedbackKpi, resolveCorrectFeedbackKpi } = await import(
  `data:text/javascript;base64,${Buffer.from(await readFile(new URL('../src/feedback-kpi.js', import.meta.url), 'utf8')).toString('base64')}`);

test('Reader combines its own due and new question KPI after shared feedback', () => {
  assert.equal(calculateKpiQuestionsRemaining({ dueCardsRemaining: 12, newQuestionsRemaining: 49 }), 61);
  assert.equal(calculateKpiQuestionsRemaining({ dueCardsRemaining: 0, newQuestionsRemaining: 0 }), 0);
  assert.throws(() => calculateKpiQuestionsRemaining({ dueCardsRemaining: Number.MAX_SAFE_INTEGER,
    newQuestionsRemaining: 1 }), /KPI questions remaining is invalid/);
});
test('KPI speech awaits the matching saved attempt and resolves each waiter once', async () => {
  const first = waitForCorrectFeedbackKpi('12');
  const second = waitForCorrectFeedbackKpi('12');
  assert.equal(resolveCorrectFeedbackKpi('13', 2), false);
  assert.equal(resolveCorrectFeedbackKpi('12', 4), true);
  assert.equal(await first, 4);
  assert.equal(resolveCorrectFeedbackKpi('12', 3), true);
  assert.equal(await second, 3);
  assert.equal(resolveCorrectFeedbackKpi('12', 3), false);
  assert.equal(await waitForCorrectFeedbackKpi('12', { phase: 'recorded', answerResult: 'correct',
    questionId: '12', kpiQuestionsRemaining: 0 }), 0);
  await assert.rejects(waitForCorrectFeedbackKpi('bad'), /invalid/);
});
