# Plan 3 — Accounts, Sync and Prices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collectors sign in (Apple, Google, or a 6-digit email code) before using the app. Their marks and tracked sets back up to Supabase and sync across devices, offline-first. The set header and card detail show daily market prices.

**Architecture:** The phone's SQLite stays the source of truth. Local rows carry a `dirty` flag. A pure `SyncEngine` in `packages/collection-core` pushes dirty rows to a Supabase RPC that applies last-write-wins by the row's `updated_at`, then pulls rows changed since a per-user cursor (a server-side sequence) and applies them locally the same way. Postgres schema, RLS and RPCs live in `supabase/migrations` and are tested in Node with PGlite. A scheduled Supabase Edge Function refreshes USD market prices from TCGdex into `card_prices`; the app caches prices per tracked set in SQLite and serves them through the existing `PriceBook`. Sign-in uses native Apple / Google ID tokens (`signInWithIdToken`) and Supabase email OTP, so the app now runs as an Expo **development build**, not Expo Go.

**Tech Stack:** Supabase (Postgres 17, Auth, Edge Functions on Deno, pg_cron + pg_net), `@supabase/supabase-js` 2.119, Supabase CLI via `npx supabase` (v3), `@electric-sql/pglite` 0.5 (SQL tests), expo-dev-client 58, expo-apple-authentication 58, `@react-native-google-signin/google-signin` 17, expo-secure-store 58, expo-crypto 58, `@react-native-community/netinfo` 12. Existing: Expo SDK 58, RN 0.88, vitest, jest-expo.

**Spec:** `docs/superpowers/specs/2026-11-14-master-set-tracker-design.md` (§2 sync goal, §5.5 prices, §5.6 architecture: accounts and offline; §5.7 data model). **Owner setup:** `docs/setup/accounts-and-backend.md`. Tasks 1–8 need none of it; Task 9 needs all of it.

## Owner decisions (2026-11-16) and deviations from the spec

- **Sign-in is required.** A signed-out user sees only the sign-in screen. After the first sign-in the session is persisted, so the app (including offline trading in Plan 4) works without a connection.
- **All three methods now:** Apple, Google and email. Email uses a **6-digit code** instead of the spec's magic link (builder's call: no deep-link plumbing, and the code works when the email is read on another device).
- **Account deletion** is included because the App Store requires in-app deletion for apps that create accounts.

## Global Constraints

- Local SQLite is the source of truth. Every user write goes through `CollectionStore`, which marks rows dirty. Sync never blocks a tap.
- **Conflict rule:** last-write-wins per row by the client `updated_at` (ISO-8601 UTC, millisecond precision). On an exact tie, the server's row wins. Applies to `collection(user, card_id, kind)` and `tracked_sets(user, set_id)`.
- **Pull cursor:** a monotonically increasing `server_seq` (one global Postgres sequence, set by trigger on every insert/update). Pages hold 1000 rows, ordered by `server_seq`.
- Counts are 0..999 on the server too (`CHECK`). Rows are never hard-deleted: a count of 0 and `removed_at` are the tombstones.
- The hosted project has "Automatically expose new tables" **off**, so migrations must grant access explicitly: revoke all from `anon` on every new table and function; grant `authenticated` exactly what it needs (select/insert/update on the sync tables, select on `card_prices`, execute on `push_changes` / `pull_changes`). Migrations also enable RLS on every table themselves; they don't rely on the project's automatic-RLS trigger. The PGlite harness creates `anon`, `authenticated` and `service_role` roles so these grants are tested.
- RLS: a user can read and write only rows where `user_id = auth.uid()`. `card_prices` is readable by any authenticated user and writable only by the service role.
- **Secrets:** the anon key, Supabase URL and Google client IDs are public `EXPO_PUBLIC_*` values in `apps/mobile/.env` (git-ignored; `.env.example` committed). The service-role key is never in the repo or the app; Edge Functions read it from their environment.
- **Session storage:** expo-secure-store via a chunking adapter (values over 1800 bytes are split).
- **Prices:** USD TCGplayer `marketPrice` from TCGdex. Kind → TCGdex variant: `normal` → `normal`; `holo` → `holofoil`; `reverse` → `reverse-holofoil`; `single` → `holofoil`, falling back to `normal`; `pokeball` / `masterball` → none (unknown, shown "—"). Stamped / promo extra cards (ids containing `-stamp-`) → none. Prices refresh daily at 09:00 UTC. The app refetches a set's prices when its cache is older than 12 h and the device is online.
- **Sign-out:** sync first. If dirty rows remain, confirm: "<n> changes haven't synced yet and will be lost. Sign out anyway?" Then wipe the local collection, tracked sets, sync state and price cache.
- The app's bundle identifier comes from `.env` (`APP_BUNDLE_ID`) via `app.config.ts`, so it isn't hard-coded before the owner chooses it.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `pnpm test` and `pnpm typecheck` stay green after every task.

## Review Focus

1. **Two devices edit the same card while one is offline.** Expected: after both sync, both devices show the version with the later `updated_at`. Neither count is summed or lost silently, and a stale push can't overwrite a newer server row. → Task 1 SQL test + Task 4 engine test.
2. **A sync is interrupted mid-way** (network drops after push, or partway through paging the pull). Expected: nothing is marked clean that the server didn't accept; the cursor only advances past rows actually applied; the next sync completes without duplicates or gaps. → Task 4 tests.
3. **A user taps while a sync is running.** Expected: the new tap stays dirty and is pushed next time, even if the in-flight push carried an older value of the same row. → Task 3 (`markSynced` only clears rows whose `updated_at` still matches) + Task 4 test.
4. **Signing out with unsynced changes, then a different person signs in on the same phone.** Expected: the warning is shown, and the second person never sees the first person's marks. → Task 8 test.
5. **TCGdex is missing a price or a whole card** (404, `pricing` absent, a 503 mid-run). Expected: those versions show "—"; other prices still refresh; the job logs and continues without writing zeros. → Task 2 tests.

---

### Task 1: Supabase schema, RLS and sync RPCs (tested with PGlite)

**Files:**
- Create: `supabase/config.toml` (`npx supabase init`), `supabase/migrations/20261116000001_sync.sql`
- Create: `packages/supabase-tests/` (package `@mst/supabase-tests`, vitest, `@electric-sql/pglite`), `src/harness.ts`, `test/sync.test.ts`
- Modify: root `typecheck` to include it

**Interfaces:**
- Produces (SQL):
  ```sql
  create sequence public.sync_seq;
  profiles(user_id uuid pk references auth.users on delete cascade, display_name text, share_code text unique not null, created_at timestamptz default now())
  tracked_sets(user_id uuid references auth.users on delete cascade, set_id text, hidden_category_ids jsonb not null default '[]',
               added_at timestamptz not null, removed_at timestamptz, updated_at timestamptz not null, server_seq bigint not null, primary key (user_id, set_id))
  collection(user_id uuid references auth.users on delete cascade, card_id text, kind text, set_id text not null,
             count int not null check (count between 0 and 999), updated_at timestamptz not null, server_seq bigint not null, primary key (user_id, card_id, kind))
  -- trigger on both tables: before insert or update → new.server_seq := nextval('public.sync_seq')
  -- trigger on auth.users insert → insert profiles(user_id, share_code = 10 chars from [a-z0-9] excluding 0/o/1/l)
  -- index (user_id, server_seq) on both tables; RLS enabled; policies select/insert/update for user_id = auth.uid()
  function public.push_changes(p_collection jsonb, p_tracked jsonb) returns jsonb   -- security invoker
    -- each element: {card_id, kind, set_id, count, updated_at} / {set_id, hidden_category_ids, added_at, removed_at, updated_at}
    -- upsert for auth.uid(); on conflict update only when excluded.updated_at > existing.updated_at
    -- returns {"collection_applied": n, "tracked_applied": n}
  function public.pull_changes(p_cursor bigint, p_limit int default 1000) returns jsonb
    -- {"collection": [...rows with server_seq > p_cursor], "tracked": [...], "next_cursor": bigint, "has_more": bool}
    -- rows from both tables merged by server_seq ascending, up to p_limit total; next_cursor = last returned server_seq (or p_cursor when empty)
  ```
- Produces (TS, `packages/supabase-tests/src/harness.ts`): `createDb(): Promise<PGlite>` (creates an `auth` schema stub: `auth.users(id uuid pk, email text)`, `auth.uid()` reading `current_setting('request.jwt.claim.sub', true)::uuid`, roles `authenticated` / `service_role`, then applies every file in `supabase/migrations` in order); `asUser(db, userId, fn)` (sets the role and the jwt claim for the duration of `fn`).

- [ ] **Step 1: Scaffold** `supabase/` with `npx supabase init` (no Docker needed for init) and the test package.
- [ ] **Step 2: Write the failing tests:**
  ```ts
  it('creates a profile with a 10-char share code on signup', ...)
  it('lets a user read and write only their own rows', ...)          // user B's select returns 0 of A's rows; B's push for A's key changes nothing of A's
  it('applies newer client rows and ignores older ones', async () => {
    // push count 2 @ t2; push count 5 @ t1 (older) → stays 2; push count 3 @ t3 → 3
  });
  it('keeps the server row on an exact updated_at tie', ...)
  it('rejects counts outside 0..999', ...)
  it('assigns increasing server_seq and pulls only rows after the cursor', ...)
  it('pages pulls by p_limit across both tables with has_more', ...)  // 3 collection + 2 tracked, limit 4 → 4 rows, has_more true; then 1 row, has_more false
  it('round-trips a removed tracked set and its hidden categories', ...)
  ```
- [ ] **Step 3: Run** `pnpm --filter @mst/supabase-tests test`. Expected: FAIL.
- [ ] **Step 4: Implement** the migration and harness.
- [ ] **Step 5: Run** the tests and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** — `feat(backend): sync schema, RLS and push/pull RPCs`

---

### Task 2: Daily prices backend

**Files:**
- Create: `supabase/migrations/20261116000002_prices.sql`
- Create: `supabase/functions/_shared/prices.ts` (pure: no Deno or Node APIs), `supabase/functions/refresh-prices/index.ts` (Deno entry)
- Test: `packages/supabase-tests/test/prices.test.ts` (imports `_shared/prices.ts`; SQL via PGlite)

**Interfaces:**
- Produces (SQL):
  ```sql
  price_sets(set_id text pk, tcgdex_set_id text not null, enabled bool not null default true)   -- seeded: ('sv03.5','sv03.5'), ('sv08.5','sv08.5')
  card_prices(card_id text, variant text check (variant in ('normal','holofoil','reverse-holofoil')), set_id text not null,
              usd numeric(10,2) not null check (usd >= 0), source_updated_at timestamptz, fetched_at timestamptz not null default now(),
              primary key (card_id, variant))
  -- RLS: select for authenticated; no insert/update policies (service role bypasses RLS)
  -- pg_cron: daily at '0 9 * * *' → net.http_post to the refresh-prices function URL with the service-role bearer from vault
  --   (schedule created by a guarded DO block that is a no-op when pg_cron/pg_net/vault are absent, so PGlite tests still apply the file)
  ```
- Produces (TS, `_shared/prices.ts`):
  ```ts
  export type Variant = 'normal' | 'holofoil' | 'reverse-holofoil';
  export interface PriceRow { card_id: string; set_id: string; variant: Variant; usd: number; source_updated_at: string | null }
  export function pricesFromTcgdexCard(setId: string, card: unknown): PriceRow[];   // tcgplayer.<variant>.marketPrice; skips null/absent/non-finite/negative
  export async function refreshSet(opts: { setId: string; tcgdexSetId: string; fetchJson(path: string): Promise<unknown>; concurrency?: number /*default 6*/ }):
    Promise<{ rows: PriceRow[]; failedCards: string[] }>;                            // a failing card is recorded, not thrown
  ```
  `index.ts`: reads enabled `price_sets` with the service-role client, runs `refreshSet` per set, upserts rows (one statement per set), logs `{setId, rows, failed}`, returns 200 with a JSON summary. A set whose card-list fetch fails is skipped and reported (status 207 if any set failed). Never deletes rows; never writes 0 for a missing price.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it('maps tcgplayer market prices to variants', ...)           // fixture shaped like the real sv08.5-001 response: normal 0.05, reverse-holofoil 0.13
  it('skips variants with no or non-numeric market price', ...)
  it('records a 404 card as failed and keeps the rest', ...)
  it('applies the prices migration and only service role can write', ...)   // authenticated insert → error; select → ok
  ```
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement**, keeping `_shared/prices.ts` free of runtime-specific imports.
- [ ] **Step 4: Run** the tests and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(backend): daily TCGdex price refresh`

---

### Task 3: Local sync and price-cache storage

**Files:**
- Modify: `packages/collection-core/src/db/migrations.ts` (step 3), `src/db/sql-db.ts`, `src/db/sqlite-repo.ts`, `src/db/memory-repo.ts`, `src/store.ts`
- Create: `packages/collection-core/src/sync/types.ts`, `src/prices/price-cache.ts`, `src/prices/price-variant.ts`
- Test: extend `test/repo.contract.ts`, `test/store.test.ts`, `test/migrations.test.ts`; new `test/prices.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // sync/types.ts
  export interface CollectionRow { cardId: string; kind: string; setId: string; count: number; updatedAt: string }
  export interface TrackedRow { setId: string; hiddenCategoryIds: string[]; addedAt: string; removedAt: string | null; updatedAt: string }
  export interface LocalChanges { collection: CollectionRow[]; tracked: TrackedRow[] }
  // CollectionRepo additions
  dirtyChanges(limit: number): LocalChanges;                      // oldest updatedAt first, at most `limit` rows in total
  markSynced(changes: LocalChanges): void;                       // clears dirty only where the stored updatedAt still equals the pushed one
  applyRemote(changes: LocalChanges): { affectedSetIds: string[] };   // one transaction; LWW: apply when remote.updatedAt > local.updatedAt,
                                                                       // or the local row is absent; applied rows are stored clean
  getSyncState(): { cursor: number; lastSyncedAt: string | null };
  setSyncState(s: { cursor: number; lastSyncedAt: string | null }): void;
  dirtyCount(): number;
  wipe(): void;                                                  // deletes collection, tracked_sets, sync_state, prices rows (one transaction)
  // CollectionStore additions
  applyRemote(changes: LocalChanges): void;                      // refreshes caches for affected sets, emits once
  wipe(): void;
  // prices
  export function priceVariantFor(cardId: string, kind: string): Array<'normal' | 'holofoil' | 'reverse-holofoil'>;  // ordered fallbacks; [] = unknown
  export interface PriceCache {
    get(setId: string): { fetchedAt: string; prices: Record<string, number> } | null;   // key `${cardId}|${variant}`
    put(setId: string, fetchedAt: string, prices: Record<string, number>): void;
  }
  export function createSqlitePriceCache(db: SqlDb): PriceCache; export function createMemoryPriceCache(): PriceCache;
  export function priceBookFromCache(cache: PriceCache, setIds: string[]): PriceBook;   // implements PriceBook.price via priceVariantFor
  ```
  Schema v3 (one transaction): `collection.dirty INTEGER NOT NULL DEFAULT 1`; `tracked_sets.dirty INTEGER NOT NULL DEFAULT 1` (existing rows become dirty, so the first sign-in uploads them); `sync_state(id INTEGER PRIMARY KEY CHECK (id = 1), cursor INTEGER NOT NULL, last_synced_at TEXT)`; `prices(set_id TEXT PRIMARY KEY, fetched_at TEXT NOT NULL, json TEXT NOT NULL)`. Every existing repo write path sets `dirty = 1`.

- [ ] **Step 1: Write the failing tests** (contract on both repos where applicable):
  ```ts
  it('marks local writes dirty and lists them oldest first', ...)
  it('markSynced leaves a row dirty if it changed after the push snapshot', ...)   // Review Focus 3
  it('applyRemote applies newer rows, ignores older ones, and stores them clean', ...)
  it('applyRemote revives and removes tracked sets with their hidden categories', ...)
  it('applyRemote refreshes only affected sets and emits once', ...)               // store test
  it('wipe clears everything including sync state and prices', ...)
  it('migrates v2 → v3 keeping rows and marking them dirty', ...)
  it('maps kinds to price variants with fallbacks', ...)   // single → ['holofoil','normal']; pokeball → []; 'sv08.5-006-stamp-set-logo' → []
  it('prices a version from the cache and returns null when unknown', ...)
  ```
- [ ] **Step 2: Run** `pnpm --filter @mst/collection-core test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(collection): dirty tracking, remote apply and price cache`

---

### Task 4: Sync engine

**Files:**
- Create: `packages/collection-core/src/sync/engine.ts`
- Test: `packages/collection-core/test/sync-engine.test.ts` (fake remote implementing LWW like Task 1, in memory)

**Interfaces:**
- Consumes: Task 3 repo/store additions.
- Produces:
  ```ts
  export interface SyncRemote {
    push(changes: LocalChanges): Promise<void>;
    pull(cursor: number, limit: number): Promise<{ changes: LocalChanges; nextCursor: number; hasMore: boolean }>;
  }
  export type SyncStatus = { state: 'idle' | 'syncing' | 'offline' | 'error'; lastSyncedAt: string | null; pending: number; error?: string };
  export class SyncEngine {
    constructor(opts: { repo: CollectionRepo; store: CollectionStore; remote: SyncRemote; now?: () => string; pushBatch?: number /*500*/; pullLimit?: number /*1000*/ });
    syncNow(): Promise<SyncStatus>;            // concurrent calls share one in-flight run, then one follow-up run if writes happened meanwhile
    subscribe(listener: (s: SyncStatus) => void): () => void;
    getStatus(): SyncStatus;
    setOnline(online: boolean): void;          // offline → state 'offline', syncNow() resolves immediately without network
  }
  ```
  Order: push dirty in batches (snapshot → `remote.push` → `repo.markSynced(snapshot)`), then pull pages (`store.applyRemote(page.changes)` then `repo.setSyncState({ cursor: page.nextCursor })`) until `hasMore` is false, then set `lastSyncedAt`. Any thrown error stops the run: state `error`, nothing further marked synced, the cursor left at the last fully applied page. Errors whose message looks like a network failure set `offline` instead.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it('uploads local changes on first sync and downloads remote ones', ...)
  it('resolves a two-device conflict by latest updatedAt on both devices', ...)   // Review Focus 1: two engines, one fake server
  it('keeps changes dirty when push fails and retries next time', ...)           // Review Focus 2
  it('advances the cursor only past applied pages when a pull page fails', ...)  // Review Focus 2
  it('pushes a tap made during an in-flight sync on the follow-up run', ...)     // Review Focus 3
  it('pages pulls until has_more is false', ...)
  it('reports offline and does no network work when offline', ...)
  it('coalesces concurrent syncNow calls', ...)
  ```
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(collection): offline-first sync engine`

---

### Task 5: Supabase client, session storage and remote adapter in the app

**Files:**
- Create: `apps/mobile/.env.example`, `apps/mobile/app.config.ts` (replaces `app.json`: same values plus `ios.bundleIdentifier` / `android.package` from `APP_BUNDLE_ID`, `ios.usesAppleSignIn: true`, plugins `expo-dev-client`, `expo-apple-authentication`, `expo-secure-store`, `@react-native-google-signin/google-signin` with `iosUrlScheme` derived from `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`)
- Create: `apps/mobile/src/backend/config.ts`, `src/backend/secure-storage.ts`, `src/backend/supabase.ts`, `src/backend/supabase-remote.ts`
- Test: `apps/mobile/src/backend/__tests__/*.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // config.ts — throws a clear error listing missing names when any are unset
  export const backendConfig: { supabaseUrl: string; supabaseAnonKey: string; googleIosClientId: string; googleWebClientId: string };
  // secure-storage.ts — supabase-js storage adapter over expo-secure-store; values > 1800 bytes split into `<key>.0..n` + `<key>.n` count
  export const secureStorage: { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void>; removeItem(k: string): Promise<void> };
  // supabase.ts
  export function getSupabase(): SupabaseClient;    // singleton; auth: { storage: secureStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false }
  // supabase-remote.ts
  export function createSupabaseRemote(client: SupabaseClient): SyncRemote;   // push → rpc('push_changes') mapping camelCase↔snake_case; pull → rpc('pull_changes')
  export async function fetchSetPrices(client: SupabaseClient, setId: string): Promise<Record<string, number>>;   // select card_id, variant, usd where set_id
  ```
  `.env.example` lists `APP_BUNDLE_ID=`, `EXPO_PUBLIC_SUPABASE_URL=`, `EXPO_PUBLIC_SUPABASE_ANON_KEY=`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=` with one-line comments pointing to `docs/setup/accounts-and-backend.md`. The jest setup provides fake env values.

- [ ] **Step 1: Write the failing tests:** chunked storage round-trips a 5 KB value and removes all chunks; config lists the missing names; the remote maps rows both ways and passes the cursor and limit; `fetchSetPrices` builds `cardId|variant` keys.
- [ ] **Step 2: Run** `pnpm --filter mobile test backend`. Expected: FAIL.
- [ ] **Step 3: Implement.** Install packages with `npx expo install`. Run `npx expo-doctor`.
- [ ] **Step 4: Run** the tests and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(mobile): Supabase client, secure session storage, sync remote`

---

### Task 6: Sign-in

**Files:**
- Create: `apps/mobile/src/auth/AuthProvider.tsx`, `src/auth/providers.ts`, `app/sign-in.tsx`, `app/sign-in-email.tsx`
- Modify: `apps/mobile/app/_layout.tsx` (gate: no session → only the sign-in routes)
- Test: `apps/mobile/src/__tests__/sign-in.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export function AuthProvider(props: { client: SupabaseClient; children: React.ReactNode }): JSX.Element;
  export function useAuth(): { status: 'loading' | 'signedOut' | 'signedIn'; userId: string | null; email: string | null; provider: string | null };
  // providers.ts
  export async function signInWithApple(client: SupabaseClient): Promise<void>;   // expo-crypto random nonce → SHA-256 → AppleAuthentication.signInAsync({ nonce: hashed, requestedScopes: [FULL_NAME, EMAIL] }) → client.auth.signInWithIdToken({ provider: 'apple', token: identityToken, nonce: raw })
  export async function signInWithGoogle(client: SupabaseClient): Promise<void>;  // GoogleSignin.configure({ iosClientId, webClientId }) → signIn() → signInWithIdToken({ provider: 'google', token: idToken })
  export async function sendEmailCode(client: SupabaseClient, email: string): Promise<void>;          // signInWithOtp({ email, options: { shouldCreateUser: true } })
  export async function verifyEmailCode(client: SupabaseClient, email: string, code: string): Promise<void>;   // verifyOtp({ email, token: code, type: 'email' })
  ```
  Sign-in screen (exact copy): app name "Master Set Tracker"; tagline "Track every version of every card."; buttons in order: the native Apple button (`AppleAuthentication.AppleAuthenticationButton`, shown only on iOS when `isAvailableAsync()`), "Continue with Google", "Continue with email". The footer is muted: "Your marks are saved to your account so they're safe on every device." User cancellation (Apple `ERR_REQUEST_CANCELED`, Google `SIGN_IN_CANCELLED`) shows nothing. Other errors show "Couldn't sign in. Check your connection and try again." Email screen: email field → "Send code" → 6-digit field (`textContentType="oneTimeCode"`, auto-submits at 6 digits) → "Verify". "Resend code" is enabled after 60 s. A wrong code shows "That code didn't work. Check it and try again."
  Gate: while `loading`, render the existing splash; `signedOut` → `/sign-in`; `signedIn` → the app.

- [ ] **Step 1: Write the failing tests** with `expo-apple-authentication`, `@react-native-google-signin/google-signin` and the Supabase client mocked: Apple success calls `signInWithIdToken` with the raw nonce; cancellations show no error; Google success; email send → verify → signed in; wrong code message; resend disabled for 60 s (fake timers); the gate shows sign-in when signed out and My Sets when signed in.
- [ ] **Step 2: Run** `pnpm --filter mobile test sign-in`. Expected: FAIL.
- [ ] **Step 3: Implement.** Existing app tests wrap in a signed-in `AuthProvider` mock via `TestProviders` (add an `auth` option defaulting to signed in).
- [ ] **Step 4: Run** `pnpm test` and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(mobile): sign in with Apple, Google or an email code`

---

### Task 7: Sync and prices wiring

**Files:**
- Create: `apps/mobile/src/sync/SyncProvider.tsx`, `src/components/SyncStatusLine.tsx`, `src/prices/usePriceRefresh.ts`
- Modify: `apps/mobile/src/db/openStore.ts` (expose the repo and a price cache), `app/_layout.tsx` (SyncProvider inside AuthProvider when signed in; PriceProvider fed by `priceBookFromCache`), `app/index.tsx` (status line under the title)
- Test: `apps/mobile/src/__tests__/sync.test.tsx`

**Interfaces:**
- Consumes: `SyncEngine` (Task 4), `createSupabaseRemote`, `fetchSetPrices` (Task 5), `useAuth` (Task 6), price cache (Task 3).
- Produces: `SyncProvider({ engine, children })`; `useSyncStatus(): SyncStatus`; `useSyncNow(): () => Promise<void>`; `SyncStatusLine()`.
  Triggers: on sign-in; on app foreground (`AppState` → `active`); when NetInfo reports connected after being offline; 2 s after the last local write (subscribe to the store; debounce); every 15 min while foregrounded. Status line copy (12 px muted, under "My Sets"): syncing → "Syncing…"; idle with lastSyncedAt → "Synced <relative time>" ("just now" under 1 min, "5 min ago", "2 h ago", or a date); offline → "Offline — changes will sync when you're back online"; error → "Couldn't sync — will retry". Pending > 0 while idle appends " · <n> to sync".
  Prices: for each tracked set, if the cache is missing or older than 12 h and online, fetch and `put`. The `PriceBook` is rebuilt from the cache after each put, so the set header's value line appears once prices exist.

- [ ] **Step 1: Write the failing tests** (fake engine/remote, fake timers, NetInfo and AppState mocked): sync runs on sign-in; a local tap triggers a sync after 2 s; the offline → online transition triggers a sync; status line copy for each state; prices fetched for tracked sets and the value line shows on the set screen; a fresh (< 12 h) cache skips the fetch.
- [ ] **Step 2: Run** `pnpm --filter mobile test sync`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(mobile): background sync and daily prices`

---

### Task 8: Account screen, sign-out and account deletion

**Files:**
- Create: `apps/mobile/app/account.tsx`, `supabase/functions/delete-account/index.ts`
- Modify: `apps/mobile/app/index.tsx` (header button "Account", person glyph, label "Account")
- Test: `apps/mobile/src/__tests__/account.test.tsx`; `packages/supabase-tests/test/delete.test.ts` (cascade: deleting the auth user removes profiles, tracked_sets and collection rows)

**Interfaces:**
- Produces: route `/account`. Content: signed-in email (or "Signed in with Apple" when the email is a private relay address), the `SyncStatusLine`, "Sync now", "Sign out", and a destructive "Delete account".
  - Sign out: `syncNow()`; if `repo.dirtyCount() > 0`, confirm with the constraint copy; then `client.auth.signOut()`, `store.wipe()`, and route to `/sign-in`.
  - Delete account: confirm "Delete your account? This permanently deletes your account and every mark you've saved, on all devices. This can't be undone." → `client.functions.invoke('delete-account')` → `store.wipe()` → sign out. The Edge Function verifies the caller's JWT and calls `auth.admin.deleteUser(callerId)` with the service-role client. Rows go via cascade.
  - Errors: "Couldn't delete your account. Check your connection and try again." Nothing is wiped on failure.

- [ ] **Step 1: Write the failing tests:** sign-out with nothing pending signs out and wipes; sign-out with pending shows the warning and Cancel keeps everything; after sign-out with a different user signing in, My Sets is empty (Review Focus 4); delete success wipes and signs out; delete failure keeps data and shows the error; the SQL cascade test.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat: account screen with sign-out and account deletion`

---

### Task 9: Deploy and verify live (needs the owner's setup)

**Prerequisite:** the owner has completed `docs/setup/accounts-and-backend.md` steps 1–6 (`apps/mobile/.env` filled; `npx supabase login` done; CocoaPods installed). If anything is missing, stop and list exactly what's missing. Do not work around it.

**Files:**
- Modify: `apps/mobile/README.md`, root `README.md` (development build instructions, `.env`, backend deploy commands)
- Create: `docs/screenshots/plan-3/`

- [ ] **Step 1: Deploy the backend:** the owner does `docs/setup/accounts-and-backend.md` step 7 themselves, because it involves the database password and the price-refresh secret: `npx supabase link --project-ref <ref>` and `npx supabase db push` (typing the database password when prompted); generating `REFRESH_PRICES_SECRET` (`openssl rand -hex 32`), `npx supabase secrets set REFRESH_PRICES_SECRET=<value>`, and in the SQL editor `select vault.create_secret('<same value>', 'refresh_prices_secret');` and `select vault.create_secret('https://<ref>.supabase.co/functions/v1/refresh-prices', 'refresh_prices_url');` (before `db push`, so the migration creates the schedule); then `npx supabase functions deploy refresh-prices` and `npx supabase functions deploy delete-account`. The service-role key is never copied anywhere. Claude never sees either secret or the password, and only verifies: `cron.job` lists `refresh-prices-daily`; after the owner's one-off `net.http_post` call (guide step 7.6, which reads both Vault secrets inside the database) `card_prices` has rows for both sets.
- [ ] **Step 2: Build and run** the development build on the iPhone 17 Pro simulator: `pnpm --filter mobile exec expo run:ios`. Expected: it launches to the sign-in screen.
- [ ] **Step 3: The owner signs in** in the simulator with each method they want verified. Claude never types credentials or codes. Then verify: the existing local marks uploaded on first sign-in; tap a dot → "Synced just now" within ~3 s; the set header shows "Owned $… · To finish ≈ $…".
- [ ] **Step 4: Second device:** run the same build on a second simulator (iPhone 17); the owner signs in with the same account. The tracked sets and marks appear. Mark a card on device A → it appears on device B after foregrounding B. Conflict check: with B in the background, set a version to 2 on A, then bring B forward and, before it finishes syncing, set the same version to 3 on B. After both sync ("Sync now" on each), both show 3, the later write. Both simulators share the Mac's network, so a true offline partition is covered by the Task 4 engine tests rather than here.
- [ ] **Step 5: Sign out on B** with a pending change (warning shown); sign back in (marks return from the server).
- [ ] **Step 6: Screenshots:** sign-in, email code, My Sets with the sync line, set screen with prices, card detail with prices, account. Fix anything found (with tests where testable), update the READMEs, run `pnpm test` / `pnpm typecheck`, and commit — `docs: deploy notes, live verification and screenshots`.
