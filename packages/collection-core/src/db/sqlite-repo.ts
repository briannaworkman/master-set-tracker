import { clampCount, versionKey, type VersionKey } from '../keys';
import { migrate } from './migrations';
import { takeOldest } from '../sync/dirty-merge';
import { isNewerOrEqual, stampAfter, type CollectionRow, type TrackedRow } from '../sync/types';
import type { CollectionRepo, SqlDb, TrackedSet } from './sql-db';

function parseIds(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : [];
  } catch {
    return [];
  }
}

export function createSqliteRepo(db: SqlDb): CollectionRepo {
  migrate(db);
  return {
    listTracked() {
      return db
        .all<{ set_id: string; hidden_category_ids: string; added_at: string }>(
          'SELECT set_id, hidden_category_ids, added_at FROM tracked_sets WHERE removed_at IS NULL ORDER BY added_at ASC, rowid ASC',
        )
        .map((r): TrackedSet => ({
          setId: r.set_id,
          hiddenCategoryIds: parseIds(r.hidden_category_ids),
          addedAt: r.added_at,
        }));
    },
    trackSet(setId, now) {
      const cur = db.first<{ removed_at: string | null; updated_at: string }>(
        'SELECT removed_at, updated_at FROM tracked_sets WHERE set_id = ?',
        [setId],
      );
      if (cur && cur.removed_at === null) return;
      const updatedAt = stampAfter(now, cur?.updated_at);
      db.run(
        `INSERT INTO tracked_sets (set_id, hidden_category_ids, added_at, updated_at, dirty) VALUES (?, '[]', ?, ?, 1)
         ON CONFLICT (set_id) DO UPDATE SET removed_at = NULL, added_at = excluded.added_at, updated_at = excluded.updated_at, dirty = 1
         WHERE tracked_sets.removed_at IS NOT NULL`,
        [setId, now, updatedAt],
      );
    },
    untrackSet(setId, now) {
      const cur = db.first<{ updated_at: string }>('SELECT updated_at FROM tracked_sets WHERE set_id = ? AND removed_at IS NULL', [setId]);
      if (!cur) return;
      db.run('UPDATE tracked_sets SET removed_at = ?, updated_at = ?, dirty = 1 WHERE set_id = ? AND removed_at IS NULL', [
        now,
        stampAfter(now, cur.updated_at),
        setId,
      ]);
    },
    setHiddenCategories(setId, ids, now) {
      const cur = db.first<{ updated_at: string }>('SELECT updated_at FROM tracked_sets WHERE set_id = ? AND removed_at IS NULL', [setId]);
      if (!cur) return;
      db.run(
        `UPDATE tracked_sets SET hidden_category_ids = ?, updated_at = ?, dirty = 1
         WHERE set_id = ? AND removed_at IS NULL AND hidden_category_ids IS NOT ?`,
        [JSON.stringify(ids), stampAfter(now, cur.updated_at), setId, JSON.stringify(ids)],
      );
    },
    countsForSet(setId) {
      const out: Record<VersionKey, number> = {};
      for (const r of db.all<{ card_id: string; kind: string; count: number }>(
        'SELECT card_id, kind, count FROM collection WHERE set_id = ? AND count > 0',
        [setId],
      )) {
        out[versionKey(r.card_id, r.kind)] = r.count;
      }
      return out;
    },
    setCount(setId, cardId, kind, count, now) {
      const next = clampCount(count);
      const cur = db.first<{ set_id: string; count: number; updated_at: string }>('SELECT set_id, count, updated_at FROM collection WHERE card_id = ? AND kind = ?', [
        cardId,
        kind,
      ]);
      if (cur ? cur.count === next && cur.set_id === setId : next === 0) return;
      db.run(
        `INSERT INTO collection (set_id, card_id, kind, count, updated_at, dirty) VALUES (?, ?, ?, ?, ?, 1)
         ON CONFLICT (card_id, kind) DO UPDATE SET set_id = excluded.set_id, count = excluded.count, updated_at = excluded.updated_at, dirty = 1`,
        [setId, cardId, kind, next, stampAfter(now, cur?.updated_at)],
      );
    },
    dirtyChanges(limit) {
      const collection = db
        .all<{ card_id: string; kind: string; set_id: string; count: number; updated_at: string }>(
          'SELECT card_id, kind, set_id, count, updated_at FROM collection WHERE dirty = 1 ORDER BY updated_at ASC, rowid ASC LIMIT ?',
          [limit],
        )
        .map((r): CollectionRow => ({ cardId: r.card_id, kind: r.kind, setId: r.set_id, count: r.count, updatedAt: r.updated_at }));
      const tracked = db
        .all<TrackedDbRow>(
          'SELECT set_id, hidden_category_ids, added_at, removed_at, updated_at FROM tracked_sets WHERE dirty = 1 ORDER BY updated_at ASC, rowid ASC LIMIT ?',
          [limit],
        )
        .map(toTrackedRow);
      return takeOldest(collection, tracked, limit);
    },
    markSynced(changes) {
      db.transaction(() => {
        for (const r of changes.collection) {
          db.run('UPDATE collection SET dirty = 0 WHERE card_id = ? AND kind = ? AND updated_at = ? AND count = ? AND set_id = ?',
            [r.cardId, r.kind, r.updatedAt, r.count, r.setId],);
        }
        for (const r of changes.tracked) {
          db.run(
            `UPDATE tracked_sets SET dirty = 0 WHERE set_id = ? AND updated_at = ? AND hidden_category_ids = ?
             AND removed_at IS ? AND added_at = ?`,
            [r.setId, r.updatedAt, JSON.stringify(r.hiddenCategoryIds), r.removedAt, r.addedAt],
          );
        }
      });
    },
    applyRemote(changes) {
      return db.transaction(() => {
        const affected = new Set<string>();
        for (const r of changes.collection) {
          const local = db.first<{ set_id: string; updated_at: string }>(
            'SELECT set_id, updated_at FROM collection WHERE card_id = ? AND kind = ?',
            [r.cardId, r.kind],
          );
          if (local && !isNewerOrEqual(r.updatedAt, local.updated_at)) continue;
          db.run(
            `INSERT INTO collection (set_id, card_id, kind, count, updated_at, dirty) VALUES (?, ?, ?, ?, ?, 0)
             ON CONFLICT (card_id, kind) DO UPDATE SET set_id = excluded.set_id, count = excluded.count, updated_at = excluded.updated_at, dirty = 0`,
            [r.setId, r.cardId, r.kind, clampCount(r.count), r.updatedAt],
          );
          affected.add(r.setId);
          if (local) affected.add(local.set_id);
        }
        for (const r of changes.tracked) {
          const local = db.first<{ updated_at: string }>('SELECT updated_at FROM tracked_sets WHERE set_id = ?', [r.setId]);
          if (local && !isNewerOrEqual(r.updatedAt, local.updated_at)) continue;
          db.run(
            `INSERT INTO tracked_sets (set_id, hidden_category_ids, added_at, removed_at, updated_at, dirty) VALUES (?, ?, ?, ?, ?, 0)
             ON CONFLICT (set_id) DO UPDATE SET hidden_category_ids = excluded.hidden_category_ids, added_at = excluded.added_at,
               removed_at = excluded.removed_at, updated_at = excluded.updated_at, dirty = 0`,
            [r.setId, JSON.stringify(r.hiddenCategoryIds), r.addedAt, r.removedAt, r.updatedAt],
          );
          affected.add(r.setId);
        }
        return { affectedSetIds: [...affected] };
      });
    },
    getSyncState() {
      const r = db.first<{ cursor: number; last_synced_at: string | null }>('SELECT cursor, last_synced_at FROM sync_state WHERE id = 1');
      return { cursor: r?.cursor ?? 0, lastSyncedAt: r?.last_synced_at ?? null };
    },
    setSyncState(s) {
      db.run(
        `INSERT INTO sync_state (id, cursor, last_synced_at) VALUES (1, ?, ?)
         ON CONFLICT (id) DO UPDATE SET cursor = excluded.cursor, last_synced_at = excluded.last_synced_at`,
        [s.cursor, s.lastSyncedAt],
      );
    },
    dirtyCount() {
      const c = db.first<{ n: number }>('SELECT (SELECT count(*) FROM collection WHERE dirty = 1) + (SELECT count(*) FROM tracked_sets WHERE dirty = 1) AS n');
      return c?.n ?? 0;
    },
    wipe() {
      db.transaction(() => {
        for (const t of ['collection', 'tracked_sets', 'sync_state', 'prices']) db.run(`DELETE FROM ${t}`);
      });
    },
  };
}

interface TrackedDbRow {
  set_id: string;
  hidden_category_ids: string;
  added_at: string;
  removed_at: string | null;
  updated_at: string;
}

const toTrackedRow = (r: TrackedDbRow): TrackedRow => ({
  setId: r.set_id,
  hiddenCategoryIds: parseIds(r.hidden_category_ids),
  addedAt: r.added_at,
  removedAt: r.removed_at,
  updatedAt: r.updated_at,
});
