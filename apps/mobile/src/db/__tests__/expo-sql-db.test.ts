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
