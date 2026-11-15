import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { asAnon, asService, asUser, createDb, createUser } from '../src/harness';

type PushResult = { collection_applied: number; tracked_applied: number };
type CollectionRow = {
  card_id: string;
  kind: string;
  set_id: string;
  count: number;
  updated_at: string;
  server_seq: number;
};
type TrackedRow = {
  set_id: string;
  hidden_category_ids: string[];
  added_at: string;
  removed_at: string | null;
  updated_at: string;
  server_seq: number;
};
type PullResult = {
  collection: CollectionRow[];
  tracked: TrackedRow[];
  next_cursor: number;
  has_more: boolean;
};

const T1 = '2026-11-16T10:00:00.001Z';
const T2 = '2026-11-16T10:00:00.002Z';
const T3 = '2026-11-16T10:00:00.003Z';

function card(cardId: string, count: number, updatedAt: string, kind = 'normal', setId = 'sv1') {
  return { card_id: cardId, kind, set_id: setId, count, updated_at: updatedAt };
}

function tracked(setId: string, updatedAt: string, extra: Partial<Record<string, unknown>> = {}) {
  return {
    set_id: setId,
    hidden_category_ids: [],
    added_at: T1,
    removed_at: null,
    updated_at: updatedAt,
    ...extra,
  };
}

async function push(
  tx: Transaction,
  collection: unknown[] = [],
  trackedSets: unknown[] = [],
): Promise<PushResult> {
  const r = await tx.query<{ r: PushResult }>(
    'select public.push_changes($1::jsonb, $2::jsonb) as r',
    [JSON.stringify(collection), JSON.stringify(trackedSets)],
  );
  return r.rows[0]!.r;
}

async function pull(tx: Transaction, cursor: number, limit?: number): Promise<PullResult> {
  const r =
    limit === undefined
      ? await tx.query<{ r: PullResult }>('select public.pull_changes($1) as r', [cursor])
      : await tx.query<{ r: PullResult }>('select public.pull_changes($1, $2) as r', [
          cursor,
          limit,
        ]);
  return r.rows[0]!.r;
}

async function countOf(db: PGlite, userId: string, cardId: string): Promise<number | undefined> {
  return asUser(db, userId, async (tx) => {
    const r = await tx.query<{ count: number }>(
      'select count from public.collection where card_id = $1',
      [cardId],
    );
    return r.rows[0]?.count;
  });
}

describe('sync schema', () => {
  let db: PGlite;
  let alice: string;
  let bob: string;

  beforeEach(async () => {
    db = await createDb();
    alice = await createUser(db, 'alice@example.com');
    bob = await createUser(db, 'bob@example.com');
  });

  it('creates a profile with a 10-char share code on signup', async () => {
    const r = await db.query<{ user_id: string; share_code: string }>(
      'select user_id, share_code from public.profiles order by share_code',
    );
    expect(r.rows).toHaveLength(2);
    for (const row of r.rows) {
      expect(row.share_code).toMatch(/^[a-km-np-z2-9]{10}$/);
    }
    expect(new Set(r.rows.map((x) => x.user_id))).toEqual(new Set([alice, bob]));

    // A user can read their own profile but not anyone else's.
    const own = await asUser(db, alice, (tx) =>
      tx.query<{ user_id: string }>('select user_id from public.profiles'),
    );
    expect(own.rows).toEqual([{ user_id: alice }]);
  });

  it('retries the share code on a collision', async () => {
    // Force the generator to return a colliding code first.
    await db.exec(`
      create table public.test_codes(n serial primary key, code text not null);
      insert into public.test_codes(code) values ('aaaaaaaaaa'), ('aaaaaaaaaa'), ('bbbbbbbbbb');
      create or replace function public.generate_share_code() returns text
      language sql volatile as $$
        delete from public.test_codes
        where n = (select min(n) from public.test_codes)
        returning code
      $$;
    `);
    const c1 = await createUser(db, 'c1@example.com');
    const c2 = await createUser(db, 'c2@example.com');
    const r = await db.query<{ user_id: string; share_code: string }>(
      'select user_id, share_code from public.profiles where user_id in ($1, $2)',
      [c1, c2],
    );
    const byUser = Object.fromEntries(r.rows.map((x) => [x.user_id, x.share_code]));
    expect(byUser[c1]).toBe('aaaaaaaaaa');
    expect(byUser[c2]).toBe('bbbbbbbbbb');
  });

  it('lets a user read and write only their own rows', async () => {
    await asUser(db, alice, (tx) => push(tx, [card('sv1-1', 4, T1)], [tracked('sv1', T1)]));

    // Bob sees none of Alice's rows.
    const seen = await asUser(db, bob, async (tx) => ({
      collection: (await tx.query('select * from public.collection')).rows.length,
      tracked: (await tx.query('select * from public.tracked_sets')).rows.length,
      pulled: await pull(tx, 0),
    }));
    expect(seen.collection).toBe(0);
    expect(seen.tracked).toBe(0);
    expect(seen.pulled.collection).toEqual([]);
    expect(seen.pulled.tracked).toEqual([]);

    // Bob's push for the same key lands in Bob's rows and changes nothing of Alice's.
    const res = await asUser(db, bob, (tx) => push(tx, [card('sv1-1', 9, T3)]));
    expect(res.collection_applied).toBe(1);
    expect(await countOf(db, alice, 'sv1-1')).toBe(4);
    expect(await countOf(db, bob, 'sv1-1')).toBe(9);

    // Direct writes to Alice's rows are invisible / refused.
    const updated = await asUser(db, bob, (tx) =>
      tx.query('update public.collection set count = 7 where user_id = $1', [alice]),
    );
    expect(updated.affectedRows).toBe(0);
    await expect(
      asUser(db, bob, (tx) =>
        tx.query(
          `insert into public.collection(user_id, card_id, kind, set_id, count, updated_at)
           values ($1, 'sv1-2', 'normal', 'sv1', 1, '2026-11-16T10:00:00.001Z')`,
          [alice],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    expect(await countOf(db, alice, 'sv1-1')).toBe(4);
  });

  it('denies anon access to tables and RPCs', async () => {
    await expect(
      asAnon(db, (tx) => tx.query('select * from public.collection')),
    ).rejects.toThrow(/permission denied/);
    await expect(asAnon(db, (tx) => tx.query('select * from public.tracked_sets'))).rejects.toThrow(
      /permission denied/,
    );
    await expect(asAnon(db, (tx) => tx.query('select * from public.profiles'))).rejects.toThrow(
      /permission denied/,
    );
    await expect(asAnon(db, (tx) => push(tx, [card('sv1-1', 1, T1)]))).rejects.toThrow(
      /permission denied/,
    );
    await expect(asAnon(db, (tx) => pull(tx, 0))).rejects.toThrow(/permission denied/);
  });

  it('rejects RPC calls without an authenticated user id', async () => {
    const noClaim = <T>(fn: (tx: Transaction) => Promise<T>) =>
      db.transaction(async (tx) => {
        await tx.exec('set local role authenticated');
        return fn(tx);
      });
    await expect(noClaim((tx) => push(tx, [card('sv1-1', 1, T1)]))).rejects.toThrow(
      /not authenticated/,
    );
    await expect(noClaim((tx) => pull(tx, 0))).rejects.toThrow(/not authenticated/);
  });

  it('lets the service role read every row', async () => {
    await asUser(db, alice, (tx) => push(tx, [card('sv1-1', 1, T1)]));
    await asUser(db, bob, (tx) => push(tx, [card('sv1-1', 2, T1)]));
    const n = await asService(db, async (tx) =>
      (await tx.query('select * from public.collection')).rows.length,
    );
    expect(n).toBe(2);
  });

  it('applies newer client rows and ignores older ones', async () => {
    const applied: number[] = [];
    applied.push((await asUser(db, alice, (tx) => push(tx, [card('sv1-1', 2, T2)]))).collection_applied);
    expect(await countOf(db, alice, 'sv1-1')).toBe(2);
    applied.push((await asUser(db, alice, (tx) => push(tx, [card('sv1-1', 5, T1)]))).collection_applied);
    expect(await countOf(db, alice, 'sv1-1')).toBe(2);
    applied.push((await asUser(db, alice, (tx) => push(tx, [card('sv1-1', 3, T3)]))).collection_applied);
    expect(await countOf(db, alice, 'sv1-1')).toBe(3);
    expect(applied).toEqual([1, 0, 1]);

    // Same rule for tracked sets.
    await asUser(db, alice, (tx) => push(tx, [], [tracked('sv1', T2, { hidden_category_ids: ['a'] })]));
    const older = await asUser(db, alice, (tx) =>
      push(tx, [], [tracked('sv1', T1, { hidden_category_ids: ['b'] })]),
    );
    expect(older.tracked_applied).toBe(0);
    const p = await asUser(db, alice, (tx) => pull(tx, 0));
    expect(p.tracked[0]!.hidden_category_ids).toEqual(['a']);
  });

  it('keeps the server row on an exact updated_at tie', async () => {
    await asUser(db, alice, (tx) => push(tx, [card('sv1-1', 2, T2)], [tracked('sv1', T2)]));
    const res = await asUser(db, alice, (tx) =>
      push(tx, [card('sv1-1', 8, T2)], [tracked('sv1', T2, { removed_at: T2 })]),
    );
    expect(res).toEqual({ collection_applied: 0, tracked_applied: 0 });
    expect(await countOf(db, alice, 'sv1-1')).toBe(2);
    const p = await asUser(db, alice, (tx) => pull(tx, 0));
    expect(p.tracked[0]!.removed_at).toBeNull();
  });

  it('collapses duplicate keys in one push to the newest element', async () => {
    const res = await asUser(db, alice, (tx) =>
      push(tx, [card('sv1-1', 1, T1), card('sv1-1', 3, T3), card('sv1-1', 2, T2)]),
    );
    expect(res.collection_applied).toBe(1);
    expect(await countOf(db, alice, 'sv1-1')).toBe(3);
  });

  it('rejects counts outside 0..999', async () => {
    await expect(asUser(db, alice, (tx) => push(tx, [card('sv1-1', 1000, T1)]))).rejects.toThrow();
    await expect(asUser(db, alice, (tx) => push(tx, [card('sv1-1', -1, T1)]))).rejects.toThrow();
    await expect(
      asUser(db, alice, (tx) =>
        tx.query(
          `insert into public.collection(user_id, card_id, kind, set_id, count, updated_at)
           values ($1, 'sv1-1', 'normal', 'sv1', 1000, '2026-11-16T10:00:00.001Z')`,
          [alice],
        ),
      ),
    ).rejects.toThrow(/check constraint/);
    const ok = await asUser(db, alice, (tx) =>
      push(tx, [card('sv1-0', 0, T1), card('sv1-9', 999, T1)]),
    );
    expect(ok.collection_applied).toBe(2);
  });

  it('rejects malformed push elements with a clear error', async () => {
    const bad: [unknown[], unknown[], RegExp][] = [
      [[{ kind: 'normal', set_id: 'sv1', count: 1, updated_at: T1 }], [], /card_id/],
      [[{ ...card('sv1-1', 1, T1), kind: '' }], [], /kind/],
      [[{ ...card('sv1-1', 1, T1), set_id: 5 }], [], /set_id/],
      [[{ ...card('sv1-1', 1, T1), count: '3' }], [], /count/],
      [[{ ...card('sv1-1', 1, T1), count: 1.5 }], [], /count/],
      [[{ ...card('sv1-1', 1, T1), count: 'abc' }], [], /count must be an integer/],
      [[], [{ ...tracked('sv1', T1), hidden_category_ids: { a: 1 } }], /hidden_category_ids/],
      [[{ ...card('sv1-1', 1, T1), updated_at: 'yesterday' }], [], /updated_at/],
      [[{ ...card('sv1-1', 1, T1), updated_at: 'now' }], [], /updated_at/],
      [[{ ...card('sv1-1', 1, T1), updated_at: '2026-11-16T10:00:00' }], [], /updated_at/],
      [[{ ...card('sv1-1', 1, T1), updated_at: '2026-13-45T10:00:00Z' }], [], /updated_at/],
      [[], [{ ...tracked('sv1', T1), removed_at: 'yesterday' }], /removed_at/],
      [['nope'], [], /object/],
      [[], [{ ...tracked('sv1', T1), hidden_category_ids: 'x' }], /hidden_category_ids/],
      [[], [{ ...tracked('sv1', T1), hidden_category_ids: [1] }], /hidden_category_ids/],
      [[], [{ ...tracked('sv1', T1), added_at: undefined }], /added_at/],
      [[], [{ ...tracked('sv1', T1), removed_at: 'later' }], /removed_at/],
    ];
    for (const [c, t, msg] of bad) {
      await expect(asUser(db, alice, (tx) => push(tx, c, t))).rejects.toThrow(msg);
    }
    await expect(
      asUser(db, alice, (tx) =>
        tx.query('select public.push_changes($1::jsonb, $2::jsonb)', ['{}', '[]']),
      ),
    ).rejects.toThrow(/array/);
  });

  it('assigns increasing server_seq and pulls only rows after the cursor', async () => {
    await asUser(db, alice, (tx) => push(tx, [card('sv1-1', 1, T1)]));
    await asUser(db, alice, (tx) => push(tx, [card('sv1-2', 1, T1)]));
    const first = await asUser(db, alice, (tx) => pull(tx, 0));
    expect(first.collection.map((r) => r.card_id)).toEqual(['sv1-1', 'sv1-2']);
    const [a, b] = first.collection;
    expect(b!.server_seq).toBeGreaterThan(a!.server_seq);
    expect(first.next_cursor).toBe(b!.server_seq);
    expect(first.has_more).toBe(false);
    expect(a).toEqual({
      card_id: 'sv1-1',
      kind: 'normal',
      set_id: 'sv1',
      count: 1,
      updated_at: T1,
      server_seq: a!.server_seq,
    });

    // An update bumps the row past the cursor; untouched rows don't come back.
    await asUser(db, alice, (tx) => push(tx, [card('sv1-1', 4, T2)]));
    const next = await asUser(db, alice, (tx) => pull(tx, first.next_cursor));
    expect(next.collection.map((r) => [r.card_id, r.count])).toEqual([['sv1-1', 4]]);
    expect(next.collection[0]!.server_seq).toBeGreaterThan(b!.server_seq);

    // Empty pull keeps the cursor.
    const empty = await asUser(db, alice, (tx) => pull(tx, next.next_cursor));
    expect(empty).toEqual({ collection: [], tracked: [], next_cursor: next.next_cursor, has_more: false });

    // Clients cannot choose server_seq.
    await asUser(db, alice, (tx) =>
      tx.query('update public.collection set server_seq = 1 where card_id = $1', ['sv1-2']),
    );
    const seq = await asUser(db, alice, async (tx) =>
      (await tx.query<{ server_seq: number }>(
        "select server_seq from public.collection where card_id = 'sv1-2'",
      )).rows[0]!.server_seq,
    );
    expect(Number(seq)).toBeGreaterThan(next.next_cursor);
  });

  it('pages pulls by p_limit across both tables with has_more', async () => {
    await asUser(db, alice, (tx) => push(tx, [card('sv1-1', 1, T1)]));
    await asUser(db, alice, (tx) => push(tx, [], [tracked('sv1', T1)]));
    await asUser(db, alice, (tx) => push(tx, [card('sv1-2', 1, T1)]));
    await asUser(db, alice, (tx) => push(tx, [], [tracked('sv2', T1)]));
    await asUser(db, alice, (tx) => push(tx, [card('sv1-3', 1, T1)]));

    const p1 = await asUser(db, alice, (tx) => pull(tx, 0, 4));
    expect(p1.collection.map((r) => r.card_id)).toEqual(['sv1-1', 'sv1-2']);
    expect(p1.tracked.map((r) => r.set_id)).toEqual(['sv1', 'sv2']);
    expect(p1.has_more).toBe(true);
    const seqs = [...p1.collection, ...p1.tracked].map((r) => r.server_seq);
    expect(p1.next_cursor).toBe(Math.max(...seqs));

    const p2 = await asUser(db, alice, (tx) => pull(tx, p1.next_cursor, 4));
    expect(p2.collection.map((r) => r.card_id)).toEqual(['sv1-3']);
    expect(p2.tracked).toEqual([]);
    expect(p2.has_more).toBe(false);
    expect(p2.next_cursor).toBe(p2.collection[0]!.server_seq);

    // Default limit returns everything here; bad limits are refused.
    const all = await asUser(db, alice, (tx) => pull(tx, 0));
    expect(all.collection.length + all.tracked.length).toBe(5);
    await expect(asUser(db, alice, (tx) => pull(tx, 0, 0))).rejects.toThrow(/p_limit/);
    await expect(asUser(db, alice, (tx) => pull(tx, 0, 1001))).rejects.toThrow(/p_limit/);
  });

  it('round-trips a removed tracked set and its hidden categories', async () => {
    await asUser(db, alice, (tx) =>
      push(tx, [], [tracked('sv1', T1, { hidden_category_ids: ['promo', 'stamped'] })]),
    );
    const res = await asUser(db, alice, (tx) =>
      push(tx, [], [tracked('sv1', T2, { hidden_category_ids: ['promo', 'stamped'], removed_at: T2 })]),
    );
    expect(res.tracked_applied).toBe(1);
    const p = await asUser(db, alice, (tx) => pull(tx, 0));
    expect(p.tracked).toEqual([
      {
        set_id: 'sv1',
        hidden_category_ids: ['promo', 'stamped'],
        added_at: T1,
        removed_at: T2,
        updated_at: T2,
        server_seq: p.tracked[0]!.server_seq,
      },
    ]);
  });
  it('serializes server_seq assignment per user with a transaction-scoped advisory lock', async () => {
    // PGlite is single-connection, so the race can't be reproduced; assert the mechanism instead.
    const src = await db.query<{ src: string }>(
      "select prosrc as src from pg_proc where oid = 'public.set_server_seq()'::regprocedure",
    );
    expect(src.rows[0]!.src).toContain('pg_advisory_xact_lock(hashtext(new.user_id::text))');

    const locks = await asUser(db, alice, async (tx) => {
      await push(tx, [card('sv1-1', 1, T1)]);
      const r = await tx.query<{ n: number }>(
        "select count(*)::int as n from pg_locks where locktype = 'advisory' and granted",
      );
      return r.rows[0]!.n;
    });
    expect(locks).toBeGreaterThanOrEqual(1);
    const after = await db.query<{ n: number }>(
      "select count(*)::int as n from pg_locks where locktype = 'advisory'",
    );
    expect(after.rows[0]!.n).toBe(0); // released at commit
  });

  it('leaves server_seq untouched when a push is rejected by LWW or a tie', async () => {
    await asUser(db, alice, (tx) => push(tx, [card('sv1-1', 2, T2)], [tracked('sv1', T2)]));
    const before = await asUser(db, alice, (tx) => pull(tx, 0));
    await asUser(db, alice, (tx) => push(tx, [card('sv1-1', 5, T1)], [tracked('sv1', T1)])); // older
    await asUser(db, alice, (tx) => push(tx, [card('sv1-1', 6, T2)], [tracked('sv1', T2)])); // tie
    const after = await asUser(db, alice, (tx) => pull(tx, 0));
    expect(after).toEqual(before);
    const since = await asUser(db, alice, (tx) => pull(tx, before.next_cursor));
    expect(since.collection).toEqual([]);
    expect(since.tracked).toEqual([]);
  });

  it('refuses moving a row to another user and refuses deletes', async () => {
    await asUser(db, alice, (tx) => push(tx, [card('sv1-1', 1, T1)], [tracked('sv1', T1)]));
    await expect(
      asUser(db, alice, (tx) => tx.query('update public.collection set user_id = $1', [bob])),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asUser(db, alice, (tx) => tx.query('update public.tracked_sets set user_id = $1', [bob])),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asUser(db, alice, (tx) => tx.query('delete from public.collection')),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, alice, (tx) => tx.query('delete from public.tracked_sets')),
    ).rejects.toThrow(/permission denied/);
    expect(await countOf(db, alice, 'sv1-1')).toBe(1);
  });

  it('revokes the hosted default privileges from API roles', async () => {
    // Sanity: the harness grants like hosted Supabase's default privileges do...
    await db.exec('create table public.probe (id int)');
    const probe = await asAnon(db, async (tx) => (await tx.query('select * from public.probe')).rows);
    expect(probe).toEqual([]);
    // ...so these failures come from the migration's revokes.
    await expect(
      asUser(db, alice, (tx) => tx.query('select public.generate_share_code()')),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, alice, (tx) => tx.query("select nextval('public.sync_seq')")),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, alice, (tx) => tx.query('truncate public.collection')),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, alice, (tx) => tx.query('update public.profiles set display_name = $1', ['x'])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asAnon(db, (tx) => tx.query("select nextval('public.sync_seq')")),
    ).rejects.toThrow(/permission denied/);
  });

  it('uses (select auth.uid()) in every policy', async () => {
    const r = await db.query<{ policyname: string; expr: string }>(
      `select policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '') as expr
       from pg_policies where schemaname = 'public'`,
    );
    expect(r.rows.length).toBeGreaterThanOrEqual(7);
    for (const row of r.rows) {
      expect(row.expr, row.policyname).toMatch(/\( SELECT auth\.uid\(\)/);
    }
  });

  it('requires hidden_category_ids to be a JSON array at the table level', async () => {
    await expect(
      asUser(db, alice, (tx) =>
        tx.query(
          `insert into public.tracked_sets(user_id, set_id, hidden_category_ids, added_at, updated_at)
           values ($1, 'sv1', '{}', $2, $2)`,
          [alice, T1],
        ),
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it('keeps timestamps at millisecond precision end to end', async () => {
    await expect(
      asUser(db, alice, (tx) => push(tx, [card('sv1-1', 1, '2026-11-16T10:00:00.0011Z')])),
    ).rejects.toThrow(/updated_at/);
    await expect(
      asUser(db, alice, (tx) =>
        push(tx, [], [tracked('sv1', T1, { added_at: '2026-11-16T10:00:00.000001Z' })]),
      ),
    ).rejects.toThrow(/added_at/);
    // Direct table writes can't sneak sub-millisecond values in either.
    for (const sql of [
      `insert into public.collection(user_id, card_id, kind, set_id, count, updated_at)
       values ($1, 'sv1-1', 'normal', 'sv1', 1, '2026-11-16T10:00:00.0001Z')`,
      `insert into public.tracked_sets(user_id, set_id, added_at, updated_at)
       values ($1, 'sv1', '2026-11-16T10:00:00.0001Z', '2026-11-16T10:00:00.001Z')`,
      `insert into public.tracked_sets(user_id, set_id, added_at, removed_at, updated_at)
       values ($1, 'sv1', '2026-11-16T10:00:00.001Z', '2026-11-16T10:00:00.0001Z', '2026-11-16T10:00:00.001Z')`,
    ]) {
      await expect(asUser(db, alice, (tx) => tx.query(sql, [alice]))).rejects.toThrow(
        /check constraint/,
      );
    }
    // Fewer digits and other offsets are fine and come back normalized to UTC milliseconds.
    await asUser(db, alice, (tx) =>
      push(tx, [card('sv1-1', 1, '2026-11-16T10:00:00.1Z'), card('sv1-2', 1, '2026-11-16T12:00:00+02:00')]),
    );
    const p = await asUser(db, alice, (tx) => pull(tx, 0));
    expect(p.collection.map((r) => r.updated_at)).toEqual([
      '2026-11-16T10:00:00.100Z',
      '2026-11-16T10:00:00.000Z',
    ]);
  });
});
