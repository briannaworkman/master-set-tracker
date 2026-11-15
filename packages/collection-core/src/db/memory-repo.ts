import { clampCount, versionKey, type VersionKey } from '../keys';
import type { CollectionRepo, TrackedSet } from './sql-db';

export function createMemoryRepo(): CollectionRepo {
  const tracked = new Map<string, TrackedSet>();
  // Keyed globally by (cardId, kind) like the SQLite primary key; a write updates the row's setId.
  const counts = new Map<VersionKey, { setId: string; count: number }>();
  return {
    listTracked() {
      return [...tracked.values()]
        .map((t) => ({ ...t, hiddenCategoryIds: [...t.hiddenCategoryIds] }))
        .sort((a, b) => (a.addedAt < b.addedAt ? -1 : a.addedAt > b.addedAt ? 1 : 0));
    },
    trackSet(setId, now) {
      if (!tracked.has(setId)) tracked.set(setId, { setId, hiddenCategoryIds: [], addedAt: now });
    },
    untrackSet(setId) {
      tracked.delete(setId);
    },
    setHiddenCategories(setId, ids) {
      const t = tracked.get(setId);
      if (t) t.hiddenCategoryIds = [...ids];
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
