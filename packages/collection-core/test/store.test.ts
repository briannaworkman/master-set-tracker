import { beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from '../src/db/migrations';
import { createMemoryRepo } from '../src/db/memory-repo';
import { createSqliteRepo } from '../src/db/sqlite-repo';
import type { CollectionRepo } from '../src/db/sql-db';
import { CollectionStore } from '../src/store';
import { setProgress } from '../src/progress';
import { fixtureCatalog } from '../src/testing/fixture-catalog';
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

  it('untrack then track restores hidden categories and counts', () => {
    store.track('a');
    store.setCount('a', 'c-001', 'normal', 2);
    store.setHidden('a', ['promos']);
    store.untrack('a');
    expect(store.getTracked()).toEqual([]);
    store.track('a');
    expect(store.getTracked()).toEqual([{ setId: 'a', hiddenCategoryIds: ['promos'], addedAt: '2026-01-01T00:00:00Z' }]);
    expect(store.getCounts('a')).toEqual({ 'c-001:normal': 2 });
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

describe('CollectionStore unchanged writes', () => {
  it.each([
    ['tap at 999', (s: CollectionStore) => s.tap('a', 'c-001', 'normal')],
    ['setCount above the cap', (s: CollectionStore) => s.setCount('a', 'c-001', 'normal', 1200)],
    ['setCount to the same value', (s: CollectionStore) => s.setCount('a', 'c-001', 'normal', 999)],
  ])('%s does not write, emit or replace the counts reference', (_n, act) => {
    const repo = createMemoryRepo();
    const store = new CollectionStore(repo);
    store.setCount('a', 'c-001', 'normal', 999);
    const ref = store.getCounts('a');
    const write = vi.spyOn(repo, 'setCount');
    const listener = vi.fn();
    store.subscribe(listener);
    act(store);
    expect(write).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(store.getCounts('a')).toBe(ref);
  });

  it('setCount(0) on a version never owned does not write', () => {
    const repo = createMemoryRepo();
    const store = new CollectionStore(repo);
    const write = vi.spyOn(repo, 'setCount');
    store.setCount('a', 'c-001', 'normal', 0);
    store.setCount('a', 'c-001', 'normal', -3);
    expect(write).not.toHaveBeenCalled();
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
    expect(db.first<{ user_version: number }>('PRAGMA user_version')!.user_version).toBe(4);
  });
});

describe('CollectionStore sync support', () => {
  const remote = (cardId: string, setId: string, count: number, updatedAt: string) => ({ cardId, kind: 'normal', setId, count, updatedAt });

  it.each([
    ['memory', () => createMemoryRepo()],
    ['sqlite', () => createSqliteRepo(createBetterSqliteDb())],
  ])('applyRemote refreshes only affected sets and emits once (%s)', (_n, make) => {
    const store = new CollectionStore(make(), () => '2026-01-01T00:00:00.000Z');
    store.track('a');
    store.tap('a', 'c-1', 'normal');
    store.tap('b', 'c-2', 'normal');
    const a = store.getCounts('a');
    const b = store.getCounts('b');
    const trackedRef = store.getTracked();
    const listener = vi.fn();
    store.subscribe(listener);
    store.applyRemote({
      collection: [remote('c-1', 'a', 4, '2026-02-01T00:00:00.000Z'), remote('c-9', 'a', 1, '2026-02-01T00:00:00.000Z')],
      tracked: [{ setId: 'z', hiddenCategoryIds: [], addedAt: '2026-02-01T00:00:00.000Z', removedAt: null, updatedAt: '2026-02-01T00:00:00.000Z' }],
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getCounts('a')).toEqual({ 'c-1:normal': 4, 'c-9:normal': 1 });
    expect(store.getCounts('a')).not.toBe(a);
    expect(store.getCounts('b')).toBe(b);
    expect(store.getTracked()).not.toBe(trackedRef);
    expect(store.getTracked().map((t) => t.setId)).toEqual(['a', 'z']);
  });

  it('applyRemote emits nothing when every remote row loses', () => {
    const store = new CollectionStore(createMemoryRepo(), () => '2026-03-01T00:00:00.000Z');
    store.tap('a', 'c-1', 'normal');
    const listener = vi.fn();
    store.subscribe(listener);
    store.applyRemote({ collection: [remote('c-1', 'a', 8, '2026-01-01T00:00:00.000Z')], tracked: [] });
    expect(listener).not.toHaveBeenCalled();
    expect(store.getCounts('a')).toEqual({ 'c-1:normal': 1 });
  });

  it('wipe resets caches and emits once', () => {
    const repo = createSqliteRepo(createBetterSqliteDb());
    const store = new CollectionStore(repo);
    store.track('a');
    store.tap('a', 'c-1', 'normal');
    const listener = vi.fn();
    store.subscribe(listener);
    store.wipe();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getTracked()).toEqual([]);
    expect(store.getCounts('a')).toEqual({});
    expect(repo.dirtyCount()).toBe(0);
  });

  it.each([
    ['memory', () => createMemoryRepo()],
    ['sqlite', () => createSqliteRepo(createBetterSqliteDb())],
  ])('a cached set loses a key that applyRemote moved to another set (%s)', (_n, make) => {
    const store = new CollectionStore(make(), () => '2026-01-01T00:00:00.000Z');
    store.tap('a', 'c-1', 'normal');
    expect(store.getCounts('a')).toEqual({ 'c-1:normal': 1 });
    store.getCounts('b');
    store.applyRemote({ collection: [remote('c-1', 'b', 2, '2026-02-01T00:00:00.000Z')], tracked: [] });
    expect(store.getCounts('a')).toEqual({});
    expect(store.getCounts('b')).toEqual({ 'c-1:normal': 2 });
  });

  it('stores a remote row for a version the catalog does not know without changing progress', () => {
    const store = new CollectionStore(createMemoryRepo(), () => '2026-01-01T00:00:00.000Z');
    const cat = fixtureCatalog;
    const before = setProgress(cat, store.getCounts(cat.id), []);
    store.applyRemote({ collection: [remote('ghost-999', cat.id, 3, '2026-02-01T00:00:00.000Z')], tracked: [] });
    expect(store.getCounts(cat.id)['ghost-999:normal']).toBe(3);
    expect(setProgress(cat, store.getCounts(cat.id), [])).toEqual(before);
  });
});
