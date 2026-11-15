import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyRules } from '../src/build/apply-rules.js';
import { parseSetRules, parseVersionKinds } from '../src/rules/schema.js';
import type { SetRules } from '../src/rules/schema.js';
import type { SourceCard } from '../src/source/tcgdex.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const kinds = parseVersionKinds(readFileSync(resolve(repoRoot, 'catalog/version-kinds.yaml'), 'utf8'));
const rules = parseSetRules(readFileSync(resolve(here, 'fixtures/rules/sv03.5.yaml'), 'utf8'), kinds);

const card = (localId: string, rarity: string | null): SourceCard => ({
  id: `sv03.5-${localId}`,
  localId,
  name: `Card ${localId}`,
  rarity,
  imageUrl: null,
});

const withOverride = (id: string, o: SetRules['overrides'][string]): SetRules => ({
  ...rules,
  overrides: { [id]: o },
});
const withTrainerGallery: SetRules = {
  ...rules,
  categories: [...rules.categories, { id: 'trainer-gallery', kind: 'subset', label: 'Trainer Gallery' }],
  categoryRules: [{ match: { localIdPrefix: 'TG' }, category: 'trainer-gallery' }],
};
const withExtra = (extra: SetRules['extraCards'][number]): SetRules => ({ ...rules, extraCards: [extra] });

describe('applyRules', () => {
  it('gives commons the four reverse versions and ex cards a single version', () => {
    const out = applyRules(rules, [card('001', 'Common'), card('003', 'Double rare')], {});
    expect(out.map((c) => c.versions)).toEqual([['normal', 'reverse', 'pokeball', 'masterball'], ['single']]);
  });
  it('matches rarity case-insensitively', () =>
    expect(applyRules(rules, [card('001', 'COMMON')], {})[0]!.versions).toHaveLength(4));
  it('sends a card with no rarity to the catch-all rule', () =>
    expect(applyRules(rules, [card('050', null)], {})[0]!.versions).toEqual(['single']));
  it('applies an override', () =>
    expect(
      applyRules(withOverride('sv03.5-001', { versions: ['normal', 'reverse'] }), [card('001', 'Common')], {})[0]!
        .versions,
    ).toEqual(['normal', 'reverse']));
  it('fails on an override for a card not in the set', () =>
    expect(() =>
      applyRules(withOverride('sv03.5-999', { versions: ['normal'] }), [card('001', 'Common')], {}),
    ).toThrow(/override for unknown card "sv03\.5-999"/));
  it('fails on an override naming an undeclared category', () =>
    expect(() =>
      applyRules(withOverride('sv03.5-001', { category: 'nope' }), [card('001', 'Common')], {}),
    ).toThrow(/unknown category "nope"/));
  it('applies a category override', () =>
    expect(
      applyRules(withOverride('sv03.5-001', { category: 'promos' }), [card('001', 'Common')], {})[0]!.categoryId,
    ).toBe('promos'));
  it('routes TG-prefixed cards to the trainer gallery category', () =>
    expect(applyRules(withTrainerGallery, [card('TG01', 'Rare')], {})[0]!.categoryId).toBe('trainer-gallery'));
  it('matches localIdPrefix case-sensitively', () =>
    expect(applyRules(withTrainerGallery, [card('tg01', 'Rare')], {})[0]!.categoryId).toBe('main'));
  it('sorts numbers naturally', () =>
    expect(
      applyRules(rules, [card('10', 'Common'), card('2', 'Common'), card('1', 'Common')], {}).map((c) => c.number),
    ).toEqual(['1', '2', '10']));
  it('orders categories by declaration, numbers before prefixed ids', () => {
    const out = applyRules(withTrainerGallery, [card('TG02', 'Rare'), card('TG1', 'Rare'), card('5', 'Rare')], {});
    expect(out.map((c) => c.number)).toEqual(['5', 'TG1', 'TG02']);
  });
  it('appends extra cards, taking name and image from their source card', () => {
    const out = applyRules(
      withExtra({
        id: 'sv03.5-promo-svp-050',
        category: 'promos',
        number: 'SVP 050',
        sourceCard: { tcgdex: 'svp-050' },
        versions: ['single'],
      }),
      [card('001', 'Common')],
      { 'svp-050': { id: 'svp-050', localId: '050', name: 'Some Promo', rarity: null, imageUrl: 'x' } },
    );
    expect(out.at(-1)).toMatchObject({
      id: 'sv03.5-promo-svp-050',
      categoryId: 'promos',
      number: 'SVP 050',
      name: 'Some Promo',
      imageUrl: 'x',
    });
  });
  it('requires a name for an extra card with no source card', () =>
    expect(() =>
      applyRules(withExtra({ id: 'x', category: 'promos', number: 'S1', versions: ['single'] }), [], {}),
    ).toThrow(/extra card "x" needs a name/));
  it('fails when an extra card source is missing from extraSources', () =>
    expect(() =>
      applyRules(
        withExtra({ id: 'x', category: 'promos', number: 'S1', sourceCard: { tcgdex: 'zzz' }, versions: ['single'] }),
        [],
        {},
      ),
    ).toThrow(/extra card "x".*"zzz"/));
});
