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
  OPERATION_ID_PATTERN,
  QUESTION_ID_PATTERN,
} from "./contracts.js";
import { initializeLearningSchema } from "./storage/schema.js";

export { initializeLearningSchema } from "./storage/schema.js";

export const LEARNING_STATE_OBJECT_NAME = "primary";
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

function saveCard(storage, site, questionId, card) {
  storage.sql.exec(
    `INSERT INTO cards (
       site, question_id, due_ms, stability, difficulty, scheduled_days,
       learning_steps, reps, lapses, state, last_review_ms
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(site, question_id) DO UPDATE SET
       due_ms = excluded.due_ms,
       stability = excluded.stability,
       difficulty = excluded.difficulty,
       scheduled_days = excluded.scheduled_days,
       learning_steps = excluded.learning_steps,
       reps = excluded.reps,
       lapses = excluded.lapses,
       state = excluded.state,
       last_review_ms = excluded.last_review_ms`,
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
    card.last_review?.getTime() ?? null
  );
}

function storedLearningMetricsFromRow(row) {
  if (row === undefined) {
    throw new Error("missing LearningState learning metrics");
  }
  return {
    stabilityDays: row.stability_days,
    attemptedQuestionCount: row.attempted_question_count,
    attemptedQuestionCountDate: row.attempted_question_count_date,
    todayAttemptedQuestionCount: row.today_attempted_question_count,
  };
}

function readStoredLearningMetrics(storage, site) {
  return storedLearningMetricsFromRow(
    storage.sql
      .exec(
        `SELECT stability_days, attempted_question_count,
                attempted_question_count_date, today_attempted_question_count
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
           attempted_question_count_date, today_attempted_question_count
         ) VALUES (?, ?, ?, ?, 0)
         ON CONFLICT(site) DO UPDATE SET
           stability_days = excluded.stability_days,
           attempted_question_count = excluded.attempted_question_count
         RETURNING stability_days, attempted_question_count,
                   attempted_question_count_date, today_attempted_question_count`,
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
  todayAttemptedQuestionCountDelta
) {
  return storedLearningMetricsFromRow(
    storage.sql
      .exec(
        `UPDATE learning_metrics
         SET stability_days = stability_days - ? + ?,
             attempted_question_count = attempted_question_count + ?,
             attempted_question_count_date = ?,
             today_attempted_question_count =
               CASE WHEN attempted_question_count_date = ?
                    THEN today_attempted_question_count + ?
                    ELSE ? END
         WHERE site = ?
         RETURNING stability_days, attempted_question_count,
                   attempted_question_count_date, today_attempted_question_count`,
        previousCardStabilityDays,
        resultingCardStabilityDays,
        attemptedQuestionCountDelta,
        today,
        today,
        todayAttemptedQuestionCountDelta,
        todayAttemptedQuestionCountDelta,
        site
      )
      .toArray()[0]
  );
}

function integerStabilityDays(metrics) {
  return Math.trunc(metrics.stabilityDays);
}

function readAttemptedQuestionCountsByDate(storage, site, dates) {
  const { startMs, endMs } = tokyoDateRangeMs(dates[0], dates.at(-1));
  const attemptedQuestionCounts = new Map(
    storage.sql
      .exec(
        `SELECT CAST((attempted_at_ms + 32400000) / 86400000 AS INTEGER) AS date_ordinal,
                COUNT(DISTINCT question_id) AS attempted_question_count
         FROM attempts
         WHERE site = ? AND attempted_at_ms >= ? AND attempted_at_ms < ?
         GROUP BY date_ordinal`,
        site,
        startMs,
        endMs
      )
      .toArray()
      .map((row) => [row.date_ordinal, row.attempted_question_count])
  );
  return new Map(
    dates.map((date) => [
      date,
      attemptedQuestionCounts.get(dateOrdinal(date)) ?? 0,
    ])
  );
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

function dueCardsCompleted(storage, site, nowMs) {
  return storage.sql
    .exec(
      `SELECT 1 AS found
       FROM cards c
       JOIN questions q ON q.site = c.site AND q.question_id = c.question_id
       WHERE c.site = ? AND c.due_ms <= ?
       LIMIT 1`,
      site,
      nowMs
    )
    .toArray()[0] === undefined;
}

function celebrationFromRow(row) {
  if (row === undefined) {
    return undefined;
  }
  return {
    site: row.site,
    date: row.date,
    dueCardsCompleted: true,
  };
}

function readCelebrationForOperation(storage, operationId) {
  return celebrationFromRow(
    storage.sql
      .exec(
        `SELECT site, date
         FROM daily_due_card_achievements
         WHERE operation_id = ?`,
        operationId
      )
      .toArray()[0]
  );
}

function recordCelebration(
  storage,
  site,
  date,
  operationId,
  achievedAtMs,
  metrics,
  wasDueCard
) {
  if (!wasDueCard || !metrics.dueCardsCompleted) {
    return undefined;
  }
  const row = storage.sql
    .exec(
      `INSERT INTO daily_due_card_achievements (
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

function learningMetrics(
  storage,
  site,
  nowMs,
  storedMetrics,
  todayStabilityDaysDelta = undefined
) {
  const today = getTokyoDate(new Date(nowMs));
  return {
    stabilityDays: integerStabilityDays(storedMetrics),
    dueCardsCompleted: dueCardsCompleted(storage, site, nowMs),
    todayStabilityDaysDelta:
      todayStabilityDaysDelta === undefined
        ? readTodayStabilityDaysDelta(storage, site, today)
        : todayStabilityDaysDelta,
    attemptedQuestionCount: storedMetrics.attemptedQuestionCount,
    todayAttemptedQuestionCount:
      storedMetrics.attemptedQuestionCountDate === today
        ? storedMetrics.todayAttemptedQuestionCount
        : 0,
  };
}

function recordDailyStabilityDays(
  storage,
  site,
  date,
  openingStabilityDays,
  closingStabilityDays
) {
  storage.sql.exec(
    `INSERT INTO stability_history (
       site, date, opening_stability_days, closing_stability_days
     ) VALUES (?, ?, ?, ?)
      ON CONFLICT(site, date) DO UPDATE SET
        closing_stability_days = excluded.closing_stability_days
      WHERE stability_history.closing_stability_days <>
            excluded.closing_stability_days`,
    site,
    date,
    openingStabilityDays,
    closingStabilityDays
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
    nextQuestion:
      nextQuestion.questionId === null
        ? null
        : {
            questionId: nextQuestion.questionId,
            url: `https://${row.site}/questions/${nextQuestion.questionId}`,
            kind: nextQuestion.kind,
            dueMs: nextQuestion.dueMs,
          },
  };
  if (celebration !== undefined) {
    response.celebration = celebration;
  }
  return response;
}

function selectNextQuestion(storage, site, nowMs, excludeQuestionId) {
  const catalog = storage.sql
    .exec("SELECT question_count FROM catalog_metadata WHERE site = ?", site)
    .toArray()[0];
  if (catalog === undefined) {
    return { error: "catalog_missing" };
  }
  const due = storage.sql
    .exec(
      `SELECT c.question_id, c.due_ms
       FROM cards c
       JOIN questions q ON q.site = c.site AND q.question_id = c.question_id
       WHERE c.site = ? AND c.due_ms <= ?
         AND (? IS NULL OR c.question_id <> ?)
       ORDER BY c.due_ms ASC, CAST(c.question_id AS INTEGER) ASC, c.question_id ASC
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
       LEFT JOIN cards c ON c.site = q.site AND c.question_id = q.question_id
       WHERE q.site = ? AND c.question_id IS NULL
         AND (? IS NULL OR q.question_id <> ?)
       ORDER BY CAST(q.question_id AS INTEGER) ASC, q.question_id ASC
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
          learningMetrics(this.ctx.storage, site, nowMs, storedMetrics),
          stabilityDays,
          stabilityDays,
          selectNextQuestion(this.ctx.storage, site, nowMs, questionId),
          readCelebrationForOperation(this.ctx.storage, operationId)
        );
      }

      const catalogQuestion = this.ctx.storage.sql
        .exec(
          "SELECT question_id FROM questions WHERE site = ? AND question_id = ?",
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
                  reps, lapses, state, last_review_ms
           FROM cards WHERE site = ? AND question_id = ?`,
          site,
          questionId
        )
        .toArray()[0];
      const card = rowToCard(stored) ?? createNewCard(nowMs);
      const previousCardStabilityDays = card.stability;
      const wasDueCard = stored !== undefined && stored.due_ms <= nowMs;
      const schedulingApplied = stored === undefined || stored.due_ms <= nowMs;
      const nextCard = schedulingApplied
        ? scheduleAnswer(card, answerResult, nowMs)
        : card;
      const today = getTokyoDate(new Date(nowMs));
      const { startMs, endMs } = tokyoDateRangeMs(today);
      const attemptedToday = this.ctx.storage.sql
        .exec(
          `SELECT 1 AS found
           FROM attempts
           WHERE site = ? AND question_id = ?
             AND attempted_at_ms >= ? AND attempted_at_ms < ?
           LIMIT 1`,
          site,
          questionId,
          startMs,
          endMs
        )
        .toArray()[0];
      const todayAttemptedQuestionCountDelta = attemptedToday === undefined ? 1 : 0;
      const storedMetricsBefore = readStoredLearningMetrics(this.ctx.storage, site);
      const stabilityDaysBefore = integerStabilityDays(storedMetricsBefore);
      if (schedulingApplied) {
        saveCard(this.ctx.storage, site, questionId, nextCard);
      }
      const attemptedQuestionCountDelta = stored === undefined ? 1 : 0;
      const metricsChanged =
        previousCardStabilityDays !== nextCard.stability ||
        attemptedQuestionCountDelta !== 0 ||
        todayAttemptedQuestionCountDelta !== 0 ||
        storedMetricsBefore.attemptedQuestionCountDate !== today;
      const storedMetricsAfter = metricsChanged
        ? updateStoredLearningMetrics(
            this.ctx.storage,
            site,
            previousCardStabilityDays,
            nextCard.stability,
            attemptedQuestionCountDelta,
            today,
            todayAttemptedQuestionCountDelta
          )
        : storedMetricsBefore;
      const stabilityDaysAfter = integerStabilityDays(storedMetricsAfter);
      const previousTodayStabilityDaysDelta = readTodayStabilityDaysDelta(
        this.ctx.storage,
        site,
        today
      );
      recordDailyStabilityDays(
        this.ctx.storage,
        site,
        today,
        stabilityDaysBefore,
        stabilityDaysAfter
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
      const metrics = learningMetrics(
        this.ctx.storage,
        site,
        nowMs,
        storedMetricsAfter,
        previousTodayStabilityDaysDelta +
          stabilityDaysAfter -
          stabilityDaysBefore
      );
      const celebration = recordCelebration(
        this.ctx.storage,
        site,
        today,
        operationId,
        nowMs,
        metrics,
        wasDueCard
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
        selectNextQuestion(this.ctx.storage, site, nowMs, questionId),
        celebration
      );
    });
  }

  getState(site, nowMs = Date.now()) {
    if (!isSite(site) || !Number.isSafeInteger(nowMs)) {
      throw new TypeError("invalid state request");
    }
    return this.ctx.storage.transactionSync(() => {
      const today = getTokyoDate(new Date(nowMs));
      const catalog = this.ctx.storage.sql
        .exec(
          "SELECT question_count, updated_at_ms, generation FROM catalog_metadata WHERE site = ?",
          site
        )
        .toArray()[0];
      const storedMetrics =
        catalog === undefined
          ? {
              stabilityDays: 0,
              attemptedQuestionCount: 0,
              attemptedQuestionCountDate: today,
              todayAttemptedQuestionCount: 0,
            }
          : readStoredLearningMetrics(this.ctx.storage, site);
      return {
        site,
        today,
        learningMetrics: learningMetrics(
          this.ctx.storage,
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
    });
  }

  getHistory(site, days = 7, nowMs = Date.now()) {
    if (!isSite(site) || !Number.isSafeInteger(days) || days < 1 || days > 31) {
      throw new TypeError("invalid history request");
    }
    return this.ctx.storage.transactionSync(() => {
      const today = getTokyoDate(new Date(nowMs));
      const dates = recentTokyoDates(today, days);
      const attemptedQuestionCountsByDate = readAttemptedQuestionCountsByDate(
        this.ctx.storage,
        site,
        dates
      );
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
            `SELECT date, opening_stability_days, closing_stability_days
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
          dailyAttemptedQuestionCount: attemptedQuestionCountsByDate.get(date),
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
          `SELECT site, date, opening_stability_days, closing_stability_days
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
      const metadata = this.ctx.storage.sql
        .exec(
          "SELECT question_count, generation FROM catalog_metadata WHERE site = ?",
          site
        )
        .toArray()[0];
      const currentGeneration = metadata?.generation ?? 0;
      if (currentGeneration !== expectedGeneration) {
        return { error: "catalog_conflict", currentGeneration };
      }
      const currentQuestionIds = new Set(
        this.ctx.storage.sql
          .exec("SELECT question_id FROM questions WHERE site = ?", site)
          .toArray()
          .map((row) => row.question_id)
      );
      const incomingQuestionIds = new Set(questionIds);
      const removedQuestionIds = [...currentQuestionIds].filter(
        (questionId) => !incomingQuestionIds.has(questionId)
      );
      const addedQuestionIds = questionIds.filter(
        (questionId) => !currentQuestionIds.has(questionId)
      );
      if (
        metadata !== undefined &&
        removedQuestionIds.length === 0 &&
        addedQuestionIds.length === 0
      ) {
        this.ctx.storage.sql.exec(
          "UPDATE catalog_metadata SET updated_at_ms = ? WHERE site = ?",
          nowMs,
          site
        );
        return {
          site,
          questionCount: metadata.question_count,
          updatedAtMs: nowMs,
          generation: currentGeneration,
        };
      }
      const storedMetricsBefore =
        metadata === undefined
          ? {
              stabilityDays: 0,
              attemptedQuestionCount: 0,
              attemptedQuestionCountDate: today,
              todayAttemptedQuestionCount: 0,
            }
          : readStoredLearningMetrics(this.ctx.storage, site);
      const stabilityDaysBefore = integerStabilityDays(storedMetricsBefore);
      const generation = currentGeneration + 1;
      for (const questionId of removedQuestionIds) {
        this.ctx.storage.sql.exec(
          "DELETE FROM questions WHERE site = ? AND question_id = ?",
          site,
          questionId
        );
      }
      for (const questionId of addedQuestionIds) {
        this.ctx.storage.sql.exec(
          "INSERT INTO questions (site, question_id) VALUES (?, ?)",
          site,
          questionId
        );
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO catalog_metadata (site, question_count, updated_at_ms, generation)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(site) DO UPDATE SET
           question_count = excluded.question_count,
           updated_at_ms = excluded.updated_at_ms,
           generation = excluded.generation`,
        site,
        questionIds.length,
        nowMs,
        generation
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
      recordDailyStabilityDays(
        this.ctx.storage,
        site,
        today,
        stabilityDaysBefore,
        stabilityDaysAfter
      );
      return {
        site,
        questionCount: questionIds.length,
        updatedAtMs: nowMs,
        generation,
      };
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
