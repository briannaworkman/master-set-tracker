# Plan 1 — Card Catalog Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A command-line tool that turns free card-database data plus hand-curated per-set rules into frozen, versioned set catalogs (JSON) for the app, plus a spreadsheet checklist per set for the owner to review.

**Architecture:** A pnpm TypeScript monorepo. `packages/catalog-core` holds the catalog types shared with the future app. `tools/catalog` fetches from the TCGdex REST API (cached on disk), applies YAML rules (categories, versions, overrides, extra promo/stamped cards), assigns each card version a permanent position (frozen in a lock file once a set is published), and writes `catalog/dist/`. Positions are what the offline QR code (Plan 4) will be keyed on, so they must never shift after publishing.

**Tech Stack:** Node 24, pnpm workspaces, TypeScript 5 (strict, ESM), vitest, zod, `yaml`.

**Spec:** `docs/superpowers/specs/2026-11-14-master-set-tracker-design.md` (§3 card data gap and data review, §5.7 data model, §5.8 pipeline and review).

## Plan series

1. **Card catalog pipeline (this plan):** unblocks the owner's set reviews.
2. **Mobile app, on-device:** Expo app with local collection, My Sets, set grid (layout A), marking, filters, category toggles, card detail. Reads Plan 1's catalog.
3. **Accounts, sync and prices:** Supabase auth/sync, daily price job, catalog publishing to phones.
4. **Sharing and offline trade matching:** QR payload codec, animated QR, scanner, Match screen, Complete trade, share web page.

## Global Constraints

- English sets only; launch scope is Scarlet & Violet era sets.
- Version kinds are data (`catalog/version-kinds.yaml`), never a hard-coded enum in code.
- Once a set is published, its version positions are frozen. Corrections bump `catalogVersion` and append new positions. Positions are never reshuffled or reused.
- Every card belongs to exactly one category. Each set has exactly one `main` category. Other kinds: `subset`, `promo_stamped`.
- Wrong variant data is a failure: any rule that references something that doesn't exist (card id, kind, category) must fail the build loudly, never be skipped.
- Prices are **not** part of the catalog (they change daily; Plan 3 owns them).
- No Pokémon trademarks in package names, file names, or app-facing strings.

## Review Focus

1. **The source renumbers or drops a card after a set is published.** Expected: existing positions don't move, the dropped version's position is retired and never reused, and the build refuses to write until `--accept-changes`. → Task 4 and Task 5 tests.
2. **A typo in a rules file** (`masterbal`, an override for a card id that isn't in the set). Expected: the build fails and names the typo. → Task 1 and Task 3 tests.
3. **Mixed card numbers** (`2`, `10`, `TG01`, `SV001`). Expected: natural order (2 before 10, prefixed numbers after plain ones within their category). → Task 3 test.
4. **Rarity text varies in case or is missing** (`Double Rare` vs `Double rare`, `null`). Expected: case-insensitive match, missing rarity falls to the catch-all rule. → Task 3 test.
5. **Network fails partway through a fetch.** Expected: nothing half-written. The cache holds only complete responses, and dist files are written atomically. → Task 2 and Task 5 tests.

---

### Task 1: Workspace, shared types, version kinds and rules schema

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore` (`node_modules`, `catalog/.cache`, `.superpowers`)
- Create: `packages/catalog-core/package.json`, `packages/catalog-core/src/index.ts`
- Create: `tools/catalog/package.json`, `tools/catalog/tsconfig.json`, `tools/catalog/vitest.config.ts`
- Create: `catalog/version-kinds.yaml`
- Create: `tools/catalog/src/rules/schema.ts`
- Test: `tools/catalog/test/rules-schema.test.ts`, fixture `tools/catalog/test/fixtures/rules/sv03.5.yaml`

**Interfaces:**
- Produces (`@mst/catalog-core`):
  ```ts
  export type VersionKindId = string;
  export interface VersionKind { id: VersionKindId; label: string; shortLabel: string; color: string; sortOrder: number }
  export type CategoryKind = 'main' | 'subset' | 'promo_stamped';
  export interface SetCategory { id: string; kind: CategoryKind; label: string; sortOrder: number }
  export interface CatalogVersion { kind: VersionKindId; position: number }
  export interface CatalogCard { id: string; number: string; name: string; rarity: string | null; categoryId: string; imageUrl: string | null; versions: CatalogVersion[] }
  export interface SetCatalog { id: string; name: string; series: string; releaseDate: string; logoUrl: string | null; catalogVersion: number; versionCount: number; retiredPositions: number[]; categories: SetCategory[]; cards: CatalogCard[] }
  export interface CatalogIndex { generatedAt: string; kinds: VersionKind[]; sets: Array<Pick<SetCatalog, 'id' | 'name' | 'series' | 'releaseDate' | 'logoUrl' | 'catalogVersion' | 'versionCount'>> }
  ```
- Produces (`tools/catalog/src/rules/schema.ts`):
  ```ts
  export interface CardMatch { rarity?: string[]; localIdPrefix?: string; ids?: string[] } // all present conditions AND; {} matches all
  export interface SetRules {
    id: string; source: { tcgdex: string }; name: string; series: string; releaseDate: string;
    categories: Array<{ id: string; kind: CategoryKind; label: string }>;
    categoryRules: Array<{ match: CardMatch; category: string }>;   // first match wins; default → the main category
    versionRules: Array<{ match: CardMatch; versions: VersionKindId[] }>; // first match wins; last must be {}
    overrides: Record<string, { versions?: VersionKindId[]; category?: string }>; // keyed by card id
    extraCards: Array<{ id: string; category: string; number: string; name?: string; sourceCard?: { tcgdex: string }; versions: VersionKindId[] }>;
  }
  export function parseVersionKinds(yamlText: string): VersionKind[];
  export function parseSetRules(yamlText: string, kinds: VersionKind[]): SetRules;
  ```

- [ ] **Step 1: Scaffold the workspace and `git init`.** Root `package.json` scripts: `"test": "pnpm -r test"`, `"catalog": "pnpm --filter @mst/catalog-tool exec tsx src/cli.ts"`. Package names: `@mst/catalog-core`, `@mst/catalog-tool`. Install `typescript`, `vitest`, `tsx`, `zod`, `yaml`.

- [ ] **Step 2: Write `catalog/version-kinds.yaml`** with exactly these kinds, in this order (sortOrder 0–5):

  | id | label | shortLabel | color |
  |---|---|---|---|
  | normal | Normal | N | `#A39D92` |
  | reverse | Reverse Holo | R | `rainbow` |
  | holo | Holo | H | `#6E8FD8` |
  | pokeball | Poké Ball Reverse | PB | `#E5484D` |
  | masterball | Master Ball Reverse | MB | `#8E4EC6` |
  | single | Single | ★ | `#D4A72C` |

- [ ] **Step 3: Write the failing tests** in `rules-schema.test.ts`, using the fixture (151 with categories `main` and `promos`, a rarity rule for `[Common, Uncommon]` → `[normal, reverse, pokeball, masterball]`, and a catch-all `{}` → `[single]`):
  ```ts
  it('parses the version kinds file', () => {
    const kinds = parseVersionKinds(read('catalog/version-kinds.yaml'));
    expect(kinds.map(k => k.id)).toEqual(['normal','reverse','holo','pokeball','masterball','single']);
  });
  it('parses a valid rules file', () => {
    const r = parseSetRules(fixture, kinds);
    expect(r.id).toBe('sv03.5');
    expect(r.versionRules[0].versions).toEqual(['normal','reverse','pokeball','masterball']);
    expect(r.overrides).toEqual({}); expect(r.extraCards).toEqual([]);
  });
  it('rejects an unknown version kind', () =>
    expect(() => parseSetRules(fixture.replace('masterball', 'masterbal'), kinds)).toThrow(/unknown version kind "masterbal"/));
  it('rejects a category rule pointing at an undeclared category', () =>
    expect(() => parseSetRules(withCategoryRule('trainer-galery'), kinds)).toThrow(/unknown category "trainer-galery"/));
  it('requires exactly one main category', () =>
    expect(() => parseSetRules(withoutMainCategory, kinds)).toThrow(/exactly one category of kind "main"/));
  it('requires the last version rule to match all cards', () =>
    expect(() => parseSetRules(withoutCatchAll, kinds)).toThrow(/last version rule must match all cards/));
  it('rejects duplicate kinds in one version list', () =>
    expect(() => parseSetRules(withVersions('[normal, normal]'), kinds)).toThrow(/duplicate version kind "normal"/));
  ```

- [ ] **Step 4: Run** `pnpm --filter @mst/catalog-tool test rules-schema`. Expected: FAIL (module not found).

- [ ] **Step 5: Implement `parseVersionKinds` and `parseSetRules`** with zod for shape plus explicit cross-reference checks (kinds, categories, single main, catch-all last, duplicates) that throw `Error` with the messages above. `overrides` and `extraCards` default to empty.

- [ ] **Step 6: Run the tests.** Expected: PASS.

- [ ] **Step 7: Commit** — `git commit -m "feat(catalog): workspace, shared catalog types, rules schema"`

---

### Task 2: TCGdex source with on-disk cache

**Files:**
- Create: `tools/catalog/src/source/tcgdex.ts`
- Test: `tools/catalog/test/tcgdex.test.ts`, fixtures `tools/catalog/test/fixtures/tcgdex/` (a trimmed set response with 3 cards, and their card responses: one with no `image`, one with no `rarity`)

**Interfaces:**
- Produces:
  ```ts
  export interface SourceCard { id: string; localId: string; name: string; rarity: string | null; imageUrl: string | null }
  export interface SourceSet { id: string; name: string; releaseDate: string; series: string; logoUrl: string | null; totalCards: number; cardIds: string[] }
  export interface CardSource { getSet(id: string): Promise<SourceSet>; getCard(id: string): Promise<SourceCard> }
  export function createTcgdexSource(opts: { fetch?: typeof fetch; cacheDir: string; baseUrl?: string }): CardSource;
  ```
  Base URL `https://api.tcgdex.net/v2/en`. Set: `GET /sets/{id}` → `{ id, name, releaseDate, logo?, serie: { name }, cardCount: { total }, cards: [{ id, localId, name, image? }] }`; `logoUrl = logo + '.webp'` when present, else `null`. Card: `GET /cards/{id}` → `{ id, localId, name, image?, rarity? }`. `imageUrl = image + '/high.webp'` when `image` is present, else `null`.

- [ ] **Step 1: Write the failing tests** with an injected fake `fetch` that serves the fixtures and counts calls:
  ```ts
  it('maps a set', async () => {
    const s = await src.getSet('sv03.5');
    expect(s).toMatchObject({ id: 'sv03.5', series: 'Scarlet & Violet', totalCards: 3, cardIds: ['sv03.5-001','sv03.5-002','sv03.5-003'] });
  });
  it('maps a card and builds the high-res image url', async () =>
    expect((await src.getCard('sv03.5-001')).imageUrl).toBe('https://assets.tcgdex.net/en/sv/sv03.5/001/high.webp'));
  it('returns null image and rarity when missing', async () => {
    expect((await src.getCard('sv03.5-002')).imageUrl).toBeNull();
    expect((await src.getCard('sv03.5-003')).rarity).toBeNull();
  });
  it('serves repeat requests from the disk cache', async () => {
    await src.getCard('sv03.5-001'); await createTcgdexSource({ fetch: fake, cacheDir }).getCard('sv03.5-001');
    expect(fake.calls).toBe(1);
  });
  it('throws on a non-200 and caches nothing', async () => {
    await expect(src.getCard('sv03.5-999')).rejects.toThrow(/TCGdex 404 for \/cards\/sv03\.5-999/);
    expect(readdirSync(cacheDir)).toHaveLength(0);
  });
  ```

- [ ] **Step 2: Run** `pnpm --filter @mst/catalog-tool test tcgdex`. Expected: FAIL.

- [ ] **Step 3: Implement `createTcgdexSource`.** Cache file per request path under `cacheDir` (path → safe filename), written only after a full successful response (write temp file, then rename). No network in tests.

- [ ] **Step 4: Run the tests.** Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(catalog): TCGdex source with disk cache"`

---

### Task 3: Applying rules to source cards

**Files:**
- Create: `tools/catalog/src/build/apply-rules.ts`
- Test: `tools/catalog/test/apply-rules.test.ts`

**Interfaces:**
- Consumes: `SetRules`, `CardMatch` (Task 1); `SourceCard` (Task 2).
- Produces:
  ```ts
  export interface DraftCard { id: string; number: string; name: string; rarity: string | null; categoryId: string; imageUrl: string | null; versions: VersionKindId[] }
  export function applyRules(rules: SetRules, cards: SourceCard[], extraSources: Record<string, SourceCard>): DraftCard[];
  ```
  `extraSources` is keyed by the `sourceCard.tcgdex` id of each extra card. Output order: categories in declaration order; within a category, cards by natural number order (`localeCompare` with `{ numeric: true }`, with plain numbers before prefixed ones); extra cards after source cards in the same category, in rules order. `number` = `localId` (or the extra card's `number`).

- [ ] **Step 1: Write the failing tests** (build small `SourceCard[]` inline):
  ```ts
  it('gives commons the four reverse versions and ex cards a single version', () => {
    const out = applyRules(rules, [card('001','Common'), card('003','Double rare')], {});
    expect(out.map(c => c.versions)).toEqual([['normal','reverse','pokeball','masterball'], ['single']]);
  });
  it('matches rarity case-insensitively', () =>
    expect(applyRules(rules, [card('001','COMMON')], {})[0].versions).toHaveLength(4));
  it('sends a card with no rarity to the catch-all rule', () =>
    expect(applyRules(rules, [card('050', null)], {})[0].versions).toEqual(['single']));
  it('applies an override', () =>
    expect(applyRules(withOverride('sv03.5-001', { versions: ['normal','reverse'] }), [card('001','Common')], {})[0].versions).toEqual(['normal','reverse']));
  it('fails on an override for a card not in the set', () =>
    expect(() => applyRules(withOverride('sv03.5-999', { versions: ['normal'] }), [card('001','Common')], {})).toThrow(/override for unknown card "sv03\.5-999"/));
  it('routes TG-prefixed cards to the trainer gallery category', () =>
    expect(applyRules(withTrainerGallery, [card('TG01','Rare')], {})[0].categoryId).toBe('trainer-gallery'));
  it('sorts numbers naturally', () =>
    expect(applyRules(rules, [card('10','Common'), card('2','Common'), card('1','Common')], {}).map(c => c.number)).toEqual(['1','2','10']));
  it('appends extra cards, taking name and image from their source card', () => {
    const out = applyRules(withExtra({ id: 'sv03.5-promo-svp-050', category: 'promos', number: 'SVP 050', sourceCard: { tcgdex: 'svp-050' }, versions: ['single'] }),
      [card('001','Common')], { 'svp-050': { id: 'svp-050', localId: '050', name: 'Some Promo', rarity: null, imageUrl: 'x' } });
    expect(out.at(-1)).toMatchObject({ id: 'sv03.5-promo-svp-050', categoryId: 'promos', number: 'SVP 050', name: 'Some Promo', imageUrl: 'x' });
  });
  it('requires a name for an extra card with no source card', () =>
    expect(() => applyRules(withExtra({ id: 'x', category: 'promos', number: 'S1', versions: ['single'] }), [], {})).toThrow(/extra card "x" needs a name/));
  ```

- [ ] **Step 2: Run** `pnpm --filter @mst/catalog-tool test apply-rules`. Expected: FAIL.

- [ ] **Step 3: Implement `applyRules`.** First matching rule wins for both category and versions. An override's `category` must name a declared category (throw `unknown category`).

- [ ] **Step 4: Run the tests.** Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(catalog): apply per-set rules to source cards"`

---

### Task 4: Frozen version positions

**Files:**
- Create: `tools/catalog/src/build/positions.ts`
- Test: `tools/catalog/test/positions.test.ts`

**Interfaces:**
- Consumes: `DraftCard` (Task 3); `CatalogCard` (Task 1).
- Produces:
  ```ts
  export interface PositionLock { setId: string; catalogVersion: number; positions: Record<string, number>; retired: number[] } // key: `${cardId}:${kind}`
  export interface PositionResult { cards: CatalogCard[]; lock: PositionLock; changed: boolean; added: string[]; retiredKeys: string[] }
  export function assignPositions(setId: string, draft: DraftCard[], lock: PositionLock | null): PositionResult;
  ```
  With no lock, positions are 0…n−1 in draft order (cards, then each card's versions in order), with `catalogVersion: 1`. With a lock, existing keys keep their positions. New keys get `max(all positions ∪ retired) + 1` onward. Keys in the lock that are missing from the draft move to `retired`. `changed = added.length + retiredKeys.length > 0`, and `catalogVersion` goes up by 1 only when changed. `versionCount` (computed by Task 5) = highest position ever used + 1.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it('numbers a fresh set sequentially', () => {
    const r = assignPositions('s', [draft('a', ['normal','reverse']), draft('b', ['single'])], null);
    expect(r.cards.flatMap(c => c.versions.map(v => v.position))).toEqual([0,1,2]);
    expect(r.lock.catalogVersion).toBe(1);
  });
  it('is stable when nothing changed', () => {
    const first = assignPositions('s', d, null); const again = assignPositions('s', d, first.lock);
    expect(again.cards).toEqual(first.cards); expect(again.changed).toBe(false); expect(again.lock.catalogVersion).toBe(1);
  });
  it('appends a card inserted mid-set without moving others', () => {
    const first = assignPositions('s', [draft('a',['normal']), draft('c',['normal'])], null);
    const r = assignPositions('s', [draft('a',['normal']), draft('b',['normal','reverse']), draft('c',['normal'])], first.lock);
    expect(pos(r, 'a:normal')).toBe(0); expect(pos(r, 'c:normal')).toBe(1);
    expect([pos(r,'b:normal'), pos(r,'b:reverse')]).toEqual([2,3]);
    expect(r.lock.catalogVersion).toBe(2); expect(r.added).toEqual(['b:normal','b:reverse']);
  });
  it('retires a removed version and never reuses its position', () => {
    const first = assignPositions('s', [draft('a',['normal','reverse'])], null);
    const r = assignPositions('s', [draft('a',['normal','pokeball'])], first.lock);
    expect(r.lock.retired).toEqual([1]); expect(pos(r,'a:pokeball')).toBe(2); expect(r.retiredKeys).toEqual(['a:reverse']);
  });
  ```

- [ ] **Step 2: Run** `pnpm --filter @mst/catalog-tool test positions`. Expected: FAIL.

- [ ] **Step 3: Implement `assignPositions`.** It must not mutate the input lock.

- [ ] **Step 4: Run the tests.** Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(catalog): frozen version positions with lock file"`

---

### Task 5: Build, checklist, publish CLI

**Files:**
- Create: `tools/catalog/src/build/build-set.ts`, `tools/catalog/src/checklist/csv.ts`, `tools/catalog/src/fs/atomic.ts`, `tools/catalog/src/cli.ts`
- Test: `tools/catalog/test/checklist.test.ts`, `tools/catalog/test/cli.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  ```ts
  export function buildSet(opts: { rules: SetRules; source: CardSource; lock: PositionLock | null }): Promise<PositionResult & { catalog: SetCatalog; warnings: string[] }>;
  export function toChecklistCsv(catalog: SetCatalog, kinds: VersionKind[]): string;
  export function writeFileAtomic(path: string, data: string): Promise<void>;
  export function runCli(argv: string[], deps: { root: string; source: CardSource; log: (s: string) => void }): Promise<number>; // exit code
  ```
  Directory layout under `root`: `catalog/rules/<id>.yaml`, `catalog/locks/<id>.lock.json` (existence = published), `catalog/dist/sets/<id>.json`, `catalog/dist/checklists/<id>.csv`, `catalog/dist/index.json`.

  Commands:
  - `build <id…|--all>`: builds each set and writes its dist JSON and checklist CSV. On a **published** set where `changed` is true, it exits 1 and lists `added` and `retiredKeys`, unless `--accept-changes` is passed, in which case it also writes the bumped lock. On an unpublished set it never writes a lock. Prints a summary line per set: `<name>: <cards> cards, <versions> versions (<category label> <n>, …)`, plus any warnings.
  - `publish <id>`: builds and writes the lock (`catalogVersion: 1`). Exits 1 if the set is already published.
  - After any successful command, it regenerates `index.json` from **published** sets only.
  - `buildSet` adds a warning when the number of source cards fetched ≠ `SourceSet.totalCards`.

  Checklist CSV: header `Number,Name,Rarity,Category,` + one column per version kind **used in that set** (kind `label`, in kind sortOrder) + `,Notes`. Each row puts `✓` in the columns for the card's versions. RFC 4180 quoting. UTF-8 with BOM so Excel and Google Sheets show ✓ and é correctly.

- [ ] **Step 1: Write the failing checklist tests:**
  ```ts
  it('writes header with only the kinds this set uses', () =>
    expect(firstLine(toChecklistCsv(catalog151, kinds))).toBe('﻿Number,Name,Rarity,Category,Normal,Reverse Holo,Poké Ball Reverse,Master Ball Reverse,Single,Notes'));
  it('marks versions with ✓', () =>
    expect(line(2)).toBe('001,Bulbasaur,Common,Main set,✓,✓,✓,✓,,'));
  it('quotes names containing commas', () =>
    expect(toChecklistCsv(withName('Mr. Mime, Jr'), kinds)).toContain('"Mr. Mime, Jr"'));
  ```

- [ ] **Step 2: Write the failing CLI tests** (temp dir root, fake `CardSource`, rules fixture copied in):
  ```ts
  it('build writes dist and checklist but no lock for an unpublished set', async () => {
    expect(await runCli(['build','sv03.5'], deps)).toBe(0);
    expect(exists('catalog/dist/sets/sv03.5.json')).toBe(true); expect(exists('catalog/locks/sv03.5.lock.json')).toBe(false);
    expect(json('catalog/dist/index.json').sets).toEqual([]);
  });
  it('publish writes the lock and lists the set in the index', async () => {
    expect(await runCli(['publish','sv03.5'], deps)).toBe(0);
    expect(json('catalog/locks/sv03.5.lock.json').catalogVersion).toBe(1);
    expect(json('catalog/dist/index.json').sets.map(s => s.id)).toEqual(['sv03.5']);
  });
  it('refuses to change a published set without --accept-changes', async () => {
    await runCli(['publish','sv03.5'], deps); source.addCard('sv03.5-004');
    expect(await runCli(['build','sv03.5'], deps)).toBe(1);
    expect(logs.join('\n')).toMatch(/sv03\.5-004:normal/);
    expect(json('catalog/locks/sv03.5.lock.json').catalogVersion).toBe(1);
  });
  it('accepts changes when asked and bumps the catalog version', async () => {
    await runCli(['publish','sv03.5'], deps); source.addCard('sv03.5-004');
    expect(await runCli(['build','sv03.5','--accept-changes'], deps)).toBe(0);
    expect(json('catalog/locks/sv03.5.lock.json').catalogVersion).toBe(2);
  });
  it('leaves previous dist files intact when the source fails mid-build', async () => {
    await runCli(['build','sv03.5'], deps); const before = read('catalog/dist/sets/sv03.5.json');
    source.failOn('sv03.5-002');
    expect(await runCli(['build','sv03.5'], deps)).toBe(1);
    expect(read('catalog/dist/sets/sv03.5.json')).toBe(before);
  });
  ```

- [ ] **Step 3: Run** `pnpm --filter @mst/catalog-tool test checklist cli`. Expected: FAIL.

- [ ] **Step 4: Implement** `writeFileAtomic` (temp file in the same directory, then rename), `toChecklistCsv`, `buildSet` (fetch the set and every card, plus extra cards' source cards, then `applyRules`, then `assignPositions`, then assemble `SetCatalog` with `versionCount` and `retiredPositions` from the lock), and `runCli`. Wire `src/cli.ts`'s `main` to `runCli(process.argv.slice(2), { root: repo root, source: createTcgdexSource({ cacheDir: 'catalog/.cache' }), log: console.log })`.

- [ ] **Step 5: Run the full suite** `pnpm test`. Expected: PASS.

- [ ] **Step 6: Commit** — `git commit -m "feat(catalog): build, checklist and publish commands"`

---

### Task 6: First real sets and owner checklists

**Files:**
- Create: `catalog/rules/sv03.5.yaml` (151), `catalog/rules/sv08.5.yaml` (Prismatic Evolutions)
- Create: `catalog/README.md`: how to add a set, how to read a checklist, how publishing and `--accept-changes` work

**Interfaces:**
- Consumes: the CLI from Task 5.

- [ ] **Step 1: Research each set's version rules** against at least two sources (TCGdex card `variants`, TCGCollector, a marketplace listing such as CardTrader or TCGplayer). Starting assumptions **to verify, not trust**:
  - 151: commons, uncommons and non-ex rares print as Normal (or Holo for rares), Reverse, Poké Ball Reverse and Master Ball Reverse. ex, illustration rares and higher are single.
  - Prismatic Evolutions: commons, uncommons and rares get Poké Ball and Master Ball reverses in addition to their usual versions. ex and higher are single.
  Record each source in a comment at the top of the rules file. Leave `extraCards: []` unless a set-tied promo or stamped card is confirmed by a source; list any unconfirmed candidates in the README for the owner.

- [ ] **Step 2: Run** `pnpm catalog build sv03.5 sv08.5`. Expected: exit 0, no "fetched ≠ total" warnings, and a summary line for each set.

- [ ] **Step 3: Spot-check** five cards per set (a common, an uncommon, a rare, an ex, the highest-numbered secret rare) in the CSV against a marketplace listing. Fix rules until they match.

- [ ] **Step 4: Commit** — `git commit -m "feat(catalog): rules for 151 and Prismatic Evolutions"`. Do **not** publish: publishing happens only after the owner signs off on the checklists in `catalog/dist/checklists/`.
