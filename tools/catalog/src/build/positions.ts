import type { CatalogCard } from '@mst/catalog-core';
import type { DraftCard } from './apply-rules.js';

export interface PositionLock {
  setId: string;
  catalogVersion: number;
  /** key: `${cardId}:${kind}` */
  positions: Record<string, number>;
  retired: number[];
}

export interface PositionResult {
  cards: CatalogCard[];
  lock: PositionLock;
  changed: boolean;
  added: string[];
  retiredKeys: string[];
}

/**
 * Assigns permanent positions to every card version. Existing keys keep their
 * positions, new keys get fresh positions above everything ever used, and keys
 * that disappear are retired (their positions are never reused). Never mutates `lock`.
 */
export function assignPositions(
  setId: string,
  draft: DraftCard[],
  lock: PositionLock | null,
): PositionResult {
  const draftKeys = new Set<string>();
  for (const card of draft) {
    for (const kind of card.versions) {
      const key = `${card.id}:${kind}`;
      if (draftKeys.has(key)) throw new Error(`duplicate version key "${key}"`);
      draftKeys.add(key);
    }
  }

  const positions: Record<string, number> = {};
  const retired = new Set<number>(lock?.retired ?? []);
  const retiredKeys: string[] = [];
  for (const [key, position] of Object.entries(lock?.positions ?? {})) {
    if (draftKeys.has(key)) {
      positions[key] = position;
    } else {
      retired.add(position);
      retiredKeys.push(key);
    }
  }

  let next = Math.max(-1, ...Object.values(positions), ...retired) + 1;
  const added: string[] = [];
  const cards: CatalogCard[] = draft.map((card) => ({
    id: card.id,
    number: card.number,
    name: card.name,
    rarity: card.rarity,
    categoryId: card.categoryId,
    imageUrl: card.imageUrl,
    versions: card.versions.map((kind) => {
      const key = `${card.id}:${kind}`;
      if (positions[key] === undefined) {
        positions[key] = next++;
        added.push(key);
      }
      return { kind, position: positions[key] };
    }),
  }));

  const changed = added.length + retiredKeys.length > 0;
  return {
    cards,
    lock: {
      setId,
      catalogVersion: lock === null ? 1 : lock.catalogVersion + (changed ? 1 : 0),
      positions,
      retired: [...retired].sort((a, b) => a - b),
    },
    changed,
    added,
    retiredKeys,
  };
}
