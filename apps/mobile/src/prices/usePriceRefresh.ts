import { priceBookFromCache, type PriceBook, type PriceCache } from '@mst/collection-core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTracked } from '../db/StoreContext';
import { PERIODIC_MS, watchAppTriggers } from '../sync/appTriggers';

/** A set's cached prices are refetched once they are this old. */
export const PRICE_STALE_MS = 12 * 60 * 60_000;

export interface PriceRefreshOptions {
  cache: PriceCache;
  /** `cardId|variant` -> USD for one set. */
  fetchPrices: (setId: string) => Promise<Record<string, number>>;
  /** False while signed out: prices are readable only by signed-in users. */
  enabled: boolean;
}

/**
 * The PriceBook for the tracked sets, read from `cache`. While enabled and online, each tracked set
 * whose cache is missing or older than 12 h is fetched and stored; the book is rebuilt after each
 * store. Checks run on mount, when the tracked sets change, on foreground, when the network comes
 * back and every 15 min while foregrounded. A failed fetch keeps the old cache and is retried at
 * the next check.
 */
export function usePriceRefresh({ cache, fetchPrices, enabled }: PriceRefreshOptions): PriceBook {
  const tracked = useTracked();
  const setIdsKey = tracked.map((t) => t.setId).join('\n');
  const setIds = useMemo(() => (setIdsKey ? setIdsKey.split('\n') : []), [setIdsKey]);
  const [version, setVersion] = useState(0);
  // `version` bumps after each cache put, so the snapshot is rebuilt.
  const priceBook = useMemo(() => priceBookFromCache(cache, setIds), [cache, setIds, version]);

  const latest = useRef({ setIds, fetchPrices });
  latest.current = { setIds, fetchPrices };
  const check = useRef<() => void>(() => {});

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const inFlight = new Set<string>();
    let interval: ReturnType<typeof setInterval> | null = null;

    const refresh = () => {
      if (disposed || !triggers.isOnline()) return;
      for (const setId of latest.current.setIds) {
        if (inFlight.has(setId)) continue;
        const cached = cache.get(setId);
        if (cached && Date.now() - Date.parse(cached.fetchedAt) < PRICE_STALE_MS) continue;
        inFlight.add(setId);
        latest.current
          .fetchPrices(setId)
          .then(
            (prices) => {
              if (disposed) return;
              cache.put(setId, new Date().toISOString(), prices);
              setVersion((v) => v + 1);
            },
            () => {
              // Silent: keep the old cache and try again at the next check.
            },
          )
          .finally(() => inFlight.delete(setId));
      }
    };
    const startInterval = () => {
      interval ??= setInterval(refresh, PERIODIC_MS);
    };

    const triggers = watchAppTriggers({
      onForeground: () => {
        startInterval();
        refresh();
      },
      onBackground: () => {
        if (interval !== null) clearInterval(interval);
        interval = null;
      },
      onOnlineChange: (online) => {
        if (online) refresh();
      },
    });
    if (triggers.isForeground()) startInterval();
    check.current = refresh;
    refresh();

    return () => {
      disposed = true;
      check.current = () => {};
      triggers.dispose();
      if (interval !== null) clearInterval(interval);
    };
  }, [enabled, cache]);

  // A newly tracked set is checked at once.
  useEffect(() => {
    check.current();
  }, [setIds]);

  return priceBook;
}
