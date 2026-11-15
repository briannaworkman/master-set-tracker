import type { CollectionRepo } from '../db/sql-db';
import type { CollectionStore } from '../store';
import type { LocalChanges } from './types';
import { partitionPushable } from './validate';

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
 * an aborted or timed-out request (name AbortError / TimeoutError), or a message that names a
 * network failure.
 */
export function isNetworkError(e: unknown): boolean {
  if (e === null || e === undefined) return false;
  const name = typeof e === 'object' ? (e as { name?: unknown }).name : undefined;
  if (name === 'AbortError' || name === 'TimeoutError') return true;
  const message = errorMessage(e);
  const isTypeError = e instanceof TypeError || /^TypeError\b/.test(message);
  if (isTypeError && FETCH_TYPE_ERROR_MESSAGE.test(message)) return true;
  return NETWORK_MESSAGE.test(message);
}

/** Thrown inside a run when stop() was called, so it unwinds without writing anything more. */
class StoppedError extends Error {
  constructor() {
    super('sync engine stopped');
  }
}

/**
 * Offline-first sync for one signed-in user. A run pushes dirty rows in batches, then pulls pages
 * until the server has no more; local writes never wait on it.
 *
 * Safety rules: a batch is marked synced only after its push resolved, and only rows still equal
 * to the pushed snapshot (repo.markSynced); the pull cursor advances only after a page has been
 * applied. Any error stops the run where it is, so the next run retries from there. After stop()
 * the engine writes nothing more to the repo or store.
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
  /** A syncNow() arrived while a run was in flight: run once more after it. */
  private rerunRequested = false;
  private stopped = false;
  private stopping: Promise<void> | null = null;

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
   * Starts a run, or joins the one in flight. Joining also guarantees exactly one more run after
   * the current one (several calls during one run still add only one), so a call made during a
   * run, even a follow-up, always sees a run that started after it. Independently, a run that
   * succeeds is followed by one more if local writes left rows dirty meanwhile (at most once per
   * in-flight period). Never rejects: failures are reported in the status. Resolves at once
   * without network while offline (setOnline(false)) or after stop().
   */
  syncNow(): Promise<SyncStatus> {
    if (this.stopped) return Promise.resolve(this.status);
    if (!this.online) {
      this.update({ state: 'offline' });
      return Promise.resolve(this.status);
    }
    if (this.inFlight) {
      this.rerunRequested = true;
      return this.inFlight;
    }
    this.rerunRequested = false;
    // Publish inFlight before drive() emits its first 'syncing' status (synchronously, below), so
    // a listener calling syncNow() joins this run and one calling stop() waits for it to unwind.
    let finish!: (s: SyncStatus) => void;
    const run = new Promise<SyncStatus>((resolve) => {
      finish = resolve;
    }).finally(() => {
      this.inFlight = null;
    });
    this.inFlight = run;
    // drive() never rejects; the fallback only guards against that changing.
    this.drive().then(finish, () => finish(this.status));
    return run;
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

  /**
   * Shuts the engine down for good (sign-out): later syncNow() calls do nothing, and the returned
   * promise resolves once any in-flight run has unwound. The run checks before every markSynced,
   * applyRemote and setSyncState, so once this resolves nothing more is written and the caller can
   * safely wipe local data. The status ends as 'idle', otherwise unchanged.
   */
  stop(): Promise<void> {
    if (!this.stopping) {
      this.stopped = true;
      const inFlight = this.inFlight;
      this.stopping = (async () => {
        if (inFlight) await inFlight;
        const { error: _error, ...rest } = this.status;
        this.publish({ ...rest, state: 'idle' });
      })();
    }
    return this.stopping;
  }

  private async drive(): Promise<SyncStatus> {
    try {
      this.update({ state: 'syncing' });
      let writeFollowUpUsed = false;
      for (;;) {
        this.rerunRequested = false;
        const lastSyncedAt = await this.runOnce();
        if (this.stopped) break;
        let again = false;
        if (this.online && this.rerunRequested) {
          again = true;
        } else if (lastSyncedAt !== null && this.online && !writeFollowUpUsed && this.dirtyCountOr(0) > 0) {
          // After a successful run, a dirty row can only come from a write made during it.
          writeFollowUpUsed = true;
          again = true;
        }
        if (!again) {
          if (lastSyncedAt !== null) this.update({ state: this.online ? 'idle' : 'offline', lastSyncedAt });
          break;
        }
        // Stay 'syncing' between runs so the status doesn't flicker through 'idle'.
        this.update(lastSyncedAt !== null ? { lastSyncedAt } : { state: 'syncing' });
      }
    } catch (e) {
      // runOnce handles its own errors; this only guards the bookkeeping around it.
      this.update({ state: 'error', error: errorMessage(e) });
    }
    return this.status;
  }

  /**
   * One push-then-pull pass. Returns the new lastSyncedAt, or null if it stopped on an error (after
   * setting the 'offline'/'error' status) or because stop() was called.
   */
  private async runOnce(): Promise<string | null> {
    try {
      await this.pushDirty();
      const cursor = await this.pullAll();
      const lastSyncedAt = this.now();
      this.throwIfStopped();
      this.repo.setSyncState({ cursor, lastSyncedAt });
      return lastSyncedAt;
    } catch (e) {
      if (this.stopped || e instanceof StoppedError) return null;
      if (!this.online || isNetworkError(e)) this.update({ state: 'offline' });
      else this.update({ state: 'error', error: errorMessage(e) });
      return null;
    }
  }

  /**
   * Pushes the rows dirty at the start in oldest-first batches. The batch count is fixed up front
   * so writes made meanwhile (left for the follow-up run) can't keep the loop going. Rows the
   * server would reject (push_changes refuses the whole call for one bad row) are quarantined:
   * marked synced without being sent, with a warning, so one bad row can't block sync forever.
   * They stay on this device.
   */
  private async pushDirty(): Promise<void> {
    const batches = Math.ceil(this.repo.dirtyCount() / this.pushBatch);
    for (let i = 0; i < batches; i++) {
      this.throwIfStopped();
      const snapshot = this.repo.dirtyChanges(this.pushBatch);
      if (snapshot.collection.length === 0 && snapshot.tracked.length === 0) return;
      const { pushable, rejected } = partitionPushable(snapshot);
      const bad = rejected.collection.length + rejected.tracked.length;
      if (bad > 0) {
        console.warn(
          `SyncEngine: ${bad} local change(s) the server would reject were marked synced without uploading`,
          {
            collection: rejected.collection.map((r) => `${String(r.cardId)}|${String(r.kind)}`),
            tracked: rejected.tracked.map((r) => String(r.setId)),
          },
        );
        this.repo.markSynced(rejected);
      }
      if (pushable.collection.length === 0 && pushable.tracked.length === 0) continue;
      await this.remote.push(pushable);
      this.throwIfStopped();
      this.repo.markSynced(pushable);
    }
  }

  /** Pulls and applies pages until hasMore is false, saving the cursor after each page. */
  private async pullAll(): Promise<number> {
    let cursor = this.repo.getSyncState().cursor;
    for (;;) {
      this.throwIfStopped();
      const page = await this.remote.pull(cursor, this.pullLimit);
      if (page.nextCursor < cursor || (page.hasMore && page.nextCursor === cursor)) {
        throw new Error(`pull returned cursor ${page.nextCursor} after ${cursor}; refusing to loop`);
      }
      this.throwIfStopped();
      this.store.applyRemote(page.changes);
      cursor = page.nextCursor;
      this.throwIfStopped();
      this.repo.setSyncState({ cursor, lastSyncedAt: this.repo.getSyncState().lastSyncedAt });
      if (!page.hasMore) return cursor;
    }
  }

  private throwIfStopped(): void {
    if (this.stopped) throw new StoppedError();
  }

  /** repo.dirtyCount(), or `fallback` if it throws, so status bookkeeping can never reject syncNow. */
  private dirtyCountOr(fallback: number): number {
    try {
      return this.repo.dirtyCount();
    } catch {
      return fallback;
    }
  }

  /** Applies `patch` with a fresh `pending`. Ignored after stop(): stop() sets the final status. */
  private update(patch: Partial<SyncStatus>): void {
    if (this.stopped) return;
    const next: SyncStatus = { ...this.status, ...patch, pending: this.dirtyCountOr(this.status.pending) };
    if (next.state !== 'error') delete next.error;
    this.publish(next);
  }

  private publish(next: SyncStatus): void {
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
