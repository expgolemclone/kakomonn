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
    if (existing.length !== 0 && existing.length !== required.length) {
      throw new Error("incomplete LearningState schema");
    }
    if (existing.length === 0) {
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
    }
    storage.sql.exec("DROP INDEX IF EXISTS attempts_by_site");
    storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS cards_by_site_stability
        ON cards (site, stability);
      CREATE INDEX IF NOT EXISTS cards_by_site_due
        ON cards (site, due_ms, question_id);
      CREATE INDEX IF NOT EXISTS attempts_by_site_answered_at_question
        ON attempts (site, answered_at_ms, question_id);
    `);
  });
}
