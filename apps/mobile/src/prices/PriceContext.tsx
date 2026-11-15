import { emptyPriceBook, type PriceBook } from '@mst/collection-core';
import { createContext, useContext, type ReactNode } from 'react';

const PriceContext = createContext<PriceBook>(emptyPriceBook);

export function PriceProvider({ priceBook, children }: { priceBook: PriceBook; children: ReactNode }) {
  return <PriceContext.Provider value={priceBook}>{children}</PriceContext.Provider>;
}

/** Plan 2 ships no prices, so this is `emptyPriceBook` unless a PriceProvider supplies one. */
export function usePriceBook(): PriceBook {
  return useContext(PriceContext);
}
