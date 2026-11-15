import type { LocalChanges, SyncRemote } from '@mst/collection-core';
import type { SupabaseClient } from '@supabase/supabase-js';

function fail(error: { message?: string }): never {
  // Keep the supabase error (message) so isNetworkError can classify fetch failures.
  throw error instanceof Error ? error : Object.assign(new Error(error.message ?? 'Request failed'), error);
}

export function createSupabaseRemote(client: SupabaseClient): SyncRemote {
  return {
    async push(changes: LocalChanges) {
      const { error } = await client.rpc('push_changes', {
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
      });
      if (error) fail(error);
    },

    async pull(cursor: number, limit: number) {
      const { data, error } = await client.rpc('pull_changes', { p_cursor: cursor, p_limit: limit });
      if (error) fail(error);
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
    },
  };
}

const PAGE = 1000;

/** `cardId|variant` -> USD for one set; pages through PostgREST's 1000-row cap. */
export async function fetchSetPrices(client: SupabaseClient, setId: string): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from('card_prices')
      .select('card_id, variant, usd')
      .eq('set_id', setId)
      .order('card_id')
      .order('variant')
      .range(from, from + PAGE - 1);
    if (error) fail(error);
    const rows = (data ?? []) as Array<{ card_id: string; variant: string; usd: number | string }>;
    for (const r of rows) prices[`${r.card_id}|${r.variant}`] = Number(r.usd);
    if (rows.length < PAGE) break;
  }
  return prices;
}
