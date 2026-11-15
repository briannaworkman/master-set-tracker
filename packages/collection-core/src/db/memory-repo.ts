import { clampCount, versionKey, type VersionKey } from '../keys';
import type { CollectionRepo, TrackedSet } from './sql-db';

export function createMemoryRepo(): CollectionRepo {
  const tracked = new Map<string, TrackedSet>();
  const counts = new Map<string, Map<VersionKey, number>>();
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
      for (const [k, n] of counts.get(setId) ?? []) if (n > 0) out[k] = n;
      return out;
    },
    setCount(setId, cardId, kind, count) {
      let m = counts.get(setId);
      if (!m) counts.set(setId, (m = new Map()));
      m.set(versionKey(cardId, kind), clampCount(count));
    },
  };
}
