import { describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrations';
import type { SqlDb } from '../src/db/sql-db';
import { createBetterSqliteDb } from './better-sqlite-db';

/** Wraps a db so the first exec/run whose SQL contains `needle` throws. */
function failingOn(db: SqlDb, needle: string): SqlDb {
  const check = (sql: string) => {
    if (sql.includes(needle)) throw new Error(`injected failure on ${needle}`);
  };
  return {
    ...db,
    exec: (sql) => {
      check(sql);
      db.exec(sql);
    },
    run: (sql, params) => {
      check(sql);
      db.run(sql, params);
    },
  };
}

const userVersion = (db: SqlDb) => db.first<{ user_version: number }>('PRAGMA user_version')!.user_version;
const tables = (db: SqlDb) =>
  db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map((r) => r.name);

describe('migrate atomicity', () => {
  it('leaves a fresh database untouched when the v1 step fails', () => {
    const db = createBetterSqliteDb();
    expect(() => migrate(failingOn(db, 'PRAGMA user_version = 1'))).toThrow('injected failure');
    expect(userVersion(db)).toBe(0);
    expect(tables(db)).toEqual([]);
  });
});

/** The v1 schema exactly as Plan 2's first release created it. */
const V1 = `
CREATE TABLE tracked_sets (set_id TEXT PRIMARY KEY, hidden_category_ids TEXT NOT NULL DEFAULT '[]', added_at TEXT NOT NULL);
CREATE TABLE collection (set_id TEXT NOT NULL, card_id TEXT NOT NULL, kind TEXT NOT NULL,
  count INTEGER NOT NULL CHECK (count >= 0), updated_at TEXT NOT NULL, PRIMARY KEY (card_id, kind));
CREATE INDEX collection_set_idx ON collection (set_id);
PRAGMA user_version = 1;
`;

function v1Db() {
  const db = createBetterSqliteDb();
  db.exec(V1);
  db.run('INSERT INTO tracked_sets (set_id, hidden_category_ids, added_at) VALUES (?, ?, ?)', ['a', '["promos"]', 't0']);
  db.run('INSERT INTO tracked_sets (set_id, hidden_category_ids, added_at) VALUES (?, ?, ?)', ['b', '[]', 't1']);
  db.run('INSERT INTO collection (set_id, card_id, kind, count, updated_at) VALUES (?, ?, ?, ?, ?)', ['a', 'a-1', 'normal', 3, 't2']);
  return db;
}

describe('migrate v1 -> v2', () => {
  it('adds removed_at/updated_at to tracked_sets and keeps existing rows', () => {
    const db = v1Db();
    migrate(db);
    expect(userVersion(db)).toBe(3);
    expect(db.all('SELECT set_id, hidden_category_ids, added_at, updated_at, removed_at FROM tracked_sets ORDER BY set_id')).toEqual([
      { set_id: 'a', hidden_category_ids: '["promos"]', added_at: 't0', updated_at: 't0', removed_at: null },
      { set_id: 'b', hidden_category_ids: '[]', added_at: 't1', updated_at: 't1', removed_at: null },
    ]);
    expect(db.all('SELECT set_id, card_id, kind, count, updated_at FROM collection')).toEqual([
      { set_id: 'a', card_id: 'a-1', kind: 'normal', count: 3, updated_at: 't2' },
    ]);
  });

  it('rolls the whole v2 step back if any part fails', () => {
    const db = v1Db();
    expect(() => migrate(failingOn(db, 'SET updated_at = added_at'))).toThrow('injected failure');
    expect(userVersion(db)).toBe(1);
    const cols = db.all<{ name: string }>('PRAGMA table_info(tracked_sets)').map((c) => c.name);
    expect(cols).toEqual(['set_id', 'hidden_category_ids', 'added_at']);
  });

  it('migrates a fresh database straight to v3 and is idempotent', () => {
    const db = createBetterSqliteDb();
    migrate(db);
    migrate(db);
    expect(userVersion(db)).toBe(3);
    const cols = db.all<{ name: string }>('PRAGMA table_info(tracked_sets)').map((c) => c.name);
    expect(cols).toEqual(['set_id', 'hidden_category_ids', 'added_at', 'removed_at', 'updated_at', 'dirty']);
  });
});

describe('migrate v2 -> v3', () => {
  it('keeps rows and marks them dirty, adding sync_state and prices', () => {
    const db = v1Db();
    db.exec('PRAGMA user_version = 1');
    // bring to v2 only, by running the v2 statements manually
    db.exec("ALTER TABLE tracked_sets ADD COLUMN removed_at TEXT; ALTER TABLE tracked_sets ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''; UPDATE tracked_sets SET updated_at = added_at; PRAGMA user_version = 2;");
    migrate(db);
    expect(userVersion(db)).toBe(3);
    expect(db.all('SELECT set_id, dirty FROM tracked_sets ORDER BY set_id')).toEqual([
      { set_id: 'a', dirty: 1 },
      { set_id: 'b', dirty: 1 },
    ]);
    expect(db.all('SELECT card_id, count, dirty FROM collection')).toEqual([{ card_id: 'a-1', count: 3, dirty: 1 }]);
    expect(tables(db)).toEqual(['collection', 'prices', 'sync_state', 'tracked_sets']);
  });

  it('rolls the v3 step back if it fails', () => {
    const db2 = v1Db();
    db2.exec("ALTER TABLE tracked_sets ADD COLUMN removed_at TEXT; ALTER TABLE tracked_sets ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''; PRAGMA user_version = 2;");
    expect(() => migrate(failingOn(db2, 'PRAGMA user_version = 3'))).toThrow('injected failure');
    expect(userVersion(db2)).toBe(2);
    expect(tables(db2)).toEqual(['collection', 'tracked_sets']);
    expect(db2.all<{ name: string }>('PRAGMA table_info(collection)').map((c) => c.name)).not.toContain('dirty');
  });
});
