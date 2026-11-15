import { clampCount, versionKey, type VersionKey } from '../keys';
import { migrate } from './migrations';
import type { CollectionRepo, SqlDb, TrackedSet } from './sql-db';

export function createSqliteRepo(db: SqlDb): CollectionRepo {
  migrate(db);
  return {
    listTracked() {
      return db
        .all<{ set_id: string; hidden_category_ids: string; added_at: string }>(
          'SELECT set_id, hidden_category_ids, added_at FROM tracked_sets ORDER BY added_at ASC, rowid ASC',
        )
        .map((r): TrackedSet => ({
          setId: r.set_id,
          hiddenCategoryIds: JSON.parse(r.hidden_category_ids) as string[],
          addedAt: r.added_at,
        }));
    },
    trackSet(setId, now) {
      db.run('INSERT OR IGNORE INTO tracked_sets (set_id, hidden_category_ids, added_at) VALUES (?, ?, ?)', [
        setId,
        '[]',
        now,
      ]);
    },
    untrackSet(setId) {
      db.run('DELETE FROM tracked_sets WHERE set_id = ?', [setId]);
    },
    setHiddenCategories(setId, ids) {
      db.run('UPDATE tracked_sets SET hidden_category_ids = ? WHERE set_id = ?', [JSON.stringify(ids), setId]);
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
