import { fromPullResult, toPushParams, type LocalChanges, type SyncRemote } from '@mst/collection-core';
import type { SupabaseClient } from '@supabase/supabase-js';

function fail(error: { message?: string }): never {
  // Keep the supabase error (message) so isNetworkError can classify fetch failures.
  throw error instanceof Error ? error : Object.assign(new Error(error.message ?? 'Request failed'), error);
}

/** SyncRemote over the push_changes / pull_changes RPCs (wire mapping shared with the PGlite tests). */
export function createSupabaseRemote(client: SupabaseClient): SyncRemote {
  return {
    async push(changes: LocalChanges) {
      const { error } = await client.rpc('push_changes', { ...toPushParams(changes) });
      if (error) fail(error);
    },

    async pull(cursor: number, limit: number) {
      const { data, error } = await client.rpc('pull_changes', { p_cursor: cursor, p_limit: limit });
      if (error) fail(error);
      return fromPullResult(data, cursor);
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
