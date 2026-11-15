# Master Set Tracker — Design

*Date: 2026-11-14 · Status: draft for approval · Working name: TBD*

Items marked *(builder's call)* were filled in by Claude, not decided by the owner. Everything else was decided in conversation.

## 1. Intent

A free, ad-free mobile app that helps Pokémon TCG collectors track progress on **master sets**: everything that is part of a set, in every version it was printed in. The model is the Figuritas app for Panini World Cup sticker albums. You open a set, see a grid, tap what you have, and instantly see what's missing.

**Why it exists:** existing apps (e.g. Holodex, Collectr) are busy. They pile on scanning, grading, portfolios, and ads, and they make one question surprisingly hard to answer: *which versions of which cards am I still missing?* Variants are the core pain. The owner uses Holodex today and finds missing variants hard to see.

**Who it's for:** Pokémon collectors working on modern master sets, released publicly on the App Store and Google Play.

**What success looks like:** a collector can open a set and know in under a second what they have, what they're missing, and what they have spare to trade. Two collectors at a card show, even one with no signal, can scan each other's codes and see exactly what they can trade.

## 2. Goals, non-goals, anti-goals

**Goals (v1)**
- Track ownership per card *version* (Normal, Reverse Holo, Poké Ball Reverse, Master Ball Reverse, Holo, single-version cards such as ex/illustration rares, and any other version a set prints), including duplicate counts.
- Cover **everything considered part of the set**: main set including secret rares, subsets (e.g. Trainer Gallery, Shiny Vault, Galarian Gallery), and set-tied promos and stamped cards.
- Let each user **toggle off categories per set** (e.g. hide promos & stamped), the way Figuritas lets you hide the Coca-Cola stickers.
- Show missing versions at a glance on the set grid.
- Show collection value and estimated cost to finish, kept visually quiet.
- Share needs/spares via a QR code (in person) and a link (online).
- In-app QR scan that compares two collections and lists what each person can give and get, **working with no signal on either phone**.
- Cross-device sync via accounts.

**Non-goals (v1, possibly later)**
- Vintage sets (1st Edition / Shadowless / Unlimited, etc.): later.
- Card scanning by camera and AI grading: liked by the owner, deliberately left out to keep the app simple.
- A full web app: planned later. Choose tech that lets it share code (see §5.6).
- Mutual trade confirmation (updating both accounts at once).
- Japanese / non-English sets. *(builder's call: English only for v1)*
- Portfolio charts, price history, marketplace/buy links.

**Anti-goals: things that make it a failure even if it works**
- Ads, upsell nags, or clutter that buries the "what am I missing" answer.
- Wrong variant data. Serious collectors will notice immediately and lose trust.
- Interactions that need more than one tap for the common action (marking a card).
- Trading that fails at the card show because the venue has no signal.

## 3. Constraints

- **Platforms:** iOS and Android from day one. Trading only works if both people can scan, regardless of phone.
- **Card data gap:** free databases (TCGdex, pokemontcg.io) provide set lists, images, and Normal/Reverse prices, but do **not** reliably model Poké Ball and Master Ball reverse holos, and are patchy on stamped cards. The app needs its own curated "what belongs to this set and in which versions" layer, maintained when each new set releases (roughly every 2–3 months).
- **Data review:** the owner reviews each set's curated list before it goes live (see §5.8). This is on the critical path for launch.
- **Prices:** free sources cover Normal/Reverse/Holo market prices. Ball-version and stamped prices may need a paid source later; until then those show "—" and are left out of totals (and the UI says so).
- **Offline:** card shows often have poor connectivity. Marking cards and in-person trade matching must work fully offline.
- **Trademark / store review:** the app name and icon must not use "Pokémon", Pokéball imagery, or Nintendo/TPCi branding. Include a "not affiliated with Nintendo / The Pokémon Company" notice. Card images come from the card database under the same norms other tracker apps follow.
- **Cost:** Apple Developer ($99/yr), Google Play ($25 once), hosting. Keep running costs low. There's no revenue in v1.

## 4. Approaches considered

1. **Cross-platform mobile app (Expo / React Native) + Supabase backend + small share web page.** **Chosen.** One codebase for iOS and Android, native camera QR scanning, polished feel, app store presence. Expo can also target web, which suits the planned web app. Trade-off: store fees and review delays.
2. **Installable web app (PWA) only.** Fastest and no stores, but browser QR scanning is clunkier, iPhone users rarely install PWAs, and it feels less polished. That works against the "simple and beautiful" goal. Also weaker offline. Rejected for now; the web app comes later anyway.
3. **Native iOS (SwiftUI) only.** Best iPhone feel, but excludes Android, which breaks two-way trading. Rejected.

The owner picked option 1, knowing a web app will follow.

**Offline trade matching, approaches** *(builder's call)*
- **a. QR carries the needs/spares data itself (chosen).** Works anywhere and on both platforms. Large collections need a multi-frame code (below).
- b. Nearby device connection (Bluetooth / Wi-Fi Direct). Handles any size, but cross-platform iOS↔Android peer-to-peer is unreliable, needs extra permissions, and adds pairing steps. Rejected.
- c. URL-only QR that fetches from the server. Simplest, but fails without signal. Rejected per owner.

## 5. The design

### 5.1 Screens

**Home: My Sets** *(builder's call)*
- List of sets the user is tracking, each with set logo, name, a progress bar/ring ("286 / 494"), and value owned.
- "Add set" opens a browsable list of supported modern sets, newest first.
- Persistent access to **My Trade Code** (QR) and **Scan**.

**Set screen** *(owner chose layout "A: card tiles with variant dots")*
- Header: set name, progress bar, "X of Y collected" (counts versions, not cards, and only categories the user has switched on), and one quiet line: `Owned $214 · To finish ≈ $96`.
- Filter switch: **All / Missing / Have / Spares**.
- Legend of version dots, built from the version kinds this set uses (e.g. Normal grey, Reverse rainbow, Poké Ball red, Master Ball purple; single-version cards one gold dot).
- Grid of tiles (3 per row on phones), in set order, with subsets and promos/stamped in their own labeled sections after the main set. Each tile has card art, number, name, and a row of dots, **one per version that card actually exists in** (per curated data).
  - Hollow/dashed dot = missing; filled dot = have.
  - A card with zero versions owned is faded (greyscale, low opacity).
  - A card with every version owned gets a small ✓ on the art.
  - Owned count > 1 shows a tiny number badge on the dot ("2", "3").

**Set settings** (from the set screen's menu)
- One switch per category that set has: **Main set** (always on), each subset (e.g. "Trainer Gallery"), **Promos & stamped**. Default: everything on.
- Switching a category off hides its section from the grid and removes it from "X of Y", cost to finish, and the user's **Needs** in sharing and trade matching. *(builder's call)* Spares in a hidden category are still offered in **Has to trade**, since you'd still happily trade them away. Counts are kept, never deleted, so switching back on restores everything.

**Card detail** *(builder's call)*: tap the card art to see a larger image, each version's count and price, and a −/+ stepper per version.

### 5.2 Marking interactions
- **Tap hollow dot** → count 1.
- **Tap filled dot** → count +1 (a spare). Badge shows the count.
- **Press and hold a dot** → small −/+ popover to correct or reduce (to 0 = missing).
- Light haptic on each change. Changes save instantly (locally first, synced when online); no save button.
- **Spare** = any copy beyond the first.

### 5.3 Sharing
- **Per-set share** (Share button on set screen): a sheet with a large QR code and "Copy link". Both point to the same URL.
- **Personal trade code**: one QR code per user covering all their tracked sets (see §5.4 for its offline format).
- Links open a **read-only web page** with **Needs** (missing versions) and **Has to trade** (spares), grouped by set, using the same tile/dot visuals. There's no account or app needed to view it. When opened with signal, it shows the live data for that share code.
- Users can regenerate their share code to revoke old links. *(builder's call)*

### 5.4 Trade matching (in-app scan, offline-capable)
- Scanning another user's trade QR **from inside the app** opens a **Match** screen:
  - **You can give:** versions they need that you have spares of.
  - **You can get:** versions you need that they have spares of.
  - Grouped by set, with the same tiles/dots, and a value total for each side (`≈ $14 ↔ ≈ $11`).
- **No signal needed on either phone.** The scanner's own collection is already on their phone (offline-first). The other person's needs and spares come from the QR code itself.
- **QR payload** *(builder's call)*: a URL whose fragment (the part after `#`, never sent to a server) carries a compact, compressed encoding of the person's needs and spares for each tracked set. It's keyed to each set's curated version order plus a catalog version number. The share code is included too, so a scanner *with* signal can fetch the freshest data instead.
  - Size estimate: a ~250-card set has ~750 versions, so needs + spares fit in ~200 bytes before compression. A few sets fit in one comfortably scannable code.
  - **Large collections:** when the payload is too big for one reliable code, the trade code becomes an **animated QR** that cycles through several frames. The scanner holds the camera steady for a second or two until all frames are collected, with a progress ring. The person showing the code can also narrow it to specific sets to keep it to a single frame.
  - **Catalog mismatch:** if the two phones have different catalog versions for a set (one hasn't updated), match on what both know and show a small "update the app for full results" note.
- **Card catalog is stored on the phone** *(builder's call)*: all supported sets' card/version data (small) are bundled and updated in the background, so the Match screen can show sets the scanner doesn't personally track. Card images are cached as viewed and show a clean placeholder when offline and uncached.
- Scanning with a normal phone camera opens the read-only web page. That page can render from the fragment data, so it works without the server knowing anything.
- To see matches on both phones, each person scans the other's code (as in Figuritas).
- **Complete trade:** the user selects the cards actually swapped and taps Complete. The app decrements their given spares and increments received versions **in their own account only**, offline if needed, synced later. The other person does the same on their phone.

### 5.5 Prices
- Show per-version market price on card detail, set value owned, and cost to finish in the set header, and side totals on the Match screen.
- Prices refresh daily (server-side job) and are cached on the phone, so offline totals use the last known prices.
- Unknown prices show "—" and are excluded from totals with a small "some prices unavailable" note.

### 5.6 Architecture
- **App:** Expo (React Native, TypeScript) with Expo Router; camera QR via `expo-camera`. Local database on the phone (e.g. SQLite) is the source of truth for the user's own collection, synced to the backend. Structure code so screens/logic can later be shared with an Expo web build or a separate web app.
- **Backend:** Supabase: Postgres, auth, row-level security, and scheduled jobs for price refresh and catalog publishing.
- **Share pages:** small web app (e.g. Next.js) serving `/u/<share-code>` and `/u/<share-code>/<set>`, plus universal/app links so the URL opens the app's Match screen when installed.
- **Accounts:** Sign in with Apple, Google, and email magic link. *(builder's call; Apple requires Sign in with Apple if Google sign-in is offered.)*

### 5.7 Data model (sketch)
- `sets` (id, name, series, release date, logo, catalog_version)
- `set_categories` (id, set_id, kind: main | subset | promo_stamped, label, sort order)
- `cards` (id, set_id, category_id, number, name, rarity, image)
- `version_kinds` (id, label, short label, dot colour/pattern, sort order). *(builder's call: kinds are a data table, not a fixed enum, so new reverse patterns or holo variants can be added without an app update. Each set's legend is built from the kinds it uses.)*
- `card_versions` (id, card_id, kind_id, position_in_set, price, price_updated_at). **This is the curated layer.** `position_in_set` fixes the bit order used by the QR payload. Holo rares that also print as reverse holo get both versions.
- `profiles` (user_id, display name, share_code)
- `tracked_sets` (user_id, set_id, hidden_category_ids)
- `collection` (user_id, card_version_id, count)
- Match = needs (count 0, category not hidden) vs spares (count ≥ 2) between two users.

### 5.8 Card data pipeline and review
- Import sets/cards/images from a free source (TCGdex or pokemontcg.io).
- Apply curated rules per set: which subsets and set-tied promos/stamped cards belong to it, and which versions each card exists in (e.g. "in Prismatic Evolutions, commons and uncommons have Normal, Reverse, Poké Ball, Master Ball; ex cards are single").
- Keep curated rules in version-controlled data files so each new set is a small, reviewable change.
- **Owner review:** for each set, generate a readable checklist (every card, its category, and its versions) that the owner checks before the set is published to the app. Once a set is published, its version order is frozen. Later corrections bump `catalog_version` and append new positions instead of reshuffling.
- **Launch scope** *(builder's call)*: Scarlet & Violet era sets at launch, since that keeps the hand-review manageable. Sword & Shield follows once reviewed.

## 6. Visual direction
Simple and beautiful: warm neutral background, card art as the main color, generous spacing, no banners. Dark mode supported. Reference: the layout A mockup from the brainstorming session.

## 7. Left to the builder
- Exact component library, state management, sync/conflict mechanism, and local database choice.
- Which free card source to start from, and the exact price source.
- QR encoding details (compression, frame size, error correction) within §5.4.
- Visual polish details (type scale, icons, motion) within the direction above.
- App name and icon (pending the owner; must avoid Pokémon trademarks).
