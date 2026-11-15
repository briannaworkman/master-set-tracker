import { beforeEach, describe, expect, it } from 'vitest';
import type { CollectionRepo } from '../src/db/sql-db';

export function runRepoContract(name: string, make: () => CollectionRepo): void {
  describe(`${name} repo contract`, () => {
    let repo: CollectionRepo;
    beforeEach(() => {
      repo = make();
    });

    it('tracks, lists in add order and ignores duplicate adds', () => {
      repo.trackSet('a', '2026-01-01T00:00:00Z');
      repo.trackSet('b', '2026-01-02T00:00:00Z');
      repo.trackSet('a', '2026-01-03T00:00:00Z');
      expect(repo.listTracked().map((t) => t.setId)).toEqual(['a', 'b']);
      expect(repo.listTracked()[0]!.addedAt).toBe('2026-01-01T00:00:00Z');
    });

    it('keeps counts when a set is untracked and re-tracked', () => {
      repo.trackSet('a', 't0');
      repo.setCount('a', 'c-001', 'normal', 3, 't1');
      repo.untrackSet('a', 't1');
      expect(repo.listTracked()).toEqual([]);
      repo.trackSet('a', 't2');
      expect(repo.countsForSet('a')['c-001:normal']).toBe(3);
    });

    it('stores hidden categories per set', () => {
      repo.trackSet('a', 't0');
      repo.trackSet('b', 't0');
      repo.setHiddenCategories('a', ['promos'], 't1');
      expect(repo.listTracked().find((t) => t.setId === 'a')!.hiddenCategoryIds).toEqual(['promos']);
      expect(repo.listTracked().find((t) => t.setId === 'b')!.hiddenCategoryIds).toEqual([]);
    });

    it('restores hidden categories and counts when a removed set is re-tracked', () => {
      repo.trackSet('a', 't0');
      repo.setCount('a', 'c-001', 'normal', 2, 't1');
      repo.setHiddenCategories('a', ['promos'], 't2');
      repo.untrackSet('a', 't3');
      expect(repo.listTracked()).toEqual([]);
      repo.trackSet('a', 't4');
      expect(repo.listTracked()).toEqual([{ setId: 'a', hiddenCategoryIds: ['promos'], addedAt: 't4' }]);
      expect(repo.countsForSet('a')).toEqual({ 'c-001:normal': 2 });
    });

    it('re-tracking a removed set refreshes addedAt so it lists last', () => {
      repo.trackSet('a', '2026-01-01');
      repo.trackSet('b', '2026-01-02');
      repo.untrackSet('a', '2026-01-03');
      repo.trackSet('a', '2026-01-04');
      expect(repo.listTracked().map((t) => [t.setId, t.addedAt])).toEqual([
        ['b', '2026-01-02'],
        ['a', '2026-01-04'],
      ]);
    });

    it('ignores hidden-category changes for a set that is not tracked', () => {
      repo.trackSet('a', 't0');
      repo.untrackSet('a', 't1');
      repo.setHiddenCategories('a', ['promos'], 't2');
      repo.setHiddenCategories('zzz', ['promos'], 't2');
      repo.trackSet('a', 't3');
      expect(repo.listTracked()[0]!.hiddenCategoryIds).toEqual([]);
      expect(repo.listTracked()).toHaveLength(1);
    });

    it('clamps counts and never stores negatives', () => {
      repo.setCount('a', 'c-001', 'normal', -2, 't1');
      expect(repo.countsForSet('a')).not.toHaveProperty('c-001:normal');
      repo.setCount('a', 'c-001', 'normal', 1200, 't2');
      expect(repo.countsForSet('a')['c-001:normal']).toBe(999);
    });

    it('omits zero counts from countsForSet', () => {
      repo.setCount('a', 'c-001', 'normal', 2, 't1');
      repo.setCount('a', 'c-001', 'normal', 0, 't2');
      expect(repo.countsForSet('a')).toEqual({});
    });

    it('keys counts globally by (cardId, kind); the latest write owns the row', () => {
      repo.setCount('a', 'c-001', 'normal', 2, 't1');
      repo.setCount('b', 'c-001', 'normal', 4, 't2');
      expect(repo.countsForSet('a')).toEqual({});
      expect(repo.countsForSet('b')['c-001:normal']).toBe(4);
    });

    describe('sync', () => {
      const stamp = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();

      it('marks local writes dirty and lists them oldest first', () => {
        repo.setCount('a', 'c-2', 'normal', 1, stamp(5));
        repo.trackSet('a', stamp(1));
        repo.setCount('a', 'c-1', 'holo', 2, stamp(3));
        repo.setHiddenCategories('a', ['x'], stamp(4));
        expect(repo.dirtyCount()).toBe(3);
        const all = repo.dirtyChanges(10);
        expect(all.tracked).toEqual([
          { setId: 'a', hiddenCategoryIds: ['x'], addedAt: stamp(1), removedAt: null, updatedAt: stamp(4) },
        ]);
        expect(all.collection.map((r) => r.cardId)).toEqual(['c-1', 'c-2']);
        expect(all.collection[0]).toEqual({ cardId: 'c-1', kind: 'holo', setId: 'a', count: 2, updatedAt: stamp(3) });
        // limit applies to the merged list, oldest first: c-1 (3), tracked (4)
        const two = repo.dirtyChanges(2);
        expect(two.collection.map((r) => r.cardId)).toEqual(['c-1']);
        expect(two.tracked.map((r) => r.setId)).toEqual(['a']);
      });

      it('does not mark a no-op write dirty', () => {
        repo.trackSet('a', stamp(1));
        repo.setCount('a', 'c-1', 'normal', 2, stamp(2));
        repo.markSynced(repo.dirtyChanges(10));
        expect(repo.dirtyCount()).toBe(0);
        repo.trackSet('a', stamp(3));
        repo.setCount('a', 'c-1', 'normal', 2, stamp(3));
        repo.setHiddenCategories('a', [], stamp(3));
        repo.untrackSet('zzz', stamp(3));
        expect(repo.dirtyCount()).toBe(0);
      });

      it('markSynced leaves a row dirty if it changed after the push snapshot', () => {
        repo.trackSet('a', stamp(1));
        repo.setCount('a', 'c-1', 'normal', 1, stamp(2));
        repo.setCount('a', 'c-2', 'normal', 1, stamp(2));
        const pushed = repo.dirtyChanges(10);
        repo.setCount('a', 'c-1', 'normal', 5, stamp(3));
        repo.setHiddenCategories('a', ['y'], stamp(3));
        repo.markSynced(pushed);
        const left = repo.dirtyChanges(10);
        expect(left.collection.map((r) => [r.cardId, r.count])).toEqual([['c-1', 5]]);
        expect(left.tracked.map((r) => r.setId)).toEqual(['a']);
        expect(repo.dirtyCount()).toBe(2);
      });

      it('applyRemote applies newer rows, ignores older ones, and stores them clean', () => {
        repo.setCount('a', 'c-1', 'normal', 1, stamp(5));
        repo.setCount('a', 'c-2', 'normal', 1, stamp(5));
        repo.markSynced(repo.dirtyChanges(10));
        const res = repo.applyRemote({
          collection: [
            { cardId: 'c-1', kind: 'normal', setId: 'a', count: 7, updatedAt: stamp(6) },
            { cardId: 'c-2', kind: 'normal', setId: 'a', count: 9, updatedAt: stamp(4) },
            { cardId: 'c-3', kind: 'normal', setId: 'b', count: 2, updatedAt: stamp(1) },
          ],
          tracked: [],
        });
        expect(res.affectedSetIds.sort()).toEqual(['a', 'b']);
        expect(repo.countsForSet('a')).toEqual({ 'c-1:normal': 7, 'c-2:normal': 1 });
        expect(repo.countsForSet('b')).toEqual({ 'c-3:normal': 2 });
        expect(repo.dirtyCount()).toBe(0);
      });

      it('applyRemote keeps the local row on an exact tie and leaves it dirty', () => {
        repo.setCount('a', 'c-1', 'normal', 1, stamp(5));
        const res = repo.applyRemote({
          collection: [{ cardId: 'c-1', kind: 'normal', setId: 'a', count: 9, updatedAt: stamp(5) }],
          tracked: [],
        });
        expect(res.affectedSetIds).toEqual([]);
        expect(repo.countsForSet('a')).toEqual({ 'c-1:normal': 1 });
        expect(repo.dirtyCount()).toBe(1);
      });

      it('applyRemote follows a card moved to another set and reports both sets', () => {
        repo.setCount('a', 'c-1', 'normal', 1, stamp(1));
        const res = repo.applyRemote({
          collection: [{ cardId: 'c-1', kind: 'normal', setId: 'b', count: 3, updatedAt: stamp(2) }],
          tracked: [],
        });
        expect(res.affectedSetIds.sort()).toEqual(['a', 'b']);
        expect(repo.countsForSet('b')).toEqual({ 'c-1:normal': 3 });
        expect(repo.countsForSet('a')).toEqual({});
      });

      it('applyRemote revives and removes tracked sets with their hidden categories', () => {
        repo.trackSet('a', stamp(1));
        repo.markSynced(repo.dirtyChanges(10));
        repo.applyRemote({
          collection: [],
          tracked: [{ setId: 'a', hiddenCategoryIds: ['promos'], addedAt: stamp(1), removedAt: stamp(3), updatedAt: stamp(3) }],
        });
        expect(repo.listTracked()).toEqual([]);
        repo.applyRemote({
          collection: [],
          tracked: [
            { setId: 'a', hiddenCategoryIds: ['promos', 'x'], addedAt: stamp(4), removedAt: null, updatedAt: stamp(4) },
            { setId: 'b', hiddenCategoryIds: [], addedAt: stamp(2), removedAt: null, updatedAt: stamp(2) },
          ],
        });
        expect(repo.listTracked()).toEqual([
          { setId: 'b', hiddenCategoryIds: [], addedAt: stamp(2) },
          { setId: 'a', hiddenCategoryIds: ['promos', 'x'], addedAt: stamp(4) },
        ]);
        // stale remote does not resurrect/overwrite
        repo.applyRemote({
          collection: [],
          tracked: [{ setId: 'a', hiddenCategoryIds: [], addedAt: stamp(1), removedAt: stamp(2), updatedAt: stamp(2) }],
        });
        expect(repo.listTracked().map((t) => t.setId)).toEqual(['b', 'a']);
        expect(repo.dirtyCount()).toBe(0);
      });

      it('stores sync state', () => {
        expect(repo.getSyncState()).toEqual({ cursor: 0, lastSyncedAt: null });
        repo.setSyncState({ cursor: 42, lastSyncedAt: stamp(1) });
        expect(repo.getSyncState()).toEqual({ cursor: 42, lastSyncedAt: stamp(1) });
        repo.setSyncState({ cursor: 50, lastSyncedAt: null });
        expect(repo.getSyncState()).toEqual({ cursor: 50, lastSyncedAt: null });
      });

      it('wipe clears everything including sync state', () => {
        repo.trackSet('a', stamp(1));
        repo.setCount('a', 'c-1', 'normal', 2, stamp(2));
        repo.setSyncState({ cursor: 9, lastSyncedAt: stamp(3) });
        repo.wipe();
        expect(repo.listTracked()).toEqual([]);
        expect(repo.countsForSet('a')).toEqual({});
        expect(repo.dirtyCount()).toBe(0);
        expect(repo.getSyncState()).toEqual({ cursor: 0, lastSyncedAt: null });
      });
    });
  });
}
