import type { CatalogCard, SetCatalog, VersionKind } from '@mst/catalog-core';

export const fixtureKinds: VersionKind[] = [
  { id: 'normal', label: 'Normal', shortLabel: 'N', color: '#6F685E', sortOrder: 0 },
  { id: 'holo', label: 'Holo', shortLabel: 'H', color: '#6E8FD8', sortOrder: 1 },
  { id: 'reverse', label: 'Reverse Holo', shortLabel: 'R', color: 'rainbow', sortOrder: 2 },
  { id: 'pokeball', label: 'Poké Ball Reverse', shortLabel: 'PB', color: '#E5484D', sortOrder: 3 },
  { id: 'masterball', label: 'Master Ball Reverse', shortLabel: 'MB', color: '#8E4EC6', sortOrder: 4 },
  { id: 'single', label: 'Single', shortLabel: '★', color: '#D4A72C', sortOrder: 5 },
];

function card(
  id: string,
  number: string,
  name: string,
  categoryId: string,
  kinds: string[],
  start: number,
): CatalogCard {
  return {
    id,
    number,
    name,
    rarity: null,
    categoryId,
    imageUrl: null,
    versions: kinds.map((kind, i) => ({ kind, position: start + i })),
  };
}

export const fixtureCatalog: SetCatalog = {
  id: 'fx',
  name: 'Fixture Set',
  series: 'Fixtures',
  releaseDate: '2025-01-01',
  logoUrl: null,
  catalogVersion: 1,
  versionCount: 11,
  retiredPositions: [],
  categories: [
    { id: 'main', kind: 'main', label: 'Main set', sortOrder: 0 },
    { id: 'promos', kind: 'promo_stamped', label: 'Promos & stamped', sortOrder: 1 },
  ],
  cards: [
    card('c-001', '001', 'Bulbasaur', 'main', ['normal', 'reverse', 'pokeball'], 0),
    card('c-002', '002', 'Ivysaur', 'main', ['normal', 'reverse', 'pokeball', 'masterball'], 3),
    card('c-003', '003', 'Venusaur', 'main', ['normal', 'reverse'], 7),
    card('c-004', '004', 'Venusaur ex', 'main', ['single'], 9),
    card('p-1', '001', 'Bulbasaur (stamped)', 'promos', ['single'], 10),
  ],
};
