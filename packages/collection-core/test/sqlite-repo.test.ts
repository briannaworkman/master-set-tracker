import { expect, it } from 'vitest';
import { createSqliteRepo } from '../src/db/sqlite-repo';
import { createBetterSqliteDb } from './better-sqlite-db';
import { runRepoContract } from './repo.contract';

runRepoContract('sqlite', () => createSqliteRepo(createBetterSqliteDb()));

it('sqlite keeps the row at count 0', () => {
  const db = createBetterSqliteDb();
  const repo = createSqliteRepo(db);
  repo.setCount('a', 'c-001', 'normal', 2, 't1');
  repo.setCount('a', 'c-001', 'normal', 0, 't2');
  expect(db.first<{ n: number }>('SELECT count(*) AS n FROM collection')!.n).toBe(1);
  expect(db.first<{ updated_at: string }>('SELECT updated_at FROM collection')!.updated_at).toBe('t2');
});

it('sqlite falls back to [] on corrupt hidden_category_ids', () => {
  const db = createBetterSqliteDb();
  const repo = createSqliteRepo(db);
  repo.trackSet('a', 't0');
  db.run("UPDATE tracked_sets SET hidden_category_ids = 'not json'");
  expect(repo.listTracked()[0]!.hiddenCategoryIds).toEqual([]);
  db.run("UPDATE tracked_sets SET hidden_category_ids = '{\"x\":1}'");
  expect(repo.listTracked()[0]!.hiddenCategoryIds).toEqual([]);
});
