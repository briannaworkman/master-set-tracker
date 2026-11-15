import type { CollectionRow, LocalChanges, TrackedRow } from './types';

// push_changes' timestamp pattern: an explicit offset and at most 3 fractional digits.
const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|[+-]\d{2}(:?\d{2})?)$/;

/** True when push_changes would accept `v` as a timestamp (pattern, real calendar date, parses). */
export function isPushTimestamp(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  const m = ISO.exec(v);
  if (!m) return false;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return false;
  if (h > 23 || mi > 59 || s > 59) return false;
  let offset = m[8]!;
  if (/^[+-]\d{2}$/.test(offset)) offset += ':00';
  else if (/^[+-]\d{4}$/.test(offset)) offset = `${offset.slice(0, 3)}:${offset.slice(3)}`;
  return !Number.isNaN(Date.parse(`${v.slice(0, v.length - m[8]!.length)}${offset}`));
}

const nonEmpty = (v: unknown): boolean => typeof v === 'string' && v !== '';

/** True when push_changes would accept this collection row. */
export function isPushableCollectionRow(r: CollectionRow): boolean {
  return (
    nonEmpty(r.cardId) &&
    nonEmpty(r.kind) &&
    nonEmpty(r.setId) &&
    Number.isInteger(r.count) &&
    r.count >= 0 &&
    r.count <= 999 &&
    isPushTimestamp(r.updatedAt)
  );
}

/** True when push_changes would accept this tracked-set row. */
export function isPushableTrackedRow(r: TrackedRow): boolean {
  return (
    nonEmpty(r.setId) &&
    Array.isArray(r.hiddenCategoryIds) &&
    r.hiddenCategoryIds.every((id) => typeof id === 'string') &&
    isPushTimestamp(r.addedAt) &&
    (r.removedAt == null || isPushTimestamp(r.removedAt)) &&
    isPushTimestamp(r.updatedAt)
  );
}

/**
 * Splits local changes into the rows push_changes would accept and the ones it would reject
 * (push_changes rejects the whole call for one bad row, so a bad row must never be sent).
 */
export function partitionPushable(changes: LocalChanges): { pushable: LocalChanges; rejected: LocalChanges } {
  const pushable: LocalChanges = { collection: [], tracked: [] };
  const rejected: LocalChanges = { collection: [], tracked: [] };
  for (const r of changes.collection) (isPushableCollectionRow(r) ? pushable : rejected).collection.push(r);
  for (const r of changes.tracked) (isPushableTrackedRow(r) ? pushable : rejected).tracked.push(r);
  return { pushable, rejected };
}
