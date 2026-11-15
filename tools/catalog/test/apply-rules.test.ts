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
const fixtureRules = parseSetRules(readFileSync(resolve(here, 'fixtures/rules/sv03.5.yaml'), 'utf8'), kinds);
// Every rarity a matcher names must exist in the set, so narrow the fixture's [Common, Uncommon]
// rule to Common; inputs below then don't all need an Uncommon card.
const rules: SetRules = {
  ...fixtureRules,
  versionRules: [
    { match: { rarity: ['Common'] }, versions: ['normal', 'reverse', 'pokeball', 'masterball'] },
    { match: {}, versions: ['single'] },
  ],
};

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
  // Inputs below include a Common so every non-final rule matches something (dead rules fail the build).
  it('sends a card with no rarity to the catch-all rule', () =>
    expect(applyRules(rules, [card('001', 'Common'), card('050', null)], {})[1]!.versions).toEqual(['single']));
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
    expect(applyRules(withTrainerGallery, [card('001', 'Common'), card('TG01', 'Rare')], {})[1]!.categoryId).toBe(
      'trainer-gallery',
    ));
  it('matches localIdPrefix case-sensitively', () =>
    expect(
      applyRules(withTrainerGallery, [card('001', 'Common'), card('tg01', 'Rare'), card('TG01', 'Rare')], {}).find(
        (c) => c.number === 'tg01',
      )!.categoryId,
    ).toBe('main'));
  it('sorts numbers naturally', () =>
    expect(
      applyRules(rules, [card('10', 'Common'), card('2', 'Common'), card('1', 'Common')], {}).map((c) => c.number),
    ).toEqual(['1', '2', '10']));
  it('orders categories by declaration, numbers before prefixed ids', () => {
    const out = applyRules(withTrainerGallery, [card('TG02', 'Rare'), card('TG1', 'Rare'), card('5', 'Common')], {});
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
  describe('card id uniqueness', () => {
    it('fails when an extra card reuses a source card id, even with different versions', () =>
      expect(() =>
        applyRules(
          withExtra({ id: 'sv03.5-001', category: 'promos', number: '001', name: 'Dup', versions: ['single'] }),
          [card('001', 'Common')],
          {},
        ),
      ).toThrow('duplicate card id "sv03.5-001"'));
    it('fails when two extra cards share an id, even with different versions', () =>
      expect(() =>
        applyRules(
          {
            ...rules,
            extraCards: [
              { id: 'sv03.5-x', category: 'promos', number: 'X', name: 'X', versions: ['single'] },
              { id: 'sv03.5-x', category: 'promos', number: 'X', name: 'X', versions: ['holo'] },
            ],
          },
          [card('001', 'Common')],
          {},
        ),
      ).toThrow('duplicate card id "sv03.5-x"'));
  });
  describe('matcher validation', () => {
    const cards = [card('001', 'Common'), card('003', 'Double rare')];
    const withVersionRules = (versionRules: SetRules['versionRules']): SetRules => ({ ...rules, versionRules });

    it('fails when a version rule names a card not in the set', () =>
      expect(() =>
        applyRules(
          withVersionRules([
            { match: { ids: ['sv03.5-001', 'sv03.5-0001'] }, versions: ['normal'] },
            { match: {}, versions: ['single'] },
          ]),
          cards,
          {},
        ),
      ).toThrow(/rule 1 in versionRules names unknown card "sv03\.5-0001"/));
    it('fails when a category rule names a card not in the set', () =>
      expect(() =>
        applyRules(
          { ...withTrainerGallery, categoryRules: [{ match: { ids: ['sv03.5-999'] }, category: 'trainer-gallery' }] },
          cards,
          {},
        ),
      ).toThrow(/rule 1 in categoryRules names unknown card "sv03\.5-999"/));
    it('fails when a rule names an extra card (rules never apply to extra cards)', () => {
      const r: SetRules = {
        ...withExtra({ id: 'sv03.5-x', category: 'promos', number: 'X', name: 'X', versions: ['single'] }),
        versionRules: [
          { match: { ids: ['sv03.5-001', 'sv03.5-x'] }, versions: ['normal'] },
          { match: {}, versions: ['single'] },
        ],
      };
      expect(() => applyRules(r, cards, {})).toThrow(/rule 1 in versionRules names extra card "sv03\.5-x"/);
    });
    it('fails when one rarity in a multi-value matcher is a typo', () =>
      expect(() =>
        applyRules(
          withVersionRules([
            { match: { rarity: ['Common', 'Uncommmon'] }, versions: ['normal'] },
            { match: {}, versions: ['single'] },
          ]),
          cards,
          {},
        ),
      ).toThrow(/rule 1 in versionRules names rarity "Uncommmon", which no card in the set has/));
    it('fails on a rarity typo in a category rule', () =>
      expect(() =>
        applyRules(
          {
            ...withTrainerGallery,
            categoryRules: [{ match: { rarity: ['Common', 'Raer'] }, category: 'trainer-gallery' }],
          },
          cards,
          {},
        ),
      ).toThrow(/rule 1 in categoryRules names rarity "Raer"/));
    it('accepts a rarity present only on an extra card source, case-insensitively', () =>
      expect(
        applyRules(
          {
            ...withExtra({ id: 'sv03.5-x', category: 'promos', number: 'X', sourceCard: { tcgdex: 'p-1' }, versions: ['single'] }),
            versionRules: [
              { match: { rarity: ['common', 'Promo'] }, versions: ['normal'] },
              { match: {}, versions: ['single'] },
            ],
          },
          cards,
          { 'p-1': { id: 'p-1', localId: '1', name: 'P', rarity: 'PROMO', imageUrl: null } },
        ),
      ).toHaveLength(3));
    it('fails when one id in a multi-id matcher is shadowed by an earlier rule', () =>
      expect(() =>
        applyRules(
          withVersionRules([
            { match: { ids: ['sv03.5-001'] }, versions: ['normal'] },
            { match: { ids: ['sv03.5-001', 'sv03.5-003'] }, versions: ['normal', 'reverse'] },
            { match: {}, versions: ['single'] },
          ]),
          cards,
          {},
        ),
      ).toThrow(/rule 2 in versionRules names card "sv03\.5-001", but rule 1 matches it first/));
    it('fails when a rule names an id its other conditions exclude', () =>
      expect(() =>
        applyRules(
          {
            ...withTrainerGallery,
            categoryRules: [{ match: { ids: ['sv03.5-001', 'sv03.5-003'], rarity: ['Double rare'] }, category: 'trainer-gallery' }],
          },
          cards,
          {},
        ),
      ).toThrow(/rule 1 in categoryRules names card "sv03\.5-001", but its other conditions exclude that card/));
    it('fails when an id in a category rule is shadowed', () =>
      expect(() =>
        applyRules(
          {
            ...withTrainerGallery,
            categoryRules: [
              { match: { rarity: ['Common'] }, category: 'promos' },
              { match: { ids: ['sv03.5-001', 'sv03.5-003'] }, category: 'trainer-gallery' },
            ],
          },
          cards,
          {},
        ),
      ).toThrow(/rule 2 in categoryRules names card "sv03\.5-001", but rule 1 matches it first/));
    it('fails when a non-final version rule matches no cards (rarity typo)', () =>
      expect(() =>
        applyRules(
          withVersionRules([
            { match: { rarity: ['Common'] }, versions: ['normal'] },
            { match: { rarity: ['Uncommmon'] }, versions: ['normal', 'reverse'] },
            { match: {}, versions: ['single'] },
          ]),
          cards,
          {},
        ),
      ).toThrow(/rule 2 in versionRules matches no cards/));
    it('fails when a version rule is shadowed by an earlier one', () =>
      expect(() =>
        applyRules(
          withVersionRules([
            { match: { rarity: ['Common'] }, versions: ['normal'] },
            { match: { ids: ['sv03.5-001'] }, versions: ['normal', 'reverse'] },
            { match: {}, versions: ['single'] },
          ]),
          cards,
          {},
        ),
      ).toThrow(/rule 2 in versionRules matches no cards/));
    it('allows the final catch-all version rule to match nothing', () =>
      expect(applyRules(rules, [card('001', 'Common')], {})).toHaveLength(1));
    it('fails when a category rule matches no cards', () =>
      expect(() => applyRules(withTrainerGallery, cards, {})).toThrow(/rule 1 in categoryRules matches no cards/));
  });
});
