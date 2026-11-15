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
  /** Sets currently tracked (not removed), ordered by addedAt ascending. */
  listTracked(): TrackedSet[];
  /**
   * No-op if already tracked. Re-tracking a removed set restores it with its hidden
   * categories and a fresh addedAt.
   */
  trackSet(setId: string, now: string): void;
  /** Soft-deletes: keeps counts and hidden categories. No-op if not tracked. */
  untrackSet(setId: string, now: string): void;
  /** No-op if the set is not tracked or the ids are unchanged. */
  setHiddenCategories(setId: string, ids: string[], now: string): void;
  /** Only entries with count > 0. */
  countsForSet(setId: string): Record<VersionKey, number>;
  /** Count is clamped to 0..999. */
  setCount(setId: string, cardId: string, kind: string, count: number, now: string): void;
}
