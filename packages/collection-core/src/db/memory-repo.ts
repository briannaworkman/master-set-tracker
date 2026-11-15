import { clampCount, versionKey, type VersionKey } from '../keys';
import type { CollectionRepo, TrackedSet } from './sql-db';

interface TrackedRow extends TrackedSet {
  removedAt: string | null;
  updatedAt: string;
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** In-memory mirror of the SQLite repo, including soft-deleted tracked sets. */
export function createMemoryRepo(): CollectionRepo {
  const tracked = new Map<string, TrackedRow>();
  // Keyed globally by (cardId, kind) like the SQLite primary key; a write updates the row's setId.
  const counts = new Map<VersionKey, { setId: string; count: number }>();
  return {
    listTracked() {
      return [...tracked.values()]
        .filter((t) => t.removedAt === null)
        .map((t): TrackedSet => ({ setId: t.setId, hiddenCategoryIds: [...t.hiddenCategoryIds], addedAt: t.addedAt }))
        .sort((a, b) => (a.addedAt < b.addedAt ? -1 : a.addedAt > b.addedAt ? 1 : 0));
    },
    trackSet(setId, now) {
      const t = tracked.get(setId);
      if (!t) {
        tracked.set(setId, { setId, hiddenCategoryIds: [], addedAt: now, updatedAt: now, removedAt: null });
      } else if (t.removedAt !== null) {
        Object.assign(t, { addedAt: now, updatedAt: now, removedAt: null });
      }
    },
    untrackSet(setId, now) {
      const t = tracked.get(setId);
      if (t && t.removedAt === null) Object.assign(t, { removedAt: now, updatedAt: now });
    },
    setHiddenCategories(setId, ids, now) {
      const t = tracked.get(setId);
      if (t && t.removedAt === null && !sameIds(t.hiddenCategoryIds, ids)) {
        Object.assign(t, { hiddenCategoryIds: [...ids], updatedAt: now });
      }
    },
    countsForSet(setId) {
      const out: Record<VersionKey, number> = {};
      for (const [k, row] of counts) if (row.setId === setId && row.count > 0) out[k] = row.count;
      return out;
    },
    setCount(setId, cardId, kind, count) {
      counts.set(versionKey(cardId, kind), { setId, count: clampCount(count) });
    },
  };
}
