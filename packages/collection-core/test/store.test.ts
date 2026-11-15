import { beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from '../src/db/migrations';
import { createMemoryRepo } from '../src/db/memory-repo';
import { createSqliteRepo } from '../src/db/sqlite-repo';
import type { CollectionRepo } from '../src/db/sql-db';
import { CollectionStore } from '../src/store';
import { createBetterSqliteDb } from './better-sqlite-db';

describe('CollectionStore', () => {
  let repo: CollectionRepo;
  let store: CollectionStore;
  beforeEach(() => {
    repo = createSqliteRepo(createBetterSqliteDb());
    store = new CollectionStore(repo, () => '2026-01-01T00:00:00Z');
  });

  it('adds exactly one per tap across rapid taps', () => {
    for (let i = 0; i < 5; i++) store.tap('s', 'c-001', 'normal');
    expect(store.getCounts('s')['c-001:normal']).toBe(5);
    expect(repo.countsForSet('s')['c-001:normal']).toBe(5);
  });

  it("notifies subscribers and replaces only the changed set's counts object", () => {
    const a = store.getCounts('a');
    const b = store.getCounts('b');
    const listener = vi.fn();
    const off = store.subscribe(listener);
    store.tap('a', 'c-001', 'normal');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getCounts('a')).not.toBe(a);
    expect(store.getCounts('b')).toBe(b);
    off();
    store.tap('a', 'c-001', 'normal');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps the same counts reference when nothing changed', () => {
    store.tap('a', 'c-001', 'normal');
    const first = store.getCounts('a');
    expect(store.getCounts('a')).toBe(first);
    const tracked = store.getTracked();
    expect(store.getTracked()).toBe(tracked);
  });

  it('tracks, untracks and replaces the tracked reference on change', () => {
    const empty = store.getTracked();
    store.track('a');
    expect(store.getTracked()).not.toBe(empty);
    expect(store.getTracked().map((t) => t.setId)).toEqual(['a']);
    store.untrack('a');
    expect(store.getTracked()).toEqual([]);
  });

  it('hides and unhides categories without touching counts', () => {
    store.track('a');
    store.tap('a', 'c-001', 'normal');
    const counts = store.getCounts('a');
    store.setHidden('a', ['promos']);
    expect(store.getTracked()[0]!.hiddenCategoryIds).toEqual(['promos']);
    store.setHidden('a', []);
    expect(store.getTracked()[0]!.hiddenCategoryIds).toEqual([]);
    expect(store.getCounts('a')).toBe(counts);
  });

  it('setCount clamps and persists', () => {
    store.setCount('a', 'c-001', 'normal', 5000);
    expect(store.getCounts('a')['c-001:normal']).toBe(999);
  });

  it('works over the memory repo too', () => {
    const s = new CollectionStore(createMemoryRepo());
    s.track('a');
    s.tap('a', 'c-001', 'normal');
    expect(s.getCounts('a')['c-001:normal']).toBe(1);
  });
});

describe('CollectionStore robustness', () => {
  it('a throwing listener does not block others or lose the write', () => {
    const repo = createMemoryRepo();
    const store = new CollectionStore(repo);
    const second = vi.fn();
    store.subscribe(() => {
      throw new Error('boom');
    });
    store.subscribe(second);
    expect(() => store.tap('a', 'c-001', 'normal')).toThrow('boom');
    expect(second).toHaveBeenCalledTimes(1);
    expect(store.getCounts('a')['c-001:normal']).toBe(1);
    expect(repo.countsForSet('a')['c-001:normal']).toBe(1);
  });

  it('does not replace the tracked reference or emit when nothing changed', () => {
    const store = new CollectionStore(createMemoryRepo());
    store.track('a');
    store.setHidden('a', ['x']);
    const ref = store.getTracked();
    const listener = vi.fn();
    store.subscribe(listener);
    store.track('a');
    store.untrack('zzz');
    store.setHidden('zzz', ['x']);
    store.setHidden('a', ['x']);
    expect(store.getTracked()).toBe(ref);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('CollectionStore cross-set writes', () => {
  it.each([
    ['memory', () => createMemoryRepo()],
    ['sqlite', () => createSqliteRepo(createBetterSqliteDb())],
  ])('keeps caches consistent with the repo (%s)', (_n, make) => {
    const repo = make();
    const store = new CollectionStore(repo);
    store.tap('a', 'c-001', 'normal');
    store.tap('a', 'c-001', 'normal');
    store.setCount('b', 'c-001', 'normal', 1);
    expect(store.getCounts('a')).not.toHaveProperty('c-001:normal');
    expect(store.getCounts('b')['c-001:normal']).toBe(1);
    store.tap('a', 'c-001', 'normal');
    expect(store.getCounts('a')['c-001:normal']).toBe(1);
    expect(store.getCounts('b')).not.toHaveProperty('c-001:normal');
    expect(store.getCounts('a')).toEqual(repo.countsForSet('a'));
    expect(store.getCounts('b')).toEqual(repo.countsForSet('b'));
  });
});

describe('migrate', () => {
  it('is idempotent', () => {
    const db = createBetterSqliteDb();
    migrate(db);
    expect(() => migrate(db)).not.toThrow();
    expect(db.first<{ user_version: number }>('PRAGMA user_version')!.user_version).toBe(1);
  });
});
