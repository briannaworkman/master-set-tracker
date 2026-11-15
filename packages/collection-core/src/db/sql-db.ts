import type { VersionKey } from '../keys';
import type { LocalChanges, SyncState } from '../sync/types';

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

/**
 * Card ids are globally unique (they start with the set id), so counts are keyed by (cardId, kind).
 * Every local write (setCount, trackSet, untrackSet, setHiddenCategories) stamps the row's
 * updatedAt with stampAfter(now, existing updatedAt): max(now, existing + 1 ms).
 */
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
  /** Dirty rows (collection + tracked merged), oldest updatedAt first, at most `limit` in total. */
  dirtyChanges(limit: number): LocalChanges;
  /**
   * Clears dirty per row, only where the stored updatedAt AND content (count/setId; hidden
   * categories/removedAt/addedAt) still equal the pushed snapshot, so a rewrite within the same
   * millisecond stays dirty. One transaction.
   */
  markSynced(changes: LocalChanges): void;
  /**
   * One transaction. Last-write-wins: a remote row applies when its updatedAt is newer than OR EQUAL
   * to the local row's, or the local row is absent; applied rows are stored clean. Remote wins ties
   * because the server keeps its own row on a tie and a pull only runs after a successful push, so
   * whatever the server holds for that timestamp is authoritative; overwriting even a dirty tied
   * local row keeps the devices in step.
   */
  applyRemote(changes: LocalChanges): { affectedSetIds: string[] };
  getSyncState(): SyncState;
  setSyncState(s: SyncState): void;
  dirtyCount(): number;
  /** Deletes collection, tracked sets, sync state and cached prices in one transaction. */
  wipe(): void;
}
