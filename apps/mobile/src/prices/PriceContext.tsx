import { emptyPriceBook, type PriceBook } from '@mst/collection-core';
import { createContext, useContext, type ReactNode } from 'react';
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

/** `emptyPriceBook` unless a PriceProvider supplies one. */
export function usePriceBook(): PriceBook {
  return useContext(PriceContext);
}
