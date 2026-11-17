# Master Set Tracker

A free, ad-free mobile app for collectors working on **master sets**: every
card in a set, in every version it was printed in. Open a set, tap what you
have, and see at a glance what's missing and what you have spare.

The design is in
[`docs/superpowers/specs/2026-11-14-master-set-tracker-design.md`](docs/superpowers/specs/2026-11-14-master-set-tracker-design.md).

![The 151 set screen on iPhone](docs/screenshots/plan-2/ios-25-hero-set-screen-light.png)

More screenshots: [`docs/screenshots/plan-2/`](docs/screenshots/plan-2/).

## What's here

A pnpm monorepo (Node 22 or newer):

| Path | What it is |
| --- | --- |
| [`apps/mobile`](apps/mobile/README.md) | The Expo app (iOS, Android, web preview). |
| `packages/catalog-core` | Types for the card catalog: sets, cards, version kinds. |
| `packages/collection-core` | Collection logic shared by every client: counts per version, progress, filters, spares, value, and the SQLite/in-memory store. |
| `tools/catalog` | The catalog builder (`pnpm catalog …`). |
| [`catalog/`](catalog/README.md) | Hand-written rules per set, and the built catalog in `catalog/dist/` that the app bundles. |
| `docs/` | Design, plans and screenshots. |

## Getting started

```sh
pnpm install
```

The repo uses `node-linker=hoisted` (see `.npmrc`) because React Native needs
a flat `node_modules`.

### Run the app

```sh
pnpm --filter mobile ios     # iPhone simulator (needs Xcode)
pnpm --filter mobile start   # dev client: start Metro for a development build (Expo Go can't run the app)
pnpm --filter mobile web     # browser preview at http://localhost:8081 (doesn't save)
```

Details, including how the catalog gets into the app and why draft sets only
show in development, are in [`apps/mobile/README.md`](apps/mobile/README.md).

### Development build

The app needs a development build (Expo Go can't run it). See
[Development build](apps/mobile/README.md#development-build) in the app README for the Xcode 26.3 notes, the `expo-modules-jsi` patch and running a second simulator.

### Plan 3 live check

Ran live (email sign-in on a hosted Supabase project, two iPhone simulators): first sign-in, changes propagating A to B and B to A, prices on the set header and card detail, signing out on one device leaving the other signed in (scope `local`), and signing back in restoring the marks from the server.

Covered by tests, not run live:
- Conflict resolution by latest write (SyncEngine two-device tests and the SyncEngine against the real `push_changes`/`pull_changes` integration test, in both push orders).
- Sign-out with unsynced changes shows the warning (account tests, including the offline scenario).
- Upload of marks that existed before the first sign-in (the adoption tests; it can't happen live because sign-in is required on a fresh install).

Pending: the Apple and Google sign-in live check (needs the owner's developer accounts).

Screenshots: [set screen with prices](docs/screenshots/plan-3/01-set-screen-with-prices.png), [card detail with prices](docs/screenshots/plan-3/02-card-detail-with-prices.png), [My Sets synced](docs/screenshots/plan-3/03-my-sets-synced.png), [device B pulled](docs/screenshots/plan-3/04-device-b-pulled.png), [device B marked](docs/screenshots/plan-3/05-device-b-marked.png), [device A received](docs/screenshots/plan-3/06-device-a-received.png), [device B signed out](docs/screenshots/plan-3/08-device-b-signed-out.png), [device B signed back in](docs/screenshots/plan-3/10-device-b-signed-back-in.png) (all in [`docs/screenshots/plan-3/`](docs/screenshots/plan-3/)). Setup notes (SMTP, code length, deploy) are in [`docs/setup/accounts-and-backend.md`](docs/setup/accounts-and-backend.md).

### Tests and type checks

```sh
pnpm test        # every package's tests (Vitest for the packages, Jest for the app)
pnpm typecheck   # TypeScript across the catalog tool, collection-core and the app
```

### Build the catalog

```sh
pnpm catalog build <set id>   # e.g. pnpm catalog build sv03.5
pnpm catalog build --all
```

See [`catalog/README.md`](catalog/README.md) for how to read the checklists and
how publishing works.
