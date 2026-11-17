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
