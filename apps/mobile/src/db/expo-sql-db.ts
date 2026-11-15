import type { SqlDb } from '@mst/collection-core';
import type { SQLiteBindValue } from 'expo-sqlite';

/** The subset of expo-sqlite's `SQLiteDatabase` sync API the adapter uses. */
export interface ExpoSyncDatabase {
  execSync(source: string): void;
  runSync(source: string, params: SQLiteBindValue[]): unknown;
  getAllSync<T>(source: string, params: SQLiteBindValue[]): T[];
  getFirstSync<T>(source: string, params: SQLiteBindValue[]): T | null;
  withTransactionSync(task: () => void): void;
}

/** Wraps an expo-sqlite database (from `openDatabaseSync`) as the collection-core `SqlDb`. */
export function createExpoSqlDb(db: ExpoSyncDatabase): SqlDb {
  const bind = (params: unknown[] = []) => params as SQLiteBindValue[];
  return {
    exec: (sql) => db.execSync(sql),
    run: (sql, params) => void db.runSync(sql, bind(params)),
    all: <T,>(sql: string, params?: unknown[]) => db.getAllSync<T>(sql, bind(params)),
    first: <T,>(sql: string, params?: unknown[]) => db.getFirstSync<T>(sql, bind(params)),
    transaction: <T,>(fn: () => T): T => {
      let result: T | undefined;
      db.withTransactionSync(() => {
        result = fn();
      });
      return result as T;
    },
  };
}
