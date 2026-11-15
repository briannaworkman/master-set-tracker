import { describe, expect, it } from 'vitest';
import { asAnon, asService, asUser, createDb, createUser } from '../src/harness';
import { pricesFromTcgdexCard, refreshSet, timingSafeEqual } from '../../../supabase/functions/_shared/prices';

// Shaped like GET https://api.tcgdex.net/v2/en/cards/sv08.5-001 (USD part of pricing).
const sv085_001 = {
  id: 'sv08.5-001',
  localId: '001',
  name: 'Leafeon',
  pricing: {
    cardmarket: { unit: 'EUR', avg: 0.1 },
    tcgplayer: {
      unit: 'USD',
      updated: '2026-11-14T22:16:34.121Z',
      normal: { productId: 610356, lowPrice: 0.01, midPrice: 0.15, highPrice: 999, marketPrice: 0.05, directLowPrice: 0.01 },
      'reverse-holofoil': { productId: 610356, lowPrice: 0.05, midPrice: 0.2, highPrice: 20, marketPrice: 0.13, directLowPrice: null },
    },
  },
};

describe('pricesFromTcgdexCard', () => {
  it('maps tcgplayer market prices to variants', () => {
    expect(pricesFromTcgdexCard('sv08.5', sv085_001)).toEqual([
      { card_id: 'sv08.5-001', set_id: 'sv08.5', variant: 'normal', usd: 0.05, source_updated_at: '2026-11-14T22:16:34.121Z' },
      { card_id: 'sv08.5-001', set_id: 'sv08.5', variant: 'reverse-holofoil', usd: 0.13, source_updated_at: '2026-11-14T22:16:34.121Z' },
    ]);
  });

  it('skips variants with no or non-numeric market price', () => {
    const card = {
      id: 'sv08.5-002',
      pricing: {
        tcgplayer: {
          unit: 'USD',
          normal: { marketPrice: null },
          holofoil: { marketPrice: 'abc' },
          'reverse-holofoil': { marketPrice: -1 },
        },
      },
    };
    expect(pricesFromTcgdexCard('sv08.5', card)).toEqual([]);
    expect(pricesFromTcgdexCard('sv08.5', { id: 'x-1' })).toEqual([]);
    expect(pricesFromTcgdexCard('sv08.5', null)).toEqual([]);
    expect(pricesFromTcgdexCard('sv08.5', { id: 'x-1', pricing: { tcgplayer: { normal: { marketPrice: 0 } } } })).toEqual([
      { card_id: 'x-1', set_id: 'sv08.5', variant: 'normal', usd: 0, source_updated_at: null },
    ]);
  });
});

describe('refreshSet', () => {
  it('records a 404 card as failed and keeps the rest', async () => {
    const calls: string[] = [];
    const fetchJson = async (path: string) => {
      calls.push(path);
      if (path === '/sets/sv08.5') return { cards: [{ id: 'sv08.5-001' }, { id: 'sv08.5-002' }, { id: 'sv08.5-003' }] };
      if (path === '/cards/sv08.5-001') return sv085_001;
      if (path === '/cards/sv08.5-002') throw new Error('HTTP 404');
      return { id: 'sv08.5-003', pricing: { tcgplayer: { holofoil: { marketPrice: 1.5 } } } };
    };
    const r = await refreshSet({ setId: 'sv08.5', tcgdexSetId: 'sv08.5', fetchJson, concurrency: 2 });
    expect(r.failedCards).toEqual(['sv08.5-002']);
    expect(r.rows.map((x) => `${x.card_id}/${x.variant}`).sort()).toEqual([
      'sv08.5-001/normal',
      'sv08.5-001/reverse-holofoil',
      'sv08.5-003/holofoil',
    ]);
  });

  it('throws when the set list fetch fails', async () => {
    await expect(
      refreshSet({ setId: 's', tcgdexSetId: 's', fetchJson: async () => { throw new Error('HTTP 503'); } }),
    ).rejects.toThrow();
  });
});

describe('refreshSet duplicates and encoding', () => {
  it('fetches a duplicated card id once and yields unique rows', async () => {
    const calls: string[] = [];
    const fetchJson = async (path: string) => {
      calls.push(path);
      if (path === '/sets/s') return { cards: [{ id: 'a-1' }, { id: 'a-1' }, { id: 'b/2' }] };
      return { id: path.slice(7), pricing: { tcgplayer: { normal: { marketPrice: 1 } } } };
    };
    const r = await refreshSet({ setId: 's', tcgdexSetId: 's', fetchJson });
    expect(calls.filter((c) => c === '/cards/a-1')).toHaveLength(1);
    expect(calls).toContain('/cards/b%2F2');
    expect(r.rows.map((x) => x.card_id).sort()).toEqual(['a-1', 'b%2F2']);
  });
});

describe('timingSafeEqual', () => {
  it('compares strings', () => {
    expect(timingSafeEqual('secret-key', 'secret-key')).toBe(true);
    expect(timingSafeEqual('secret-key', 'secret-kez')).toBe(false);
    expect(timingSafeEqual('secret', 'secret-key')).toBe(false);
    expect(timingSafeEqual('', 'x')).toBe(false);
    expect(timingSafeEqual('', '')).toBe(true);
    expect(timingSafeEqual('é', 'e\u0301')).toBe(false);
  });
});

describe('prices migration', () => {
  it('applies the prices migration and only service role can write', async () => {
    const db = await createDb();
    const uid = await createUser(db, 'p@example.com');
    const seeded = await db.query<{ set_id: string }>('select set_id from price_sets order by set_id');
    expect(seeded.rows.map((r) => r.set_id)).toEqual(['sv03.5', 'sv08.5']);

    await asService(db, (tx) =>
      tx.query(
        `insert into card_prices (card_id, variant, set_id, usd) values ('sv08.5-001','normal','sv08.5',0.05)
         on conflict (card_id, variant) do update set usd = excluded.usd`,
      ),
    );

    const rows = await asUser(db, uid, (tx) => tx.query<{ usd: string }>('select usd from card_prices'));
    expect(rows.rows).toHaveLength(1);

    await expect(
      asUser(db, uid, (tx) => tx.query(`insert into card_prices (card_id, variant, set_id, usd) values ('a','normal','s',1)`)),
    ).rejects.toThrow();
    await expect(asUser(db, uid, (tx) => tx.query(`update card_prices set usd = 9`))).rejects.toThrow();
    await expect(asUser(db, uid, (tx) => tx.query(`delete from card_prices`))).rejects.toThrow();
    await expect(asUser(db, uid, (tx) => tx.query(`select * from price_sets`))).rejects.toThrow();
    await expect(asAnon(db, (tx) => tx.query('select * from card_prices'))).rejects.toThrow();
    await expect(
      asService(db, (tx) => tx.query(`insert into card_prices (card_id, variant, set_id, usd) values ('a','weird','s',1)`)),
    ).rejects.toThrow();
    await expect(
      asService(db, (tx) => tx.query(`insert into card_prices (card_id, variant, set_id, usd) values ('a','normal','s',-1)`)),
    ).rejects.toThrow();
  });
});
