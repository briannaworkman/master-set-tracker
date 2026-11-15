import type { SetCatalog } from '@mst/catalog-core';
import type { SetRules } from '../rules/schema.js';
import type { CardSource, SourceCard } from '../source/tcgdex.js';
import { applyRules } from './apply-rules.js';
import { assignPositions, type PositionLock, type PositionResult } from './positions.js';

const CONCURRENCY = 8;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function buildSet(opts: {
  rules: SetRules;
  source: CardSource;
  lock: PositionLock | null;
}): Promise<PositionResult & { catalog: SetCatalog; warnings: string[] }> {
  const { rules, source, lock } = opts;
  const sourceSet = await source.getSet(rules.source.tcgdex);
  const cards = await mapLimit(sourceSet.cardIds, CONCURRENCY, (id) => source.getCard(id));

  const extraIds = [...new Set(rules.extraCards.flatMap((e) => (e.sourceCard ? [e.sourceCard.tcgdex] : [])))];
  const extraCards = await mapLimit(extraIds, CONCURRENCY, (id) => source.getCard(id));
  const extraSources: Record<string, SourceCard> = {};
  extraIds.forEach((id, i) => (extraSources[id] = extraCards[i]!));

  const warnings: string[] = [];
  if (cards.length !== sourceSet.totalCards) {
    warnings.push(`fetched ${cards.length} cards but source reports ${sourceSet.totalCards} total`);
  }

  const draft = applyRules(rules, cards, extraSources);
  const result = assignPositions(rules.id, draft, lock);

  const catalog: SetCatalog = {
    id: rules.id,
    name: rules.name,
    series: rules.series,
    releaseDate: rules.releaseDate,
    logoUrl: sourceSet.logoUrl,
    catalogVersion: result.lock.catalogVersion,
    // Bitset length for offline QR codes: highest position ever used + 1, including retired ones.
    versionCount: Math.max(-1, ...Object.values(result.lock.positions), ...result.lock.retired) + 1,
    retiredPositions: result.lock.retired,
    categories: rules.categories.map((c, i) => ({ id: c.id, kind: c.kind, label: c.label, sortOrder: i })),
    cards: result.cards,
  };
  return { ...result, catalog, warnings };
}
