import type { SyncRemote } from '../sync/engine';
import type { CollectionRow, LocalChanges, TrackedRow } from '../sync/types';

type Stored<T> = T & { serverSeq: number };

const copyCollection = (r: CollectionRow): CollectionRow => ({
  cardId: r.cardId,
  kind: r.kind,
  setId: r.setId,
  count: r.count,
  updatedAt: r.updatedAt,
});
const copyTracked = (r: TrackedRow): TrackedRow => ({
  setId: r.setId,
  hiddenCategoryIds: [...r.hiddenCategoryIds],
  addedAt: r.addedAt,
  removedAt: r.removedAt ?? null,
  updatedAt: r.updatedAt,
});
const copyChanges = (c: LocalChanges): LocalChanges => ({
  collection: c.collection.map(copyCollection),
  tracked: c.tracked.map(copyTracked),
});

/** Newest element per key, in first-seen key order (push_changes' `DISTINCT ON ... ORDER BY updated_at DESC`). */
function newestPerKey<T extends { updatedAt: string }>(rows: T[], key: (r: T) => string): T[] {
  const out = new Map<string, T>();
  for (const r of rows) {
    const cur = out.get(key(r));
    if (!cur || r.updatedAt > cur.updatedAt) out.set(key(r), r);
  }
  return [...out.values()];
}

/**
 * In-memory stand-in for one signed-in user's view of the Supabase sync RPCs
 * (supabase/migrations/20261116000001_sync.sql):
 * - push: last-write-wins by client updatedAt, accepted only when strictly newer (the server keeps
 *   its row on a tie); duplicate keys in one call collapse to the newest; counts outside 0..999
 *   reject the whole call; each accepted write takes the next value of one sequence shared by both
 *   tables, rejected writes take none.
 * - pull: rows with serverSeq > cursor from both tables merged in serverSeq order, at most `limit`
 *   (1..1000); nextCursor is the page's highest serverSeq (or the cursor when empty); hasMore says
 *   whether rows remain.
 *
 * Data is copied in and out, like a network boundary. Hooks and failNext() inject failures for tests.
 */
export class FakeSyncRemote implements SyncRemote {
  private collection = new Map<string, Stored<CollectionRow>>();
  private tracked = new Map<string, Stored<TrackedRow>>();
  private sequence = 0;
  private failures: { push: unknown[]; pull: unknown[] } = { push: [], pull: [] };

  /** Every push() argument (copied), including calls that failed. */
  readonly pushCalls: LocalChanges[] = [];
  /** Every pull() argument, including calls that failed. */
  readonly pullCalls: { cursor: number; limit: number }[] = [];
  /** The applied counts push_changes returned for the last successful push. */
  lastPushApplied: { collection: number; tracked: number } | null = null;

  /** Awaited before a push touches anything; throw to fail the call with nothing written. */
  beforePush?: (changes: LocalChanges) => void | Promise<void>;
  /** Awaited after a push was applied; throw to simulate a lost response (the write stays applied). */
  afterPush?: (changes: LocalChanges) => void | Promise<void>;
  /** Awaited before a pull reads anything; throw to fail the call. */
  beforePull?: (cursor: number, limit: number) => void | Promise<void>;

  /** The highest serverSeq handed out so far. */
  get seq(): number {
    return this.sequence;
  }

  /** Makes the next call of `op` throw `error` before doing any work. Queues if called repeatedly. */
  failNext(op: 'push' | 'pull', error: unknown): void {
    this.failures[op].push(error);
  }

  /** The server's rows (copied), each table in key order. */
  snapshot(): LocalChanges {
    return {
      collection: [...this.collection.values()]
        .sort((a, b) => (a.cardId === b.cardId ? cmp(a.kind, b.kind) : cmp(a.cardId, b.cardId)))
        .map(copyCollection),
      tracked: [...this.tracked.values()].sort((a, b) => cmp(a.setId, b.setId)).map(copyTracked),
    };
  }

  async push(changes: LocalChanges): Promise<void> {
    const input = copyChanges(changes);
    this.pushCalls.push(copyChanges(input));
    this.takeFailure('push');
    await this.beforePush?.(copyChanges(input));

    input.collection.forEach((r, i) => {
      if (!Number.isInteger(r.count) || r.count < 0 || r.count > 999) {
        throw new Error(`p_collection[${i}].count must be between 0 and 999`);
      }
    });

    let collectionApplied = 0;
    for (const r of newestPerKey(input.collection, (x) => `${x.cardId}\u0000${x.kind}`)) {
      const key = `${r.cardId}\u0000${r.kind}`;
      const cur = this.collection.get(key);
      if (cur && !(r.updatedAt > cur.updatedAt)) continue;
      this.collection.set(key, { ...r, serverSeq: ++this.sequence });
      collectionApplied++;
    }
    let trackedApplied = 0;
    for (const r of newestPerKey(input.tracked, (x) => x.setId)) {
      const cur = this.tracked.get(r.setId);
      if (cur && !(r.updatedAt > cur.updatedAt)) continue;
      this.tracked.set(r.setId, { ...r, serverSeq: ++this.sequence });
      trackedApplied++;
    }
    this.lastPushApplied = { collection: collectionApplied, tracked: trackedApplied };
    await this.afterPush?.(copyChanges(input));
  }

  async pull(cursor: number, limit: number): Promise<{ changes: LocalChanges; nextCursor: number; hasMore: boolean }> {
    this.pullCalls.push({ cursor, limit });
    this.takeFailure('pull');
    await this.beforePull?.(cursor, limit);
    if (!Number.isInteger(cursor) || cursor < 0) throw new Error('p_cursor must be >= 0');
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('p_limit must be between 1 and 1000');

    const candidates = [
      ...[...this.collection.values()].filter((r) => r.serverSeq > cursor).map((r) => ({ src: 'c' as const, r })),
      ...[...this.tracked.values()].filter((r) => r.serverSeq > cursor).map((r) => ({ src: 't' as const, r })),
    ].sort((a, b) => a.r.serverSeq - b.r.serverSeq);
    const page = candidates.slice(0, limit);
    const changes: LocalChanges = { collection: [], tracked: [] };
    for (const p of page) {
      if (p.src === 'c') changes.collection.push(copyCollection(p.r as CollectionRow));
      else changes.tracked.push(copyTracked(p.r as TrackedRow));
    }
    return {
      changes,
      nextCursor: page.length > 0 ? page[page.length - 1]!.r.serverSeq : cursor,
      hasMore: candidates.length > limit,
    };
  }

  private takeFailure(op: 'push' | 'pull'): void {
    if (this.failures[op].length > 0) throw this.failures[op].shift();
  }
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
