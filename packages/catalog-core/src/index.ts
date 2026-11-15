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
  /** Permanent bit index of this card version in the set's bitset; frozen once published. */
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
  /**
   * Starts at 1 when the set is published and goes up by one each time a published
   * set's versions change (a version added or retired). Positions never move between
   * catalog versions, so a bitset encoded against an older catalogVersion still decodes:
   * it just lacks bits for versions added since.
   */
  catalogVersion: number;
  /**
   * Length of the per-set ownership bitset (e.g. for offline QR codes): the highest
   * position ever assigned + 1, retired positions included. It is NOT the number of
   * collectible versions; count `cards[].versions` for that.
   */
  versionCount: number;
  /**
   * Positions that belonged to versions since removed from the set. Their bits stay
   * in the bitset (so `versionCount` never shrinks) but must be ignored, and they are
   * never reassigned to another version.
   */
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
