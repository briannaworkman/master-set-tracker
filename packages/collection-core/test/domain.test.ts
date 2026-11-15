import { describe, expect, it } from 'vitest';
import {
  cardStatus,
  clampCount,
  emptyPriceBook,
  filterCards,
  legendKinds,
  setProgress,
  setValue,
  spareCount,
  versionKey,
  visibleSections,
  type PriceBook,
} from '../src/index';
import { fixtureCatalog as cat, fixtureKinds as kinds } from '../src/testing/fixture-catalog';

const card = (id: string) => cat.cards.find((c) => c.id === id)!;
const card001 = card('c-001');
const card004 = card('c-004');
const mainCards = cat.cards.filter((c) => c.categoryId === 'main');
const ids = (cs: { id: string }[]) => cs.map((c) => c.id);
const book = (m: Record<string, number>): PriceBook => ({ price: (_s, k) => m[k] ?? null });

describe('collection domain', () => {
  it('builds version keys', () => expect(versionKey('sv03.5-001', 'reverse')).toBe('sv03.5-001:reverse'));
  it('clamps counts', () => {
    expect(clampCount(-1)).toBe(0);
    expect(clampCount(2.7)).toBe(2);
    expect(clampCount(5000)).toBe(999);
  });
  it('counts spares beyond the first copy', () => {
    expect(spareCount(0)).toBe(0);
    expect(spareCount(1)).toBe(0);
    expect(spareCount(3)).toBe(2);
  });
  it('counts versions, not cards, in visible categories', () => {
    expect(setProgress(cat, { 'c-001:normal': 2, 'c-001:reverse': 1, 'p-1:single': 1 }, [])).toEqual({ collected: 3, total: 11 });
    expect(setProgress(cat, { 'c-001:normal': 2, 'c-001:reverse': 1, 'p-1:single': 1 }, ['promos'])).toEqual({ collected: 2, total: 10 });
  });
  it('ignores counts for versions not in the catalog', () =>
    expect(setProgress(cat, { 'gone-999:normal': 4, 'c-004:reverse': 1 }, [])).toEqual({ collected: 0, total: 11 }));
  it('never hides the main category', () =>
    expect(visibleSections(cat, ['main', 'promos']).map((s) => s.category.id)).toEqual(['main']));
  it('reports card status', () => {
    expect(cardStatus(card001, {})).toBe('none');
    expect(cardStatus(card001, { 'c-001:normal': 1 })).toBe('partial');
    expect(cardStatus(card004, { 'c-004:single': 1 })).toBe('complete');
  });
  it('filters missing, have and spares', () => {
    const counts = { 'c-004:single': 2, 'c-001:normal': 1 };
    expect(ids(filterCards(mainCards, counts, 'missing'))).toEqual(['c-001', 'c-002', 'c-003']);
    expect(ids(filterCards(mainCards, counts, 'have'))).toEqual(['c-001', 'c-004']);
    expect(ids(filterCards(mainCards, counts, 'spares'))).toEqual(['c-004']);
  });
  it('lists legend kinds used by the set in sortOrder', () =>
    expect(legendKinds(cat, kinds).map((k) => k.id)).toEqual(['normal', 'reverse', 'pokeball', 'masterball', 'single']));
  it('values owned copies and the cost to finish, skipping unknown prices', () => {
    const prices = book({ 'c-001:normal': 0.5, 'c-001:reverse': 1, 'c-004:single': 10 });
    expect(setValue(cat, { 'c-001:normal': 3, 'c-004:single': 1 }, [], prices)).toEqual({ owned: 11.5, toFinish: 1, hasPrices: true, incomplete: true });
    expect(setValue(cat, {}, [], emptyPriceBook)).toEqual({ owned: 0, toFinish: 0, hasPrices: false, incomplete: true });
  });
});
