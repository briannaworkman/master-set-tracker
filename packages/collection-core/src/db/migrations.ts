import type { SqlDb } from './sql-db';

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS tracked_sets (
  set_id TEXT PRIMARY KEY,
  hidden_category_ids TEXT NOT NULL DEFAULT '[]',
  added_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS collection (
  set_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  count INTEGER NOT NULL CHECK (count >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (card_id, kind)
);
CREATE INDEX IF NOT EXISTS collection_set_idx ON collection (set_id);
`;

/** Step N upgrades a database at user_version N-1 to N. Each step runs in its own transaction. */
const STEPS: Array<(db: SqlDb) => void> = [(db) => db.exec(SCHEMA_V1)];

export function migrate(db: SqlDb): void {
  const row = db.first<{ user_version: number }>('PRAGMA user_version');
  const version = row?.user_version ?? 0;
  STEPS.forEach((step, i) => {
    const target = i + 1;
    if (version >= target) return;
    db.transaction(() => {
      step(db);
      db.exec(`PRAGMA user_version = ${target}`);
    });
  });
}
