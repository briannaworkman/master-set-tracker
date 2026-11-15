import type { CatalogIndex, SetCatalog, VersionKind } from '@mst/catalog-core';
import { createContext, useContext, type ReactNode } from 'react';

export interface CatalogSetSummary {
  id: string;
  name: string;
  series: string;
  releaseDate: string;
  logoUrl: string | null;
  published: boolean;
}

export interface Catalog {
  kinds: VersionKind[];
  /** Newest releaseDate first. */
  listSets(): CatalogSetSummary[];
  /** Null for unknown ids and for drafts when drafts are excluded. */
  getSet(id: string): SetCatalog | null;
}

/**
 * Published sets are the index entries that have a set file; drafts are set files with no
 * index entry. Drafts are only visible with `includeDrafts` (development builds).
 */
export function createCatalog(
  bundle: { index: CatalogIndex; sets: Record<string, SetCatalog> },
  opts: { includeDrafts: boolean },
): Catalog {
  const visible = new Map<string, { set: SetCatalog; summary: CatalogSetSummary }>();
  for (const entry of bundle.index.sets) {
    const set = bundle.sets[entry.id];
    if (!set) continue;
    const { id, name, series, releaseDate, logoUrl } = entry;
    visible.set(id, { set, summary: { id, name, series, releaseDate, logoUrl, published: true } });
  }
  if (opts.includeDrafts) {
    for (const set of Object.values(bundle.sets)) {
      if (visible.has(set.id)) continue;
      const { id, name, series, releaseDate, logoUrl } = set;
      visible.set(id, { set, summary: { id, name, series, releaseDate, logoUrl, published: false } });
    }
  }
  const sorted = [...visible.values()]
    .map((v) => v.summary)
    .sort((a, b) => (a.releaseDate < b.releaseDate ? 1 : a.releaseDate > b.releaseDate ? -1 : a.id.localeCompare(b.id)));
  return {
    kinds: bundle.index.kinds,
    listSets: () => sorted.map((s) => ({ ...s })),
    getSet: (id) => visible.get(id)?.set ?? null,
  };
}

const CatalogContext = createContext<Catalog | null>(null);

export function CatalogProvider({ catalog, children }: { catalog: Catalog; children: ReactNode }) {
  return <CatalogContext.Provider value={catalog}>{children}</CatalogContext.Provider>;
}

export function useCatalog(): Catalog {
  const catalog = useContext(CatalogContext);
  if (!catalog) throw new Error('useCatalog must be used inside a CatalogProvider');
  return catalog;
}
