import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { SetCatalog } from '@mst/catalog-core';
import { parseVersionKinds } from '../src/rules/schema.js';
import { toChecklistCsv } from '../src/checklist/csv.js';

const kinds = parseVersionKinds(
  readFileSync(fileURLToPath(new URL('../../../catalog/version-kinds.yaml', import.meta.url)), 'utf8'),
);

const v = (kind: string, position: number) => ({ kind, position });
const catalog151: SetCatalog = {
  id: 'sv03.5',
  name: '151',
  series: 'Scarlet & Violet',
  releaseDate: '2023-09-22',
  logoUrl: null,
  catalogVersion: 1,
  versionCount: 9,
  retiredPositions: [],
  categories: [{ id: 'main', kind: 'main', label: 'Main set', sortOrder: 0 }],
  cards: [
    {
      id: 'sv03.5-001', number: '001', name: 'Bulbasaur', rarity: 'Common', categoryId: 'main', imageUrl: null,
      versions: [v('normal', 0), v('reverse', 1), v('pokeball', 2), v('masterball', 3)],
    },
    {
      id: 'sv03.5-003', number: '003', name: 'Venusaur ex', rarity: null, categoryId: 'main', imageUrl: null,
      versions: [v('single', 4)],
    },
  ],
};

const lines = (csv: string) => csv.split('\r\n');
const withName = (name: string): SetCatalog => ({
  ...catalog151,
  cards: [{ ...catalog151.cards[0]!, name }],
});

describe('toChecklistCsv', () => {
  it('writes header with only the kinds this set uses', () =>
    expect(lines(toChecklistCsv(catalog151, kinds))[0]).toBe(
      '﻿Number,Name,Rarity,Category,Normal,Reverse Holo,Poké Ball Reverse,Master Ball Reverse,Single,Notes',
    ));
  it('marks versions with ✓', () =>
    expect(lines(toChecklistCsv(catalog151, kinds))[1]).toBe('001,Bulbasaur,Common,Main set,✓,✓,✓,✓,,'));
  it('leaves rarity blank and marks single', () =>
    expect(lines(toChecklistCsv(catalog151, kinds))[2]).toBe('003,Venusaur ex,,Main set,,,,,✓,'));
  it('quotes names containing commas', () =>
    expect(toChecklistCsv(withName('Mr. Mime, Jr'), kinds)).toContain('"Mr. Mime, Jr"'));
  it('escapes embedded quotes', () =>
    expect(toChecklistCsv(withName('A "B" C'), kinds)).toContain('"A ""B"" C"'));
});
