export type VersionKey = string;
export type Counts = Readonly<Record<VersionKey, number>>;

export function versionKey(cardId: string, kind: string): VersionKey {
  return `${cardId}:${kind}`;
}

export function clampCount(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(999, Math.max(0, Math.trunc(n)));
}

export function spareCount(count: number): number {
  return Math.max(0, count - 1);
}
