# Master Set Tracker — mobile app

The Expo app (package name `mobile`): My Sets, Add a set, the set grid with
version dots, set settings and card detail. Expo SDK 58 with expo-router;
marks are saved on the device in SQLite.

All commands below run from the repository root. Run `pnpm install` once first.

## Run it

### iPhone simulator (Mac with Xcode)

```sh
pnpm --filter mobile ios
```

This builds a development build (`expo run:ios`, which generates the git-ignored
`apps/mobile/ios` folder) and opens it on the booted simulator. Marks are
saved in real SQLite, so they survive closing and reopening the app.

Sign in with Apple is enabled automatically once `APP_BUNDLE_ID` is filled in
`apps/mobile/.env` (it needs an Apple Developer account and code signing).
Without it the simulator build works with email and Google sign-in only. After
changing `APP_BUNDLE_ID`, rebuild: `rm -rf apps/mobile/ios && pnpm --filter mobile ios`.

### Expo Go on your phone

```sh
pnpm --filter mobile start
```

Install **Expo Go** from the App Store or Google Play, then scan the QR code
the command prints (iPhone: with the Camera app; Android: from inside Expo
Go). The phone and the computer must be on the same Wi-Fi network.

### Web preview

```sh
pnpm --filter mobile web
```

Opens the app in a browser at <http://localhost:8081>. Use the browser's
device toolbar at phone width (e.g. 375 × 812). The browser can't open the
SQLite database here, so the app keeps marks in memory and shows
"Web preview — changes aren't saved" at the top of My Sets. Everything works,
but a reload starts from empty. Use the simulator or a phone to check saving.

## Development build

The app needs a development build (it uses native modules, so Expo Go isn't enough for Apple/Google sign-in). With **Xcode 26.3**:

- The Swift 6 concurrency checks reject `expo-modules-jsi@58.0.23`, so the repo carries a pnpm patch at `patches/expo-modules-jsi@58.0.23.patch` (registered under `pnpm.patchedDependencies` in the root `package.json`). Remove the patch once Expo ships a fix.
- Sign in with Apple is only compiled in when `APP_BUNDLE_ID` is set, so simulator builds need no signing.
- Build and launch on the booted simulator: `pnpm --filter mobile ios`.
- Second simulator (to test sync between two devices): boot it, then install the built app and open the dev client:

  ```sh
  xcrun simctl install <UDID> path/to/MasterSetTracker.app   # the .app from DerivedData / apps/mobile/ios/build
  xcrun simctl openurl <UDID> <dev client URL printed by `pnpm --filter mobile start`>
  ```

## Plan 3 live check

Run against a hosted Supabase project on two iPhone simulators with email sign-in only: sign-in with an emailed code, two-way sync between the devices, card prices on the set screen, local-scope sign-out, and re-sign-in all worked. Screenshots are in [`../../docs/screenshots/plan-3/`](../../docs/screenshots/plan-3/); setup notes (SMTP, code length, deploy) are in [`docs/setup/accounts-and-backend.md`](../../docs/setup/accounts-and-backend.md).

## The card catalog

The app doesn't download card lists. It ships with the catalog built by
`pnpm catalog build` (see [`catalog/README.md`](../../catalog/README.md)):

- `scripts/sync-catalog.mjs` copies `catalog/dist/index.json` and
  `catalog/dist/sets/*.json` into `assets/catalog/` and regenerates
  `src/catalog/bundled.ts`, which `require`s each file so Metro bundles it.
- It runs automatically before `start`, `ios`, `android`, `web` and `test`.
  Run it by hand with `pnpm --filter mobile sync-catalog`.
- Card images and set logos are loaded from the URLs in the catalog, so they
  need a network connection the first time.

### Draft sets

A set is **published** when it is listed in `catalog/dist/index.json`. Sets
that have a built file in `catalog/dist/sets/` but aren't published yet are
**drafts**. Drafts appear only in development builds (`__DEV__`: the simulator,
Expo Go and the web preview), with a "Draft" label in Add a set. Release
builds show published sets only.

Right now both sets, 151 (`sv03.5`) and Prismatic Evolutions (`sv08.5`), are
drafts waiting for review.

## Tests

```sh
pnpm --filter mobile test        # Jest (jest-expo) + React Native Testing Library
pnpm --filter mobile typecheck   # tsc --noEmit
```

Screen tests render each screen inside `src/test/TestProviders.tsx` (a small
fixture catalog and an in-memory store) with expo-router's hooks mocked.

## Layout

- `app/` — routes (expo-router): `index` (My Sets), `browse` (Add a set),
  `set/[id]/index` (set grid), `set/[id]/settings`, `set/[id]/card/[cardId]`.
- `src/catalog/` — the bundled catalog and `useCatalog()`.
- `src/db/` — opens the SQLite store (in-memory fallback on web) and the
  `useStore()`, `useTracked()`, `useCounts()` hooks.
- `src/components/` — card tiles, version dots, count popover, filters, header.
- `src/prices/` — the price book context (empty until prices are added).
- `src/theme/` — light and dark colour tokens.

Domain logic (progress, filters, spares, value) lives in
`packages/collection-core`, shared with future clients.
