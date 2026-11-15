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

  // A typo in a matcher must fail loudly, never silently fall through to a later rule.
  const knownIds = new Set([...cardIds, ...rules.extraCards.map((e) => e.id)]);
  const ruleLists = [
    ['versionRules', rules.versionRules],
    ['categoryRules', rules.categoryRules],
  ] as const;
  for (const [list, ruleList] of ruleLists) {
    ruleList.forEach((r, i) => {
      for (const id of r.match.ids ?? []) {
        if (!knownIds.has(id)) throw new Error(`rule ${i + 1} in ${list} names unknown card "${id}"`);
      }
    });
  }

  const mainCategory = rules.categories.find((c) => c.kind === 'main')!.id;
  const byCategory = new Map<string, DraftCard[]>(rules.categories.map((c) => [c.id, []]));

  // How many cards each rule is the first match for (overrides don't count against a rule).
  const versionHits = rules.versionRules.map(() => 0);
  const categoryHits = rules.categoryRules.map(() => 0);

  for (const card of cards) {
    const override = rules.overrides[card.id];
    const categoryIndex = rules.categoryRules.findIndex((r) => matches(r.match, card));
    const versionIndex = rules.versionRules.findIndex((r) => matches(r.match, card));
    if (categoryIndex >= 0) categoryHits[categoryIndex]!++;
    if (versionIndex >= 0) versionHits[versionIndex]!++;
    const categoryId = override?.category ?? rules.categoryRules[categoryIndex]?.category ?? mainCategory;
    const versions = override?.versions ?? rules.versionRules[versionIndex]?.versions;
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

  // A rule that is the first match for no card is dead: usually a rarity typo or a rule
  // shadowed by an earlier one. The final catch-all version rule may legitimately be unused.
  versionHits.forEach((n, i) => {
    if (n === 0 && i < rules.versionRules.length - 1) {
      throw new Error(`rule ${i + 1} in versionRules matches no cards`);
    }
  });
  categoryHits.forEach((n, i) => {
    if (n === 0) throw new Error(`rule ${i + 1} in categoryRules matches no cards`);
  });

  return rules.categories.flatMap((c) => [
    ...byCategory.get(c.id)!.sort((a, b) => compareNumbers(a.number, b.number)),
    ...extras.get(c.id)!,
  ]);
}
