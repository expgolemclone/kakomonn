import { DurableObject } from "cloudflare:workers";
import {
  dateOrdinal,
  getTokyoDate,
  recentTokyoDates,
  tokyoDateRangeMs,
} from "./dates.js";
import {
  createNewCard,
  scheduleAnswer,
} from "./fsrs.js";
import { isSite } from "./auth.js";
import {
  ANSWER_RESULTS,
  canonicalQuestionIds,
  OPERATION_ID_PATTERN,
  QUESTION_ID_PATTERN,
} from "./contracts.js";
import { initializeLearningSchema } from "./storage/schema.js";

export { initializeLearningSchema } from "./storage/schema.js";

export const LEARNING_STATE_OBJECT_NAME = "primary";
export const NEW_QUESTION_GOAL = 100;
export { OPERATION_ID_PATTERN, QUESTION_ID_PATTERN } from "./contracts.js";

function rowToCard(row) {
  if (row === undefined) {
    return undefined;
  }
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
      row.last_review_ms === null || row.last_review_ms === undefined
        ? undefined
        : new Date(row.last_review_ms),
  };
}

function saveCard(storage, site, questionId, card, lastAttemptDate) {
  storage.sql.exec(
    `INSERT INTO cards (
       site, question_id, due_ms, stability, difficulty, scheduled_days,
       learning_steps, reps, lapses, state, last_review_ms, last_attempt_date
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(site, question_id) DO UPDATE SET
       due_ms = excluded.due_ms,
       stability = excluded.stability,
       difficulty = excluded.difficulty,
       scheduled_days = excluded.scheduled_days,
       learning_steps = excluded.learning_steps,
       reps = excluded.reps,
       lapses = excluded.lapses,
       state = excluded.state,
       last_review_ms = excluded.last_review_ms,
       last_attempt_date = excluded.last_attempt_date`,
    site,
    questionId,
    card.due.getTime(),
    card.stability,
    card.difficulty,
    card.scheduled_days,
    card.learning_steps,
    card.reps,
    card.lapses,
    card.state,
    card.last_review?.getTime() ?? null,
    lastAttemptDate
  );
}

function storedLearningMetricsFromRow(row) {
  if (row === undefined) {
    throw new Error("missing LearningState learning metrics");
  }
  return {
    stabilityDays: row.stability_days,
    attemptedQuestionCount: row.attempted_question_count,
    dailyMetricsDate: row.daily_metrics_date,
    todayAttemptedQuestionCount: row.today_attempted_question_count,
    todayAttemptCount: row.today_attempt_count,
    todayCorrectAttemptCount: row.today_correct_attempt_count,
    todayNewQuestionCount: row.today_new_question_count,
  };
}

function readStoredLearningMetrics(storage, site) {
  return storedLearningMetricsFromRow(
    storage.sql
      .exec(
        `SELECT stability_days, attempted_question_count, daily_metrics_date,
                today_attempted_question_count, today_attempt_count,
                today_correct_attempt_count, today_new_question_count
         FROM learning_metrics WHERE site = ?`,
        site
      )
      .toArray()[0]
  );
}

function calculateCurrentCatalogStabilityDays(storage, site) {
  return storage.sql
    .exec(
      `SELECT COALESCE(SUM(cards.stability), 0) AS stability_days
       FROM cards
       JOIN questions
         ON questions.site = cards.site
        AND questions.question_id = cards.question_id
       WHERE cards.site = ?`,
      site
    )
    .toArray()[0].stability_days;
}

function replaceStoredLearningMetrics(storage, site, metrics, today) {
  return storedLearningMetricsFromRow(
    storage.sql
      .exec(
        `INSERT INTO learning_metrics (
           site, stability_days, attempted_question_count,
           daily_metrics_date, today_attempted_question_count,
           today_attempt_count, today_correct_attempt_count,
           today_new_question_count
         ) VALUES (?, ?, ?, ?, 0, 0, 0, 0)
         ON CONFLICT(site) DO UPDATE SET
           stability_days = excluded.stability_days,
           attempted_question_count = excluded.attempted_question_count
         RETURNING stability_days, attempted_question_count, daily_metrics_date,
                   today_attempted_question_count, today_attempt_count,
                   today_correct_attempt_count, today_new_question_count`,
        site,
        metrics.stabilityDays,
        metrics.attemptedQuestionCount,
        today
      )
      .toArray()[0]
  );
}

function updateStoredLearningMetrics(
  storage,
  site,
  previousCardStabilityDays,
  resultingCardStabilityDays,
  attemptedQuestionCountDelta,
  today,
  todayAttemptedQuestionCountDelta,
  todayCorrectAttemptCountDelta,
  todayNewQuestionCountDelta
) {
  return storedLearningMetricsFromRow(
    storage.sql
      .exec(
        `UPDATE learning_metrics
         SET stability_days = stability_days - ? + ?,
             attempted_question_count = attempted_question_count + ?,
             daily_metrics_date = ?,
             today_attempted_question_count =
               CASE WHEN daily_metrics_date = ?
                    THEN today_attempted_question_count + ?
                    ELSE ? END,
             today_attempt_count =
               CASE WHEN daily_metrics_date = ?
                    THEN today_attempt_count + 1
                    ELSE 1 END,
             today_correct_attempt_count =
               CASE WHEN daily_metrics_date = ?
                    THEN today_correct_attempt_count + ?
                    ELSE ? END,
             today_new_question_count =
               CASE WHEN daily_metrics_date = ?
                    THEN today_new_question_count + ?
                    ELSE ? END
         WHERE site = ?
         RETURNING stability_days, attempted_question_count, daily_metrics_date,
                   today_attempted_question_count, today_attempt_count,
                   today_correct_attempt_count, today_new_question_count`,
        previousCardStabilityDays,
        resultingCardStabilityDays,
        attemptedQuestionCountDelta,
        today,
        today,
        todayAttemptedQuestionCountDelta,
        todayAttemptedQuestionCountDelta,
        today,
        today,
        todayCorrectAttemptCountDelta,
        todayCorrectAttemptCountDelta,
        today,
        todayNewQuestionCountDelta,
        todayNewQuestionCountDelta,
        site
      )
      .toArray()[0]
  );
}

function integerStabilityDays(metrics) {
  return Math.trunc(metrics.stabilityDays);
}

function correctRatePercent(correctAttemptCount, attemptCount) {
  return attemptCount === 0
    ? null
    : Math.round((correctAttemptCount * 100) / attemptCount);
}

function readTodayStabilityDaysDelta(storage, site, today) {
  const row = storage.sql
    .exec(
      `SELECT opening_stability_days, closing_stability_days
       FROM stability_history WHERE site = ? AND date = ?`,
      site,
      today
    )
    .toArray()[0];
  return row === undefined
    ? 0
    : row.closing_stability_days - row.opening_stability_days;
}

function dueCardsRemaining(storage, site, nowMs) {
  return storage.sql
    .exec(
      `SELECT COUNT(*) AS due_cards_remaining
       FROM cards c
       JOIN questions q ON q.site = c.site AND q.question_id = c.question_id
       WHERE c.site = ? AND c.due_ms <= ?`,
      site,
      nowMs
    )
    .toArray()[0].due_cards_remaining;
}

function celebrationFromRow(row) {
  if (row === undefined) {
    return undefined;
  }
  return {
    site: row.site,
    date: row.date,
    dailyKpiCompleted: true,
  };
}

function readCelebrationForOperation(storage, operationId) {
  return celebrationFromRow(
    storage.sql
      .exec(
        `SELECT site, date
         FROM daily_kpi_achievements
         WHERE operation_id = ?`,
        operationId
      )
      .toArray()[0]
  );
}

function hasDailyKpiAchievement(storage, site, date) {
  return (
    storage.sql
      .exec(
        `SELECT 1 AS achieved
         FROM daily_kpi_achievements
         WHERE site = ? AND date = ?`,
        site,
        date
      )
      .toArray()[0] !== undefined
  );
}

function recordCelebration(
  storage,
  site,
  date,
  operationId,
  achievedAtMs,
  wasDailyKpiCompleted,
  metrics
) {
  if (wasDailyKpiCompleted || !metrics.dailyKpiCompleted) {
    return undefined;
  }
  const row = storage.sql
    .exec(
      `INSERT INTO daily_kpi_achievements (
         site, date, operation_id, achieved_at_ms
       ) VALUES (?, ?, ?, ?)
       ON CONFLICT(site, date) DO NOTHING
       RETURNING site, date`,
      site,
      date,
      operationId,
      achievedAtMs
    )
    .toArray()[0];
  return celebrationFromRow(row);
}

function composeLearningMetrics(
  site,
  nowMs,
  storedMetrics,
  remaining,
  todayStabilityDaysDelta,
  previouslyCompleted = false
) {
  const today = getTokyoDate(new Date(nowMs));
  const isCurrentDailyMetrics = storedMetrics.dailyMetricsDate === today;
  const todayAttemptCount = isCurrentDailyMetrics
    ? storedMetrics.todayAttemptCount
    : 0;
  const todayNewQuestionCount = isCurrentDailyMetrics
    ? storedMetrics.todayNewQuestionCount
    : 0;
  const newQuestionsRemaining = Math.max(
    0,
    NEW_QUESTION_GOAL - todayNewQuestionCount
  );
  return {
    stabilityDays: integerStabilityDays(storedMetrics),
    dailyKpiCompleted:
      previouslyCompleted || (remaining === 0 && newQuestionsRemaining === 0),
    dueCardsCompleted: remaining === 0,
    dueCardsRemaining: remaining,
    todayNewQuestionCount,
    newQuestionGoal: NEW_QUESTION_GOAL,
    newQuestionsRemaining,
    todayStabilityDaysDelta,
    attemptedQuestionCount: storedMetrics.attemptedQuestionCount,
    todayAttemptedQuestionCount:
      isCurrentDailyMetrics
        ? storedMetrics.todayAttemptedQuestionCount
        : 0,
    todayCorrectRatePercent: correctRatePercent(
      isCurrentDailyMetrics ? storedMetrics.todayCorrectAttemptCount : 0,
      todayAttemptCount
    ),
  };
}

function readLearningMetrics(storage, site, nowMs, storedMetrics) {
  const today = getTokyoDate(new Date(nowMs));
  return composeLearningMetrics(
    site,
    nowMs,
    storedMetrics,
    dueCardsRemaining(storage, site, nowMs),
    readTodayStabilityDaysDelta(storage, site, today),
    hasDailyKpiAchievement(storage, site, today)
  );
}

function recordDailyMetrics(
  storage,
  site,
  date,
  openingStabilityDays,
  closingStabilityDays,
  attemptedQuestionCountDelta = 0,
  newQuestionCountDelta = 0,
  attemptCountDelta = 0,
  correctAttemptCountDelta = 0
) {
  storage.sql.exec(
    `INSERT INTO stability_history (
       site, date, opening_stability_days, closing_stability_days,
       attempted_question_count, new_question_count, attempt_count,
       correct_attempt_count
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(site, date) DO UPDATE SET
        closing_stability_days = excluded.closing_stability_days,
        attempted_question_count =
          stability_history.attempted_question_count +
          excluded.attempted_question_count,
        new_question_count =
          stability_history.new_question_count +
          excluded.new_question_count,
        attempt_count = stability_history.attempt_count + excluded.attempt_count,
        correct_attempt_count =
          stability_history.correct_attempt_count + excluded.correct_attempt_count
      WHERE stability_history.closing_stability_days <>
            excluded.closing_stability_days
         OR excluded.attempt_count > 0`,
    site,
    date,
    openingStabilityDays,
    closingStabilityDays,
    attemptedQuestionCountDelta,
    newQuestionCountDelta,
    attemptCountDelta,
    correctAttemptCountDelta
  );
}

function attemptResponse(
  row,
  metrics,
  previousStabilityDays,
  resultingStabilityDays,
  nextQuestion,
  celebration = undefined
) {
  const response = {
    attempt: {
      questionId: row.question_id,
      answerResult: row.answer_result,
      attemptedAtMs: row.attempted_at_ms,
      previousCardStabilityDays: row.previous_card_stability_days,
      resultingCardStabilityDays: row.resulting_card_stability_days,
      previousStabilityDays,
      resultingStabilityDays,
    },
    learningMetrics: metrics,
    nextQuestion: nextQuestionResponse(row.site, nextQuestion),
  };
  if (celebration !== undefined) {
    response.celebration = celebration;
  }
  return response;
}

function nextQuestionResponse(site, nextQuestion) {
  return nextQuestion.questionId === null
    ? null
    : {
        questionId: nextQuestion.questionId,
        url: `https://${site}/questions/${nextQuestion.questionId}`,
        kind: nextQuestion.kind,
        dueMs: nextQuestion.dueMs,
      };
}

function selectNextQuestionFromCatalog(storage, site, nowMs, excludeQuestionId) {
  const due = storage.sql
    .exec(
      `SELECT c.question_id, c.due_ms
       FROM cards c
       JOIN questions q ON q.site = c.site AND q.question_id = c.question_id
       WHERE c.site = ? AND c.due_ms <= ?
         AND (? IS NULL OR c.question_id <> ?)
       ORDER BY c.due_ms ASC, CAST(c.question_id AS INTEGER) ASC,
                c.question_id ASC
       LIMIT 1`,
      site,
      nowMs,
      excludeQuestionId,
      excludeQuestionId
    )
    .toArray()[0];
  if (due !== undefined) {
    return { questionId: due.question_id, kind: "review", dueMs: due.due_ms };
  }
  const unseen = storage.sql
    .exec(
      `SELECT q.question_id
       FROM questions q
       WHERE q.site = ? AND q.attempted = 0
         AND (? IS NULL OR q.question_id <> ?)
       ORDER BY q.question_number ASC, q.question_id ASC
       LIMIT 1`,
      site,
      excludeQuestionId,
      excludeQuestionId
    )
    .toArray()[0];
  if (unseen !== undefined) {
    return { questionId: unseen.question_id, kind: "new", dueMs: null };
  }
  return { questionId: null, kind: "none", dueMs: null };
}

function selectNextQuestion(storage, site, nowMs, excludeQuestionId) {
  const catalog = storage.sql
    .exec("SELECT 1 FROM catalog_metadata WHERE site = ?", site)
    .toArray()[0];
  if (catalog === undefined) {
    return { error: "catalog_missing" };
  }
  return selectNextQuestionFromCatalog(
    storage,
    site,
    nowMs,
    excludeQuestionId
  );
}

function emptyStoredLearningMetrics(today) {
  return {
    stabilityDays: 0,
    attemptedQuestionCount: 0,
    dailyMetricsDate: today,
    todayAttemptedQuestionCount: 0,
    todayAttemptCount: 0,
    todayCorrectAttemptCount: 0,
    todayNewQuestionCount: 0,
  };
}

function learningStateFromCatalog(storage, site, nowMs, catalog) {
  const today = getTokyoDate(new Date(nowMs));
  const storedMetrics =
    catalog === undefined
      ? emptyStoredLearningMetrics(today)
      : readStoredLearningMetrics(storage, site);
  return {
    site,
    today,
    learningMetrics: readLearningMetrics(
      storage,
      site,
      nowMs,
      storedMetrics
    ),
    catalog:
      catalog === undefined
        ? null
        : {
            questionCount: catalog.question_count,
            updatedAtMs: catalog.updated_at_ms,
            generation: catalog.generation,
          },
  };
}

function catalogResultWithNextQuestion(storage, site, nowMs, catalog) {
  return {
    site,
    questionCount: catalog.questionCount,
    updatedAtMs: catalog.updatedAtMs,
    generation: catalog.generation,
    question: nextQuestionResponse(
      site,
      selectNextQuestionFromCatalog(storage, site, nowMs, null)
    ),
  };
}

function assertAttempt(site, questionId, operationId, result) {
  if (
    !isSite(site) ||
    !QUESTION_ID_PATTERN.test(questionId) ||
    !OPERATION_ID_PATTERN.test(operationId) ||
    !ANSWER_RESULTS.has(result)
  ) {
    throw new TypeError("invalid attempt");
  }
}

export class LearningState extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    initializeLearningSchema(this.ctx.storage);
  }

  recordAttempt(site, questionId, operationId, answerResult, nowMs = Date.now()) {
    assertAttempt(site, questionId, operationId, answerResult);
    if (!Number.isSafeInteger(nowMs) || nowMs <= 0) {
      throw new TypeError("invalid attempt time");
    }

    return this.ctx.storage.transactionSync(() => {
      const existing = this.ctx.storage.sql
        .exec(
          `SELECT site, question_id, attempted_at_ms, answer_result,
                  previous_card_stability_days, resulting_card_stability_days
           FROM attempts WHERE operation_id = ?`,
          operationId
        )
        .toArray()[0];
      if (existing !== undefined) {
        if (
          existing.site !== site ||
          existing.question_id !== questionId ||
          existing.answer_result !== answerResult
        ) {
          return { error: "operation_conflict" };
        }
        const storedMetrics = readStoredLearningMetrics(this.ctx.storage, site);
        const stabilityDays = integerStabilityDays(storedMetrics);
        return attemptResponse(
          existing,
          readLearningMetrics(this.ctx.storage, site, nowMs, storedMetrics),
          stabilityDays,
          stabilityDays,
          selectNextQuestion(this.ctx.storage, site, nowMs, questionId),
          readCelebrationForOperation(this.ctx.storage, operationId)
        );
      }

      const catalogQuestion = this.ctx.storage.sql
        .exec(
          `SELECT question_id, attempted FROM questions
           WHERE site = ? AND question_id = ?`,
          site,
          questionId
        )
        .toArray()[0];
      if (catalogQuestion === undefined) {
        return { error: "unknown_question" };
      }

      const stored = this.ctx.storage.sql
        .exec(
          `SELECT due_ms, stability, difficulty, scheduled_days, learning_steps,
                  reps, lapses, state, last_review_ms, last_attempt_date
           FROM cards WHERE site = ? AND question_id = ?`,
          site,
          questionId
        )
        .toArray()[0];
      const card = rowToCard(stored) ?? createNewCard(nowMs);
      const previousCardStabilityDays = card.stability;
      const schedulingApplied = stored === undefined || stored.due_ms <= nowMs;
      const nextCard = schedulingApplied
        ? scheduleAnswer(card, answerResult, nowMs)
        : card;
      const today = getTokyoDate(new Date(nowMs));
      const todayAttemptedQuestionCountDelta =
        stored?.last_attempt_date === today ? 0 : 1;
      const storedMetricsBefore = readStoredLearningMetrics(this.ctx.storage, site);
      const stabilityDaysBefore = integerStabilityDays(storedMetricsBefore);
      const remainingBefore = dueCardsRemaining(this.ctx.storage, site, nowMs);
      const previousTodayStabilityDaysDelta = readTodayStabilityDaysDelta(
        this.ctx.storage,
        site,
        today
      );
      const previouslyCompleted = hasDailyKpiAchievement(
        this.ctx.storage,
        site,
        today
      );
      const wasDailyKpiCompleted = composeLearningMetrics(
        site,
        nowMs,
        storedMetricsBefore,
        remainingBefore,
        previousTodayStabilityDaysDelta,
        previouslyCompleted
      ).dailyKpiCompleted;
      if (schedulingApplied) {
        saveCard(this.ctx.storage, site, questionId, nextCard, today);
      } else if (stored.last_attempt_date !== today) {
        this.ctx.storage.sql.exec(
          `UPDATE cards SET last_attempt_date = ?
           WHERE site = ? AND question_id = ?`,
          today,
          site,
          questionId
        );
      }
      const attemptedQuestionCountDelta = catalogQuestion.attempted === 0 ? 1 : 0;
      if (attemptedQuestionCountDelta === 1) {
        this.ctx.storage.sql.exec(
          `UPDATE questions SET attempted = 1
           WHERE site = ? AND question_id = ?`,
          site,
          questionId
        );
      }
      const storedMetricsAfter = updateStoredLearningMetrics(
        this.ctx.storage,
        site,
        previousCardStabilityDays,
        nextCard.stability,
        attemptedQuestionCountDelta,
        today,
        todayAttemptedQuestionCountDelta,
        answerResult === "correct" ? 1 : 0,
        attemptedQuestionCountDelta
      );
      const stabilityDaysAfter = integerStabilityDays(storedMetricsAfter);
      recordDailyMetrics(
        this.ctx.storage,
        site,
        today,
        stabilityDaysBefore,
        stabilityDaysAfter,
        todayAttemptedQuestionCountDelta,
        attemptedQuestionCountDelta,
        1,
        answerResult === "correct" ? 1 : 0
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO attempts (
           site, operation_id, question_id, attempted_at_ms, answer_result,
           previous_card_stability_days, resulting_card_stability_days
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        site,
        operationId,
        questionId,
        nowMs,
        answerResult,
        previousCardStabilityDays,
        nextCard.stability
      );
      const wasDueBefore = stored !== undefined && stored.due_ms <= nowMs;
      const isDueAfter = nextCard.due.getTime() <= nowMs;
      const remainingAfter =
        remainingBefore - Number(wasDueBefore) + Number(isDueAfter);
      const metrics = composeLearningMetrics(
        site,
        nowMs,
        storedMetricsAfter,
        remainingAfter,
        previousTodayStabilityDaysDelta +
          stabilityDaysAfter -
          stabilityDaysBefore,
        previouslyCompleted
      );
      const celebration = recordCelebration(
        this.ctx.storage,
        site,
        today,
        operationId,
        nowMs,
        wasDailyKpiCompleted,
        metrics
      );
      return attemptResponse(
        {
          site,
          question_id: questionId,
          attempted_at_ms: nowMs,
          answer_result: answerResult,
          previous_card_stability_days: previousCardStabilityDays,
          resulting_card_stability_days: nextCard.stability,
        },
        metrics,
        stabilityDaysBefore,
        stabilityDaysAfter,
        selectNextQuestionFromCatalog(
          this.ctx.storage,
          site,
          nowMs,
          questionId
        ),
        celebration
      );
    });
  }

  getState(site, nowMs = Date.now()) {
    if (!isSite(site) || !Number.isSafeInteger(nowMs)) {
      throw new TypeError("invalid state request");
    }
    return this.ctx.storage.transactionSync(() => {
      const catalog = this.ctx.storage.sql
        .exec(
          "SELECT question_count, updated_at_ms, generation FROM catalog_metadata WHERE site = ?",
          site
        )
        .toArray()[0];
      return learningStateFromCatalog(this.ctx.storage, site, nowMs, catalog);
    });
  }

  getHistory(site, days = 7, nowMs = Date.now()) {
    if (!isSite(site) || !Number.isSafeInteger(days) || days < 1 || days > 31) {
      throw new TypeError("invalid history request");
    }
    return this.ctx.storage.transactionSync(() => {
      const today = getTokyoDate(new Date(nowMs));
      const dates = recentTokyoDates(today, days);
      const baseline = this.ctx.storage.sql
        .exec(
          `SELECT closing_stability_days FROM stability_history
           WHERE site = ? AND date < ? ORDER BY date DESC LIMIT 1`,
          site,
          dates[0]
        )
        .toArray()[0];
      const rows = new Map(
        this.ctx.storage.sql
          .exec(
            `SELECT date, opening_stability_days, closing_stability_days,
                    attempted_question_count, new_question_count,
                    attempt_count, correct_attempt_count
             FROM stability_history
             WHERE site = ? AND date >= ? AND date <= ? ORDER BY date`,
            site,
            dates[0],
            dates.at(-1)
          )
          .toArray()
          .map((row) => [row.date, row])
      );
      let closingStabilityDays = baseline?.closing_stability_days ?? null;
      let trackingStarted = baseline !== undefined;
      const history = dates.map((date) => {
        const row = rows.get(date);
        let stabilityDaysDelta = trackingStarted ? 0 : null;
        if (row !== undefined) {
          closingStabilityDays = row.closing_stability_days;
          stabilityDaysDelta =
            row.closing_stability_days - row.opening_stability_days;
          trackingStarted = true;
        }
        return {
          date,
          closingStabilityDays,
          stabilityDaysDelta,
          dailyAttemptedQuestionCount: row?.attempted_question_count ?? 0,
          dailyNewQuestionCount: row?.new_question_count ?? 0,
          dailyCorrectRatePercent: correctRatePercent(
            row?.correct_attempt_count ?? 0,
            row?.attempt_count ?? 0
          ),
        };
      });
      return { site, timeZone: "Asia/Tokyo", today, days: history };
    });
  }

  getDailyDetails(site, date) {
    if (!isSite(site) || dateOrdinal(date) === null) {
      throw new TypeError("invalid daily details request");
    }
    return this.ctx.storage.transactionSync(() => {
      const { startMs, endMs } = tokyoDateRangeMs(date);
      const stabilityHistory = this.ctx.storage.sql
        .exec(
          `SELECT site, date, opening_stability_days, closing_stability_days,
                  attempted_question_count, new_question_count, attempt_count,
                  correct_attempt_count
           FROM stability_history WHERE site = ? AND date = ?`,
          site,
          date
        )
        .toArray();
      const attempts = this.ctx.storage.sql
        .exec(
          `SELECT site, operation_id, question_id, attempted_at_ms, answer_result,
                  previous_card_stability_days, resulting_card_stability_days
           FROM attempts
           WHERE site = ? AND attempted_at_ms >= ? AND attempted_at_ms < ?
           ORDER BY attempted_at_ms, operation_id`,
          site,
          startMs,
          endMs
        )
        .toArray();
      return {
        site,
        date,
        timeZone: "Asia/Tokyo",
        tables: { stability_history: stabilityHistory, attempts },
      };
    });
  }

  nextQuestion(site, nowMs = Date.now(), excludeQuestionId = null) {
    if (
      !isSite(site) ||
      !Number.isSafeInteger(nowMs) ||
      (excludeQuestionId !== null &&
        (typeof excludeQuestionId !== "string" || !QUESTION_ID_PATTERN.test(excludeQuestionId)))
    ) {
      throw new TypeError("invalid next request");
    }
    return selectNextQuestion(
      this.ctx.storage,
      site,
      nowMs,
      excludeQuestionId
    );
  }

  getNextState(site, nowMs = Date.now(), excludeQuestionId = null) {
    if (
      !isSite(site) ||
      !Number.isSafeInteger(nowMs) ||
      (excludeQuestionId !== null &&
        (typeof excludeQuestionId !== "string" || !QUESTION_ID_PATTERN.test(excludeQuestionId)))
    ) {
      throw new TypeError("invalid next state request");
    }
    return this.ctx.storage.transactionSync(() => {
      const catalog = this.ctx.storage.sql
        .exec(
          "SELECT question_count, updated_at_ms, generation FROM catalog_metadata WHERE site = ?",
          site
        )
        .toArray()[0];
      if (catalog === undefined) {
        return { error: "catalog_missing" };
      }
      return {
        state: learningStateFromCatalog(this.ctx.storage, site, nowMs, catalog),
        question: nextQuestionResponse(
          site,
          selectNextQuestionFromCatalog(
            this.ctx.storage,
            site,
            nowMs,
            excludeQuestionId
          )
        ),
      };
    });
  }

  replaceCatalog(site, questionIds, expectedGeneration, nowMs = Date.now()) {
    if (
      !isSite(site) ||
      !Array.isArray(questionIds) ||
      questionIds.length === 0 ||
      questionIds.length > 10000 ||
      questionIds.some((id) => typeof id !== "string" || !QUESTION_ID_PATTERN.test(id)) ||
      new Set(questionIds).size !== questionIds.length ||
      !Number.isSafeInteger(expectedGeneration) ||
      expectedGeneration < 0 ||
      !Number.isSafeInteger(nowMs)
    ) {
      throw new TypeError("invalid question catalog");
    }
    return this.ctx.storage.transactionSync(() => {
      const today = getTokyoDate(new Date(nowMs));
      const canonicalIds = canonicalQuestionIds(questionIds);
      const questionIdsJSON = JSON.stringify(canonicalIds);
      const metadata = this.ctx.storage.sql
        .exec(
          `SELECT question_count, updated_at_ms, generation, question_ids_json
           FROM catalog_metadata WHERE site = ?`,
          site
        )
        .toArray()[0];
      const currentGeneration = metadata?.generation ?? 0;
      if (currentGeneration !== expectedGeneration) {
        return {
          error: "catalog_conflict",
          currentGeneration,
          catalog:
            metadata === undefined
              ? null
              : {
                  site,
                  questionCount: metadata.question_count,
                  updatedAtMs: metadata.updated_at_ms,
                  generation: metadata.generation,
                },
          question:
            metadata === undefined
              ? null
              : nextQuestionResponse(
                  site,
                  selectNextQuestionFromCatalog(
                    this.ctx.storage,
                    site,
                    nowMs,
                    null
                  )
                ),
        };
      }
      if (metadata?.question_ids_json === questionIdsJSON) {
        this.ctx.storage.sql.exec(
          "UPDATE catalog_metadata SET updated_at_ms = ? WHERE site = ?",
          nowMs,
          site
        );
        return catalogResultWithNextQuestion(this.ctx.storage, site, nowMs, {
          questionCount: metadata.question_count,
          updatedAtMs: nowMs,
          generation: currentGeneration,
        });
      }
      const storedMetricsBefore =
        metadata === undefined
          ? {
              stabilityDays: 0,
              attemptedQuestionCount: 0,
              dailyMetricsDate: today,
              todayAttemptedQuestionCount: 0,
              todayAttemptCount: 0,
              todayCorrectAttemptCount: 0,
              todayNewQuestionCount: 0,
            }
          : readStoredLearningMetrics(this.ctx.storage, site);
      const stabilityDaysBefore = integerStabilityDays(storedMetricsBefore);
      const deleteCursor = this.ctx.storage.sql.exec(
        `DELETE FROM questions
         WHERE site = ?
           AND question_id NOT IN (
             SELECT CAST(value AS TEXT) FROM json_each(?)
           )`,
        site,
        questionIdsJSON
      );
      const insertCursor = this.ctx.storage.sql.exec(
        `INSERT OR IGNORE INTO questions (
           site, question_id, question_number, attempted
         )
         SELECT ?, CAST(incoming.value AS TEXT),
                CAST(incoming.value AS INTEGER),
                CASE WHEN EXISTS (
                  SELECT 1 FROM cards
                  WHERE cards.site = ?
                    AND cards.question_id = CAST(incoming.value AS TEXT)
                ) THEN 1 ELSE 0 END
         FROM json_each(?) incoming`,
        site,
        site,
        questionIdsJSON
      );
      const catalogChanged =
        deleteCursor.rowsWritten + insertCursor.rowsWritten > 0;
      if (!catalogChanged) {
        this.ctx.storage.sql.exec(
          `UPDATE catalog_metadata
           SET updated_at_ms = ?, question_ids_json = ?
           WHERE site = ?`,
          nowMs,
          questionIdsJSON,
          site
        );
        return catalogResultWithNextQuestion(this.ctx.storage, site, nowMs, {
          questionCount: metadata.question_count,
          updatedAtMs: nowMs,
          generation: currentGeneration,
        });
      }
      const generation = currentGeneration + 1;
      this.ctx.storage.sql.exec(
        `INSERT INTO catalog_metadata (
           site, question_count, updated_at_ms, generation, question_ids_json
         )
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(site) DO UPDATE SET
           question_count = excluded.question_count,
           updated_at_ms = excluded.updated_at_ms,
           generation = excluded.generation,
           question_ids_json = excluded.question_ids_json`,
        site,
        canonicalIds.length,
        nowMs,
        generation,
        questionIdsJSON
      );
      const storedMetricsAfter = replaceStoredLearningMetrics(
        this.ctx.storage,
        site,
        {
          stabilityDays: calculateCurrentCatalogStabilityDays(
            this.ctx.storage,
            site
          ),
          attemptedQuestionCount: storedMetricsBefore.attemptedQuestionCount,
        },
        today
      );
      const stabilityDaysAfter = integerStabilityDays(storedMetricsAfter);
      recordDailyMetrics(
        this.ctx.storage,
        site,
        today,
        stabilityDaysBefore,
        stabilityDaysAfter
      );
      return catalogResultWithNextQuestion(this.ctx.storage, site, nowMs, {
        questionCount: canonicalIds.length,
        updatedAtMs: nowMs,
        generation,
      });
    });
  }

  listSites() {
    return this.ctx.storage.sql
      .exec("SELECT site FROM catalog_metadata ORDER BY site")
      .toArray()
      .map((row) => row.site);
  }

  getDashboard(requestedSite = null, nowMs = Date.now()) {
    if (
      (requestedSite !== null && !isSite(requestedSite)) ||
      !Number.isSafeInteger(nowMs)
    ) {
      throw new TypeError("invalid dashboard request");
    }
    const sites = this.listSites();
    const selectedSite = sites.includes(requestedSite)
      ? requestedSite
      : sites[0] ?? null;
    if (selectedSite === null) {
      return {
        sites,
        selectedSite: null,
        state: null,
        history: null,
      };
    }
    return {
      sites,
      selectedSite,
      state: this.getState(selectedSite, nowMs),
      history: this.getHistory(selectedSite, 31, nowMs),
    };
  }
}

export function getLearningStateStub(env) {
  const id = env.LEARNING_STATE.idFromName(LEARNING_STATE_OBJECT_NAME);
  return env.LEARNING_STATE.get(id);
}
