import type { VersionKindId } from '@mst/catalog-core';
import type { CardMatch, SetRules } from '../rules/schema.js';
import type { SourceCard } from '../source/tcgdex.js';

export interface DraftCard {
  id: string;
  number: string;
  name: string;
  rarity: string | null;
  categoryId: string;
  imageUrl: string | null;
  versions: VersionKindId[];
}

function matches(match: CardMatch, card: SourceCard): boolean {
  if (match.rarity !== undefined) {
    if (card.rarity === null) return false;
    const rarity = card.rarity.toLowerCase();
    if (!match.rarity.some((r) => r.toLowerCase() === rarity)) return false;
  }
  if (match.localIdPrefix !== undefined && !card.localId.startsWith(match.localIdPrefix)) return false;
  if (match.ids !== undefined && !match.ids.includes(card.id)) return false;
  return true;
}

const isNumeric = (s: string) => /^\d+$/.test(s);

function compareNumbers(a: string, b: string): number {
  const an = isNumeric(a);
  const bn = isNumeric(b);
  if (an && bn) return Number(a) - Number(b);
  if (an) return -1;
  if (bn) return 1;
  return a.localeCompare(b, undefined, { numeric: true });
}

export function applyRules(
  rules: SetRules,
  cards: SourceCard[],
  extraSources: Record<string, SourceCard>,
): DraftCard[] {
  const categoryIds = new Set(rules.categories.map((c) => c.id));
  const cardIds = new Set(cards.map((c) => c.id));

  for (const [id, o] of Object.entries(rules.overrides)) {
    if (!cardIds.has(id)) throw new Error(`override for unknown card "${id}"`);
    if (o.category !== undefined && !categoryIds.has(o.category)) {
      throw new Error(`unknown category "${o.category}" in override for "${id}"`);
    }
  }

  const mainCategory = rules.categories.find((c) => c.kind === 'main')!.id;
  const byCategory = new Map<string, DraftCard[]>(rules.categories.map((c) => [c.id, []]));

  for (const card of cards) {
    const override = rules.overrides[card.id];
    const categoryId =
      override?.category ?? rules.categoryRules.find((r) => matches(r.match, card))?.category ?? mainCategory;
    const versions =
      override?.versions ?? rules.versionRules.find((r) => matches(r.match, card))?.versions;
    if (!versions) throw new Error(`no version rule matches card "${card.id}"`);
    byCategory.get(categoryId)!.push({
      id: card.id,
      number: card.localId,
      name: card.name,
      rarity: card.rarity,
      categoryId,
      imageUrl: card.imageUrl,
      versions: [...versions],
    });
  }

  const extras = new Map<string, DraftCard[]>(rules.categories.map((c) => [c.id, []]));
  for (const extra of rules.extraCards) {
    let source: SourceCard | undefined;
    if (extra.sourceCard) {
      source = extraSources[extra.sourceCard.tcgdex];
      if (!source) {
        throw new Error(`extra card "${extra.id}" source "${extra.sourceCard.tcgdex}" was not fetched`);
      }
    }
    const name = extra.name ?? source?.name;
    if (!name) throw new Error(`extra card "${extra.id}" needs a name`);
    extras.get(extra.category)!.push({
      id: extra.id,
      number: extra.number,
      name,
      rarity: source?.rarity ?? null,
      categoryId: extra.category,
      imageUrl: source?.imageUrl ?? null,
      versions: [...extra.versions],
    });
  }

  return rules.categories.flatMap((c) => [
    ...byCategory.get(c.id)!.sort((a, b) => compareNumbers(a.number, b.number)),
    ...extras.get(c.id)!,
  ]);
}
