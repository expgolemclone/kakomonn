import { Rating } from "ts-fsrs";
import { getTokyoDate, tokyoDateRangeMs } from "./dates.js";
import { createNewCard, scheduleRating } from "./fsrs.js";

export const QUESTION_HISTORY_REPAIR_ID =
  "chushoks-86956-full-history-v1";

const TARGET_SITE = "chushoks.kakomonn.com";
const TARGET_QUESTION_ID = "86956";
const EASY_CUTOVER_MS = Date.parse("2026-08-14T04:08:17.000Z");
const FLOAT_TOLERANCE = 1e-7;

function closeEnough(left, right) {
  return Math.abs(left - right) <= FLOAT_TOLERANCE;
}

function sumStability(stabilityByQuestion) {
  let total = 0;
  for (const value of stabilityByQuestion.values()) {
    total += value;
  }
  return total;
}

function cardFromRow(row) {
  return {
    due: new Date(row.due_ms),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: 0,
    scheduled_days: row.scheduled_days,
    learning_steps: row.learning_steps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    last_review:
      row.last_review_ms === null ? undefined : new Date(row.last_review_ms),
  };
}

function serializeCard(card) {
  return {
    dueMs: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReviewMs: card.last_review?.getTime() ?? null,
  };
}

function historicalRating(row) {
  if (row.answer_result === "incorrect") {
    return Rating.Again;
  }
  return row.attempted_at_ms < EASY_CUTOVER_MS
    ? Rating.Good
    : Rating.Easy;
}

function fnv1a64(value) {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function readTarget(storage) {
  const cardRow = storage.sql
    .exec(
      `SELECT due_ms, stability, difficulty, scheduled_days, learning_steps,
              reps, lapses, state, last_review_ms
       FROM cards WHERE site = ? AND question_id = ?`,
      TARGET_SITE,
      TARGET_QUESTION_ID
    )
    .toArray()[0];
  if (cardRow === undefined) {
    throw new Error("repair target card is missing");
  }
  const targetAttempts = storage.sql
    .exec(
      `SELECT operation_id, question_id, attempted_at_ms, answer_result,
              previous_card_stability_days, resulting_card_stability_days
       FROM attempts
       WHERE site = ? AND question_id = ?
       ORDER BY attempted_at_ms, operation_id`,
      TARGET_SITE,
      TARGET_QUESTION_ID
    )
    .toArray();
  if (targetAttempts.length === 0) {
    throw new Error("repair target attempts are missing");
  }
  let previousResult = targetAttempts[0].previous_card_stability_days;
  if (!closeEnough(previousResult, 0)) {
    throw new Error("repair target does not start from a new card");
  }
  for (const row of targetAttempts) {
    if (!closeEnough(row.previous_card_stability_days, previousResult)) {
      throw new Error("repair target attempt chain is inconsistent");
    }
    previousResult = row.resulting_card_stability_days;
  }
  if (!closeEnough(previousResult, cardRow.stability)) {
    throw new Error("repair target card does not match its latest attempt");
  }
  return { cardRow, targetAttempts };
}

function replayTarget(targetAttempts) {
  let card;
  let schedulingAppliedCount = 0;
  const correctedAttempts = [];
  for (const row of targetAttempts) {
    const previousCardStabilityDays = card?.stability ?? 0;
    const schedulingApplied =
      card === undefined || card.due.getTime() <= row.attempted_at_ms;
    if (schedulingApplied) {
      const inputCard = card ?? createNewCard(row.attempted_at_ms);
      card = scheduleRating(
        inputCard,
        historicalRating(row),
        row.attempted_at_ms
      );
      schedulingAppliedCount += 1;
    }
    correctedAttempts.push({
      ...row,
      previous_card_stability_days: previousCardStabilityDays,
      resulting_card_stability_days: card.stability,
      schedulingApplied,
    });
  }
  return {
    correctedCard: card,
    correctedAttempts,
    schedulingAppliedCount,
    practiceCount: targetAttempts.length - schedulingAppliedCount,
  };
}

function readRepairInputs(storage, firstDate) {
  const questions = new Set(
    storage.sql
      .exec("SELECT question_id FROM questions WHERE site = ?", TARGET_SITE)
      .toArray()
      .map((row) => row.question_id)
  );
  if (!questions.has(TARGET_QUESTION_ID)) {
    throw new Error("repair target is not in the current catalog");
  }
  const attempts = storage.sql
    .exec(
      `SELECT operation_id, question_id, attempted_at_ms, answer_result,
              previous_card_stability_days, resulting_card_stability_days
       FROM attempts WHERE site = ?
       ORDER BY attempted_at_ms, operation_id`,
      TARGET_SITE
    )
    .toArray();
  const history = storage.sql
    .exec(
      `SELECT site, date, opening_stability_days, closing_stability_days
       FROM stability_history WHERE site = ? AND date >= ? ORDER BY date`,
      TARGET_SITE,
      firstDate
    )
    .toArray();
  if (history.length === 0 || history[0].date !== firstDate) {
    throw new Error("repair target history is incomplete");
  }
  const achievements = storage.sql
    .exec(
      `SELECT site, date, operation_id, achieved_at_ms,
              today_stability_days_delta, daily_stability_days_delta_goal
       FROM daily_stability_days_delta_achievements
       WHERE site = ? AND date >= ? ORDER BY date`,
      TARGET_SITE,
      firstDate
    )
    .toArray();
  const metrics = storage.sql
    .exec(
      `SELECT stability_days, attempted_question_count,
              attempted_question_count_date, today_attempted_question_count
       FROM learning_metrics WHERE site = ?`,
      TARGET_SITE
    )
    .toArray()[0];
  if (metrics === undefined) {
    throw new Error("repair target metrics are missing");
  }
  return { questions, attempts, history, achievements, metrics };
}

function reconstructHistory(
  questions,
  attempts,
  correctedTargetByOperation,
  history
) {
  const original = new Map();
  const corrected = new Map();
  const historyPlan = [];
  const correctedEventsByDate = new Map();
  let attemptIndex = 0;
  let previousCorrectedClosing;

  for (const row of history) {
    const { startMs, endMs } = tokyoDateRangeMs(row.date);
    while (
      attemptIndex < attempts.length &&
      attempts[attemptIndex].attempted_at_ms < startMs
    ) {
      const attempt = attempts[attemptIndex];
      if (questions.has(attempt.question_id)) {
        original.set(
          attempt.question_id,
          attempt.resulting_card_stability_days
        );
        const replacement = correctedTargetByOperation.get(attempt.operation_id);
        corrected.set(
          attempt.question_id,
          replacement?.resulting_card_stability_days ??
            attempt.resulting_card_stability_days
        );
      }
      attemptIndex += 1;
    }

    const originalOpening = Math.trunc(sumStability(original));
    const correctedOpening =
      previousCorrectedClosing ?? row.opening_stability_days;
    if (
      historyPlan.length > 0 &&
      originalOpening !== row.opening_stability_days
    ) {
      throw new Error(`repair opening history mismatch on ${row.date}`);
    }

    const dayEvents = [];
    while (
      attemptIndex < attempts.length &&
      attempts[attemptIndex].attempted_at_ms < endMs
    ) {
      const attempt = attempts[attemptIndex];
      if (questions.has(attempt.question_id)) {
        original.set(
          attempt.question_id,
          attempt.resulting_card_stability_days
        );
        const replacement = correctedTargetByOperation.get(attempt.operation_id);
        corrected.set(
          attempt.question_id,
          replacement?.resulting_card_stability_days ??
            attempt.resulting_card_stability_days
        );
        dayEvents.push({
          operationId: attempt.operation_id,
          attemptedAtMs: attempt.attempted_at_ms,
          resultingStabilityDays: Math.trunc(sumStability(corrected)),
        });
      }
      attemptIndex += 1;
    }
    const originalClosing = Math.trunc(sumStability(original));
    if (originalClosing !== row.closing_stability_days) {
      throw new Error(`repair closing history mismatch on ${row.date}`);
    }
    const correctedClosing = Math.trunc(sumStability(corrected));
    historyPlan.push({
      date: row.date,
      previousOpeningStabilityDays: row.opening_stability_days,
      previousClosingStabilityDays: row.closing_stability_days,
      openingStabilityDays: correctedOpening,
      closingStabilityDays: correctedClosing,
    });
    correctedEventsByDate.set(row.date, dayEvents);
    previousCorrectedClosing = correctedClosing;
  }

  return {
    historyPlan,
    correctedEventsByDate,
    originalFinalStabilityDays: sumStability(original),
    correctedFinalStabilityDays: sumStability(corrected),
  };
}

function repairAchievements(achievements, historyPlan, correctedEventsByDate) {
  const historyByDate = new Map(historyPlan.map((row) => [row.date, row]));
  const repaired = [];
  const removedDates = [];
  for (const achievement of achievements) {
    const day = historyByDate.get(achievement.date);
    if (day === undefined) {
      throw new Error("repair achievement history is missing");
    }
    const goal = achievement.daily_stability_days_delta_goal;
    let previousDelta = 0;
    const crossing = (correctedEventsByDate.get(achievement.date) ?? []).find(
      (event) => {
        const delta =
          event.resultingStabilityDays - day.openingStabilityDays;
        const crossed = previousDelta < goal && delta >= goal;
        previousDelta = delta;
        return crossed;
      }
    );
    if (crossing === undefined) {
      removedDates.push(achievement.date);
      continue;
    }
    repaired.push({
      site: TARGET_SITE,
      date: achievement.date,
      operationId: crossing.operationId,
      achievedAtMs: crossing.attemptedAtMs,
      todayStabilityDaysDelta:
        crossing.resultingStabilityDays - day.openingStabilityDays,
      dailyStabilityDaysDeltaGoal: goal,
    });
  }
  return { repaired, removedDates };
}

function publicPlan(plan) {
  return {
    repairId: QUESTION_HISTORY_REPAIR_ID,
    digest: plan.digest,
    site: TARGET_SITE,
    questionId: TARGET_QUESTION_ID,
    totalAttemptCount: plan.correctedAttempts.length,
    schedulingAppliedCount: plan.schedulingAppliedCount,
    practiceCount: plan.practiceCount,
    previousCard: serializeCard(cardFromRow(plan.cardRow)),
    correctedCard: serializeCard(plan.correctedCard),
    stabilityDaysReduction:
      plan.metrics.stability_days - plan.correctedFinalStabilityDays,
    affectedDays: plan.historyPlan,
    removedAchievementDates: plan.achievementPlan.removedDates,
    repairedAchievementCount: plan.achievementPlan.repaired.length,
  };
}

function buildPlan(storage) {
  const { cardRow, targetAttempts } = readTarget(storage);
  const replay = replayTarget(targetAttempts);
  const firstDate = getTokyoDate(new Date(targetAttempts[0].attempted_at_ms));
  const inputs = readRepairInputs(storage, firstDate);
  const correctedTargetByOperation = new Map(
    replay.correctedAttempts.map((row) => [row.operation_id, row])
  );
  const reconstructed = reconstructHistory(
    inputs.questions,
    inputs.attempts,
    correctedTargetByOperation,
    inputs.history
  );
  if (
    !closeEnough(
      reconstructed.originalFinalStabilityDays,
      inputs.metrics.stability_days
    )
  ) {
    throw new Error("repair final metrics do not match attempt history");
  }
  const achievementPlan = repairAchievements(
    inputs.achievements,
    reconstructed.historyPlan,
    reconstructed.correctedEventsByDate
  );
  const digestInput = {
    targetAttempts,
    cardRow,
    attempts: inputs.attempts,
    history: inputs.history,
    achievements: inputs.achievements,
    metrics: inputs.metrics,
  };
  const plan = {
    ...replay,
    ...reconstructed,
    achievementPlan,
    cardRow,
    metrics: inputs.metrics,
    firstDate,
    digest: fnv1a64(JSON.stringify(digestInput)),
  };
  return plan;
}

function saveCard(storage, card) {
  storage.sql.exec(
    `UPDATE cards
     SET due_ms = ?, stability = ?, difficulty = ?, scheduled_days = ?,
         learning_steps = ?, reps = ?, lapses = ?, state = ?, last_review_ms = ?
     WHERE site = ? AND question_id = ?`,
    card.due.getTime(),
    card.stability,
    card.difficulty,
    card.scheduled_days,
    card.learning_steps,
    card.reps,
    card.lapses,
    card.state,
    card.last_review?.getTime() ?? null,
    TARGET_SITE,
    TARGET_QUESTION_ID
  );
}

export function previewQuestionHistoryRepair(storage) {
  return publicPlan(buildPlan(storage));
}

export function applyQuestionHistoryRepair(storage, expectedDigest, nowMs) {
  const plan = buildPlan(storage);
  if (plan.digest !== expectedDigest) {
    return { error: "repair_state_changed", preview: publicPlan(plan) };
  }
  for (const row of plan.correctedAttempts) {
    storage.sql.exec(
      `UPDATE attempts
       SET previous_card_stability_days = ?, resulting_card_stability_days = ?
       WHERE operation_id = ?`,
      row.previous_card_stability_days,
      row.resulting_card_stability_days,
      row.operation_id
    );
  }
  saveCard(storage, plan.correctedCard);
  for (const row of plan.historyPlan) {
    storage.sql.exec(
      `UPDATE stability_history
       SET opening_stability_days = ?, closing_stability_days = ?
       WHERE site = ? AND date = ?`,
      row.openingStabilityDays,
      row.closingStabilityDays,
      TARGET_SITE,
      row.date
    );
  }
  storage.sql.exec(
    `DELETE FROM daily_stability_days_delta_achievements
     WHERE site = ? AND date >= ?`,
    TARGET_SITE,
    plan.firstDate
  );
  for (const achievement of plan.achievementPlan.repaired) {
    storage.sql.exec(
      `INSERT INTO daily_stability_days_delta_achievements (
         site, date, operation_id, achieved_at_ms,
         today_stability_days_delta, daily_stability_days_delta_goal
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      achievement.site,
      achievement.date,
      achievement.operationId,
      achievement.achievedAtMs,
      achievement.todayStabilityDaysDelta,
      achievement.dailyStabilityDaysDeltaGoal
    );
  }
  const today = getTokyoDate(new Date(nowMs));
  const { startMs, endMs } = tokyoDateRangeMs(today);
  const todayAttemptedQuestionCount = storage.sql
    .exec(
      `SELECT COUNT(DISTINCT question_id) AS count
       FROM attempts
       WHERE site = ? AND attempted_at_ms >= ? AND attempted_at_ms < ?`,
      TARGET_SITE,
      startMs,
      endMs
    )
    .toArray()[0].count;
  storage.sql.exec(
    `UPDATE learning_metrics
     SET stability_days = ?, attempted_question_count_date = ?,
         today_attempted_question_count = ?
     WHERE site = ?`,
    plan.correctedFinalStabilityDays,
    today,
    todayAttemptedQuestionCount,
    TARGET_SITE
  );
  return { applied: true, ...publicPlan(plan) };
}
