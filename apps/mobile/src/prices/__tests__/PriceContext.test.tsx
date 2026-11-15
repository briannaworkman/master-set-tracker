import { renderHook } from '@testing-library/react-native';
import { emptyPriceBook, type PriceBook } from '@mst/collection-core';
import type { ReactNode } from 'react';
import { PriceProvider, usePriceBook } from '../PriceContext';

describe('PriceContext', () => {
  it('defaults to the empty price book', async () => {
    expect((await renderHook(() => usePriceBook())).result.current).toBe(emptyPriceBook);
  });

  it('provides the given price book', async () => {
    const book: PriceBook = { price: () => 1.5 };
    const wrapper = ({ children }: { children: ReactNode }) => <PriceProvider priceBook={book}>{children}</PriceProvider>;
    expect((await renderHook(() => usePriceBook(), { wrapper })).result.current).toBe(book);
  });
});
