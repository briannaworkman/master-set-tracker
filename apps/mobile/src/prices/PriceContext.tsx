import { emptyPriceBook, type PriceBook } from '@mst/collection-core';
import { createContext, useContext, type ReactNode } from 'react';
import { useSyncSession } from '../sync/SyncProvider';
import { usePriceRefresh, type PriceRefreshOptions } from './usePriceRefresh';

const PriceContext = createContext<PriceBook>(emptyPriceBook);

export function PriceProvider({ priceBook, children }: { priceBook: PriceBook; children: ReactNode }) {
  return <PriceContext.Provider value={priceBook}>{children}</PriceContext.Provider>;
}

/** Provides the cached prices of the tracked sets, keeping them fresh (see usePriceRefresh). */
export function RefreshingPriceProvider({ children, ...options }: PriceRefreshOptions & { children: ReactNode }) {
  const priceBook = usePriceRefresh(options);
  return <PriceProvider priceBook={priceBook}>{children}</PriceProvider>;
}

/**
 * RefreshingPriceProvider for the app: fetches only while the sync session allows it (signed in,
 * the local data checked, not signing out), so another account's sets are never fetched.
 */
export function SessionPriceProvider({ children, ...options }: Omit<PriceRefreshOptions, 'enabled'> & { children: ReactNode }) {
  const { pricesEnabled } = useSyncSession();
  return (
    <RefreshingPriceProvider {...options} enabled={pricesEnabled}>
      {children}
    </RefreshingPriceProvider>
  );
}

/** `emptyPriceBook` unless a PriceProvider supplies one. */
export function usePriceBook(): PriceBook {
  return useContext(PriceContext);
}
