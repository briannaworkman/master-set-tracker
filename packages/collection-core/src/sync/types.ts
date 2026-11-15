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

/** True when `a` is later than or equal to `b` (same fixed-width ISO format assumption as isNewer). */
export function isNewerOrEqual(a: string, b: string): boolean {
  return a >= b;
}

/**
 * The updatedAt for a local write to a row that currently has `previous` (null for a new row):
 * max(now, previous + 1 ms) as a toISOString() value. A device whose clock is behind still stamps
 * its write later than the version it holds (possibly pulled from a device whose clock is ahead),
 * so the server never rejects it as older while markSynced clears it locally; a rewrite within the
 * same millisecond also gets a distinct stamp. Values that don't parse as dates (tests only) pass
 * through as `now`.
 */
export function stampAfter(now: string, previous: string | null | undefined): string {
  const cur = Date.parse(now);
  if (Number.isNaN(cur)) return now;
  const prev = previous == null ? NaN : Date.parse(previous);
  return new Date(Number.isNaN(prev) ? cur : Math.max(cur, prev + 1)).toISOString();
}
