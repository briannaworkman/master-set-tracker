export type VersionKindId = string;

export interface VersionKind {
  id: VersionKindId;
  label: string;
  shortLabel: string;
  color: string;
  sortOrder: number;
}

export type CategoryKind = 'main' | 'subset' | 'promo_stamped';

export interface SetCategory {
  id: string;
  kind: CategoryKind;
  label: string;
  sortOrder: number;
}

export interface CatalogVersion {
  kind: VersionKindId;
  position: number;
}

export interface CatalogCard {
  id: string;
  number: string;
  name: string;
  rarity: string | null;
  categoryId: string;
  imageUrl: string | null;
  versions: CatalogVersion[];
}

export interface SetCatalog {
  id: string;
  name: string;
  series: string;
  releaseDate: string;
  logoUrl: string | null;
  catalogVersion: number;
  versionCount: number;
  retiredPositions: number[];
  categories: SetCategory[];
  cards: CatalogCard[];
}

export interface CatalogIndex {
  generatedAt: string;
  kinds: VersionKind[];
  sets: Array<
    Pick<
      SetCatalog,
      'id' | 'name' | 'series' | 'releaseDate' | 'logoUrl' | 'catalogVersion' | 'versionCount'
    >
  >;
}
