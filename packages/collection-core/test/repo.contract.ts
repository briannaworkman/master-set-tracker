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
      repo.untrackSet('a');
      expect(repo.listTracked()).toEqual([]);
      repo.trackSet('a', 't2');
      expect(repo.countsForSet('a')['c-001:normal']).toBe(3);
    });

    it('stores hidden categories per set', () => {
      repo.trackSet('a', 't0');
      repo.trackSet('b', 't0');
      repo.setHiddenCategories('a', ['promos']);
      expect(repo.listTracked().find((t) => t.setId === 'a')!.hiddenCategoryIds).toEqual(['promos']);
      expect(repo.listTracked().find((t) => t.setId === 'b')!.hiddenCategoryIds).toEqual([]);
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
