import type { CatalogCard, SetCatalog, VersionKind } from '@mst/catalog-core';
import { versionKey, type Counts } from './keys';

export type Filter = 'all' | 'missing' | 'have' | 'spares';

export function filterCards(cards: CatalogCard[], counts: Counts, filter: Filter): CatalogCard[] {
  if (filter === 'all') return cards;
  const min = filter === 'spares' ? 2 : 1;
  return cards.filter((card) => {
    const per = card.versions.map((v) => counts[versionKey(card.id, v.kind)] ?? 0);
    if (filter === 'missing') return per.some((n) => n === 0);
    return per.some((n) => n >= min);
  });
}

export function legendKinds(catalog: SetCatalog, kinds: VersionKind[]): VersionKind[] {
  const used = new Set(catalog.cards.flatMap((c) => c.versions.map((v) => v.kind)));
  return kinds.filter((k) => used.has(k.id)).sort((a, b) => a.sortOrder - b.sortOrder);
}
