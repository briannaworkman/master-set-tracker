import { describe, expect, it } from 'vitest';
import type { CatalogCard, SetCatalog } from '@mst/catalog-core';
import { diffReviewedCards } from '../src/build/compare.js';

const card = (id: string, over: Partial<CatalogCard> = {}): CatalogCard => ({
  id,
  number: id,
  name: `Card ${id}`,
  rarity: 'Common',
  categoryId: 'main',
  imageUrl: null,
  versions: [{ kind: 'normal', position: 0 }],
  ...over,
});
const catalog = (cards: CatalogCard[], over: Partial<SetCatalog> = {}): SetCatalog => ({
  id: 's', name: 'S', series: 'X', releaseDate: '2025-01-01', logoUrl: null,
  catalogVersion: 1, versionCount: 1, retiredPositions: [], categories: [], cards, ...over,
});

describe('diffReviewedCards', () => {
  it('ignores positions, catalogVersion, versionCount, rarity and images', () =>
    expect(
      diffReviewedCards(
        catalog([card('a')]),
        catalog([card('a', { versions: [{ kind: 'normal', position: 7 }], rarity: 'Rare', imageUrl: 'x' })], {
          catalogVersion: 2,
          versionCount: 8,
        }),
      ),
    ).toEqual([]));
  it('names added and removed cards', () =>
    expect(diffReviewedCards(catalog([card('a'), card('b')]), catalog([card('a'), card('c')]))).toEqual([
      'added: c',
      'removed: b',
    ]));
  it('names changed numbers, names, categories and version kinds', () =>
    expect(
      diffReviewedCards(
        catalog([card('a'), card('b'), card('c'), card('d')]),
        catalog([
          card('a', { number: '1' }),
          card('b', { name: 'B2' }),
          card('c', { categoryId: 'promos' }),
          card('d', { versions: [{ kind: 'normal', position: 0 }, { kind: 'reverse', position: 1 }] }),
        ]),
      ),
    ).toEqual([
      'changed a: number "a" -> "1"',
      'changed b: name "Card b" -> "B2"',
      'changed c: category "main" -> "promos"',
      'changed d: versions [normal] -> [normal, reverse]',
    ]));
  it('reports a change in card order', () =>
    expect(diffReviewedCards(catalog([card('a'), card('b')]), catalog([card('b'), card('a')]))).toEqual([
      'card order changed',
    ]));
});
