import type { SqlDb } from '../db/sql-db';
import type { PriceBook } from '../value';
import type { VersionKey } from '../keys';
import { priceVariantFor } from './price-variant';

export interface CachedPrices {
  fetchedAt: string;
  /** Keyed `${cardId}|${variant}`. */
  prices: Record<string, number>;
}

export interface PriceCache {
  get(setId: string): CachedPrices | null;
  put(setId: string, fetchedAt: string, prices: Record<string, number>): void;
  /** Removes every set's prices (sign-out). The SQLite repo's wipe() also clears its table. */
  clear(): void;
}

export function createSqlitePriceCache(db: SqlDb): PriceCache {
  return {
    get(setId) {
      const r = db.first<{ fetched_at: string; json: string }>('SELECT fetched_at, json FROM prices WHERE set_id = ?', [setId]);
      if (!r) return null;
      try {
        const v: unknown = JSON.parse(r.json);
        if (v && typeof v === 'object' && !Array.isArray(v)) return { fetchedAt: r.fetched_at, prices: v as Record<string, number> };
      } catch {
        // fall through: a corrupt row reads as a cache miss
      }
      return null;
    },
    put(setId, fetchedAt, prices) {
      db.run('INSERT OR REPLACE INTO prices (set_id, fetched_at, json) VALUES (?, ?, ?)', [setId, fetchedAt, JSON.stringify(prices)]);
    },
    clear() {
      db.run('DELETE FROM prices');
    },
  };
}

export function createMemoryPriceCache(): PriceCache {
  const sets = new Map<string, CachedPrices>();
  return {
    get(setId) {
      const c = sets.get(setId);
      return c ? { fetchedAt: c.fetchedAt, prices: { ...c.prices } } : null;
    },
    put(setId, fetchedAt, prices) {
      sets.set(setId, { fetchedAt, prices: { ...prices } });
    },
    clear() {
      sets.clear();
    },
  };
}

/**
 * Snapshot of the cached prices for `setIds`. A version resolves to the first variant (in
 * fallback order) with a usable price; a cached 0 counts as unknown, since a $0 market price
 * is almost always missing data.
 */
export function priceBookFromCache(cache: PriceCache, setIds: string[]): PriceBook {
  const snapshot = new Map<string, Record<string, number>>();
  for (const id of setIds) {
    const c = cache.get(id);
    if (c) snapshot.set(id, c.prices);
  }
  return {
    price(setId, key: VersionKey) {
      const prices = snapshot.get(setId);
      if (!prices) return null;
      const i = key.lastIndexOf(':');
      if (i < 0) return null;
      const cardId = key.slice(0, i);
      for (const variant of priceVariantFor(cardId, key.slice(i + 1))) {
        const p = prices[`${cardId}|${variant}`];
        if (typeof p === 'number' && Number.isFinite(p) && p > 0) return p;
      }
      return null;
    },
  };
}
