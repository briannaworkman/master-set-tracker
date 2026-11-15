import { createExpoSqlDb, type ExpoSyncDatabase } from '../expo-sql-db';

function fakeDb() {
  const calls: unknown[][] = [];
  const db: ExpoSyncDatabase = {
    execSync: (sql) => void calls.push(['exec', sql]),
    runSync: (sql, params) => {
      calls.push(['run', sql, params]);
      return { lastInsertRowId: 0, changes: 0 };
    },
    getAllSync: <T,>(sql: string, params: unknown) => {
      calls.push(['all', sql, params]);
      return [{ n: 1 }] as T[];
    },
    getFirstSync: <T,>(sql: string, params: unknown) => {
      calls.push(['first', sql, params]);
      return null as T | null;
    },
    withTransactionSync: (task) => {
      calls.push(['begin']);
      task();
      calls.push(['commit']);
    },
  };
  return { db, calls };
}

describe('createExpoSqlDb', () => {
  it('forwards each SqlDb call to the matching expo-sqlite sync method', () => {
    const { db, calls } = fakeDb();
    const sql = createExpoSqlDb(db);
    sql.exec('CREATE TABLE t (n)');
    sql.run('INSERT INTO t VALUES (?)', [1]);
    expect(sql.all('SELECT n FROM t')).toEqual([{ n: 1 }]);
    expect(sql.first('SELECT n FROM t WHERE n = ?', [2])).toBeNull();
    expect(calls).toEqual([
      ['exec', 'CREATE TABLE t (n)'],
      ['run', 'INSERT INTO t VALUES (?)', [1]],
      ['all', 'SELECT n FROM t', []],
      ['first', 'SELECT n FROM t WHERE n = ?', [2]],
    ]);
  });
});

describe('createExpoSqlDb transaction', () => {
  it('runs the callback inside withTransactionSync and returns its result', () => {
    const { db, calls } = fakeDb();
    const sql = createExpoSqlDb(db);
    const out = sql.transaction(() => {
      sql.run('INSERT INTO t VALUES (?)', [1]);
      return 42;
    });
    expect(out).toBe(42);
    expect(calls).toEqual([['begin'], ['run', 'INSERT INTO t VALUES (?)', [1]], ['commit']]);
  });

  it('propagates an error from the callback', () => {
    const { db } = fakeDb();
    const sql = createExpoSqlDb(db);
    expect(() =>
      sql.transaction(() => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
  });
});
