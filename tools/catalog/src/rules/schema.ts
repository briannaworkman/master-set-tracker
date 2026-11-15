import { parse } from 'yaml';
import { z } from 'zod';
import type { CategoryKind, VersionKind, VersionKindId } from '@mst/catalog-core';

export interface CardMatch {
  rarity?: string[];
  localIdPrefix?: string;
  ids?: string[];
}

export interface SetRules {
  id: string;
  source: { tcgdex: string };
  name: string;
  series: string;
  releaseDate: string;
  categories: Array<{ id: string; kind: CategoryKind; label: string }>;
  categoryRules: Array<{ match: CardMatch; category: string }>;
  versionRules: Array<{ match: CardMatch; versions: VersionKindId[] }>;
  overrides: Record<string, { versions?: VersionKindId[]; category?: string }>;
  extraCards: Array<{
    id: string;
    category: string;
    number: string;
    name?: string;
    sourceCard?: { tcgdex: string };
    versions: VersionKindId[];
  }>;
}

const versionKindsSchema = z.array(
  z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    shortLabel: z.string().min(1),
    color: z.string().min(1),
    sortOrder: z.number().int(),
  }).strict(),
);

export function parseVersionKinds(yamlText: string): VersionKind[] {
  const kinds = versionKindsSchema.parse(parse(yamlText));
  const seen = new Set<string>();
  for (const k of kinds) {
    if (seen.has(k.id)) throw new Error(`duplicate version kind id "${k.id}"`);
    seen.add(k.id);
  }
  return kinds;
}

const matchSchema = z
  .object({
    rarity: z.array(z.string()).optional(),
    localIdPrefix: z.string().optional(),
    ids: z.array(z.string()).optional(),
  })
  .strict();

const versionList = z.array(z.string()).min(1);

const rulesSchema = z.object({
  id: z.string().min(1),
  source: z.object({ tcgdex: z.string().min(1) }).strict(),
  name: z.string().min(1),
  series: z.string().min(1),
  releaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'releaseDate must be YYYY-MM-DD'),
  categories: z.array(
    z.object({
      id: z.string().min(1),
      kind: z.enum(['main', 'subset', 'promo_stamped']),
      label: z.string().min(1),
    }).strict(),
  ),
  categoryRules: z.array(z.object({ match: matchSchema, category: z.string() }).strict()).default([]),
  versionRules: z.array(z.object({ match: matchSchema, versions: versionList }).strict()).min(1),
  overrides: z
    .record(z.object({ versions: versionList.optional(), category: z.string().optional() }).strict())
    .default({}),
  extraCards: z
    .array(
      z.object({
        id: z.string().min(1),
        category: z.string(),
        number: z.string().min(1),
        name: z.string().optional(),
        sourceCard: z.object({ tcgdex: z.string().min(1) }).strict().optional(),
        versions: versionList,
      }).strict(),
    )
    .default([]),
}).strict();

export function parseSetRules(yamlText: string, kinds: VersionKind[]): SetRules {
  const rules: SetRules = rulesSchema.parse(parse(yamlText));
  const kindIds = new Set(kinds.map((k) => k.id));
  const categoryIds = new Set(rules.categories.map((c) => c.id));

  const checkVersions = (versions: VersionKindId[]) => {
    const seen = new Set<string>();
    for (const v of versions) {
      if (!kindIds.has(v)) throw new Error(`unknown version kind "${v}"`);
      if (seen.has(v)) throw new Error(`duplicate version kind "${v}"`);
      seen.add(v);
    }
  };
  const checkCategory = (id: string) => {
    if (!categoryIds.has(id)) throw new Error(`unknown category "${id}"`);
  };

  if (rules.categories.filter((c) => c.kind === 'main').length !== 1) {
    throw new Error('rules must declare exactly one category of kind "main"');
  }
  if (categoryIds.size !== rules.categories.length) throw new Error('duplicate category id');

  for (const r of rules.categoryRules) checkCategory(r.category);
  for (const r of rules.versionRules) checkVersions(r.versions);
  for (const o of Object.values(rules.overrides)) {
    if (o.versions) checkVersions(o.versions);
    if (o.category) checkCategory(o.category);
  }
  for (const c of rules.extraCards) {
    checkCategory(c.category);
    checkVersions(c.versions);
  }

  const last = rules.versionRules[rules.versionRules.length - 1]!;
  if (Object.keys(last.match).length !== 0) {
    throw new Error('last version rule must match all cards (use match: {})');
  }
  return rules;
}
