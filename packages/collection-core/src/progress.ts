import type { CatalogCard, SetCatalog, SetCategory } from '@mst/catalog-core';
import { versionKey, type Counts } from './keys';

export type CardStatus = 'none' | 'partial' | 'complete';

export function visibleSections(
  catalog: SetCatalog,
  hidden: readonly string[],
): Array<{ category: SetCategory; cards: CatalogCard[] }> {
  return [...catalog.categories]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .filter((c) => c.kind === 'main' || !hidden.includes(c.id))
    .map((category) => ({
      category,
      cards: catalog.cards.filter((card) => card.categoryId === category.id),
    }))
    .filter((s) => s.cards.length > 0);
}

export function setProgress(
  catalog: SetCatalog,
  counts: Counts,
  hidden: readonly string[],
): { collected: number; total: number } {
  let collected = 0;
  let total = 0;
  for (const { cards } of visibleSections(catalog, hidden)) {
    for (const card of cards) {
      for (const v of card.versions) {
        total += 1;
        if ((counts[versionKey(card.id, v.kind)] ?? 0) >= 1) collected += 1;
      }
    }
  }
  return { collected, total };
}

export function cardStatus(card: CatalogCard, counts: Counts): CardStatus {
  const have = card.versions.filter((v) => (counts[versionKey(card.id, v.kind)] ?? 0) >= 1).length;
  if (have === 0) return 'none';
  return have === card.versions.length ? 'complete' : 'partial';
}
