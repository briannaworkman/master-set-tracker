import { describe, expect, it } from 'vitest';
import { createBetterSqliteDb } from './better-sqlite-db';

describe('SqlDb.transaction (better-sqlite3 adapter)', () => {
  it('commits and returns the callback result', () => {
    const db = createBetterSqliteDb();
    db.exec('CREATE TABLE t (n INTEGER)');
    const out = db.transaction(() => {
      db.run('INSERT INTO t VALUES (?)', [1]);
      return 'done';
    });
    expect(out).toBe('done');
    expect(db.all<{ n: number }>('SELECT n FROM t')).toEqual([{ n: 1 }]);
  });

  it('rolls back every statement when the callback throws', () => {
    const db = createBetterSqliteDb();
    db.exec('CREATE TABLE t (n INTEGER)');
    expect(() =>
      db.transaction(() => {
        db.run('INSERT INTO t VALUES (?)', [1]);
        db.exec('PRAGMA user_version = 7');
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(db.all('SELECT n FROM t')).toEqual([]);
    expect(db.first<{ user_version: number }>('PRAGMA user_version')!.user_version).toBe(0);
  });
});
