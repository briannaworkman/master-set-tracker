import type { VersionKey } from '../keys';

export interface SqlDb {
  exec(sql: string): void;
  run(sql: string, params?: unknown[]): void;
  all<T>(sql: string, params?: unknown[]): T[];
  first<T>(sql: string, params?: unknown[]): T | null;
  /** Runs `fn` inside BEGIN/COMMIT; rolls back and rethrows if it throws. Not reentrant. */
  transaction<T>(fn: () => T): T;
}

export interface TrackedSet {
  setId: string;
  hiddenCategoryIds: string[];
  addedAt: string;
}

/** Card ids are globally unique (they start with the set id), so counts are keyed by (cardId, kind). */
export interface CollectionRepo {
  /** Ordered by addedAt ascending. */
  listTracked(): TrackedSet[];
  /** No-op if already tracked. */
  trackSet(setId: string, now: string): void;
  /** Keeps counts. */
  untrackSet(setId: string): void;
  setHiddenCategories(setId: string, ids: string[]): void;
  /** Only entries with count > 0. */
  countsForSet(setId: string): Record<VersionKey, number>;
  /** Count is clamped to 0..999. */
  setCount(setId: string, cardId: string, kind: string, count: number, now: string): void;
}
