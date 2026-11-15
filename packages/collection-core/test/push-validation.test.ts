import { describe, expect, it } from 'vitest';
import { partitionPushable } from '../src/sync/validate';
import type { CollectionRow, TrackedRow } from '../src/sync/types';

const T = '2026-11-16T10:00:00.001Z';
const c = (extra: Partial<Record<keyof CollectionRow, unknown>> = {}) =>
  ({ cardId: 'sv1-001', kind: 'normal', setId: 'sv1', count: 1, updatedAt: T, ...extra }) as CollectionRow;
const t = (extra: Partial<Record<keyof TrackedRow, unknown>> = {}) =>
  ({ setId: 'sv1', hiddenCategoryIds: [], addedAt: T, removedAt: null, updatedAt: T, ...extra }) as TrackedRow;

describe('partitionPushable (mirrors push_changes validation)', () => {
  it.each([
    ['a plain row', c()],
    ['count 0 and 999', c({ count: 0 })],
    ['count 999', c({ count: 999 })],
    ['no fraction', c({ updatedAt: '2026-11-16T10:00:00Z' })],
    ['an explicit offset', c({ updatedAt: '2026-11-16T10:00:00.5+01:00' })],
    ['a compact offset', c({ updatedAt: '2026-11-16T10:00:00.12-0530' })],
  ])('keeps %s', (_label, row) => {
    expect(partitionPushable({ collection: [row], tracked: [] })).toEqual({
      pushable: { collection: [row], tracked: [] },
      rejected: { collection: [], tracked: [] },
    });
  });

  it.each([
    ['count 1000', c({ count: 1000 })],
    ['count -1', c({ count: -1 })],
    ['a fractional count', c({ count: 1.5 })],
    ['a NaN count', c({ count: NaN })],
    ['a string count', c({ count: '1' })],
    ['an empty card id', c({ cardId: '' })],
    ['a non-string kind', c({ kind: 3 })],
    ['4 fraction digits', c({ updatedAt: '2026-11-16T10:00:00.0001Z' })],
    ['no offset', c({ updatedAt: '2026-11-16T10:00:00.001' })],
    ['a 5-digit year (toISOString of a far-future clock)', c({ updatedAt: '+010000-01-01T00:00:00.000Z' })],
    ['an impossible date', c({ updatedAt: '2026-02-30T10:00:00.000Z' })],
    ['a non-string timestamp', c({ updatedAt: 1 })],
  ])('rejects a collection row with %s', (_label, row) => {
    const good = c({ cardId: 'sv1-002' });
    expect(partitionPushable({ collection: [row, good], tracked: [] })).toEqual({
      pushable: { collection: [good], tracked: [] },
      rejected: { collection: [row], tracked: [] },
    });
  });

  it.each([
    ['removed', t({ removedAt: T })],
    ['hidden ids', t({ hiddenCategoryIds: ['promos', 'stamped'] })],
  ])('keeps a tracked row with %s', (_label, row) => {
    expect(partitionPushable({ collection: [], tracked: [row] }).rejected.tracked).toEqual([]);
  });

  it.each([
    ['non-string hidden ids', t({ hiddenCategoryIds: [1] })],
    ['hidden ids not an array', t({ hiddenCategoryIds: 'promos' })],
    ['an empty set id', t({ setId: '' })],
    ['a bad addedAt', t({ addedAt: 'yesterday' })],
    ['a bad removedAt', t({ removedAt: '2026-11-16T10:00:00.0001Z' })],
    ['a bad updatedAt', t({ updatedAt: '2026-11-16 10:00:00Z' })],
  ])('rejects a tracked row with %s', (_label, row) => {
    expect(partitionPushable({ collection: [], tracked: [row] })).toEqual({
      pushable: { collection: [], tracked: [] },
      rejected: { collection: [], tracked: [row] },
    });
  });
});
