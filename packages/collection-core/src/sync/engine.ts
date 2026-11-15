import type { CollectionRepo } from '../db/sql-db';
import type { CollectionStore } from '../store';
import type { LocalChanges } from './types';

export interface SyncRemote {
  /** Uploads rows; the server applies each one only if it is strictly newer than its own. */
  push(changes: LocalChanges): Promise<void>;
  /** Rows the server wrote after `cursor`, oldest first, at most `limit`. */
  pull(cursor: number, limit: number): Promise<{ changes: LocalChanges; nextCursor: number; hasMore: boolean }>;
}

export type SyncStatus = {
  state: 'idle' | 'syncing' | 'offline' | 'error';
  lastSyncedAt: string | null;
  /** repo.dirtyCount() when the status was last updated. */
  pending: number;
  /** Set only in the 'error' state. */
  error?: string;
};

export interface SyncEngineOptions {
  repo: CollectionRepo;
  store: CollectionStore;
  remote: SyncRemote;
  now?: () => string;
  /** Rows per push call (default 500). */
  pushBatch?: number;
  /** Rows per pull page, 1..1000 like pull_changes (default 1000). */
  pullLimit?: number;
}

const NETWORK_MESSAGE = /network|fetch failed|timed out|offline|ECONN|ENOTFOUND/i;
// What fetch's own TypeError says: browsers "Failed to fetch", Safari "Load failed",
// React Native "Network request failed", Node "fetch failed".
const FETCH_TYPE_ERROR_MESSAGE = /failed to fetch|fetch failed|network|load failed/i;

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (typeof e === 'object' && e !== null && typeof (e as { message?: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  return String(e);
}

/**
 * True when `e` means the network was unreachable rather than the server refusing the request:
 * a TypeError thrown by fetch (or a wrapper's "TypeError: ..." message, as supabase-js produces),
 * or a message that names a network failure.
 */
export function isNetworkError(e: unknown): boolean {
  if (e === null || e === undefined) return false;
  const message = errorMessage(e);
  const isTypeError = e instanceof TypeError || /^TypeError\b/.test(message);
  if (isTypeError && FETCH_TYPE_ERROR_MESSAGE.test(message)) return true;
  return NETWORK_MESSAGE.test(message);
}

/**
 * Offline-first sync for one signed-in user. A run pushes dirty rows in batches, then pulls pages
 * until the server has no more; local writes never wait on it.
 *
 * Safety rules: a batch is marked synced only after its push resolved, and only rows still equal
 * to the pushed snapshot (repo.markSynced); the pull cursor advances only after a page has been
 * applied. Any error stops the run where it is, so the next run retries from there.
 */
export class SyncEngine {
  private readonly repo: CollectionRepo;
  private readonly store: CollectionStore;
  private readonly remote: SyncRemote;
  private readonly now: () => string;
  private readonly pushBatch: number;
  private readonly pullLimit: number;
  private readonly listeners = new Set<(s: SyncStatus) => void>();
  private status: SyncStatus;
  private online = true;
  private inFlight: Promise<SyncStatus> | null = null;

  constructor(opts: SyncEngineOptions) {
    const pushBatch = opts.pushBatch ?? 500;
    const pullLimit = opts.pullLimit ?? 1000;
    if (!Number.isInteger(pushBatch) || pushBatch < 1) throw new RangeError('pushBatch must be a positive integer');
    if (!Number.isInteger(pullLimit) || pullLimit < 1 || pullLimit > 1000) {
      throw new RangeError('pullLimit must be an integer between 1 and 1000');
    }
    this.repo = opts.repo;
    this.store = opts.store;
    this.remote = opts.remote;
    this.now = opts.now ?? (() => new Date().toISOString());
    this.pushBatch = pushBatch;
    this.pullLimit = pullLimit;
    this.status = { state: 'idle', lastSyncedAt: this.repo.getSyncState().lastSyncedAt, pending: this.repo.dirtyCount() };
  }

  /**
   * Runs a sync, or joins the one in flight. A run that succeeds is followed by exactly one more if
   * local writes left rows dirty meanwhile. Never rejects: failures are reported in the status.
   * While offline (setOnline(false)) it resolves at once without touching the network.
   */
  syncNow(): Promise<SyncStatus> {
    if (!this.online) {
      this.update({ state: 'offline' });
      return Promise.resolve(this.status);
    }
    if (!this.inFlight) {
      this.inFlight = this.runWithFollowUp().finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  subscribe(listener: (s: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** The current status; the same object until something in it changes. */
  getStatus(): SyncStatus {
    return this.status;
  }

  /**
   * Going offline shows 'offline' and makes syncNow a no-op. Coming back shows 'idle' (or
   * 'syncing' if a run is still in flight) but does not start a sync; the caller decides when.
   */
  setOnline(online: boolean): void {
    if (online === this.online) return;
    this.online = online;
    if (!online) this.update({ state: 'offline' });
    else if (this.status.state === 'offline') this.update({ state: this.inFlight ? 'syncing' : 'idle' });
  }

  /** Stays 'syncing' across the follow-up run so the status doesn't flicker through 'idle'. */
  private async runWithFollowUp(): Promise<SyncStatus> {
    this.update({ state: 'syncing' });
    let lastSyncedAt = await this.runOnce();
    // After a successful run, a dirty row can only come from a write made during it.
    if (lastSyncedAt !== null && this.online && this.repo.dirtyCount() > 0) {
      this.update({ lastSyncedAt });
      lastSyncedAt = await this.runOnce();
    }
    if (lastSyncedAt !== null) this.update({ state: this.online ? 'idle' : 'offline', lastSyncedAt });
    return this.status;
  }

  /**
   * One push-then-pull pass. Returns the new lastSyncedAt, or null after setting the
   * 'offline'/'error' status if it stopped on an error.
   */
  private async runOnce(): Promise<string | null> {
    try {
      await this.pushDirty();
      const cursor = await this.pullAll();
      const lastSyncedAt = this.now();
      this.repo.setSyncState({ cursor, lastSyncedAt });
      return lastSyncedAt;
    } catch (e) {
      if (!this.online || isNetworkError(e)) this.update({ state: 'offline' });
      else this.update({ state: 'error', error: errorMessage(e) });
      return null;
    }
  }

  /**
   * Pushes the rows dirty at the start in oldest-first batches. The batch count is fixed up front
   * so writes made meanwhile (left for the follow-up run) can't keep the loop going.
   */
  private async pushDirty(): Promise<void> {
    const batches = Math.ceil(this.repo.dirtyCount() / this.pushBatch);
    for (let i = 0; i < batches; i++) {
      const snapshot = this.repo.dirtyChanges(this.pushBatch);
      if (snapshot.collection.length === 0 && snapshot.tracked.length === 0) return;
      await this.remote.push(snapshot);
      this.repo.markSynced(snapshot);
    }
  }

  /** Pulls and applies pages until hasMore is false, saving the cursor after each page. */
  private async pullAll(): Promise<number> {
    let cursor = this.repo.getSyncState().cursor;
    for (;;) {
      const page = await this.remote.pull(cursor, this.pullLimit);
      if (page.nextCursor < cursor || (page.hasMore && page.nextCursor === cursor)) {
        throw new Error(`pull returned cursor ${page.nextCursor} after ${cursor}; refusing to loop`);
      }
      this.store.applyRemote(page.changes);
      cursor = page.nextCursor;
      this.repo.setSyncState({ cursor, lastSyncedAt: this.repo.getSyncState().lastSyncedAt });
      if (!page.hasMore) return cursor;
    }
  }

  private update(patch: Partial<SyncStatus>): void {
    const next: SyncStatus = { ...this.status, ...patch, pending: this.repo.dirtyCount() };
    if (next.state !== 'error') delete next.error;
    const prev = this.status;
    if (
      prev.state === next.state &&
      prev.lastSyncedAt === next.lastSyncedAt &&
      prev.pending === next.pending &&
      prev.error === next.error
    ) {
      return;
    }
    this.status = next;
    for (const listener of [...this.listeners]) {
      try {
        listener(next);
      } catch (e) {
        // A broken listener must not abort or misreport the sync it is observing.
        console.error('SyncEngine status listener threw', e);
      }
    }
  }
}
