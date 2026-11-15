import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseRemote, fetchSetPrices } from '../supabase-remote';

function fakeRpcClient(result: { data: unknown; error: unknown }) {
  const rpc = jest.fn(async () => result);
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe('createSupabaseRemote', () => {
  it('push maps camelCase to snake_case', async () => {
    const { client, rpc } = fakeRpcClient({ data: null, error: null });
    await createSupabaseRemote(client).push({
      collection: [{ cardId: 'a-1', kind: 'normal', setId: 'a', count: 2, updatedAt: '2026-01-01T00:00:00.000Z' }],
      tracked: [
        { setId: 'a', hiddenCategoryIds: ['x'], addedAt: '2026-01-01T00:00:00.000Z', removedAt: null, updatedAt: '2026-01-02T00:00:00.000Z' },
      ],
    });
    expect(rpc).toHaveBeenCalledWith('push_changes', {
      p_collection: [{ card_id: 'a-1', kind: 'normal', set_id: 'a', count: 2, updated_at: '2026-01-01T00:00:00.000Z' }],
      p_tracked: [
        { set_id: 'a', hidden_category_ids: ['x'], added_at: '2026-01-01T00:00:00.000Z', removed_at: null, updated_at: '2026-01-02T00:00:00.000Z' },
      ],
    });
  });

  it('push throws the supabase error', async () => {
    const err = { message: 'TypeError: Network request failed' };
    const { client } = fakeRpcClient({ data: null, error: err });
    await expect(createSupabaseRemote(client).push({ collection: [], tracked: [] })).rejects.toMatchObject({
      message: 'TypeError: Network request failed',
    });
  });

  it('pull passes cursor and limit and maps rows back', async () => {
    const { client, rpc } = fakeRpcClient({
      data: {
        collection: [{ card_id: 'a-1', kind: 'holo', set_id: 'a', count: 3, updated_at: 'T1' }],
        tracked: [{ set_id: 'a', hidden_category_ids: ['x', 'y'], added_at: 'T0', removed_at: 'T2', updated_at: 'T3' }],
        next_cursor: 42,
        has_more: true,
      },
      error: null,
    });
    const res = await createSupabaseRemote(client).pull(7, 1000);
    expect(rpc).toHaveBeenCalledWith('pull_changes', { p_cursor: 7, p_limit: 1000 });
    expect(res).toEqual({
      changes: {
        collection: [{ cardId: 'a-1', kind: 'holo', setId: 'a', count: 3, updatedAt: 'T1' }],
        tracked: [{ setId: 'a', hiddenCategoryIds: ['x', 'y'], addedAt: 'T0', removedAt: 'T2', updatedAt: 'T3' }],
      },
      nextCursor: 42,
      hasMore: true,
    });
  });

  it('pull tolerates null hidden ids / removed_at and empty arrays', async () => {
    const { client } = fakeRpcClient({
      data: { collection: null, tracked: [{ set_id: 'a', hidden_category_ids: null, added_at: 'T0', removed_at: null, updated_at: 'T3' }], next_cursor: '5', has_more: false },
      error: null,
    });
    const res = await createSupabaseRemote(client).pull(0, 10);
    expect(res.changes.collection).toEqual([]);
    expect(res.changes.tracked[0]).toMatchObject({ hiddenCategoryIds: [], removedAt: null });
    expect(res.nextCursor).toBe(5);
  });

  it('pull throws the supabase error', async () => {
    const { client } = fakeRpcClient({ data: null, error: { message: 'boom' } });
    await expect(createSupabaseRemote(client).pull(0, 10)).rejects.toMatchObject({ message: 'boom' });
  });
});

function fakePricesClient(total: number) {
  const ranges: Array<[number, number]> = [];
  const eq = jest.fn();
  const builder: any = {
    select: jest.fn(() => builder),
    eq: eq.mockImplementation(() => builder),
    order: jest.fn(() => builder),
    range: jest.fn(async (from: number, to: number) => {
      ranges.push([from, to]);
      const rows = [];
      for (let i = from; i <= to && i < total; i++) rows.push({ card_id: `c${i}`, variant: 'normal', usd: i });
      return { data: rows, error: null };
    }),
  };
  const from = jest.fn(() => builder);
  return { client: { from } as unknown as SupabaseClient, ranges, from, eq };
}

describe('fetchSetPrices', () => {
  it('builds cardId|variant keys', async () => {
    const { client, from, eq } = fakePricesClient(2);
    const prices = await fetchSetPrices(client, 'base1');
    expect(from).toHaveBeenCalledWith('card_prices');
    expect(eq).toHaveBeenCalledWith('set_id', 'base1');
    expect(prices).toEqual({ 'c0|normal': 0, 'c1|normal': 1 });
  });

  it('pages until fewer than 1000 rows come back', async () => {
    const { client, ranges } = fakePricesClient(2300);
    const prices = await fetchSetPrices(client, 's');
    expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(Object.keys(prices)).toHaveLength(2300);
  });

  it('stops after a full final page followed by an empty one', async () => {
    const { client, ranges } = fakePricesClient(1000);
    await fetchSetPrices(client, 's');
    expect(ranges).toEqual([[0, 999], [1000, 1999]]);
  });

  it('throws on error', async () => {
    const builder: any = { select: () => builder, eq: () => builder, order: () => builder, range: async () => ({ data: null, error: { message: 'denied' } }) };
    await expect(fetchSetPrices({ from: () => builder } as unknown as SupabaseClient, 's')).rejects.toMatchObject({ message: 'denied' });
  });
});
