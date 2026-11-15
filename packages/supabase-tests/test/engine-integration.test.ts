// SyncEngine + the app's wire mapping (the same functions createSupabaseRemote uses) against the
// real push_changes / pull_changes SQL in PGlite, as the signed-in user.
import type { PGlite } from '@electric-sql/pglite';
import {
  CollectionStore,
  createMemoryRepo,
  fromPullResult,
  SyncEngine,
  toPushParams,
  type SyncRemote,
} from '@mst/collection-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { asUser, createDb, createUser } from '../src/harness';

/** What supabase.rpc() does for this user: calls the RPC with the mapped parameters under RLS. */
function pgliteRemote(db: PGlite, userId: string): SyncRemote {
  return {
    async push(changes) {
      const { p_collection, p_tracked } = toPushParams(changes);
      await asUser(db, userId, (tx) =>
        tx.query('select public.push_changes($1::jsonb, $2::jsonb)', [JSON.stringify(p_collection), JSON.stringify(p_tracked)]),
      );
    },
    async pull(cursor, limit) {
      const r = await asUser(db, userId, (tx) =>
        tx.query<{ r: unknown }>('select public.pull_changes($1, $2) as r', [cursor, limit]),
      );
      return fromPullResult(r.rows[0]!.r, cursor);
    },
  };
}

function makeClock(start: string) {
  let t = Date.parse(start);
  return {
    now: () => new Date(t++).toISOString(),
    set: (iso: string) => {
      t = Date.parse(iso);
    },
  };
}

function device(db: PGlite, userId: string, start = '2026-11-16T10:00:00.000Z') {
  const clock = makeClock(start);
  const repo = createMemoryRepo();
  const store = new CollectionStore(repo, clock.now);
  const engine = new SyncEngine({ repo, store, remote: pgliteRemote(db, userId), now: clock.now, pullLimit: 2 });
  return { clock, repo, store, engine };
}

describe('SyncEngine against push_changes / pull_changes (two devices, one user)', () => {
  let db: PGlite;
  let userId: string;

  beforeEach(async () => {
    db = await createDb();
    userId = await createUser(db, 'collector@example.com');
  });

  it('a mark and a tracked set made on device A reach device B', async () => {
    const a = device(db, userId);
    const b = device(db, userId);
    a.store.track('sv1');
    a.store.setHidden('sv1', ['promos']);
    a.store.tap('sv1', 'sv1-001', 'normal');
    a.store.tap('sv1', 'sv1-001', 'normal');
    a.store.tap('sv1', 'sv1-002', 'holo');
    a.store.tap('sv1', 'sv1-003', 'normal');

    expect((await a.engine.syncNow()).state).toBe('idle');
    expect(a.repo.dirtyCount()).toBe(0);
    // pullLimit 2 makes B page through the server's rows.
    expect((await b.engine.syncNow()).state).toBe('idle');

    expect(b.store.getTracked()).toMatchObject([{ setId: 'sv1', hiddenCategoryIds: ['promos'] }]);
    expect(b.repo.countsForSet('sv1')).toEqual({ 'sv1-001:normal': 2, 'sv1-002:holo': 1, 'sv1-003:normal': 1 });
    expect(b.repo.dirtyCount()).toBe(0);

    // An untrack on B is a tombstone that reaches A.
    b.store.untrack('sv1');
    await b.engine.syncNow();
    await a.engine.syncNow();
    expect(a.store.getTracked()).toEqual([]);
  });

  it('a conflict resolves to the later updated_at on both devices, whichever pushes first', async () => {
    for (const laterPushesFirst of [false, true]) {
      db = await createDb();
      userId = await createUser(db, 'collector@example.com');
      const a = device(db, userId);
      const b = device(db, userId);
      a.store.track('sv1');
      await a.engine.syncNow();
      await b.engine.syncNow();

      // A writes count 2 at 10:05; B (offline meanwhile) writes count 3 at 10:06, the later write.
      a.clock.set('2026-11-16T10:05:00.000Z');
      a.store.setCount('sv1', 'sv1-001', 'normal', 2);
      b.clock.set('2026-11-16T10:06:00.000Z');
      b.store.setCount('sv1', 'sv1-001', 'normal', 3);

      const order = laterPushesFirst ? [b, a, b] : [a, b, a];
      for (const d of order) expect((await d.engine.syncNow()).state).toBe('idle');

      expect(a.repo.countsForSet('sv1')).toEqual({ 'sv1-001:normal': 3 });
      expect(b.repo.countsForSet('sv1')).toEqual({ 'sv1-001:normal': 3 });
      expect(a.repo.dirtyCount() + b.repo.dirtyCount()).toBe(0);
      const server = await asUser(db, userId, (tx) =>
        tx.query<{ count: number; updated_at: Date }>("select count, updated_at from public.collection where card_id = 'sv1-001'"),
      );
      expect(server.rows[0]!.count).toBe(3);
      expect(server.rows[0]!.updated_at.toISOString()).toBe('2026-11-16T10:06:00.000Z');
    }
  });
});
