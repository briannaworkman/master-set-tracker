import { describe, expect, it } from 'vitest';
import type { VersionKindId } from '@mst/catalog-core';
import { assignPositions } from '../src/build/positions.js';
import type { PositionResult } from '../src/build/positions.js';
import type { DraftCard } from '../src/build/apply-rules.js';

const draft = (id: string, versions: string[]): DraftCard => ({
  id,
  number: id,
  name: `Card ${id}`,
  rarity: null,
  categoryId: 'c',
  imageUrl: null,
  versions: versions as VersionKindId[],
});

const pos = (r: PositionResult, key: string): number | undefined => {
  const [id, kind] = key.split(':');
  return r.cards.find((c) => c.id === id)?.versions.find((v) => v.kind === kind)?.position;
};

describe('assignPositions', () => {
  it('numbers a fresh set sequentially', () => {
    const r = assignPositions('s', [draft('a', ['normal', 'reverse']), draft('b', ['single'])], null);
    expect(r.cards.flatMap((c) => c.versions.map((v) => v.position))).toEqual([0, 1, 2]);
    expect(r.lock.catalogVersion).toBe(1);
    expect(r.lock.setId).toBe('s');
  });

  it('is stable when nothing changed', () => {
    const d = [draft('a', ['normal', 'reverse']), draft('b', ['single'])];
    const first = assignPositions('s', d, null);
    const again = assignPositions('s', d, first.lock);
    expect(again.cards).toEqual(first.cards);
    expect(again.changed).toBe(false);
    expect(again.lock.catalogVersion).toBe(1);
  });

  it('appends a card inserted mid-set without moving others', () => {
    const first = assignPositions('s', [draft('a', ['normal']), draft('c', ['normal'])], null);
    const r = assignPositions(
      's',
      [draft('a', ['normal']), draft('b', ['normal', 'reverse']), draft('c', ['normal'])],
      first.lock,
    );
    expect(pos(r, 'a:normal')).toBe(0);
    expect(pos(r, 'c:normal')).toBe(1);
    expect([pos(r, 'b:normal'), pos(r, 'b:reverse')]).toEqual([2, 3]);
    expect(r.lock.catalogVersion).toBe(2);
    expect(r.added).toEqual(['b:normal', 'b:reverse']);
  });

  it('retires a removed version and never reuses its position', () => {
    const first = assignPositions('s', [draft('a', ['normal', 'reverse'])], null);
    const r = assignPositions('s', [draft('a', ['normal', 'pokeball'])], first.lock);
    expect(r.lock.retired).toEqual([1]);
    expect(pos(r, 'a:pokeball')).toBe(2);
    expect(r.retiredKeys).toEqual(['a:reverse']);
    expect(r.lock.positions['a:reverse']).toBeUndefined();
  });

  it('does not reuse a retired position even when it is the highest', () => {
    const first = assignPositions('s', [draft('a', ['normal', 'reverse'])], null);
    const second = assignPositions('s', [draft('a', ['normal'])], first.lock);
    const third = assignPositions('s', [draft('a', ['normal', 'pokeball'])], second.lock);
    expect(pos(third, 'a:pokeball')).toBe(2);
    expect(third.lock.retired).toEqual([1]);
  });

  it('gives a re-added, previously retired key a fresh position', () => {
    const first = assignPositions('s', [draft('a', ['normal', 'reverse'])], null);
    const second = assignPositions('s', [draft('a', ['normal'])], first.lock);
    const third = assignPositions('s', [draft('a', ['normal', 'reverse'])], second.lock);
    expect(pos(third, 'a:reverse')).toBe(2);
    expect(third.lock.retired).toEqual([1]);
    expect(third.added).toEqual(['a:reverse']);
    expect(third.lock.catalogVersion).toBe(3);
  });

  it('bumps catalogVersion and reports a change for a retirement-only change', () => {
    const first = assignPositions('s', [draft('a', ['normal', 'reverse'])], null);
    const r = assignPositions('s', [draft('a', ['normal'])], first.lock);
    expect(r.changed).toBe(true);
    expect(r.added).toEqual([]);
    expect(r.retiredKeys).toEqual(['a:reverse']);
    expect(r.lock.catalogVersion).toBe(2);
  });

  it('retires every version of a card that is dropped', () => {
    const first = assignPositions('s', [draft('a', ['normal', 'reverse']), draft('b', ['normal', 'reverse'])], null);
    const r = assignPositions('s', [draft('a', ['normal', 'reverse'])], first.lock);
    expect(r.retiredKeys).toEqual(['b:normal', 'b:reverse']);
    expect(r.lock.retired).toEqual([2, 3]);
    expect(Object.keys(r.lock.positions)).toEqual(['a:normal', 'a:reverse']);
    expect(r.cards.map((c) => c.id)).toEqual(['a']);
  });

  it('throws on a duplicate version key', () => {
    expect(() => assignPositions('s', [draft('a', ['normal']), draft('a', ['normal'])], null)).toThrow(
      'duplicate version key "a:normal"',
    );
  });

  it('does not mutate the input lock', () => {
    const first = assignPositions('s', [draft('a', ['normal', 'reverse'])], null);
    const snapshot = structuredClone(first.lock);
    const r = assignPositions('s', [draft('a', ['normal', 'pokeball'])], first.lock);
    expect(first.lock).toEqual(snapshot);
    expect(r.lock.positions).not.toBe(first.lock.positions);
    expect(r.lock.retired).not.toBe(first.lock.retired);
  });
});
