import { clampCount, versionKey, type VersionKey } from '../keys';
import { migrate } from './migrations';
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
      db.run(
        `INSERT INTO tracked_sets (set_id, hidden_category_ids, added_at, updated_at) VALUES (?, '[]', ?, ?)
         ON CONFLICT (set_id) DO UPDATE SET removed_at = NULL, added_at = excluded.added_at, updated_at = excluded.updated_at
         WHERE tracked_sets.removed_at IS NOT NULL`,
        [setId, now, now],
      );
    },
    untrackSet(setId, now) {
      db.run('UPDATE tracked_sets SET removed_at = ?, updated_at = ? WHERE set_id = ? AND removed_at IS NULL', [
        now,
        now,
        setId,
      ]);
    },
    setHiddenCategories(setId, ids, now) {
      db.run(
        `UPDATE tracked_sets SET hidden_category_ids = ?, updated_at = ?
         WHERE set_id = ? AND removed_at IS NULL AND hidden_category_ids IS NOT ?`,
        [JSON.stringify(ids), now, setId, JSON.stringify(ids)],
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
      db.run(
        `INSERT INTO collection (set_id, card_id, kind, count, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (card_id, kind) DO UPDATE SET set_id = excluded.set_id, count = excluded.count, updated_at = excluded.updated_at`,
        [setId, cardId, kind, clampCount(count), now],
      );
    },
  };
}
