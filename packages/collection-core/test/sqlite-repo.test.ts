import { expect, it } from 'vitest';
import { createSqliteRepo } from '../src/db/sqlite-repo';
import { createSqlitePriceCache } from '../src/prices/price-cache';
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

type Row = { set_id: string; added_at: string; updated_at: string; removed_at: string | null; hidden_category_ids: string };
const row = (db: ReturnType<typeof createBetterSqliteDb>, setId: string) =>
  db.first<Row>('SELECT set_id, added_at, updated_at, removed_at, hidden_category_ids FROM tracked_sets WHERE set_id = ?', [
    setId,
  ]);

it('sqlite soft-deletes tracked sets and stamps updated_at on every change', () => {
  const db = createBetterSqliteDb();
  const repo = createSqliteRepo(db);
  repo.trackSet('a', 't0');
  expect(row(db, 'a')).toMatchObject({ added_at: 't0', updated_at: 't0', removed_at: null });
  repo.setHiddenCategories('a', ['promos'], 't1');
  expect(row(db, 'a')).toMatchObject({ updated_at: 't1', hidden_category_ids: '["promos"]' });
  repo.untrackSet('a', 't2');
  expect(row(db, 'a')).toMatchObject({ updated_at: 't2', removed_at: 't2', hidden_category_ids: '["promos"]' });
  repo.trackSet('a', 't3');
  expect(row(db, 'a')).toMatchObject({ added_at: 't3', updated_at: 't3', removed_at: null, hidden_category_ids: '["promos"]' });
});

it('sqlite does not touch updated_at for no-op changes', () => {
  const db = createBetterSqliteDb();
  const repo = createSqliteRepo(db);
  repo.trackSet('a', 't0');
  repo.setHiddenCategories('a', ['promos'], 't1');
  repo.trackSet('a', 't2');
  repo.setHiddenCategories('a', ['promos'], 't3');
  expect(row(db, 'a')).toMatchObject({ added_at: 't0', updated_at: 't1' });
  repo.untrackSet('a', 't4');
  repo.untrackSet('a', 't5');
  repo.setHiddenCategories('a', [], 't6');
  expect(row(db, 'a')).toMatchObject({ updated_at: 't4', removed_at: 't4', hidden_category_ids: '["promos"]' });
});

it('sqlite wipe also clears cached prices', () => {
  const db = createBetterSqliteDb();
  const repo = createSqliteRepo(db);
  const cache = createSqlitePriceCache(db);
  cache.put('a', 't0', { 'c-1|normal': 1 });
  repo.wipe();
  expect(cache.get('a')).toBeNull();
});
