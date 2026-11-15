// Pure helpers for the daily price refresh. No Deno or Node APIs, so both the Deno Edge
// Function and the vitest suite can import this file.

export type Variant = 'normal' | 'holofoil' | 'reverse-holofoil';

export interface PriceRow {
  card_id: string;
  set_id: string;
  variant: Variant;
  usd: number;
  source_updated_at: string | null;
}

const VARIANTS: readonly Variant[] = ['normal', 'holofoil', 'reverse-holofoil'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * USD TCGplayer `marketPrice` per variant from a TCGdex card response. A variant with a
 * null, absent, non-numeric, non-finite or negative price is skipped (never written as 0).
 */
export function pricesFromTcgdexCard(setId: string, card: unknown): PriceRow[] {
  if (!isRecord(card) || typeof card.id !== 'string') return [];
  const pricing = card.pricing;
  const tcg = isRecord(pricing) ? pricing.tcgplayer : undefined;
  if (!isRecord(tcg)) return [];
  const updated = typeof tcg.updated === 'string' ? tcg.updated : null;
  const rows: PriceRow[] = [];
  for (const variant of VARIANTS) {
    const entry = tcg[variant];
    if (!isRecord(entry)) continue;
    const price = entry.marketPrice;
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) continue;
    rows.push({ card_id: card.id, set_id: setId, variant, usd: price, source_updated_at: updated });
  }
  return rows;
}

/**
 * Fetches a set's card list, then each card with bounded concurrency. A failing card is
 * recorded in `failedCards` and never thrown. A failing set-list fetch throws.
 */
export async function refreshSet(opts: {
  setId: string;
  tcgdexSetId: string;
  fetchJson(path: string): Promise<unknown>;
  concurrency?: number;
}): Promise<{ rows: PriceRow[]; failedCards: string[] }> {
  const { setId, tcgdexSetId, fetchJson } = opts;
  const concurrency = Math.max(1, Math.floor(opts.concurrency ?? 6));
  const set = await fetchJson(`/sets/${tcgdexSetId}`);
  const list = isRecord(set) && Array.isArray(set.cards) ? set.cards : [];
  const ids: string[] = [];
  for (const c of list) if (isRecord(c) && typeof c.id === 'string') ids.push(c.id);

  const rows: PriceRow[] = [];
  const failedCards: string[] = [];
  let next = 0;
  async function worker(): Promise<void> {
    while (next < ids.length) {
      const id = ids[next++]!;
      try {
        rows.push(...pricesFromTcgdexCard(setId, await fetchJson(`/cards/${id}`)));
      } catch {
        failedCards.push(id);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  failedCards.sort();
  return { rows, failedCards };
}
