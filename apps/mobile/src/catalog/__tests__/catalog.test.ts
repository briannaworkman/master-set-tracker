import type { CatalogIndex, SetCatalog } from '@mst/catalog-core';
import { fixtureCatalog, fixtureKinds } from '@mst/collection-core/testing';
import { bundledCatalog } from '../bundled';
import { createCatalog } from '../CatalogContext';

const META: Record<string, Pick<SetCatalog, 'name' | 'releaseDate'>> = {
  'sv03.5': { name: '151', releaseDate: '2023-09-22' },
  'sv08.5': { name: 'Prismatic Evolutions', releaseDate: '2025-01-17' },
  'sv10': { name: 'Destined Rivals', releaseDate: '2025-05-30' },
};

function makeSet(id: string): SetCatalog {
  return { ...fixtureCatalog, id, ...META[id]! };
}

function bundleWith({ published, drafts }: { published: string[]; drafts: string[] }) {
  const all = [...published, ...drafts].map(makeSet);
  const index: CatalogIndex = {
    generatedAt: '2026-11-15T00:00:00.000Z',
    kinds: fixtureKinds,
    sets: published.map(makeSet).map(({ id, name, series, releaseDate, logoUrl, catalogVersion, versionCount }) => ({
      id,
      name,
      series,
      releaseDate,
      logoUrl,
      catalogVersion,
      versionCount,
    })),
  };
  return { index, sets: Object.fromEntries(all.map((s) => [s.id, s])) };
}

const bundle = bundleWith({ published: ['sv03.5'], drafts: ['sv08.5'] });

describe('createCatalog', () => {
  it('lists published sets newest first and hides drafts by default', () => {
    const c = createCatalog(bundleWith({ published: ['sv03.5'], drafts: ['sv08.5'] }), { includeDrafts: false });
    expect(c.listSets().map((s) => s.id)).toEqual(['sv03.5']);
    expect(c.getSet('sv08.5')).toBeNull();
  });

  it('includes drafts, flagged, when asked', () =>
    expect(createCatalog(bundle, { includeDrafts: true }).listSets().map((s) => [s.id, s.published])).toEqual([
      ['sv08.5', false],
      ['sv03.5', true],
    ]));

  it('orders several published sets by release date, newest first', () => {
    const c = createCatalog(bundleWith({ published: ['sv03.5', 'sv10', 'sv08.5'], drafts: [] }), {
      includeDrafts: false,
    });
    expect(c.listSets().map((s) => s.id)).toEqual(['sv10', 'sv08.5', 'sv03.5']);
  });

  it('summarises a set and returns its full catalog by id', () => {
    const c = createCatalog(bundle, { includeDrafts: false });
    expect(c.listSets()[0]).toEqual({
      id: 'sv03.5',
      name: '151',
      series: 'Fixtures',
      releaseDate: '2023-09-22',
      logoUrl: null,
      published: true,
    });
    expect(c.getSet('sv03.5')).toBe(bundle.sets['sv03.5']);
    expect(c.getSet('nope')).toBeNull();
  });

  it('returns drafts from getSet only when drafts are included', () => {
    expect(createCatalog(bundle, { includeDrafts: true }).getSet('sv08.5')).toBe(bundle.sets['sv08.5']);
  });

  it('skips an index entry that has no set file', () => {
    const b = bundleWith({ published: ['sv03.5', 'sv10'], drafts: [] });
    delete b.sets['sv10'];
    const c = createCatalog(b, { includeDrafts: true });
    expect(c.listSets().map((s) => s.id)).toEqual(['sv03.5']);
    expect(c.getSet('sv10')).toBeNull();
  });

  it('exposes the version kinds from the index', () => {
    expect(createCatalog(bundle, { includeDrafts: false }).kinds).toEqual(fixtureKinds);
  });

  it('loads the bundled catalog synced from catalog/dist', () => {
    const c = createCatalog(bundledCatalog, { includeDrafts: true });
    expect(c.kinds.length).toBeGreaterThan(0);
    const ids = c.listSets().map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['sv03.5', 'sv08.5']));
    expect(c.getSet('sv03.5')?.cards.length).toBeGreaterThan(0);
  });
});

describe('bundled catalog kinds', () => {
  it('match the fixture kinds the tests use', () => {
    expect(bundledCatalog.index.kinds).toEqual(fixtureKinds);
  });
});
