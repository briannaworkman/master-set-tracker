import type { LocalChanges } from './types';

/**
 * The backend's wire format (snake_case) for push_changes / pull_changes. Shared by the app's
 * Supabase remote and the PGlite integration test, so both exercise the same mapping.
 */
export interface WireCollectionRow {
  card_id: string;
  kind: string;
  set_id: string;
  count: number;
  updated_at: string;
}

export interface WireTrackedRow {
  set_id: string;
  hidden_category_ids: string[];
  added_at: string;
  removed_at: string | null;
  updated_at: string;
}

/** push_changes(p_collection, p_tracked) parameters. */
export interface PushParams {
  p_collection: WireCollectionRow[];
  p_tracked: WireTrackedRow[];
}

export function toPushParams(changes: LocalChanges): PushParams {
  return {
    p_collection: changes.collection.map((r) => ({
      card_id: r.cardId,
      kind: r.kind,
      set_id: r.setId,
      count: r.count,
      updated_at: r.updatedAt,
    })),
    p_tracked: changes.tracked.map((r) => ({
      set_id: r.setId,
      hidden_category_ids: r.hiddenCategoryIds,
      added_at: r.addedAt,
      removed_at: r.removedAt,
      updated_at: r.updatedAt,
    })),
  };
}

/** Maps a pull_changes result back to local rows; a missing next_cursor keeps `cursor`. */
export function fromPullResult(
  data: unknown,
  cursor: number,
): { changes: LocalChanges; nextCursor: number; hasMore: boolean } {
  const d = (data ?? {}) as Record<string, any>;
  return {
    changes: {
      collection: ((d.collection ?? []) as any[]).map((r) => ({
        cardId: String(r.card_id),
        kind: String(r.kind),
        setId: String(r.set_id),
        count: Number(r.count),
        updatedAt: String(r.updated_at),
      })),
      tracked: ((d.tracked ?? []) as any[]).map((r) => ({
        setId: String(r.set_id),
        hiddenCategoryIds: ((r.hidden_category_ids ?? []) as unknown[]).map(String),
        addedAt: String(r.added_at),
        removedAt: r.removed_at == null ? null : String(r.removed_at),
        updatedAt: String(r.updated_at),
      })),
    },
    nextCursor: Number(d.next_cursor ?? cursor),
    hasMore: Boolean(d.has_more),
  };
}
