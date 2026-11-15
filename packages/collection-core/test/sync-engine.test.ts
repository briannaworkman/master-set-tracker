import { describe, expect, it, vi } from 'vitest';
import { createMemoryRepo } from '../src/db/memory-repo';
import { createSqliteRepo } from '../src/db/sqlite-repo';
import type { CollectionRepo } from '../src/db/sql-db';
import { CollectionStore } from '../src/store';
import { SyncEngine, isNetworkError, type SyncStatus } from '../src/sync/engine';
import type { CollectionRow } from '../src/sync/types';
import { FakeSyncRemote } from '../src/testing/fake-remote';
import { createBetterSqliteDb } from './better-sqlite-db';

type RepoKind = 'memory' | 'sqlite';

function makeClock(start = '2026-01-01T00:00:00.000Z') {
  let t = Date.parse(start);
  return {
    /** Each call returns the current time, then advances 1 ms, so writes never share a timestamp by accident. */
    now: () => new Date(t++).toISOString(),
    set: (iso: string) => {
      t = Date.parse(iso);
    },
  };
}

function makeRepo(kind: RepoKind): CollectionRepo {
  return kind === 'memory' ? createMemoryRepo() : createSqliteRepo(createBetterSqliteDb());
}

function makeDevice(server: FakeSyncRemote, kind: RepoKind, opts: { pushBatch?: number; pullLimit?: number } = {}) {
  const clock = makeClock();
  const repo = makeRepo(kind);
  const store = new CollectionStore(repo, clock.now);
  const engine = new SyncEngine({ repo, store, remote: server, now: clock.now, ...opts });
  return { clock, repo, store, engine };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const crow = (cardId: string, count: number, updatedAt: string, setId = 's1'): CollectionRow => ({
  cardId,
  kind: 'normal',
  setId,
  count,
  updatedAt,
});

const other = (k: RepoKind): RepoKind => (k === 'memory' ? 'sqlite' : 'memory');

describe.each<RepoKind>(['memory', 'sqlite'])('SyncEngine over a %s repo', (kind) => {
  it('uploads local changes on first sync and downloads remote ones', async () => {
    const server = new FakeSyncRemote();
    const a = makeDevice(server, kind);
    a.store.track('s1');
    a.store.tap('s1', 's1-001', 'normal');
    a.store.tap('s1', 's1-001', 'normal');
    a.store.setHidden('s1', ['promos']);
    a.clock.set('2026-01-02T00:00:00.000Z');

    const status = await a.engine.syncNow();
    expect(status).toEqual({ state: 'idle', lastSyncedAt: '2026-01-02T00:00:00.000Z', pending: 0 });
    expect(a.engine.getStatus()).toBe(status);
    expect(server.snapshot().collection).toEqual([
      { cardId: 's1-001', kind: 'normal', setId: 's1', count: 2, updatedAt: expect.any(String) },
    ]);
    expect(server.snapshot().tracked).toMatchObject([{ setId: 's1', hiddenCategoryIds: ['promos'], removedAt: null }]);
    expect(a.repo.dirtyCount()).toBe(0);
    expect(a.repo.getSyncState()).toEqual({ cursor: server.seqs().at(-1), lastSyncedAt: '2026-01-02T00:00:00.000Z' });

    // A second device downloads it; its store emits once for the whole page.
    const b = makeDevice(server, other(kind));
    const listener = vi.fn();
    b.store.subscribe(listener);
    await b.engine.syncNow();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(b.store.getTracked()).toMatchObject([{ setId: 's1', hiddenCategoryIds: ['promos'] }]);
    expect(b.store.getCounts('s1')).toEqual({ 's1-001:normal': 2 });
    expect(b.repo.dirtyCount()).toBe(0);
    expect(b.engine.getStatus()).toMatchObject({ state: 'idle', pending: 0 });
    expect(server.pushCalls).toHaveLength(1); // b had nothing to push
  });

  it('resolves a two-device conflict by latest updatedAt on both devices', async () => {
    const server = new FakeSyncRemote();
    const a = makeDevice(server, kind);
    const b = makeDevice(server, other(kind));
    a.clock.set('2026-01-01T10:00:00.000Z');
    a.store.track('s1');
    a.store.setCount('s1', 's1-001', 'normal', 1);
    a.store.setCount('s1', 's1-002', 'normal', 1);
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect(b.store.getCounts('s1')).toEqual({ 's1-001:normal': 1, 's1-002:normal': 1 });

    // Both edit while apart. s1-001: B is later. s1-002 and the tracked row: A is later.
    a.clock.set('2026-01-01T11:00:00.000Z');
    a.store.setCount('s1', 's1-001', 'normal', 2);
    b.clock.set('2026-01-01T12:00:00.000Z');
    b.store.setCount('s1', 's1-001', 'normal', 5);
    b.store.setCount('s1', 's1-002', 'normal', 7);
    b.store.untrack('s1');
    a.clock.set('2026-01-01T13:00:00.000Z');
    a.store.setCount('s1', 's1-002', 'normal', 3);
    a.store.setHidden('s1', ['promos']);

    await a.engine.syncNow(); // all of A's rows are newer than the server's: accepted
    await b.engine.syncNow(); // s1-001 accepted; s1-002 + untrack rejected, then A's versions pulled
    await a.engine.syncNow(); // pulls B's s1-001

    for (const d of [a, b]) {
      expect(d.store.getCounts('s1')).toEqual({ 's1-001:normal': 5, 's1-002:normal': 3 });
      expect(d.store.getTracked()).toMatchObject([{ setId: 's1', hiddenCategoryIds: ['promos'] }]);
      expect(d.repo.dirtyCount()).toBe(0);
    }
    expect(server.snapshot().collection.map((r) => [r.cardId, r.count])).toEqual([
      ['s1-001', 5],
      ['s1-002', 3],
    ]);
    expect(server.snapshot().tracked).toMatchObject([{ setId: 's1', hiddenCategoryIds: ['promos'], removedAt: null }]);
  });

  it('keeps the server row on an exact updatedAt tie on both devices', async () => {
    const server = new FakeSyncRemote();
    const a = makeDevice(server, kind);
    const b = makeDevice(server, other(kind));
    a.clock.set('2026-01-01T10:00:00.000Z');
    a.store.setCount('s1', 's1-001', 'normal', 2);
    b.clock.set('2026-01-01T10:00:00.000Z');
    b.store.setCount('s1', 's1-001', 'normal', 9);

    await a.engine.syncNow();
    await b.engine.syncNow(); // tie: server keeps A's row; B's dirty tied row is overwritten by the pull
    await a.engine.syncNow();

    expect(server.snapshot().collection).toEqual([crow('s1-001', 2, '2026-01-01T10:00:00.000Z')]);
    for (const d of [a, b]) {
      expect(d.store.getCounts('s1')).toEqual({ 's1-001:normal': 2 });
      expect(d.repo.dirtyCount()).toBe(0);
    }
  });

  it('converges when one device clock is behind, reporting pending 0 only once converged', async () => {
    const server = new FakeSyncRemote();
    const a = makeDevice(server, kind);
    const b = makeDevice(server, other(kind));
    a.clock.set('2026-01-01T10:00:05.000Z');
    a.store.track('s1');
    a.store.setCount('s1', 's1-001', 'normal', 2);
    await a.engine.syncNow();
    await b.engine.syncNow(); // B now holds A's rows, stamped by A's clock

    b.clock.set('2026-01-01T10:00:02.000Z'); // B's clock is 3 s behind
    b.store.setCount('s1', 's1-001', 'normal', 3);
    b.store.setHidden('s1', ['promos']);
    expect(await b.engine.syncNow()).toMatchObject({ state: 'idle', pending: 0 });
    await a.engine.syncNow();

    expect(server.snapshot().collection).toMatchObject([{ cardId: 's1-001', count: 3 }]);
    expect(server.snapshot().tracked).toMatchObject([{ setId: 's1', hiddenCategoryIds: ['promos'] }]);
    for (const d of [a, b]) {
      expect(d.store.getCounts('s1')).toEqual({ 's1-001:normal': 3 });
      expect(d.store.getTracked()).toMatchObject([{ setId: 's1', hiddenCategoryIds: ['promos'] }]);
      expect(d.repo.dirtyCount()).toBe(0);
    }
  });

  it('keeps changes dirty when push fails and retries next time', async () => {
    const server = new FakeSyncRemote();
    const a = makeDevice(server, kind);
    a.store.track('s1');
    a.store.tap('s1', 's1-001', 'normal');
    server.failNext('push', new Error('push_changes: internal error'));

    const failed = await a.engine.syncNow();
    expect(failed).toEqual({ state: 'error', lastSyncedAt: null, pending: 2, error: 'push_changes: internal error' });
    expect(a.repo.dirtyCount()).toBe(2);
    expect(server.pullCalls).toHaveLength(0); // the run stopped at the failed push
    expect(server.snapshot()).toEqual({ collection: [], tracked: [] });

    const ok = await a.engine.syncNow();
    expect(ok).toMatchObject({ state: 'idle', pending: 0, lastSyncedAt: expect.any(String) });
    expect(ok.error).toBeUndefined();
    expect('error' in ok).toBe(false);
    expect(server.snapshot().collection).toHaveLength(1);
    expect(server.snapshot().tracked).toHaveLength(1);
  });

  it('marks only the batches that were pushed before a failure as synced', async () => {
    const server = new FakeSyncRemote();
    const a = makeDevice(server, kind, { pushBatch: 2 });
    a.store.setCount('s1', 's1-001', 'normal', 1);
    a.store.setCount('s1', 's1-002', 'normal', 1);
    a.store.setCount('s1', 's1-003', 'normal', 1);
    let pushes = 0;
    server.beforePush = () => {
      if (++pushes === 2) throw new Error('second batch failed');
    };

    expect(await a.engine.syncNow()).toMatchObject({ state: 'error', pending: 1 });
    expect(a.repo.dirtyChanges(10).collection.map((r) => r.cardId)).toEqual(['s1-003']);
    expect(server.snapshot().collection.map((r) => r.cardId)).toEqual(['s1-001', 's1-002']);

    server.beforePush = undefined;
    expect(await a.engine.syncNow()).toMatchObject({ state: 'idle', pending: 0 });
    expect(server.snapshot().collection.map((r) => r.cardId)).toEqual(['s1-001', 's1-002', 's1-003']);
  });

  it('recovers when the server applied a push but the response was lost', async () => {
    const server = new FakeSyncRemote();
    const a = makeDevice(server, kind);
    a.store.setCount('s1', 's1-001', 'normal', 4);
    server.afterPush = () => {
      throw new TypeError('Network request failed');
    };
    expect(await a.engine.syncNow()).toMatchObject({ state: 'offline', pending: 1 });
    expect(server.snapshot().collection).toHaveLength(1);
    const seqs = server.seqs();

    server.afterPush = undefined;
    expect(await a.engine.syncNow()).toMatchObject({ state: 'idle', pending: 0 });
    // The retried row tied, so the server kept its row untouched.
    expect(server.lastPushApplied).toEqual({ collection: 0, tracked: 0 });
    expect(server.seqs()).toEqual(seqs);
    expect(a.store.getCounts('s1')).toEqual({ 's1-001:normal': 4 });
  });

  it('advances the cursor only past applied pages when a pull page fails', async () => {
    const server = new FakeSyncRemote();
    for (let i = 1; i <= 5; i++) {
      await server.push({ collection: [crow(`s1-00${i}`, i, `2026-01-01T10:00:0${i}.000Z`)], tracked: [] });
      // A rejected stale write takes a sequence value too, so cursors have gaps.
      await server.push({ collection: [crow(`s1-00${i}`, 0, '2025-01-01T00:00:00.000Z')], tracked: [] });
    }
    const seqs = server.seqs();
    expect(seqs).not.toEqual([1, 2, 3, 4, 5]);
    const a = makeDevice(server, kind, { pullLimit: 2 });
    let pulls = 0;
    server.beforePull = () => {
      if (++pulls === 2) throw new Error('pull_changes: statement timeout');
    };

    const failed = await a.engine.syncNow();
    expect(failed).toMatchObject({ state: 'error', error: 'pull_changes: statement timeout', lastSyncedAt: null });
    expect(a.repo.getSyncState()).toEqual({ cursor: seqs[1], lastSyncedAt: null });
    expect(a.store.getCounts('s1')).toEqual({ 's1-001:normal': 1, 's1-002:normal': 2 });

    server.beforePull = undefined;
    expect(await a.engine.syncNow()).toMatchObject({ state: 'idle' });
    expect(server.pullCalls.slice(2).map((c) => c.cursor)).toEqual([seqs[1], seqs[3]]); // resumed at the saved cursor
    expect(a.repo.getSyncState().cursor).toBe(seqs[4]);
    expect(Object.keys(a.store.getCounts('s1'))).toHaveLength(5);
  });

  it('pushes a tap made during an in-flight sync on the follow-up run', async () => {
    const server = new FakeSyncRemote();
    const a = makeDevice(server, kind);
    const entered = deferred();
    const release = deferred();
    let first = true;
    server.beforePush = async () => {
      if (!first) return;
      first = false;
      entered.resolve();
      await release.promise;
    };
    a.store.tap('s1', 's1-001', 'normal');
    const run = a.engine.syncNow();
    await entered.promise;
    expect(a.engine.getStatus().state).toBe('syncing');
    a.store.tap('s1', 's1-002', 'normal'); // a new row
    a.store.tap('s1', 's1-001', 'normal'); // the row being pushed, rewritten after its snapshot
    release.resolve();

    const status = await run;
    expect(status).toMatchObject({ state: 'idle', pending: 0 });
    expect(server.pushCalls).toHaveLength(2);
    expect(server.pushCalls[1]?.collection.map((r) => [r.cardId, r.count])).toEqual([
      ['s1-002', 1],
      ['s1-001', 2],
    ]);
    expect(server.snapshot().collection.map((r) => [r.cardId, r.count])).toEqual([
      ['s1-001', 2],
      ['s1-002', 1],
    ]);
    expect(server.pullCalls).toHaveLength(2);
  });

  it('pushes a tap made during the pull phase on the follow-up run', async () => {
    const server = new FakeSyncRemote();
    await server.push({ collection: [crow('s1-001', 1, '2026-01-01T00:00:00.000Z')], tracked: [] });
    const a = makeDevice(server, kind);
    a.clock.set('2026-02-01T00:00:00.000Z');
    let first = true;
    server.beforePull = () => {
      if (!first) return;
      first = false;
      a.store.setCount('s1', 's1-001', 'normal', 6); // newer than the server row being pulled
    };
    expect(await a.engine.syncNow()).toMatchObject({ state: 'idle', pending: 0 });
    expect(server.snapshot().collection).toMatchObject([{ cardId: 's1-001', count: 6 }]);
    expect(a.store.getCounts('s1')).toEqual({ 's1-001:normal': 6 });
  });

  it('runs at most one write-triggered follow-up per syncNow call', async () => {
    const server = new FakeSyncRemote();
    const a = makeDevice(server, kind);
    let n = 0;
    server.beforePush = () => {
      n += 1;
      a.store.tap('s1', `s1-10${n}`, 'normal'); // every push sees a new local write
    };
    a.store.tap('s1', 's1-001', 'normal');
    const status = await a.engine.syncNow();
    expect(server.pushCalls).toHaveLength(2);
    expect(status).toMatchObject({ state: 'idle', pending: 1 });
    expect(a.repo.dirtyChanges(10).collection.map((r) => r.cardId)).toEqual(['s1-102']);
  });

  it('gives a syncNow made during a run, even the follow-up, exactly one more run', async () => {
    const server = new FakeSyncRemote();
    const a = makeDevice(server, kind);
    let n = 0;
    const joined: Promise<SyncStatus>[] = [];
    server.beforePush = () => {
      n += 1;
      a.store.tap('s1', `s1-10${n}`, 'normal');
      if (n === 2) joined.push(a.engine.syncNow(), a.engine.syncNow()); // during the follow-up run
    };
    a.store.tap('s1', 's1-001', 'normal');
    const first = a.engine.syncNow();
    const status = await first;
    expect(joined).toHaveLength(2);
    expect(joined[0]).toBe(first);
    // Run 1, its write follow-up (run 2), and one run for the two calls made during run 2.
    expect(server.pushCalls).toHaveLength(3);
    expect(server.pullCalls).toHaveLength(3);
    expect(status).toMatchObject({ state: 'idle', pending: 1 }); // s1-103 was tapped during run 3
  });

  it('adds one run for several syncNow calls during a run, even after a failed run', async () => {
    const server = new FakeSyncRemote();
    const a = makeDevice(server, kind);
    const entered = deferred();
    const release = deferred();
    server.beforePull = async () => {
      if (server.pullCalls.length > 1) return;
      entered.resolve();
      await release.promise;
      throw new Error('pull_changes: boom');
    };
    const run = a.engine.syncNow();
    await entered.promise;
    void a.engine.syncNow();
    void a.engine.syncNow();
    void a.engine.syncNow();
    release.resolve();
    expect(await run).toMatchObject({ state: 'idle' });
    expect(server.pullCalls).toHaveLength(2);
  });

  it('pages pulls until has_more is false', async () => {
    const server = new FakeSyncRemote();
    const b = makeDevice(server, other(kind));
    b.store.track('s1');
    b.store.track('s2');
    for (let i = 1; i <= 3; i++) b.store.setCount('s1', `s1-00${i}`, 'normal', i);
    b.store.setHidden('s2', ['promos']);
    await b.engine.syncNow();
    b.store.setCount('s1', 's1-001', 'normal', 9); // an update moves the row to a later seq, leaving a gap
    await b.engine.syncNow();
    const seqs = server.seqs();
    expect(seqs).toHaveLength(5);
    const pullsBefore = server.pullCalls.length;

    const a = makeDevice(server, kind, { pullLimit: 2 });
    expect(await a.engine.syncNow()).toMatchObject({ state: 'idle' });
    expect(server.pullCalls.slice(pullsBefore)).toEqual([
      { cursor: 0, limit: 2 },
      { cursor: seqs[1], limit: 2 },
      { cursor: seqs[3], limit: 2 },
    ]);
    expect(a.repo.getSyncState().cursor).toBe(seqs[4]);
    expect(a.store.getCounts('s1')).toEqual({ 's1-001:normal': 9, 's1-002:normal': 2, 's1-003:normal': 3 });
    expect(a.store.getTracked().map((t) => [t.setId, t.hiddenCategoryIds])).toEqual([
      ['s1', []],
      ['s2', ['promos']],
    ]);

    // Nothing new: one empty page, cursor unchanged.
    await a.engine.syncNow();
    expect(server.pullCalls.at(-1)).toEqual({ cursor: seqs[4], limit: 2 });
    expect(a.repo.getSyncState().cursor).toBe(seqs[4]);
  });

  it('reports offline and does no network work when offline', async () => {
    const server = new FakeSyncRemote();
    const a = makeDevice(server, kind);
    a.engine.setOnline(false);
    expect(a.engine.getStatus()).toMatchObject({ state: 'offline', pending: 0 });
    a.store.tap('s1', 's1-001', 'normal');

    expect(await a.engine.syncNow()).toEqual({ state: 'offline', lastSyncedAt: null, pending: 1 });
    expect(server.pushCalls).toHaveLength(0);
    expect(server.pullCalls).toHaveLength(0);

    a.engine.setOnline(true); // back to idle, but it does not start a sync by itself
    expect(a.engine.getStatus()).toMatchObject({ state: 'idle', pending: 1 });
    await Promise.resolve();
    expect(server.pushCalls).toHaveLength(0);

    expect(await a.engine.syncNow()).toMatchObject({ state: 'idle', pending: 0 });
    expect(server.pushCalls).toHaveLength(1);
  });

  it('reports offline, not error, for a network failure and still tries next time', async () => {
    const server = new FakeSyncRemote();
    const a = makeDevice(server, kind);
    a.store.tap('s1', 's1-001', 'normal');
    server.failNext('push', new TypeError('Network request failed'));
    const status = await a.engine.syncNow();
    expect(status).toEqual({ state: 'offline', lastSyncedAt: null, pending: 1 });
    expect(await a.engine.syncNow()).toMatchObject({ state: 'idle', pending: 0 });
  });

  it('coalesces concurrent syncNow calls', async () => {
    const server = new FakeSyncRemote();
    const a = makeDevice(server, kind);
    a.store.tap('s1', 's1-001', 'normal');
    const p1 = a.engine.syncNow();
    const p2 = a.engine.syncNow();
    const p3 = a.engine.syncNow();
    expect(p2).toBe(p1);
    expect(p3).toBe(p1);
    await Promise.all([p1, p2, p3]);
    // p2 and p3 arrived while run 1 was in flight, so together they get exactly one more run.
    expect(server.pushCalls).toHaveLength(1);
    expect(server.pullCalls).toHaveLength(2);

    const p4 = a.engine.syncNow(); // a call after everything settled starts a new one
    expect(p4).not.toBe(p1);
    await p4;
    expect(server.pullCalls).toHaveLength(3);
  });
});

describe('SyncEngine status', () => {
  it('emits syncing then idle, keeps a stable reference and stops after unsubscribe', async () => {
    const server = new FakeSyncRemote();
    const a = makeDevice(server, 'memory');
    const initial = a.engine.getStatus();
    expect(initial).toEqual({ state: 'idle', lastSyncedAt: null, pending: 0 });
    expect(a.engine.getStatus()).toBe(initial);

    const seen: SyncStatus[] = [];
    const off = a.engine.subscribe((s) => seen.push(s));
    a.store.tap('s1', 's1-001', 'normal');
    await a.engine.syncNow();
    expect(seen.map((s) => s.state)).toEqual(['syncing', 'idle']);
    expect(seen[0]?.pending).toBe(1);
    expect(seen[1]?.pending).toBe(0);
    expect(seen[1]).toBe(a.engine.getStatus());

    off();
    await a.engine.syncNow();
    expect(seen).toHaveLength(2);
  });

  it('stays syncing across a follow-up run instead of flickering through idle', async () => {
    const server = new FakeSyncRemote();
    const a = makeDevice(server, 'sqlite');
    let first = true;
    server.beforePush = () => {
      if (!first) return;
      first = false;
      a.store.tap('s1', 's1-002', 'normal');
    };
    a.store.tap('s1', 's1-001', 'normal');
    const seen: SyncStatus['state'][] = [];
    a.engine.subscribe((s) => seen.push(s.state));
    await a.engine.syncNow();
    expect(server.pushCalls).toHaveLength(2);
    expect(seen.at(-1)).toBe('idle');
    expect(seen.slice(0, -1).every((s) => s === 'syncing')).toBe(true);
  });

  it('keeps the first run lastSyncedAt when the follow-up run fails', async () => {
    const server = new FakeSyncRemote();
    const a = makeDevice(server, 'memory');
    a.clock.set('2026-03-01T00:00:00.000Z');
    let pushes = 0;
    server.beforePush = () => {
      pushes += 1;
      if (pushes === 1) a.store.tap('s1', 's1-002', 'normal');
      if (pushes === 2) throw new Error('follow-up failed');
    };
    a.store.tap('s1', 's1-001', 'normal');
    const status = await a.engine.syncNow();
    expect(status).toMatchObject({ state: 'error', error: 'follow-up failed', pending: 1 });
    expect(status.lastSyncedAt).not.toBeNull();
    expect(a.repo.getSyncState().lastSyncedAt).toBe(status.lastSyncedAt);
  });

  it('starts from the persisted lastSyncedAt and dirty count', () => {
    const repo = createMemoryRepo();
    repo.setCount('s1', 's1-001', 'normal', 1, '2026-01-01T00:00:00.000Z');
    repo.setSyncState({ cursor: 7, lastSyncedAt: '2026-01-01T00:00:00.000Z' });
    const engine = new SyncEngine({ repo, store: new CollectionStore(repo), remote: new FakeSyncRemote() });
    expect(engine.getStatus()).toEqual({ state: 'idle', lastSyncedAt: '2026-01-01T00:00:00.000Z', pending: 1 });
  });

  it('a throwing status listener does not break the run and is reported', async () => {
    const server = new FakeSyncRemote();
    const a = makeDevice(server, 'memory');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      a.engine.subscribe(() => {
        throw new Error('listener bug');
      });
      const good = vi.fn();
      a.engine.subscribe(good);
      a.store.tap('s1', 's1-001', 'normal');
      expect(await a.engine.syncNow()).toMatchObject({ state: 'idle', pending: 0 });
      expect(good).toHaveBeenCalledTimes(2);
      expect(consoleError).toHaveBeenCalledWith(expect.stringMatching(/listener/), expect.objectContaining({ message: 'listener bug' }));
    } finally {
      consoleError.mockRestore();
    }
  });

  it('shows offline while offline even if a run was in flight, and syncing when back online mid-run', async () => {
    const server = new FakeSyncRemote();
    const a = makeDevice(server, 'memory');
    const entered = deferred();
    const release = deferred();
    server.beforePull = async () => {
      entered.resolve();
      await release.promise;
    };
    const run = a.engine.syncNow();
    await entered.promise;
    a.engine.setOnline(false);
    expect(a.engine.getStatus().state).toBe('offline');
    a.engine.setOnline(true);
    expect(a.engine.getStatus().state).toBe('syncing');
    a.engine.setOnline(false);
    release.resolve();
    expect(await run).toMatchObject({ state: 'offline' });
  });

  it('rejects a page that claims more data without advancing the cursor', async () => {
    const repo = createMemoryRepo();
    const engine = new SyncEngine({
      repo,
      store: new CollectionStore(repo),
      remote: {
        push: async () => {},
        pull: async (cursor) => ({ changes: { collection: [], tracked: [] }, nextCursor: cursor, hasMore: true }),
      },
    });
    expect(await engine.syncNow()).toMatchObject({ state: 'error', error: expect.stringMatching(/cursor/) });
  });

  it('validates pushBatch and pullLimit', () => {
    const repo = createMemoryRepo();
    const base = { repo, store: new CollectionStore(repo), remote: new FakeSyncRemote() };
    expect(() => new SyncEngine({ ...base, pushBatch: 0 })).toThrow(RangeError);
    expect(() => new SyncEngine({ ...base, pullLimit: 1001 })).toThrow(RangeError);
    expect(() => new SyncEngine({ ...base, pullLimit: 1.5 })).toThrow(RangeError);
  });
});

describe('SyncEngine.stop', () => {
  it('stopped during a push: the batch is not marked synced and nothing more runs', async () => {
    const server = new FakeSyncRemote();
    const a = makeDevice(server, 'sqlite');
    const entered = deferred();
    const release = deferred();
    server.afterPush = async () => {
      entered.resolve();
      await release.promise;
    };
    a.store.tap('s1', 's1-001', 'normal');
    const run = a.engine.syncNow();
    await entered.promise; // the server has applied the push; its response is outstanding
    const stopped = a.engine.stop();
    expect(await a.engine.syncNow()).toBe(a.engine.getStatus()); // resolves at once, no new run
    release.resolve();
    await stopped;
    await run;

    expect(server.snapshot().collection).toHaveLength(1);
    expect(a.repo.dirtyCount()).toBe(1); // never marked synced
    expect(server.pullCalls).toHaveLength(0);
    expect(a.repo.getSyncState()).toEqual({ cursor: 0, lastSyncedAt: null });
    expect(a.engine.getStatus()).toEqual({ state: 'idle', lastSyncedAt: null, pending: 1 });
  });

  it('stopped during a pull: the page is not applied and the cursor is not saved', async () => {
    const server = new FakeSyncRemote();
    await server.push({ collection: [crow('s1-001', 4, '2026-01-01T00:00:00.000Z')], tracked: [] });
    const a = makeDevice(server, 'sqlite');
    const entered = deferred();
    const release = deferred();
    server.beforePull = async () => {
      entered.resolve();
      await release.promise;
    };
    expect(a.store.getCounts('s1')).toEqual({}); // cached, so an applied page would emit
    const listener = vi.fn();
    a.store.subscribe(listener);
    const run = a.engine.syncNow();
    await entered.promise;
    const stopped = a.engine.stop();
    release.resolve();
    await stopped;
    expect(listener).not.toHaveBeenCalled();
    expect(a.repo.countsForSet('s1')).toEqual({});
    expect(a.repo.getSyncState()).toEqual({ cursor: 0, lastSyncedAt: null });
    a.store.wipe(); // sign-out wipes once stop() has resolved
    await run;
    await new Promise((r) => setTimeout(r, 0));

    expect(listener).toHaveBeenCalledTimes(1); // only the wipe
    expect(a.store.getCounts('s1')).toEqual({});
    expect(a.repo.getSyncState()).toEqual({ cursor: 0, lastSyncedAt: null });
    expect(server.pullCalls).toHaveLength(1);
    expect(a.engine.getStatus().state).toBe('idle');
  });

  it('with nothing in flight it resolves, ends idle, and later syncNow does no network work', async () => {
    const server = new FakeSyncRemote();
    const a = makeDevice(server, 'memory');
    a.store.tap('s1', 's1-001', 'normal');
    server.failNext('push', new Error('boom'));
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ state: 'error', error: 'boom' });
    const seen: SyncStatus[] = [];
    a.engine.subscribe((st) => seen.push(st));

    const p = a.engine.stop();
    expect(a.engine.stop()).toBe(p);
    await p;
    expect(a.engine.getStatus()).toEqual({ state: 'idle', lastSyncedAt: null, pending: 1 });
    a.engine.setOnline(false);
    a.engine.setOnline(true);
    expect(await a.engine.syncNow()).toEqual({ state: 'idle', lastSyncedAt: null, pending: 1 });
    expect(server.pushCalls).toHaveLength(1);
    expect(server.pullCalls).toHaveLength(0);
    expect(seen.map((st) => st.state)).toEqual(['idle']);
  });
});

describe('SyncEngine robustness', () => {
  it('never rejects syncNow when dirtyCount throws during status bookkeeping', async () => {
    const repo = createMemoryRepo();
    const store = new CollectionStore(repo);
    const engine = new SyncEngine({ repo, store, remote: new FakeSyncRemote() });
    repo.dirtyCount = () => {
      throw new Error('database is locked');
    };
    const status = await engine.syncNow();
    expect(status.state).toBe('error');
    expect(status.error).toMatch(/database is locked/);
    engine.setOnline(false);
    await expect(engine.syncNow()).resolves.toMatchObject({ state: 'offline' });
  });
});

describe('isNetworkError', () => {
  it.each([
    new TypeError('Failed to fetch'),
    new TypeError('Network request failed'),
    new TypeError('Load failed'),
    new TypeError('fetch failed'),
    new Error('fetch failed'),
    new Error('connect ECONNREFUSED 127.0.0.1:54321'),
    new Error('getaddrinfo ENOTFOUND example.supabase.co'),
    new Error('Request timed out'),
    new Error('The device is offline'),
    new Error('NetworkError when attempting to fetch resource.'),
    { message: 'TypeError: Failed to fetch' }, // supabase-js wraps fetch failures in a plain error object
    'Network request failed',
  ])('treats %s as a network failure', (e) => {
    expect(isNetworkError(e)).toBe(true);
  });

  it('treats aborted and timed-out requests (AbortError / TimeoutError) as network failures', () => {
    expect(isNetworkError(new DOMException('This operation was aborted', 'AbortError'))).toBe(true);
    expect(isNetworkError(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))).toBe(true);
    expect(isNetworkError(Object.assign(new Error('Aborted'), { name: 'AbortError' }))).toBe(true);
    expect(isNetworkError({ name: 'AbortError', message: '' })).toBe(true);
  });

  it.each([
    new Error('push_changes: p_collection[0].count must be between 0 and 999'),
    new Error('not authenticated'),
    new TypeError("Cannot read properties of undefined (reading 'map')"),
    { message: 'JWT expired', code: 'PGRST301' },
    null,
    undefined,
    42,
  ])('treats %s as a real error', (e) => {
    expect(isNetworkError(e)).toBe(false);
  });
});
