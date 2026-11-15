import { clampCount, versionKey, type VersionKey } from '../keys';
import { isNewer, type CollectionRow, type SyncState, type TrackedRow } from '../sync/types';
import { takeOldest } from './sqlite-repo';
import type { CollectionRepo, TrackedSet } from './sql-db';

interface TrackedEntry extends TrackedRow {
  dirty: boolean;
}
interface CountEntry extends CollectionRow {
  dirty: boolean;
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const strip = <T extends { dirty: boolean }>({ dirty: _d, ...rest }: T): Omit<T, 'dirty'> => rest;

/** In-memory mirror of the SQLite repo, including soft-deleted tracked sets and dirty flags. */
export function createMemoryRepo(): CollectionRepo {
  const tracked = new Map<string, TrackedEntry>();
  // Keyed globally by (cardId, kind) like the SQLite primary key; a write updates the row's setId.
  const counts = new Map<VersionKey, CountEntry>();
  let sync: SyncState = { cursor: 0, lastSyncedAt: null };
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
        tracked.set(setId, { setId, hiddenCategoryIds: [], addedAt: now, updatedAt: now, removedAt: null, dirty: true });
      } else if (t.removedAt !== null) {
        Object.assign(t, { addedAt: now, updatedAt: now, removedAt: null, dirty: true });
      }
    },
    untrackSet(setId, now) {
      const t = tracked.get(setId);
      if (t && t.removedAt === null) Object.assign(t, { removedAt: now, updatedAt: now, dirty: true });
    },
    setHiddenCategories(setId, ids, now) {
      const t = tracked.get(setId);
      if (t && t.removedAt === null && !sameIds(t.hiddenCategoryIds, ids)) {
        Object.assign(t, { hiddenCategoryIds: [...ids], updatedAt: now, dirty: true });
      }
    },
    countsForSet(setId) {
      const out: Record<VersionKey, number> = {};
      for (const [k, row] of counts) if (row.setId === setId && row.count > 0) out[k] = row.count;
      return out;
    },
    setCount(setId, cardId, kind, count, now) {
      const key = versionKey(cardId, kind);
      const next = clampCount(count);
      const cur = counts.get(key);
      if (cur ? cur.count === next && cur.setId === setId : next === 0) return;
      counts.set(key, { cardId, kind, setId, count: next, updatedAt: now, dirty: true });
    },
    dirtyChanges(limit) {
      return takeOldest(
        [...counts.values()].filter((r) => r.dirty).map((r) => strip(r)),
        [...tracked.values()].filter((r) => r.dirty).map((r) => ({ ...strip(r), hiddenCategoryIds: [...r.hiddenCategoryIds] })),
        limit,
      );
    },
    markSynced(changes) {
      for (const r of changes.collection) {
        const c = counts.get(versionKey(r.cardId, r.kind));
        if (c && c.updatedAt === r.updatedAt) c.dirty = false;
      }
      for (const r of changes.tracked) {
        const t = tracked.get(r.setId);
        if (t && t.updatedAt === r.updatedAt) t.dirty = false;
      }
    },
    applyRemote(changes) {
      const affected = new Set<string>();
      for (const r of changes.collection) {
        const key = versionKey(r.cardId, r.kind);
        const local = counts.get(key);
        if (local && !isNewer(r.updatedAt, local.updatedAt)) continue;
        counts.set(key, { ...r, count: clampCount(r.count), dirty: false });
        affected.add(r.setId);
        if (local) affected.add(local.setId);
      }
      for (const r of changes.tracked) {
        const local = tracked.get(r.setId);
        if (local && !isNewer(r.updatedAt, local.updatedAt)) continue;
        tracked.set(r.setId, { ...r, hiddenCategoryIds: [...r.hiddenCategoryIds], dirty: false });
        affected.add(r.setId);
      }
      return { affectedSetIds: [...affected] };
    },
    getSyncState: () => ({ ...sync }),
    setSyncState(s) {
      sync = { ...s };
    },
    dirtyCount() {
      return [...counts.values()].filter((r) => r.dirty).length + [...tracked.values()].filter((r) => r.dirty).length;
    },
    wipe() {
      tracked.clear();
      counts.clear();
      sync = { cursor: 0, lastSyncedAt: null };
    },
  };
}
