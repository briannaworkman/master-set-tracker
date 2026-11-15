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
