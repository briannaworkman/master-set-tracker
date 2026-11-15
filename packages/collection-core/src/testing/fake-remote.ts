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

/** Newest element per key, sorted by key (push_changes' `DISTINCT ON (key) ... ORDER BY key, updated_at DESC`). */
function newestPerKey<T extends { updatedAt: string }>(rows: T[], key: (r: T) => string): T[] {
  const out = new Map<string, T>();
  for (const r of rows) {
    const cur = out.get(key(r));
    if (!cur || r.updatedAt > cur.updatedAt) out.set(key(r), r);
  }
  return [...out.entries()].sort(([a], [b]) => cmp(a, b)).map(([, r]) => r);
}

// push_changes' timestamp pattern: explicit offset, at most 3 fractional digits.
const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|[+-]\d{2}(:?\d{2})?)$/;

/** The instant as a toISOString() value (what pull_changes returns), or null if push_changes would reject it. */
function normalizeTimestamp(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = ISO.exec(v);
  if (!m) return null;
  const [, y, mo, d, h, mi, sec] = m.map(Number) as number[];
  if (mo! < 1 || mo! > 12 || d! < 1 || d! > new Date(Date.UTC(y!, mo!, 0)).getUTCDate() || h! > 23 || mi! > 59 || sec! > 59) {
    return null;
  }
  let offset = m[8]!;
  if (/^[+-]\d{2}$/.test(offset)) offset += ':00';
  else if (/^[+-]\d{4}$/.test(offset)) offset = `${offset.slice(0, 3)}:${offset.slice(3)}`;
  const t = Date.parse(`${v.slice(0, v.length - m[8]!.length)}${offset}`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

const nonEmpty = (v: unknown): boolean => typeof v === 'string' && v !== '';

/** Validates and normalizes a push like push_changes: the first problem rejects the whole call. */
function validatePush(input: LocalChanges): LocalChanges {
  if (!Array.isArray(input.collection)) throw new Error('p_collection must be a JSON array');
  if (!Array.isArray(input.tracked)) throw new Error('p_tracked must be a JSON array');
  const collection = input.collection.map((r, i): CollectionRow => {
    const where = `p_collection[${i}]`;
    for (const f of ['cardId', 'kind', 'setId'] as const) {
      if (!nonEmpty(r[f])) throw new Error(`${where}.${f} must be a non-empty string`);
    }
    if (!Number.isInteger(r.count)) throw new Error(`${where}.count must be an integer`);
    if (r.count < 0 || r.count > 999) throw new Error(`${where}.count must be between 0 and 999`);
    const updatedAt = normalizeTimestamp(r.updatedAt);
    if (updatedAt === null) throw new Error(`${where}.updated_at must be an ISO-8601 timestamp string`);
    return { ...r, updatedAt };
  });
  const tracked = input.tracked.map((r, i): TrackedRow => {
    const where = `p_tracked[${i}]`;
    if (!nonEmpty(r.setId)) throw new Error(`${where}.set_id must be a non-empty string`);
    if (!Array.isArray(r.hiddenCategoryIds) || !r.hiddenCategoryIds.every((x) => typeof x === 'string')) {
      throw new Error(`${where}.hidden_category_ids must be an array of strings`);
    }
    const addedAt = normalizeTimestamp(r.addedAt);
    if (addedAt === null) throw new Error(`${where}.added_at must be an ISO-8601 timestamp string`);
    const removedAt = r.removedAt == null ? null : normalizeTimestamp(r.removedAt);
    if (r.removedAt != null && removedAt === null) {
      throw new Error(`${where}.removed_at must be null or an ISO-8601 timestamp string`);
    }
    const updatedAt = normalizeTimestamp(r.updatedAt);
    if (updatedAt === null) throw new Error(`${where}.updated_at must be an ISO-8601 timestamp string`);
    return { ...r, addedAt, removedAt, updatedAt };
  });
  return { collection, tracked };
}

/**
 * In-memory stand-in for one signed-in user's view of the Supabase sync RPCs
 * (supabase/migrations/20261116000001_sync.sql):
 * - push: every element is validated first (ids, count 0..999, ISO-8601 timestamps with an offset
 *   and at most 3 fractional digits); the first problem rejects the whole call. Timestamps are
 *   stored as UTC toISOString() values, as pull_changes returns them. Duplicate keys in one call
 *   collapse to the newest. A row applies only when strictly newer than the server's (the server
 *   keeps its row on a tie).
 * - serverSeq: one sequence shared by both tables, advanced like the BEFORE INSERT/UPDATE triggers
 *   on `INSERT ... ON CONFLICT DO UPDATE`: every row reaching the insert takes a value (rejected
 *   ones included), and an accepted update takes a second one, which the row keeps. So cursors
 *   have gaps: never assume consecutive values (use seqs()).
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

  /** The last value taken from the sequence (rejected rows advance it too). */
  get seq(): number {
    return this.sequence;
  }

  /** The serverSeq every stored row currently holds, ascending: the cursors a full pull can end on. */
  seqs(): number[] {
    return [...this.collection.values(), ...this.tracked.values()].map((r) => r.serverSeq).sort((a, b) => a - b);
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
    const raw = copyChanges(changes);
    this.pushCalls.push(copyChanges(raw));
    this.takeFailure('push');
    await this.beforePush?.(copyChanges(raw));
    const input = validatePush(raw);

    let collectionApplied = 0;
    for (const r of newestPerKey(input.collection, (x) => `${x.cardId}\u0000${x.kind}`)) {
      const key = `${r.cardId}\u0000${r.kind}`;
      const cur = this.collection.get(key);
      const insertSeq = ++this.sequence; // BEFORE INSERT fires for every proposed row
      if (cur && !(r.updatedAt > cur.updatedAt)) continue;
      this.collection.set(key, { ...r, serverSeq: cur ? ++this.sequence : insertSeq }); // BEFORE UPDATE on conflict
      collectionApplied++;
    }
    let trackedApplied = 0;
    for (const r of newestPerKey(input.tracked, (x) => x.setId)) {
      const cur = this.tracked.get(r.setId);
      const insertSeq = ++this.sequence;
      if (cur && !(r.updatedAt > cur.updatedAt)) continue;
      this.tracked.set(r.setId, { ...r, serverSeq: cur ? ++this.sequence : insertSeq });
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
