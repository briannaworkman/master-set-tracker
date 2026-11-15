import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseSetRules, parseVersionKinds } from '../src/rules/schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const read = (rel: string) => readFileSync(resolve(repoRoot, rel), 'utf8');

const kinds = parseVersionKinds(read('catalog/version-kinds.yaml'));
const fixture = readFileSync(resolve(here, 'fixtures/rules/sv03.5.yaml'), 'utf8');

const withCategoryRule = (category: string) =>
  fixture.replace('categoryRules: []', `categoryRules:\n  - match: { localIdPrefix: TG }\n    category: ${category}`);
const withoutMainCategory = fixture.replace('kind: main', 'kind: subset');
const withoutCatchAll = fixture.replace('  - match: {}\n    versions: [single]\n', '');
const withVersions = (list: string) =>
  fixture.replace('versions: [normal, reverse, pokeball, masterball]', `versions: ${list}`);

describe('rules schema', () => {
  it('parses the version kinds file', () => {
    expect(kinds.map((k) => k.id)).toEqual(['normal', 'reverse', 'holo', 'pokeball', 'masterball', 'single']);
    expect(kinds.map((k) => k.sortOrder)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('parses a valid rules file', () => {
    const r = parseSetRules(fixture, kinds);
    expect(r.id).toBe('sv03.5');
    expect(r.source.tcgdex).toBe('sv03.5');
    expect(r.name).toBe('151');
    expect(r.categories.map((c) => c.label)).toEqual(['Main set', 'Promos & stamped']);
    expect(r.versionRules[0]!.versions).toEqual(['normal', 'reverse', 'pokeball', 'masterball']);
    expect(r.overrides).toEqual({});
    expect(r.extraCards).toEqual([]);
  });

  it('rejects an unknown version kind', () =>
    expect(() => parseSetRules(fixture.replace('masterball', 'masterbal'), kinds)).toThrow(
      /unknown version kind "masterbal"/,
    ));

  it('rejects a category rule pointing at an undeclared category', () =>
    expect(() => parseSetRules(withCategoryRule('trainer-galery'), kinds)).toThrow(
      /unknown category "trainer-galery"/,
    ));

  it('accepts a category rule pointing at a declared category', () =>
    expect(parseSetRules(withCategoryRule('promos'), kinds).categoryRules).toHaveLength(1));

  it('requires exactly one main category', () =>
    expect(() => parseSetRules(withoutMainCategory, kinds)).toThrow(/exactly one category of kind "main"/));

  it('requires the last version rule to match all cards', () =>
    expect(() => parseSetRules(withoutCatchAll, kinds)).toThrow(/last version rule must match all cards/));

  it('rejects duplicate kinds in one version list', () =>
    expect(() => parseSetRules(withVersions('[normal, normal]'), kinds)).toThrow(/duplicate version kind "normal"/));
});
