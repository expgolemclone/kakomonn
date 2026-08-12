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
export const DEFAULT_DAILY_STABILITY_DAYS_GOAL = 30;
export { OPERATION_ID_PATTERN, QUESTION_ID_PATTERN } from "./contracts.js";
const LEGACY_SETTINGS_STORAGE_KEY = "settings";

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

function readStabilityDays(storage, site) {
  return storage.sql
    .exec(
      `SELECT CAST(COALESCE(SUM(c.stability), 0) AS INTEGER) AS stability_days
       FROM questions q
       LEFT JOIN cards c ON c.site = q.site AND c.question_id = q.question_id
       WHERE q.site = ?`,
      site
    )
    .toArray()[0].stability_days;
}

function readAttemptedQuestionCount(storage, site) {
  return storage.sql
    .exec(
      `SELECT COUNT(DISTINCT question_id) AS attempted_question_count
       FROM attempts WHERE site = ?`,
      site
    )
    .toArray()[0].attempted_question_count;
}

function readAttemptedQuestionCountsByDate(storage, site, dates) {
  const { startMs, endMs } = tokyoDateRangeMs(dates[0], dates.at(-1));
  const attemptedQuestionCounts = new Map(
    storage.sql
      .exec(
        `SELECT CAST((answered_at_ms + 32400000) / 86400000 AS INTEGER) AS date_ordinal,
                COUNT(DISTINCT question_id) AS attempted_question_count
         FROM attempts
         WHERE site = ? AND answered_at_ms >= ? AND answered_at_ms < ?
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

function learningTotals(storage, site, nowMs) {
  const today = getTokyoDate(new Date(nowMs));
  return {
    stabilityDays: readStabilityDays(storage, site),
    attemptedQuestionCount: readAttemptedQuestionCount(storage, site),
    todayAttemptedQuestionCount: readAttemptedQuestionCountsByDate(
      storage,
      site,
      [today]
    ).get(today),
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
       closing_stability_days = excluded.closing_stability_days`,
    site,
    date,
    openingStabilityDays,
    closingStabilityDays
  );
}

function attemptResponse(row, totals) {
  return {
    attempt: {
      questionId: row.question_id,
      result: row.result,
      previousStability: row.previous_stability,
      resultingStability: row.resulting_stability,
    },
    totals,
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
    this.ctx.blockConcurrencyWhile(async () => {
      initializeLearningSchema(this.ctx.storage);
      await this.ctx.storage.delete(LEGACY_SETTINGS_STORAGE_KEY);
    });
  }

  recordAttempt(site, questionId, operationId, result, nowMs = Date.now()) {
    assertAttempt(site, questionId, operationId, result);
    if (!Number.isSafeInteger(nowMs) || nowMs <= 0) {
      throw new TypeError("invalid attempt time");
    }

    return this.ctx.storage.transactionSync(() => {
      const existing = this.ctx.storage.sql
        .exec(
          `SELECT site, question_id, result, previous_stability, resulting_stability
           FROM attempts WHERE operation_id = ?`,
          operationId
        )
        .toArray()[0];
      if (existing !== undefined) {
        if (
          existing.site !== site ||
          existing.question_id !== questionId ||
          existing.result !== result
        ) {
          return { error: "operation_conflict" };
        }
        return attemptResponse(
          existing,
          learningTotals(this.ctx.storage, site, nowMs)
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
      const previousStability = card.stability;
      const nextCard = scheduleAnswer(card, result, nowMs);
      const stabilityDaysBefore = readStabilityDays(this.ctx.storage, site);
      saveCard(this.ctx.storage, site, questionId, nextCard);
      const stabilityDaysAfter = readStabilityDays(this.ctx.storage, site);
      const today = getTokyoDate(new Date(nowMs));
      recordDailyStabilityDays(
        this.ctx.storage,
        site,
        today,
        stabilityDaysBefore,
        stabilityDaysAfter
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO attempts (
           site, operation_id, question_id, answered_at_ms, result,
           previous_stability, resulting_stability
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        site,
        operationId,
        questionId,
        nowMs,
        result,
        previousStability,
        nextCard.stability
      );
      return attemptResponse(
        {
          question_id: questionId,
          result,
          previous_stability: previousStability,
          resulting_stability: nextCard.stability,
        },
        learningTotals(this.ctx.storage, site, nowMs)
      );
    });
  }

  getState(site, nowMs = Date.now()) {
    if (!isSite(site) || !Number.isSafeInteger(nowMs)) {
      throw new TypeError("invalid state request");
    }
    return this.ctx.storage.transactionSync(() => {
      const today = getTokyoDate(new Date(nowMs));
      const stabilityDays = readStabilityDays(this.ctx.storage, site);
      const attemptedQuestionCount = readAttemptedQuestionCount(
        this.ctx.storage,
        site
      );
      const todayAttemptedQuestionCount = readAttemptedQuestionCountsByDate(
        this.ctx.storage,
        site,
        [today]
      ).get(today);
      const todayRow = this.ctx.storage.sql
        .exec(
          `SELECT opening_stability_days, closing_stability_days
           FROM stability_history WHERE site = ? AND date = ?`,
          site,
          today
        )
        .toArray()[0];
      const todayStabilityDaysDelta =
        todayRow === undefined
          ? 0
          : todayRow.closing_stability_days - todayRow.opening_stability_days;
      const catalog = this.ctx.storage.sql
        .exec(
          "SELECT question_count, updated_at_ms, generation FROM catalog_metadata WHERE site = ?",
          site
        )
        .toArray()[0];
      return {
        site,
        today,
        stabilityDays,
        attemptedQuestionCount,
        todayAttemptedQuestionCount,
        todayStabilityDaysDelta,
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
      let stabilityDays = baseline?.closing_stability_days ?? null;
      let trackingStarted = baseline !== undefined;
      const history = dates.map((date) => {
        const row = rows.get(date);
        let stabilityDaysDelta = trackingStarted ? 0 : null;
        if (row !== undefined) {
          stabilityDays = row.closing_stability_days;
          stabilityDaysDelta =
            row.closing_stability_days - row.opening_stability_days;
          trackingStarted = true;
        }
        return {
          date,
          stabilityDays,
          stabilityDaysDelta,
          attemptedQuestionCount: attemptedQuestionCountsByDate.get(date),
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
          `SELECT site, operation_id, question_id, answered_at_ms, result,
                  previous_stability, resulting_stability
           FROM attempts
           WHERE site = ? AND answered_at_ms >= ? AND answered_at_ms < ?
           ORDER BY answered_at_ms, operation_id`,
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

  getSettings(site) {
    if (!isSite(site)) {
      throw new TypeError("invalid settings site");
    }
    const row = this.ctx.storage.sql
      .exec(
        `SELECT daily_stability_days_goal FROM site_settings WHERE site = ?`,
        site
      )
      .toArray()[0];
    if (row === undefined) {
      throw new Error("missing StabilityState settings");
    }
    return { site, dailyStabilityDaysGoal: row.daily_stability_days_goal };
  }

  updateSettings(site, dailyStabilityDaysGoal) {
    if (
      !isSite(site) ||
      !Number.isSafeInteger(dailyStabilityDaysGoal) ||
      dailyStabilityDaysGoal < 1
    ) {
      throw new TypeError("invalid settings");
    }
    const updated = this.ctx.storage.sql
      .exec(
        `UPDATE site_settings SET daily_stability_days_goal = ? WHERE site = ?
         RETURNING daily_stability_days_goal`,
        dailyStabilityDaysGoal,
        site
      )
      .toArray()[0];
    if (updated === undefined) {
      throw new Error("missing StabilityState settings");
    }
    return { site, dailyStabilityDaysGoal: updated.daily_stability_days_goal };
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
    const catalog = this.ctx.storage.sql
      .exec("SELECT question_count FROM catalog_metadata WHERE site = ?", site)
      .toArray()[0];
    if (catalog === undefined) {
      return { error: "catalog_missing" };
    }
    const due = this.ctx.storage.sql
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
    const unseen = this.ctx.storage.sql
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
      const stabilityDaysBefore = readStabilityDays(this.ctx.storage, site);
      const metadata = this.ctx.storage.sql
        .exec("SELECT generation FROM catalog_metadata WHERE site = ?", site)
        .toArray()[0];
      const currentGeneration = metadata?.generation ?? 0;
      if (currentGeneration !== expectedGeneration) {
        return { error: "catalog_conflict", currentGeneration };
      }
      const generation = currentGeneration + 1;
      this.ctx.storage.sql.exec("DELETE FROM questions WHERE site = ?", site);
      for (const questionId of questionIds) {
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
      this.ctx.storage.sql.exec(
        `INSERT INTO site_settings (site, daily_stability_days_goal)
         VALUES (?, ?)
         ON CONFLICT(site) DO NOTHING`,
        site,
        DEFAULT_DAILY_STABILITY_DAYS_GOAL
      );
      const stabilityDaysAfter = readStabilityDays(this.ctx.storage, site);
      recordDailyStabilityDays(
        this.ctx.storage,
        site,
        getTokyoDate(new Date(nowMs)),
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
}

export { LearningState as StabilityState };

export function getStabilityStateStub(env) {
  const id = env.LEARNING_STATE.idFromName(LEARNING_STATE_OBJECT_NAME);
  return env.LEARNING_STATE.get(id);
}
