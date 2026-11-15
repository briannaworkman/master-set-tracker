import { describe, expect, it } from 'vitest';
import { createMemoryPriceCache, createSqlitePriceCache, priceBookFromCache } from '../src/prices/price-cache';
import { priceVariantFor } from '../src/prices/price-variant';
import { createSqliteRepo } from '../src/db/sqlite-repo';
import { createBetterSqliteDb } from './better-sqlite-db';

describe('priceVariantFor', () => {
  it('maps kinds to price variants with fallbacks', () => {
    expect(priceVariantFor('sv08-001', 'normal')).toEqual(['normal']);
    expect(priceVariantFor('sv08-001', 'holo')).toEqual(['holofoil']);
    expect(priceVariantFor('sv08-001', 'reverse')).toEqual(['reverse-holofoil']);
    expect(priceVariantFor('sv08-001', 'single')).toEqual(['holofoil', 'normal']);
    expect(priceVariantFor('sv08-001', 'pokeball')).toEqual([]);
    expect(priceVariantFor('sv08-001', 'masterball')).toEqual([]);
    expect(priceVariantFor('sv08-001', 'mystery')).toEqual([]);
    expect(priceVariantFor('sv08.5-006-stamp-set-logo', 'normal')).toEqual([]);
    expect(priceVariantFor('sv08.5-006-stamp-set-logo', 'single')).toEqual([]);
  });
});

describe.each([
  ['memory', () => createMemoryPriceCache()],
  ['sqlite', () => createSqlitePriceCache(createSqliteDbForCache())],
])('price cache (%s)', (_n, make) => {
  it('round-trips and replaces per set', () => {
    const cache = make();
    expect(cache.get('a')).toBeNull();
    cache.put('a', 't1', { 'c-1|normal': 1.5 });
    cache.put('a', 't2', { 'c-1|normal': 2 });
    expect(cache.get('a')).toEqual({ fetchedAt: 't2', prices: { 'c-1|normal': 2 } });
    expect(cache.get('b')).toBeNull();
  });

  it('prices a version from the cache and returns null when unknown', () => {
    const cache = make();
    cache.put('a', 't', {
      'c-1|normal': 1.25,
      'c-2|holofoil': 5,
      'c-2|normal': 0.5,
      'c-3|normal': 0.4,
      'c-4|normal': 0,
      'c-4|holofoil': 0,
      'c-5|reverse-holofoil': 3,
    });
    const book = priceBookFromCache(cache, ['a', 'missing']);
    expect(book.price('a', 'c-1:normal')).toBe(1.25);
    expect(book.price('a', 'c-2:single')).toBe(5); // holofoil first
    expect(book.price('a', 'c-3:single')).toBe(0.4); // falls back to normal
    expect(book.price('a', 'c-4:single')).toBeNull(); // zero is unknown
    expect(book.price('a', 'c-5:reverse')).toBe(3);
    expect(book.price('a', 'c-1:holo')).toBeNull();
    expect(book.price('a', 'c-1:pokeball')).toBeNull();
    expect(book.price('a', 'nope:normal')).toBeNull();
    expect(book.price('missing', 'c-1:normal')).toBeNull();
    expect(book.price('other', 'c-1:normal')).toBeNull();
  });
});

function createSqliteDbForCache() {
  const db = createBetterSqliteDb();
  createSqliteRepo(db); // runs migrations
  return db;
}
