export interface CollectionRow {
  cardId: string;
  kind: string;
  setId: string;
  count: number;
  updatedAt: string;
}

export interface TrackedRow {
  setId: string;
  hiddenCategoryIds: string[];
  addedAt: string;
  removedAt: string | null;
  updatedAt: string;
}

export interface LocalChanges {
  collection: CollectionRow[];
  tracked: TrackedRow[];
}

export interface SyncState {
  cursor: number;
  lastSyncedAt: string | null;
}

/**
 * True when timestamp `a` is strictly later than `b`. Timestamps are `Date.toISOString()` strings
 * (fixed-width UTC, 3 fractional digits), which sort lexicographically; this is the only place
 * that relies on it.
 */
export function isNewer(a: string, b: string): boolean {
  return a > b;
}
