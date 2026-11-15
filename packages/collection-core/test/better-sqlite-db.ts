import Database from 'better-sqlite3';
import type { SqlDb } from '../src/db/sql-db';

export function createBetterSqliteDb(): SqlDb & { raw: Database.Database } {
  const raw = new Database(':memory:');
  return {
    raw,
    exec: (sql) => void raw.exec(sql),
    run: (sql, params = []) => void raw.prepare(sql).run(...params),
    all: <T>(sql: string, params: unknown[] = []) => raw.prepare(sql).all(...params) as T[],
    first: <T>(sql: string, params: unknown[] = []) => (raw.prepare(sql).get(...params) as T | undefined) ?? null,
  };
}
