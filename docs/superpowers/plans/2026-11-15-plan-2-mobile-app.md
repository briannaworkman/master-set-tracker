# Plan 2 — Mobile App (On-Device) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Expo app (iOS/Android, with a web build for previewing) where a collector adds sets, sees the layout-A grid of card tiles with version dots, and marks what they own (with duplicate counts). All data stays on the device, and it works fully offline.

**Architecture:** A new pure-TypeScript package `packages/collection-core` holds all domain logic (progress, filters, sections, values) and storage (a `CollectionRepo` over a tiny `SqlDb` interface, plus a subscribable `CollectionStore`). It is tested in Node with vitest and better-sqlite3. `apps/mobile` is an Expo Router app that bundles Plan 1's catalog JSON, adapts `expo-sqlite` to `SqlDb`, and renders the screens. UI is tested with jest-expo and React Native Testing Library. No accounts, sync, prices data, sharing or scanning: those are Plans 3–4.

**Tech Stack:** Expo SDK 58 (expo 58.0.x, expo-router 58, expo-sqlite 58, expo-image 58, expo-haptics 58, expo-linear-gradient 58), React Native 0.88, React 19.3, TypeScript strict, vitest + better-sqlite3 (packages), jest-expo + @testing-library/react-native 14 (app), pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-11-14-master-set-tracker-design.md` (§5.1 screens, §5.2 marking, §5.5 prices, §5.6 architecture, §6 visual direction). Catalog types: `packages/catalog-core/src/index.ts` (Plan 1).

## Global Constraints

- App display name **"Master Set Tracker"** (working name), slug `master-set-tracker`. No "Pokémon", Poké Ball imagery, or Nintendo/TPCi branding in the app name, icon or app chrome. Card data labels come from the catalog as-is.
- A version is identified by `VersionKey = "<cardId>:<kindId>"`. Counts are stored per VersionKey and are never negative.
- **Spare** = any copy beyond the first (`max(0, count − 1)`).
- Progress "X of Y" counts **versions**, not cards, and only in categories the user has switched on. The main category can't be switched off.
- Hiding a category or removing a set from My Sets never deletes counts. Turning it back on, or re-adding the set, restores everything.
- Marking: **tap a dot = +1**; **press and hold (350 ms) a dot = −/+ popover**; a light haptic (`Haptics.selectionAsync`) on every change; changes save instantly with no save button.
- Prices: the app reads prices through a `PriceBook` interface. Plan 2 ships an empty one (Plan 3 fills it). Unknown prices show "—" and are excluded from totals. When a set has **no** known prices, the header value line is hidden entirely.
- Visual direction: warm neutral background, card art as the main colour, generous spacing, no banners. Light and dark mode. Tokens are in Task 3.
- Unpublished catalog sets (not in `catalog/dist/index.json`) appear only in development builds (`__DEV__`), marked "Draft".
- Monorepo uses `node-linker=hoisted` (root `.npmrc`) for React Native compatibility.

## Review Focus

1. **Rapid repeated taps on one dot.** Expected: each tap adds exactly one, and the stored count equals the number of taps. → Task 2 store test.
2. **Hiding a category that has owned cards, then showing it again.** Expected: progress drops those versions while hidden, the counts survive, and unhiding restores the same progress. → Task 2 store test + Task 1 progress test.
3. **The catalog changes under existing counts** (a version retired or a card removed in a newer bundled catalog). Expected: counts for unknown versions are ignored by progress, filters and value (no crash, no inflated "X of Y"), and the rows are kept. → Task 1 test.
4. **A card with no image, or an image that fails to load offline.** Expected: the tile shows a neutral placeholder with number and name, and the dots still work. → Task 5 test.
5. **Lowering a count to 0 from the popover.** Expected: the dot becomes hollow, the card fades if nothing else is owned, "−" is disabled at 0, and the count never goes negative. → Task 1 test (`clampCount`) + Task 5 popover test.

---

### Task 1: Collection domain logic

**Files:**
- Create: `packages/collection-core/package.json` (name `@mst/collection-core`, vitest), `tsconfig.json`, `src/index.ts`, `src/keys.ts`, `src/progress.ts`, `src/filters.ts`, `src/value.ts`
- Modify: root `package.json` `typecheck` script to also check `packages/collection-core`
- Test: `packages/collection-core/test/domain.test.ts`, fixture `packages/collection-core/test/fixtures/catalog.ts`, exported for reuse by the app's tests. It contains a hand-built `SetCatalog` `{ id: 'fx', name: 'Fixture Set' }` with categories `main` ("Main set", sortOrder 0) and `promos` ("Promos & stamped", kind promo_stamped, sortOrder 1), and these cards:

  | id | number | name | category | versions |
  |---|---|---|---|---|
  | c-001 | 001 | Bulbasaur | main | normal, reverse, pokeball |
  | c-002 | 002 | Ivysaur | main | normal, reverse, pokeball, masterball |
  | c-003 | 003 | Venusaur | main | normal, reverse |
  | c-004 | 004 | Venusaur ex | main | single |
  | p-1 | 001 | Bulbasaur (stamped) | promos | single |

  That gives 10 versions in main and 11 in total. Use positions 0–10 in that order, and include the kinds list copied from `catalog/version-kinds.yaml`.

**Interfaces:**
- Consumes: `SetCatalog`, `CatalogCard`, `VersionKind`, `SetCategory` from `@mst/catalog-core`.
- Produces:
  ```ts
  export type VersionKey = string;                       // `${cardId}:${kind}`
  export type Counts = Readonly<Record<VersionKey, number>>;
  export type Filter = 'all' | 'missing' | 'have' | 'spares';
  export type CardStatus = 'none' | 'partial' | 'complete';
  export interface PriceBook { price(setId: string, key: VersionKey): number | null }
  export const emptyPriceBook: PriceBook;
  export function versionKey(cardId: string, kind: string): VersionKey;
  export function clampCount(n: number): number;        // integer, 0..999
  export function spareCount(count: number): number;
  export function visibleSections(catalog: SetCatalog, hidden: readonly string[]): Array<{ category: SetCategory; cards: CatalogCard[] }>;
  export function setProgress(catalog: SetCatalog, counts: Counts, hidden: readonly string[]): { collected: number; total: number };
  export function cardStatus(card: CatalogCard, counts: Counts): CardStatus;
  export function filterCards(cards: CatalogCard[], counts: Counts, filter: Filter): CatalogCard[];
  export function legendKinds(catalog: SetCatalog, kinds: VersionKind[]): VersionKind[];
  export function setValue(catalog: SetCatalog, counts: Counts, hidden: readonly string[], prices: PriceBook): { owned: number; toFinish: number; hasPrices: boolean; incomplete: boolean };
  ```
  Rules: `visibleSections` follows category `sortOrder`, drops hidden ids, never drops the `main` category, and omits empty sections. `filterCards` semantics: `missing` = at least one version with count 0; `have` = at least one version with count ≥ 1; `spares` = at least one version with count ≥ 2. `setValue`: `owned` = Σ price × count over visible versions with a known price; `toFinish` = Σ price over visible versions with count 0 and a known price; `hasPrices` = any visible version has a known price; `incomplete` = some visible version's price is unknown. Counts whose key isn't a version in the catalog are ignored everywhere.

- [ ] **Step 1: Scaffold the package**, then write the failing tests:
  ```ts
  it('builds version keys', () => expect(versionKey('sv03.5-001', 'reverse')).toBe('sv03.5-001:reverse'));
  it('clamps counts', () => { expect(clampCount(-1)).toBe(0); expect(clampCount(2.7)).toBe(2); expect(clampCount(5000)).toBe(999); });
  it('counts spares beyond the first copy', () => { expect(spareCount(0)).toBe(0); expect(spareCount(1)).toBe(0); expect(spareCount(3)).toBe(2); });
  it('counts versions, not cards, in visible categories', () => {
    expect(setProgress(cat, { 'c-001:normal': 2, 'c-001:reverse': 1, 'p-1:single': 1 }, [])).toEqual({ collected: 3, total: 11 });
    expect(setProgress(cat, { 'c-001:normal': 2, 'c-001:reverse': 1, 'p-1:single': 1 }, ['promos'])).toEqual({ collected: 2, total: 10 });
  });
  it('ignores counts for versions not in the catalog', () =>
    expect(setProgress(cat, { 'gone-999:normal': 4, 'c-004:reverse': 1 }, [])).toEqual({ collected: 0, total: 11 }));
  it('never hides the main category', () =>
    expect(visibleSections(cat, ['main', 'promos']).map(s => s.category.id)).toEqual(['main']));
  it('reports card status', () => {
    expect(cardStatus(card001, {})).toBe('none');
    expect(cardStatus(card001, { 'c-001:normal': 1 })).toBe('partial');
    expect(cardStatus(card004, { 'c-004:single': 1 })).toBe('complete');
  });
  it('filters missing, have and spares', () => {
    const counts = { 'c-004:single': 2, 'c-001:normal': 1 };
    expect(ids(filterCards(mainCards, counts, 'missing'))).toEqual(['c-001','c-002','c-003']);
    expect(ids(filterCards(mainCards, counts, 'have'))).toEqual(['c-001','c-004']);
    expect(ids(filterCards(mainCards, counts, 'spares'))).toEqual(['c-004']);
  });
  it('lists legend kinds used by the set in sortOrder', () =>
    expect(legendKinds(cat, kinds).map(k => k.id)).toEqual(['normal','reverse','pokeball','masterball','single']));
  it('values owned copies and the cost to finish, skipping unknown prices', () => {
    const prices = book({ 'c-001:normal': 0.5, 'c-001:reverse': 1, 'c-004:single': 10 });
    expect(setValue(cat, { 'c-001:normal': 3, 'c-004:single': 1 }, [], prices))
      .toEqual({ owned: 11.5, toFinish: 1, hasPrices: true, incomplete: true });
    expect(setValue(cat, {}, [], emptyPriceBook)).toEqual({ owned: 0, toFinish: 0, hasPrices: false, incomplete: true });
  });
  ```

- [ ] **Step 2: Run** `pnpm --filter @mst/collection-core test`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the functions above across `keys.ts`, `progress.ts`, `filters.ts`, `value.ts`, re-exported from `index.ts`. Round money values to cents in `setValue`.
- [ ] **Step 4: Run** the tests and `pnpm typecheck`. Expected: PASS, clean.
- [ ] **Step 5: Commit** — `feat(collection): domain logic for progress, filters and value`

---

### Task 2: Collection storage and store

**Files:**
- Create: `packages/collection-core/src/db/sql-db.ts`, `src/db/migrations.ts`, `src/db/sqlite-repo.ts`, `src/db/memory-repo.ts`, `src/store.ts`
- Test: `packages/collection-core/test/repo.contract.ts` (shared contract), `test/sqlite-repo.test.ts` (runs the contract on better-sqlite3), `test/memory-repo.test.ts` (runs the contract on memory), `test/store.test.ts`, helper `test/better-sqlite-db.ts` (adapts better-sqlite3 to `SqlDb`)

**Interfaces:**
- Consumes: `Counts`, `VersionKey`, `versionKey`, `clampCount` (Task 1).
- Produces:
  ```ts
  export interface SqlDb {
    exec(sql: string): void;
    run(sql: string, params?: unknown[]): void;
    all<T>(sql: string, params?: unknown[]): T[];
    first<T>(sql: string, params?: unknown[]): T | null;
  }
  export interface TrackedSet { setId: string; hiddenCategoryIds: string[]; addedAt: string }
  export interface CollectionRepo {
    listTracked(): TrackedSet[];                       // ordered by addedAt ascending
    trackSet(setId: string, now: string): void;        // no-op if already tracked
    untrackSet(setId: string): void;                   // keeps counts
    setHiddenCategories(setId: string, ids: string[]): void;
    countsForSet(setId: string): Record<VersionKey, number>;  // count > 0 only
    setCount(setId: string, cardId: string, kind: string, count: number, now: string): void; // clamped
  }
  export function migrate(db: SqlDb): void;            // idempotent, uses PRAGMA user_version
  export function createSqliteRepo(db: SqlDb): CollectionRepo;   // calls migrate
  export function createMemoryRepo(): CollectionRepo;
  export class CollectionStore {
    constructor(repo: CollectionRepo, now?: () => string);
    subscribe(listener: () => void): () => void;
    getTracked(): TrackedSet[];                        // stable reference until a change
    getCounts(setId: string): Counts;                  // stable reference until that set changes
    track(setId: string): void; untrack(setId: string): void;
    setHidden(setId: string, ids: string[]): void;
    tap(setId: string, cardId: string, kind: string): void;           // +1
    setCount(setId: string, cardId: string, kind: string, n: number): void;
  }
  ```
  Schema v1: `tracked_sets(set_id TEXT PRIMARY KEY, hidden_category_ids TEXT NOT NULL DEFAULT '[]', added_at TEXT NOT NULL)`; `collection(set_id TEXT NOT NULL, card_id TEXT NOT NULL, kind TEXT NOT NULL, count INTEGER NOT NULL CHECK (count >= 0), updated_at TEXT NOT NULL, PRIMARY KEY (card_id, kind))`. Rows are kept at count 0 (Plan 3 sync needs `updated_at`). The store caches per-set `Counts` objects and replaces only the changed set's object on writes, so `useSyncExternalStore` selectors re-render only that set.

- [ ] **Step 1: Write the failing contract** (`repo.contract.ts` exports `runRepoContract(name, make: () => CollectionRepo)`):
  ```ts
  it('tracks, lists in add order and ignores duplicate adds', ...)        // trackSet a, b, a → [a, b]
  it('keeps counts when a set is untracked and re-tracked', ...)          // setCount 3 → untrack → track → countsForSet has 3
  it('stores hidden categories per set', ...)                             // ['promos'] round-trips
  it('clamps counts and never stores negatives', ...)                     // setCount -2 → no key; 1200 → 999
  it('omits zero counts from countsForSet but keeps the row', ...)        // set 2 then 0 → {}; (sqlite only: SELECT count(*) from collection = 1)
  ```
  Plus `store.test.ts`:
  ```ts
  it('adds exactly one per tap across rapid taps', () => { for (let i = 0; i < 5; i++) store.tap('s','c-001','normal'); expect(store.getCounts('s')['c-001:normal']).toBe(5); expect(repo.countsForSet('s')['c-001:normal']).toBe(5); });
  it('notifies subscribers and replaces only the changed set\'s counts object', ...)
  it('keeps the same counts reference when nothing changed', ...)
  it('hides and unhides categories without touching counts', ...)
  it('migrate is idempotent', ...)  // migrate twice on the same better-sqlite3 db → user_version 1, no throw
  ```
- [ ] **Step 2: Run** `pnpm --filter @mst/collection-core test`. Expected: FAIL.
- [ ] **Step 3: Implement** the repos, migrations and store. Writes go through the repo synchronously before listeners are notified.
- [ ] **Step 4: Run** the tests and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(collection): sqlite and memory repos with a subscribable store`

---

### Task 3: Expo app scaffold, bundled catalog and theme

**Files:**
- Create: root `.npmrc` (`node-linker=hoisted`); `apps/mobile/` from `npx create-expo-app@latest apps/mobile --template blank-typescript`, then add expo-router, expo-sqlite, expo-image, expo-haptics, expo-linear-gradient (`npx expo install …`), jest-expo + @testing-library/react-native
- Create: `apps/mobile/app.json` (name "Master Set Tracker", slug `master-set-tracker`, scheme `mastersettracker`, `userInterfaceStyle: "automatic"`), `apps/mobile/metro.config.js` (monorepo watchFolders; `wasm` asset ext and COOP/COEP headers for expo-sqlite on web)
- Create: `apps/mobile/scripts/sync-catalog.mjs`, `apps/mobile/src/catalog/bundled.ts` (generated, committed), `apps/mobile/src/catalog/CatalogContext.tsx`
- Create: `apps/mobile/src/db/expo-sql-db.ts`, `apps/mobile/src/db/StoreContext.tsx`
- Create: `apps/mobile/src/theme/tokens.ts`, `apps/mobile/src/theme/useTheme.ts`
- Create: `apps/mobile/app/_layout.tsx`, `apps/mobile/app/index.tsx` (empty-state placeholder only; Task 4 builds the screen)
- Test: `apps/mobile/src/catalog/__tests__/catalog.test.ts`, `apps/mobile/src/__tests__/smoke.test.tsx`

**Interfaces:**
- Consumes: Plan 1 `catalog/dist/index.json`, `catalog/dist/sets/*.json`; `CollectionStore`, `createSqliteRepo`, `createMemoryRepo`, `SqlDb` (Task 2).
- Produces:
  ```ts
  // src/catalog/CatalogContext.tsx
  export interface CatalogSetSummary { id: string; name: string; series: string; releaseDate: string; logoUrl: string | null; published: boolean }
  export interface Catalog { kinds: VersionKind[]; listSets(): CatalogSetSummary[]; getSet(id: string): SetCatalog | null }
  export function createCatalog(bundle: { index: CatalogIndex; sets: Record<string, SetCatalog> }, opts: { includeDrafts: boolean }): Catalog;
  export function CatalogProvider(props: { catalog: Catalog; children: React.ReactNode }): JSX.Element;
  export function useCatalog(): Catalog;
  // src/db/StoreContext.tsx
  export function StoreProvider(props: { store: CollectionStore; children: React.ReactNode }): JSX.Element;
  export function useStore(): CollectionStore;
  export function useTracked(): TrackedSet[];                 // useSyncExternalStore
  export function useCounts(setId: string): Counts;           // useSyncExternalStore
  // src/theme
  export interface Theme { bg: string; surface: string; border: string; text: string; muted: string; missing: string; accent: string; overlay: string }
  export const light: Theme; export const dark: Theme;
  export function useTheme(): Theme;                          // follows useColorScheme()
  ```
  `listSets()` returns newest `releaseDate` first; drafts (sets with a dist file but not in `index.sets`) are included only when `includeDrafts` is set, and have `published: false`. `getSet` returns null for unknown or excluded ids. The root layout builds the catalog with `includeDrafts: __DEV__`, opens `expo-sqlite` `openDatabaseSync('collection.db')` wrapped by `expo-sql-db.ts` (`execSync` / `runSync` / `getAllSync` / `getFirstSync`), and creates one `CollectionStore`. If opening SQLite throws on web, fall back to `createMemoryRepo()` and show a one-line "Web preview — changes aren't saved" note under the header (web only).

  Theme tokens (exact): light `bg #FBFAF7, surface #FFFFFF, border #ECE8E0, text #1D1B18, muted #7A756C, missing #C4BEB3, accent #1D1B18, overlay rgba(29,27,24,0.35)`; dark `bg #151412, surface #1F1D1A, border #2C2925, text #F3F0EA, muted #A19B90, missing #5A554D, accent #F3F0EA, overlay rgba(0,0,0,0.55)`.

  `sync-catalog.mjs` copies `catalog/dist/index.json` and every `catalog/dist/sets/*.json` into `apps/mobile/assets/catalog/`, then writes `src/catalog/bundled.ts` with static `require()`s for each (Metro needs static requires). Add a `"sync-catalog"` script and call it from the `prestart`, `preweb`, `preios`, `preandroid` and `pretest` scripts.

- [ ] **Step 1: Scaffold** the app and dependencies. Run `pnpm install` at the root and `npx expo-doctor` in `apps/mobile`. Expected: no blocking errors.
- [ ] **Step 2: Write the failing tests:**
  ```ts
  it('lists published sets newest first and hides drafts by default', () => {
    const c = createCatalog(bundleWith({ published: ['sv03.5'], drafts: ['sv08.5'] }), { includeDrafts: false });
    expect(c.listSets().map(s => s.id)).toEqual(['sv03.5']); expect(c.getSet('sv08.5')).toBeNull();
  });
  it('includes drafts, flagged, when asked', () =>
    expect(createCatalog(bundle, { includeDrafts: true }).listSets().map(s => [s.id, s.published])).toEqual([['sv08.5', false], ['sv03.5', true]]));
  it('renders the home screen inside the providers', async () => {
    render(<TestProviders><HomeScreen /></TestProviders>);
    expect(await screen.findByText('Add a set to start tracking')).toBeOnTheScreen();
  });
  ```
  `TestProviders` (in `src/test/TestProviders.tsx`) wires the Task 1 fixture catalog (published, via `createCatalog`) and a `CollectionStore` over `createMemoryRepo()`, and accepts an optional `store` and `priceBook`. Later tasks reuse it.
- [ ] **Step 3: Run** `pnpm --filter mobile test`. Expected: FAIL.
- [ ] **Step 4: Implement** the files above. Home shows the empty state text "Add a set to start tracking" for now.
- [ ] **Step 5: Run** the tests, `pnpm typecheck` (extend it to `apps/mobile`), and `pnpm --filter mobile exec expo export --platform web` (build check). Expected: PASS, clean, export succeeds.
- [ ] **Step 6: Commit** — `feat(mobile): Expo app scaffold with bundled catalog, local store and theme`

---

### Task 4: My Sets and Add Set screens

**Files:**
- Create: `apps/mobile/app/index.tsx` (My Sets), `apps/mobile/app/browse.tsx` (Add a set), `apps/mobile/src/components/ProgressBar.tsx`, `apps/mobile/src/components/SetRow.tsx`
- Test: `apps/mobile/src/__tests__/my-sets.test.tsx`

**Interfaces:**
- Consumes: `useCatalog`, `useTracked`, `useCounts`, `useStore`, `useTheme` (Task 3); `setProgress` (Task 1).
- Produces: `ProgressBar({ value: number /*0..1*/ })`; `SetRow({ set: CatalogSetSummary, collected: number, total: number, onPress })`. Routes: `/` and `/browse`; tapping a tracked set navigates to `/set/<id>`.

  My Sets: title "My Sets"; one `SetRow` per tracked set (logo via expo-image or the name's initials on a surface tile if no logo, name, `"<collected> of <total>"`, ProgressBar); a header button "Add set" to `/browse`; empty state "Add a set to start tracking" with the same button. Tracked sets missing from the catalog (e.g. a draft in a production build) are skipped.
  Add a set: list from `catalog.listSets()`, each row showing name, series and release year, "Draft" pill when `!published`, and a trailing "Add" button, or "Added ✓" (disabled) if already tracked. Adding calls `store.track(id)` and returns to My Sets.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it('shows the empty state with no tracked sets', ...)                        // 'Add a set to start tracking'
  it('adds a set from Browse and shows it with progress', async () => {
    // render Browse, press 'Add' on 'Fixture Set' → store.getTracked() has 'fx'; render My Sets → 'Fixture Set' and '0 of 11'
  });
  it('shows Added ✓ for sets already tracked', ...)
  it('shows progress from stored counts', ...)                                // store.setCount on 2 versions → '2 of 11'
  ```
- [ ] **Step 2: Run** `pnpm --filter mobile test my-sets`. Expected: FAIL.
- [ ] **Step 3: Implement** the screens and components with theme tokens; 16 px side gutter, rows 72 px tall.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(mobile): My Sets and Add a set screens`

---

### Task 5: Card tile, version dots and count popover

**Files:**
- Create: `apps/mobile/src/components/VersionDot.tsx`, `CardTile.tsx`, `CountPopover.tsx`, `Legend.tsx`
- Test: `apps/mobile/src/components/__tests__/card-tile.test.tsx`

**Interfaces:**
- Consumes: `VersionKind`, `CatalogCard` (catalog-core); `cardStatus`, `versionKey`, `Counts` (Task 1); `useTheme` (Task 3).
- Produces:
  ```tsx
  VersionDot({ kind: VersionKind; count: number; onTap(): void; onLongPress(): void; accessibilityLabel: string })
  CardTile({ card: CatalogCard; kindsById: Record<string, VersionKind>; counts: Counts; width: number;
             onTapVersion(kind: string): void; onLongPressVersion(kind: string): void; onOpenCard(): void })
  CountPopover({ visible: boolean; title: string; versionLabel: string; count: number; onChange(n: number): void; onClose(): void })
  Legend({ kinds: VersionKind[] })
  ```
  Dot visuals: 14 px circle inside a 24 × 28 pressable (`hitSlop` 6). Missing = 1.5 px dashed `theme.missing` border, transparent fill. Owned = filled with the kind's `color`; `color: "rainbow"` renders an `expo-linear-gradient` (`#A5B4FC → #F9A8D4 → #86EFAC → #FDE68A`, diagonal). Count ≥ 2 shows a badge (min 14 px, 9 px bold text) at the dot's top-right with the count. `delayLongPress` 350. Haptic `selectionAsync` on tap and on popover changes.
  Tile: surface card, 12 px radius, 1 px border, 6 px padding; image area 0.72 × width tall using expo-image with `contentFit="contain"`; placeholder (no URL or load error) = a `theme.border` block with the number centred. Below: number (9 px muted), name (11 px semibold, one line, ellipsis), then the dots row. `status === 'none'` → faded: image at 35 % opacity under a `theme.bg` overlay at 40 % (React Native has no greyscale filter; this reads as greyed out). `status === 'complete'` → 16 px white circle "✓" at the image's top-right. Pressing the image calls `onOpenCard`. Accessibility label per dot: `"<name> <number>, <kind label>, <count> owned"`.
  Popover: modal over `theme.overlay`, centred card 260 px wide: title, version label, a row "−  <count>  +" (44 px buttons), "Done". "−" is disabled at 0, "+" at 999.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  // fixture cards from packages/collection-core/test/fixtures/catalog.ts
  it('renders one dot per version in catalog order', ...)              // Ivysaur (c-002): getAllByRole('button', { name: /owned$/ }) length 4
  it('taps a dot to add one', ...)                                     // press 'Bulbasaur 001, Reverse Holo, 0 owned' → onTapVersion('reverse')
  it('long-presses a dot to open the counter', ...)                    // fireEvent(dot, 'longPress') → onLongPressVersion('normal')
  it('shows a count badge for spares', ...)                            // counts {..:normal: 3} → getByText('3')
  it('fades a card with nothing owned and checks a complete card', ...) // testID 'tile-faded' / 'tile-complete'
  it('shows a placeholder when the card has no image', ...)            // imageUrl null → testID 'tile-placeholder' with '001'
  it('disables minus at zero and never goes negative', ...)            // CountPopover count 0: '−' disabled; press '+' → onChange(1)
  ```
- [ ] **Step 2: Run** `pnpm --filter mobile test card-tile`. Expected: FAIL.
- [ ] **Step 3: Implement** the components.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(mobile): card tiles with version dots and count popover`

---

### Task 6: Set screen

**Files:**
- Create: `apps/mobile/app/set/[id]/index.tsx`, `apps/mobile/src/components/SetHeader.tsx`, `apps/mobile/src/components/FilterSwitch.tsx`, `apps/mobile/src/components/SetGrid.tsx`
- Test: `apps/mobile/src/__tests__/set-screen.test.tsx`

**Interfaces:**
- Consumes: Tasks 1, 3 and 5. `PriceBook`: the screen reads it from a `PriceContext` defaulting to `emptyPriceBook` (create `src/prices/PriceContext.tsx`; Plan 3 swaps the provider).
- Produces: `SetHeader({ name, collected, total, value: ReturnType<typeof setValue> })`, `FilterSwitch({ value: Filter; onChange })`, `SetGrid({ sections, counts, kindsById, filter, onTapVersion, onLongPressVersion, onOpenCard })`. Route `/set/[id]`; header-right menu button → `/set/[id]/settings`; opening a card → `/set/[id]/card/[cardId]`.

  Layout (exact copy): title = set name; subtitle `"Master set · <collected> of <total> collected"`; ProgressBar; value line `"Owned $<owned> · To finish ≈ $<toFinish>"` only when `value.hasPrices`, with a muted `"Some prices unavailable"` after it when `value.incomplete`; FilterSwitch segments `All / Missing / Have / Spares`; Legend; then `SetGrid`. Grid: a `SectionList` of rows of 3 tiles, 8 px gaps, 16 px gutters, tile width `(screenWidth − 32 − 16) / 3`. Section headers (category label, 13 px semibold muted) only for non-main sections. The filter applies within each section; sections left empty are omitted; if all are empty, show `"Nothing here yet"` (Missing → `"You have every version 🎉"` when progress is complete). Unknown set id → `"This set isn't available"` and a back button.

- [ ] **Step 1: Write the failing tests** (fixture catalog through `TestProviders`):
  ```ts
  it('shows version progress for the set', ...)                         // 'Master set · 0 of 11 collected'
  it('updates progress and the dot when a dot is tapped', ...)          // press dot → '1 of 11' and dot label '1 owned'
  it('filters to missing cards', ...)                                   // complete c-004 → Missing hides c-004 tile
  it('filters to spares', ...)                                          // count 2 on c-001:normal → only c-001 shown
  it('sets a count from the long-press popover', ...)                   // longPress → '+' ×2 → Done → '2 owned'
  it('hides the value line when no prices are known', ...)              // queryByText(/Owned \$/) is null
  it('shows the value line with a price book', ...)                     // PriceContext with prices → 'Owned $…'
  it('shows a section header for the promos category', ...)             // 'Promos & stamped'
  it('handles an unknown set id', ...)                                  // "This set isn't available"
  ```
- [ ] **Step 2: Run** `pnpm --filter mobile test set-screen`. Expected: FAIL.
- [ ] **Step 3: Implement** the screen. Use `useCounts(id)` and memoise sections and filtered rows on `[catalog, counts, hidden, filter]`. Popover state lives in the screen (`{ cardId, kind } | null`).
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(mobile): set screen with progress, filters and marking`

---

### Task 7: Set settings and card detail

**Files:**
- Create: `apps/mobile/app/set/[id]/settings.tsx`, `apps/mobile/app/set/[id]/card/[cardId].tsx` (presented as a modal)
- Test: `apps/mobile/src/__tests__/settings-and-detail.test.tsx`

**Interfaces:**
- Consumes: `useStore`, `useTracked`, `useCounts`, `useCatalog`, `PriceContext`, `CountPopover`'s stepper styling (extract a shared `Stepper` component from Task 5 if needed — keep `CountPopover`'s props unchanged).

  Settings: title "Set settings". A "Show in this set" list with one switch per category in `sortOrder`. The main category's switch is on and disabled, with the helper text "Always shown". Toggling calls `store.setHidden`. A destructive-styled row "Remove from My Sets" opens a confirm alert ("Your marks are kept if you add it again.") that calls `store.untrack` and returns to My Sets.
  Card detail: large image (expo-image, contain, placeholder as in Task 5), name, `"<number> · <rarity>"` (rarity omitted if null), category label if not main. Then one row per version: dot (non-interactive), kind label, price (`$x.xx` or "—"), and a −/count/+ stepper (same rules as the popover). Spares line under the rows when any: `"<n> spare(s) to trade"`.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it('hides a category and removes it from progress', ...)        // toggle promos off → set screen '… of 10'
  it('keeps the main category always on', ...)                    // main switch disabled
  it('removes a set but keeps its marks', ...)                    // untrack → re-add → counts intact
  it('changes counts from card detail', ...)                      // '+' on Reverse Holo → '1 owned' on set screen dot
  it('shows — for unknown prices and the spares line', ...)       // '—' ; count 3 → '2 spares to trade'
  ```
- [ ] **Step 2: Run** `pnpm --filter mobile test settings-and-detail`. Expected: FAIL.
- [ ] **Step 3: Implement** both screens.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(mobile): set settings and card detail`

---

### Task 8: Run it, check it, document it

**Files:**
- Create: `apps/mobile/README.md` (run on a phone with Expo Go via `pnpm --filter mobile start`; web preview via `pnpm --filter mobile web`; how the catalog is bundled; drafts in dev only)
- Modify: root `README.md` (create if missing: what the project is, packages, how to run tests and the app)

- [ ] **Step 1: Start the web build** (`pnpm --filter mobile web`, port 8081) and open it in the browser pane at phone width (375 × 812), light and dark.
- [ ] **Step 2: Walk the flow** and screenshot each step: empty My Sets → Add a set (both drafts visible, marked Draft) → add 151 → set screen → tap a Normal dot twice (badge "2") → long-press a dot, set 3, Done → filter Spares → open a card → settings: hide Promos & stamped → back (progress total drops by 4) → remove from My Sets → re-add (marks kept). Expected: every step behaves as described in Tasks 4–7, with no console errors. If expo-sqlite fails on web, the "Web preview — changes aren't saved" note shows and the flow still works in memory. Record which happened.
- [ ] **Step 3: Fix** anything the walkthrough exposes, each fix with a test where the behaviour is testable.
- [ ] **Step 4: Run** `pnpm test` and `pnpm typecheck` at the root. Expected: all green.
- [ ] **Step 5: Commit** — `docs(mobile): how to run the app; walkthrough fixes`. Save the screenshots under `docs/screenshots/plan-2/` and commit them so the owner can see the result on GitHub.
