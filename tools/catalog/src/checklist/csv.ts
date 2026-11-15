import type { SetCatalog, VersionKind } from '@mst/catalog-core';

const BOM = '﻿';

function field(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Spreadsheet checklist: one row per card, one column per version kind used in the set. */
export function toChecklistCsv(catalog: SetCatalog, kinds: VersionKind[]): string {
  const used = new Set(catalog.cards.flatMap((c) => c.versions.map((v) => v.kind)));
  const columns = kinds.filter((k) => used.has(k.id)).sort((a, b) => a.sortOrder - b.sortOrder);
  const categoryLabel = new Map(catalog.categories.map((c) => [c.id, c.label]));

  const rows: string[][] = [['Number', 'Name', 'Rarity', 'Category', ...columns.map((k) => k.label), 'Notes']];
  for (const card of catalog.cards) {
    const has = new Set(card.versions.map((v) => v.kind));
    rows.push([
      card.number,
      card.name,
      card.rarity ?? '',
      categoryLabel.get(card.categoryId) ?? card.categoryId,
      ...columns.map((k) => (has.has(k.id) ? '✓' : '')),
      '',
    ]);
  }
  return BOM + rows.map((r) => r.map(field).join(',')).join('\r\n') + '\r\n';
}
