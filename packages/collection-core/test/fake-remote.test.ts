import { describe, expect, it } from 'vitest';
import { FakeSyncRemote } from '../src/testing/fake-remote';
import type { CollectionRow, TrackedRow } from '../src/sync/types';

const row = (cardId: string, count: number, updatedAt: string, setId = 's1', kind = 'normal'): CollectionRow => ({
  cardId,
  kind,
  setId,
  count,
  updatedAt,
});
const tracked = (setId: string, updatedAt: string, hidden: string[] = [], removedAt: string | null = null): TrackedRow => ({
  setId,
  hiddenCategoryIds: hidden,
  addedAt: '2026-01-01T00:00:00.000Z',
  removedAt,
  updatedAt,
});
const T1 = '2026-01-01T10:00:00.000Z';
const T2 = '2026-01-01T11:00:00.000Z';

describe('FakeSyncRemote (mirrors push_changes / pull_changes)', () => {
  it('accepts a push only when strictly newer and keeps its own row on a tie', async () => {
    const server = new FakeSyncRemote();
    await server.push({ collection: [row('c1', 1, T2)], tracked: [tracked('s1', T2, ['a'])] });
    expect(server.lastPushApplied).toEqual({ collection: 1, tracked: 1 });
    expect(server.seqs()).toEqual([1, 2]);

    await server.push({ collection: [row('c1', 9, T2)], tracked: [tracked('s1', T2, ['tie'])] }); // tie
    await server.push({ collection: [row('c1', 8, T1)], tracked: [tracked('s1', T1, ['old'])] }); // older
    expect(server.lastPushApplied).toEqual({ collection: 0, tracked: 0 });
    // Rejected rows still take a value (the BEFORE INSERT trigger fired) but no row keeps it.
    expect(server.seq).toBe(6);
    expect(server.seqs()).toEqual([1, 2]);
    expect(await server.pull(2, 1000)).toEqual({ changes: { collection: [], tracked: [] }, nextCursor: 2, hasMore: false });
    expect(server.snapshot().collection).toEqual([row('c1', 1, T2)]);
    expect(server.snapshot().tracked).toEqual([tracked('s1', T2, ['a'])]);

    // An accepted update takes two values (BEFORE INSERT, then BEFORE UPDATE) and keeps the second.
    await server.push({ collection: [row('c1', 3, '2026-01-01T11:00:00.001Z')], tracked: [] });
    expect(server.snapshot().collection[0]?.count).toBe(3);
    expect(server.seq).toBe(8);
    expect(server.seqs()).toEqual([2, 8]);
  });

  it('collapses duplicate keys in one push to the newest element', async () => {
    const server = new FakeSyncRemote();
    await server.push({ collection: [row('c1', 1, T1), row('c1', 2, T2), row('c1', 3, T1)], tracked: [] });
    expect(server.snapshot().collection).toEqual([row('c1', 2, T2)]);
    expect(server.seq).toBe(1); // collapsed duplicates never reach the insert
  });

  it('rejects counts outside 0..999 without writing anything', async () => {
    const server = new FakeSyncRemote();
    await expect(server.push({ collection: [row('c1', 1, T1), row('c2', 1000, T1)], tracked: [] })).rejects.toThrow(
      /p_collection\[1\]\.count/,
    );
    expect(server.seq).toBe(0);
    expect(server.snapshot().collection).toEqual([]);
  });

  it.each([
    '2026-01-01 10:00:00Z', // no T
    '2026-01-01T10:00:00', // no offset
    '2026-01-01T10:00:00.0001Z', // more than millisecond precision
    '2026-02-30T10:00:00Z', // no such day
    'now',
  ])('rejects the whole push for updated_at %s', async (bad) => {
    const server = new FakeSyncRemote();
    await expect(
      server.push({ collection: [row('c1', 1, T1)], tracked: [tracked('s1', T1), tracked('s2', bad)] }),
    ).rejects.toThrow('p_tracked[1].updated_at must be an ISO-8601 timestamp string');
    await expect(server.push({ collection: [row('c1', 1, bad)], tracked: [] })).rejects.toThrow(
      'p_collection[0].updated_at must be an ISO-8601 timestamp string',
    );
    expect(server.seq).toBe(0);
    expect(server.snapshot()).toEqual({ collection: [], tracked: [] });
  });

  it('validates tracked timestamps and ids like push_changes', async () => {
    const server = new FakeSyncRemote();
    await expect(server.push({ collection: [], tracked: [{ ...tracked('s1', T1), addedAt: 'x' }] })).rejects.toThrow(
      'p_tracked[0].added_at must be an ISO-8601 timestamp string',
    );
    await expect(server.push({ collection: [], tracked: [{ ...tracked('s1', T1), removedAt: 'x' }] })).rejects.toThrow(
      'p_tracked[0].removed_at must be null or an ISO-8601 timestamp string',
    );
    await expect(server.push({ collection: [row('', 1, T1)], tracked: [] })).rejects.toThrow('p_collection[0].cardId');
    await expect(server.push({ collection: [row('c1', 1.5, T1)], tracked: [] })).rejects.toThrow('must be an integer');
    expect(server.seq).toBe(0);
  });

  it('stores timestamps as UTC milliseconds and compares instants across offsets', async () => {
    const server = new FakeSyncRemote();
    await server.push({ collection: [row('c1', 1, '2026-01-01T15:30:00.5+05:30')], tracked: [] });
    expect(server.snapshot().collection[0]?.updatedAt).toBe('2026-01-01T10:00:00.500Z');
    // 10:00:00.400Z expressed in another offset is older, even though it sorts later as text.
    await server.push({ collection: [row('c1', 2, '2026-01-01T11:00:00.4+0100')], tracked: [] });
    expect(server.snapshot().collection[0]?.count).toBe(1);
    await server.push({ collection: [row('c1', 3, '2026-01-01T05:00:01-05')], tracked: [] });
    expect(server.snapshot().collection[0]).toMatchObject({ count: 3, updatedAt: '2026-01-01T10:00:01.000Z' });
  });

  it('pages both tables merged by server_seq with next_cursor and has_more', async () => {
    const server = new FakeSyncRemote();
    await server.push({ collection: [row('c1', 1, T1)], tracked: [] }); // seq 1
    await server.push({ collection: [], tracked: [tracked('s1', T1)] }); // seq 2
    await server.push({ collection: [row('c2', 1, T1)], tracked: [] }); // seq 3

    const p1 = await server.pull(0, 2);
    expect(p1).toEqual({ changes: { collection: [row('c1', 1, T1)], tracked: [tracked('s1', T1)] }, nextCursor: 2, hasMore: true });
    const p2 = await server.pull(2, 2);
    expect(p2).toEqual({ changes: { collection: [row('c2', 1, T1)], tracked: [] }, nextCursor: 3, hasMore: false });
    const p3 = await server.pull(3, 2);
    expect(p3).toEqual({ changes: { collection: [], tracked: [] }, nextCursor: 3, hasMore: false });

    // An update moves the row to a new server_seq (two values taken: 4 and 5).
    await server.push({ collection: [row('c1', 2, T2)], tracked: [] });
    expect(await server.pull(3, 1000)).toEqual({ changes: { collection: [row('c1', 2, T2)], tracked: [] }, nextCursor: 5, hasMore: false });
    expect(server.pullCalls).toEqual([
      { cursor: 0, limit: 2 },
      { cursor: 2, limit: 2 },
      { cursor: 3, limit: 2 },
      { cursor: 3, limit: 1000 },
    ]);
  });

  it('validates pull arguments like the RPC', async () => {
    const server = new FakeSyncRemote();
    await expect(server.pull(-1, 10)).rejects.toThrow(/p_cursor/);
    await expect(server.pull(0, 0)).rejects.toThrow(/p_limit/);
    await expect(server.pull(0, 1001)).rejects.toThrow(/p_limit/);
  });

  it('copies data across the boundary and supports failure injection', async () => {
    const server = new FakeSyncRemote();
    const changes = { collection: [row('c1', 1, T1)], tracked: [tracked('s1', T1, ['a'])] };
    await server.push(changes);
    changes.collection[0]!.count = 50;
    changes.tracked[0]!.hiddenCategoryIds.push('mutated');
    expect(server.snapshot().collection[0]?.count).toBe(1);
    expect(server.snapshot().tracked[0]?.hiddenCategoryIds).toEqual(['a']);
    expect(server.pushCalls[0]?.collection[0]?.count).toBe(1);

    server.failNext('push', new Error('push down'));
    await expect(server.push({ collection: [row('c9', 1, T2)], tracked: [] })).rejects.toThrow('push down');
    expect(server.snapshot().collection.map((r) => r.cardId)).toEqual(['c1']); // nothing written
    server.failNext('pull', new TypeError('Network request failed'));
    await expect(server.pull(0, 10)).rejects.toThrow(TypeError);
    expect((await server.pull(0, 10)).nextCursor).toBe(2);
  });

  it('afterPush failures leave the write applied (response lost)', async () => {
    const server = new FakeSyncRemote();
    server.afterPush = () => {
      throw new Error('response lost');
    };
    await expect(server.push({ collection: [row('c1', 1, T1)], tracked: [] })).rejects.toThrow('response lost');
    expect(server.snapshot().collection).toEqual([row('c1', 1, T1)]);
  });
});
