import type { CatalogCard, SetCatalog } from '@mst/catalog-core';

const fields: Array<[label: string, get: (c: CatalogCard) => string]> = [
  ['number', (c) => JSON.stringify(c.number)],
  ['name', (c) => JSON.stringify(c.name)],
  ['category', (c) => JSON.stringify(c.categoryId)],
  ['versions', (c) => `[${c.versions.map((v) => v.kind).join(', ')}]`],
];

/**
 * Differences between the reviewed catalog and a fresh build, limited to what publishing
 * freezes: which cards exist, in what order, and each card's number, name, category and
 * version kinds. Positions, catalogVersion and versionCount are ignored (publish assigns them).
 */
export function diffReviewedCards(reviewed: SetCatalog, fresh: SetCatalog): string[] {
  const before = new Map(reviewed.cards.map((c) => [c.id, c]));
  const after = new Map(fresh.cards.map((c) => [c.id, c]));
  const diffs: string[] = [];
  for (const id of after.keys()) if (!before.has(id)) diffs.push(`added: ${id}`);
  for (const id of before.keys()) if (!after.has(id)) diffs.push(`removed: ${id}`);
  for (const [id, b] of before) {
    const a = after.get(id);
    if (!a) continue;
    for (const [label, get] of fields) {
      if (get(b) !== get(a)) diffs.push(`changed ${id}: ${label} ${get(b)} -> ${get(a)}`);
    }
  }
  if (diffs.length === 0 && reviewed.cards.some((c, i) => fresh.cards[i]!.id !== c.id)) {
    diffs.push('card order changed');
  }
  return diffs;
}
