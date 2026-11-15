import type { SetCatalog } from '@mst/catalog-core';
import { versionKey, type Counts, type VersionKey } from './keys';
import { visibleSections } from './progress';

export interface PriceBook {
  price(setId: string, key: VersionKey): number | null;
}

export const emptyPriceBook: PriceBook = { price: () => null };

const cents = (n: number): number => Math.round(n * 100) / 100;

export function setValue(
  catalog: SetCatalog,
  counts: Counts,
  hidden: readonly string[],
  prices: PriceBook,
): { owned: number; toFinish: number; hasPrices: boolean; incomplete: boolean } {
  let owned = 0;
  let toFinish = 0;
  let hasPrices = false;
  let incomplete = false;
  for (const { cards } of visibleSections(catalog, hidden)) {
    for (const card of cards) {
      for (const v of card.versions) {
        const key = versionKey(card.id, v.kind);
        const price = prices.price(catalog.id, key);
        if (price === null) {
          incomplete = true;
          continue;
        }
        hasPrices = true;
        const count = counts[key] ?? 0;
        owned += price * count;
        if (count === 0) toFinish += price;
      }
    }
  }
  return { owned: cents(owned), toFinish: cents(toFinish), hasPrices, incomplete };
}
