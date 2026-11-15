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

/**
 * v2: tracked_sets rows are soft-deleted (removed_at) so hidden categories survive removal,
 * and carry updated_at for sync. Existing rows take updated_at = added_at.
 */
const SCHEMA_V2 = `
ALTER TABLE tracked_sets ADD COLUMN removed_at TEXT;
ALTER TABLE tracked_sets ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
`;

/** Step N upgrades a database at user_version N-1 to N. Each step runs in its own transaction. */
const STEPS: Array<(db: SqlDb) => void> = [
  (db) => db.exec(SCHEMA_V1),
  (db) => {
    db.exec(SCHEMA_V2);
    db.run('UPDATE tracked_sets SET updated_at = added_at');
  },
];

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
