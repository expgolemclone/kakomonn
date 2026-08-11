import { DurableObject } from "cloudflare:workers";
import { getTokyoDate, recentTokyoDates } from "./dates.js";
import {
  createNewCard,
  masteryDelta,
  scheduleAnswer,
} from "./fsrs.js";
import { isSite } from "./auth.js";

export const LEARNING_STATE_OBJECT_NAME = "primary";
export const MASTERY_MILESTONE_INTERVAL = 50;
export const OPERATION_ID_PATTERN = /^[0-9a-f]{32}$/;
export const QUESTION_ID_PATTERN = /^\d+$/;
const ANSWER_RESULTS = new Set(["correct", "incorrect"]);

function tableDefinition(storage, tableName) {
  return storage.sql
    .exec("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", tableName)
    .toArray()[0]?.sql;
}

export function initializeLearningSchema(storage) {
  storage.transactionSync(() => {
    const required = [
      "cards",
      "attempts",
      "mastery_history",
      "questions",
      "learning_metadata",
      "catalog_metadata",
    ];
    const existing = required.filter((name) => tableDefinition(storage, name) !== undefined);
    if (existing.length === required.length) {
      return;
    }
    if (existing.length !== 0) {
      throw new Error("incomplete LearningState schema");
    }
    storage.sql.exec(`
      CREATE TABLE cards (
        site TEXT NOT NULL,
        question_id TEXT NOT NULL,
        due_ms INTEGER NOT NULL,
        stability REAL NOT NULL,
        difficulty REAL NOT NULL,
        scheduled_days INTEGER NOT NULL,
        learning_steps INTEGER NOT NULL,
        reps INTEGER NOT NULL,
        lapses INTEGER NOT NULL,
        state INTEGER NOT NULL,
        last_review_ms INTEGER,
        PRIMARY KEY (site, question_id)
      ) WITHOUT ROWID;

      CREATE TABLE attempts (
        site TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        question_id TEXT NOT NULL,
        answered_at_ms INTEGER NOT NULL,
        result TEXT NOT NULL CHECK (result IN ('correct', 'incorrect')),
        previous_stability REAL NOT NULL,
        resulting_stability REAL NOT NULL,
        mastery_delta INTEGER NOT NULL CHECK (mastery_delta IN (-1, 0, 1)),
        resulting_mastered_count INTEGER NOT NULL CHECK (resulting_mastered_count >= 0),
        completed_milestone INTEGER CHECK (
          completed_milestone IS NULL OR
          (completed_milestone > 0 AND completed_milestone % 50 = 0)
        ),
        PRIMARY KEY (operation_id)
      ) WITHOUT ROWID;

      CREATE TABLE mastery_history (
        site TEXT NOT NULL,
        date TEXT NOT NULL,
        mastered_count INTEGER NOT NULL CHECK (mastered_count >= 0),
        PRIMARY KEY (site, date)
      ) WITHOUT ROWID;

      CREATE TABLE questions (
        site TEXT NOT NULL,
        question_id TEXT NOT NULL,
        PRIMARY KEY (site, question_id)
      ) WITHOUT ROWID;

      CREATE TABLE learning_metadata (
        site TEXT PRIMARY KEY,
        highest_mastery_milestone INTEGER NOT NULL DEFAULT 0
          CHECK (highest_mastery_milestone >= 0)
      ) WITHOUT ROWID;

      CREATE TABLE catalog_metadata (
        site TEXT PRIMARY KEY,
        question_count INTEGER NOT NULL CHECK (question_count > 0),
        updated_at_ms INTEGER NOT NULL,
        generation INTEGER NOT NULL CHECK (generation > 0)
      ) WITHOUT ROWID;
    `);
  });
}

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

function masteredCount(storage, site) {
  return storage.sql
    .exec("SELECT COUNT(*) AS count FROM cards WHERE site = ? AND stability >= 30", site)
    .toArray()[0].count;
}

function milestoneFor(storage, site, mastered, delta) {
  if (delta !== 1 || mastered % MASTERY_MILESTONE_INTERVAL !== 0) {
    return null;
  }
  const row = storage.sql
    .exec(
      "SELECT highest_mastery_milestone FROM learning_metadata WHERE site = ?",
      site
    )
    .toArray()[0];
  const highest = row?.highest_mastery_milestone ?? 0;
  if (mastered <= highest) {
    return null;
  }
  storage.sql.exec(
    `INSERT INTO learning_metadata (site, highest_mastery_milestone)
     VALUES (?, ?)
     ON CONFLICT(site) DO UPDATE SET highest_mastery_milestone = excluded.highest_mastery_milestone`,
    site,
    mastered
  );
  return mastered;
}

function attemptResponse(row, mastered = row.resulting_mastered_count) {
  return {
    attempt: {
      questionId: row.question_id,
      result: row.result,
      previousStability: row.previous_stability,
      stability: row.resulting_stability,
      masteryDelta: row.mastery_delta,
    },
    totals: { mastered },
    completedMilestone: row.completed_milestone,
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
          `SELECT site, question_id, result, previous_stability, resulting_stability,
                  mastery_delta, resulting_mastered_count, completed_milestone
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
        return attemptResponse(existing, masteredCount(this.ctx.storage, site));
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
      const delta = masteryDelta(previousStability, nextCard.stability);
      saveCard(this.ctx.storage, site, questionId, nextCard);
      const mastered = masteredCount(this.ctx.storage, site);
      const today = getTokyoDate(new Date(nowMs));
      if (delta !== 0) {
        this.ctx.storage.sql.exec(
          `INSERT INTO mastery_history (site, date, mastered_count)
           VALUES (?, ?, ?)
           ON CONFLICT(site, date) DO UPDATE SET mastered_count = excluded.mastered_count`,
          site,
          today,
          mastered
        );
      }
      const completedMilestone = milestoneFor(this.ctx.storage, site, mastered, delta);
      this.ctx.storage.sql.exec(
        `INSERT INTO attempts (
           site, operation_id, question_id, answered_at_ms, result,
           previous_stability, resulting_stability, mastery_delta,
           resulting_mastered_count, completed_milestone
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        site,
        operationId,
        questionId,
        nowMs,
        result,
        previousStability,
        nextCard.stability,
        delta,
        mastered,
        completedMilestone
      );
      return attemptResponse({
        question_id: questionId,
        result,
        previous_stability: previousStability,
        resulting_stability: nextCard.stability,
        mastery_delta: delta,
        resulting_mastered_count: mastered,
        completed_milestone: completedMilestone,
      });
    });
  }

  getState(site, nowMs = Date.now()) {
    if (!isSite(site) || !Number.isSafeInteger(nowMs)) {
      throw new TypeError("invalid state request");
    }
    return this.ctx.storage.transactionSync(() => {
      const today = getTokyoDate(new Date(nowMs));
      const mastered = masteredCount(this.ctx.storage, site);
      const todayRow = this.ctx.storage.sql
        .exec(
          "SELECT mastered_count FROM mastery_history WHERE site = ? AND date = ?",
          site,
          today
        )
        .toArray()[0];
      const previous = this.ctx.storage.sql
        .exec(
          `SELECT mastered_count FROM mastery_history
           WHERE site = ? AND date < ? ORDER BY date DESC LIMIT 1`,
          site,
          today
        )
        .toArray()[0];
      const todayDelta = todayRow === undefined ? 0 : todayRow.mastered_count - (previous?.mastered_count ?? 0);
      const catalog = this.ctx.storage.sql
        .exec(
          "SELECT question_count, updated_at_ms, generation FROM catalog_metadata WHERE site = ?",
          site
        )
        .toArray()[0];
      return {
        site,
        today,
        mastered,
        todayDelta,
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
      const baseline = this.ctx.storage.sql
        .exec(
          `SELECT mastered_count FROM mastery_history
           WHERE site = ? AND date < ? ORDER BY date DESC LIMIT 1`,
          site,
          dates[0]
        )
        .toArray()[0]?.mastered_count ?? 0;
      const rows = new Map(
        this.ctx.storage.sql
          .exec(
            `SELECT date, mastered_count FROM mastery_history
             WHERE site = ? AND date >= ? AND date <= ? ORDER BY date`,
            site,
            dates[0],
            dates.at(-1)
          )
          .toArray()
          .map((row) => [row.date, row.mastered_count])
      );
      let mastered = baseline;
      const history = dates.map((date) => {
        if (rows.has(date)) {
          mastered = rows.get(date);
        }
        return { date, mastered };
      });
      return { site, timeZone: "Asia/Tokyo", today, days: history };
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

export function getLearningStateStub(env) {
  const id = env.LEARNING_STATE.idFromName(LEARNING_STATE_OBJECT_NAME);
  return env.LEARNING_STATE.get(id);
}
