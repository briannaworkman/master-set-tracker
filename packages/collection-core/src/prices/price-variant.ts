export type PriceVariant = 'normal' | 'holofoil' | 'reverse-holofoil';

/** Ordered TCGplayer variants to try for a version; [] means no price is defined for it. */
export function priceVariantFor(cardId: string, kind: string): PriceVariant[] {
  if (cardId.includes('-stamp-')) return [];
  switch (kind) {
    case 'normal':
      return ['normal'];
    case 'holo':
      return ['holofoil'];
    case 'reverse':
      return ['reverse-holofoil'];
    case 'single':
      return ['holofoil', 'normal'];
    default:
      return [];
  }
}
