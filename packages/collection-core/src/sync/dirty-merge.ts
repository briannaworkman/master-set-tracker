import type { CollectionRow, LocalChanges, TrackedRow } from './types';

/** Keeps the `limit` oldest rows across both lists, preserving each list's order. */
export function takeOldest(collection: CollectionRow[], tracked: TrackedRow[], limit: number): LocalChanges {
  const merged = [
    ...collection.map((row, i) => ({ row, i, kind: 0 as const })),
    ...tracked.map((row, i) => ({ row, i, kind: 1 as const })),
  ].sort((a, b) => (a.row.updatedAt < b.row.updatedAt ? -1 : a.row.updatedAt > b.row.updatedAt ? 1 : a.kind - b.kind || a.i - b.i));
  const out: LocalChanges = { collection: [], tracked: [] };
  for (const m of merged.slice(0, Math.max(0, limit))) {
    if (m.kind === 0) out.collection.push(m.row as CollectionRow);
    else out.tracked.push(m.row as TrackedRow);
  }
  return out;
}
