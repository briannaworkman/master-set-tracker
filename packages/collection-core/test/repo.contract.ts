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
  });
}
