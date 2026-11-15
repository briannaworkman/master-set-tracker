# Card catalog

This folder holds the curated list of what belongs to each set and which
versions each card was printed in. The app reads the built files in `dist/`.

- `rules/<set id>.yaml`: one hand-written rules file per set. Each file starts
  with a comment listing the sources used to check it.
- `version-kinds.yaml`: the list of versions a card can have (Normal, Reverse
  Holo, and so on).
- `dist/checklists/<set id>.csv`: a spreadsheet checklist per set, for review.
- `dist/sets/<set id>.json` and `dist/index.json`: the data the app uses.
- `locks/<set id>.lock.json`: only exists once a set is published (see below).

Sets so far: `sv03.5` (151) and `sv08.5` (Prismatic Evolutions). Neither is
published yet; both are waiting for the owner's review.

## How to read a checklist

Open `dist/checklists/<set id>.csv` in Excel, Numbers or Google Sheets (on
GitHub it shows as a table). There is one row per card.

| Column | Meaning |
| --- | --- |
| Number | The number printed on the card, e.g. `025` for 025/165. Secret rares have numbers above the set size. |
| Name | The card name. Stamped promo versions say which stamp in brackets. |
| Rarity | The rarity as printed (Common, Uncommon, Rare, Double rare, ...). |
| Category | Which section of the set the card belongs to (see below). |
| One column per version | A ✓ means the card exists in that version and counts toward the master set. A blank means it was not printed that way. |
| Notes | Empty. Use it for your own review comments. |

The version columns only appear if at least one card in the set uses them:

| Column | What it is |
| --- | --- |
| Normal | The regular non-foil card. |
| Holo | The regular card for rarities whose standard print is holofoil (e.g. Rare). |
| Reverse Holo | The card with the foil on the background instead of the picture. |
| Poké Ball Reverse | Reverse holo with the Poké Ball pattern. |
| Master Ball Reverse | Reverse holo with the Master Ball pattern. |
| Single | Cards that come in exactly one version (ex, illustration rares, ultra rares, gold cards, stamped promos). |

Example from Prismatic Evolutions:

```
Number,Name,Rarity,Category,Normal,Holo,Reverse Holo,Poké Ball Reverse,Master Ball Reverse,Single,Notes
001,Exeggcute,Common,Main set,✓,,✓,✓,✓,,
093,Amarys,Common,Main set,✓,,✓,✓,,,
005,Leafeon,Rare,Main set,,✓,✓,✓,✓,,
060,Umbreon ex,Double rare,Main set,,,,,,✓,
```

So Exeggcute needs four copies for the master set, Amarys three (Trainers
have no Master Ball version), Leafeon four, and Umbreon ex one.

**Categories.** Every card is in exactly one category. The app lets each
collector hide categories they don't collect.

- **Main set**: every numbered card, including secret rares.
- **Promos & stamped**: stamped versions of this set's cards released in this
  set's own products. They are listed after the main set. A stamped card is a
  separate collectible from the unstamped one, so it gets its own row.
- A set can also have **subsets** (e.g. Trainer Gallery). Neither set so far
  has one.

**What to check when reviewing.** For each row, does the ✓ pattern match what
was actually printed? Is any card missing (especially promos or stamped
cards), or included when it shouldn't be? Write corrections in the Notes
column or as comments, and they will be turned into rule changes.

## Totals for the current sets

| Set | Cards | Versions | Breakdown |
| --- | --- | --- | --- |
| 151 | 211 | 364 | 207 numbered cards + 153 reverse holos = 360, plus 4 stamped promos |
| Prismatic Evolutions | 193 | 460 | 180 numbered cards + 100 reverse + 100 Poké Ball + 67 Master Ball = 447, plus 13 stamped promos |

Rules used:

- **151**: Common and Uncommon (Pokémon and Trainers): Normal + Reverse Holo.
  Rare: Holo + Reverse Holo. Everything rarer: Single. **The English 151 set
  has no Poké Ball or Master Ball reverses.** Those were only printed in the
  Japanese, Korean and Chinese versions of 151.
- **Prismatic Evolutions**: Common and Uncommon Pokémon: Normal, Reverse,
  Poké Ball, Master Ball. Rare Pokémon: Holo, Reverse, Poké Ball, Master Ball.
  Common and Uncommon Trainers: Normal, Reverse, Poké Ball (no Master Ball).
  ACE SPEC, ex and everything rarer: Single.

## Open questions for the owner

These need a decision from you. Nothing on this list is in the checklists yet,
except where it says so.

1. **151 has no ball reverses (in the checklist).** The plan assumed English 151
   had Poké Ball and Master Ball reverses. Every source checked (TCGdex,
   PriceCharting, TCGWatchtower, Pokecottage, Binderforge) says those are
   Japanese/Korean/Chinese only, and the English master set is 360 cards. The
   checklist follows the sources. Please confirm.
2. **151 starter stamps (in the checklist).** Bulbasaur (151 stamp, Best Buy),
   Charmander (GameStop stamp), Charmander (EB Games stamp, Australia/New
   Zealand only), Squirtle (Pokémon Center stamp). Do you want all four,
   including the EB Games one? Sources disagree on their finish (TCGdex lists
   Bulbasaur and the GameStop Charmander as non-holo, Bulbapedia says reverse
   holo). That doesn't change the checklist, since each is tracked as one version.
3. **Prismatic Evolutions Lugia ex stamp (one row in the checklist).** Bulbapedia
   reports two stamped Lugia ex 082 printings: stamp on the left (Lugia ex
   Special Collection, sold in Europe) and stamp on the right (Lugia ex & Latias
   ex Premium Collection, Target US). TCGdex also lists two, but PriceCharting
   lists one. The checklist row is the **stamp-on-the-right** printing from the
   Lugia ex & Latias ex Premium Collection. Should the European stamp-on-the-left
   printing get its own row too?
4. **Cosmos holo versions (not in the checklist).** Some cards were also printed
   with the "cosmos" holo pattern in blister packs, tins and collection boxes.
   Tracking them would need a new "Cosmos Holo" version kind.
   - 151 (TCGdex): cosmos reverse of Bulbasaur 001, Charmander 004, Squirtle 007
     and Pikachu 025 (Costco bundles); cosmos holo of Charmander 004, Charmeleon
     005, Raichu 026, Machamp 068 and Dragonite 149; galaxy holo of Gengar 094;
     cosmos Voltorb 100 (Professor Program, PriceCharting). Binderforge instead
     names Abra, Kadabra and Electabuzz as the collection-box cosmos holos, so
     sources disagree on which cards.
   - Prismatic Evolutions (TCGdex, partly PriceCharting): cosmos holo of
     Leafeon 005, Flareon 013, Vaporeon 022, Glaceon 025, Jolteon 029, Espeon
     033, Sylveon 040, Umbreon 059; cosmos reverse of Eevee 074.
5. **Other stamped promos (not in the checklist).** These are set cards with
   stamps from general programs rather than this set's own products:
   - 151: Pikachu 025 and Eevee 133 with the Pokémon Together stamp and with
     the Holiday Calendar snowflake stamp; Mew ex 151 and Ditto 132 Prize Pack
     stamps; Mew ex 151 Ultra Ball League stamp; Voltorb 100 Professor Program.
   - Prismatic Evolutions: Glaceon ex 026 Holiday Calendar 2025 snowflake;
     Sylveon 040 Pokémon Day 2025 stamp (TCGdex and PriceCharting); Eevee 074
     Pokémon Day stamp (PriceCharting only); Budew 004 Premier Ball League
     Judge; Prize Pack stamps on Umbreon ex 060, Eevee ex 075, Leafeon ex 006
     and Max Rod 116.
6. **Oversized and metal cards (not in the checklist).** 151: jumbo Blastoise ex
   009 and Mew ex 205, metal gold Mew ex 205 (Ultra-Premium Collection).
   Prismatic Evolutions: jumbo Lucario ex 051, Snorlax ex 076, Lugia ex 082.
7. **Black Star promos (not in the checklist).** Promos numbered in the SVP
   promo series (e.g. Elite Trainer Box promos) are not part of either set's
   numbering, so they are left out. Say if you want set-themed SVP promos
   included.
8. **151 cosmos basic energies (not in the checklist).** Binderforge mentions
   unnumbered cosmos-foil basic energies inserted in 151 booster packs. They
   have no set number. Include them or not?

## How to add a set

You need Node 22 and pnpm. Run commands from the repository root.

1. Find the set's TCGdex id, e.g. at `https://api.tcgdex.net/v2/en/sets`.
2. Create `catalog/rules/<id>.yaml`. Copy an existing rules file and change it.
   - `categories`: exactly one `main`, plus any `subset` / `promo_stamped`.
   - `categoryRules`: puts cards into categories; anything unmatched goes to `main`.
   - `versionRules`: which versions each card has. Match on `rarity` (exact
     TCGdex rarity strings, case-insensitive), `localIdPrefix` (e.g. `TG`), or
     `ids`. The last rule must be `match: {}`.
   - In both rule lists, **the first matching rule wins**, so put narrow rules
     (e.g. a list of `ids`) before broad ones (e.g. a `rarity`).
   - The build **fails** if a rule's `ids` names a card that isn't in the set
     (or names an extra card: rules only apply to TCGdex set cards), if an id
     in a rule's `ids` is matched first by an earlier rule, if any `rarity` in
     a matcher isn't a rarity some card in the set actually has, or if any
     category rule or non-final version rule is the first match for no card at
     all. A failure like that usually means a typo (e.g. a misspelt rarity) or
     a rule hidden behind an earlier one. The final `match: {}` version rule
     may match nothing.
   - `overrides`: per-card exceptions, keyed by card id like `sv08.5-093`.
   - `extraCards`: stamped or promo cards that aren't in the TCGdex set list.
     Each needs an `id` unique within the set (the build fails on a clash with
     another extra card or a TCGdex card id). Use
     `<set id>-<number>-stamp-<stamp>`, where `<stamp>` names the stamp in
     lowercase kebab case: `set-logo` for the expansion's own logo stamp, or
     the retailer or program (`gamestop`, `ebgames`, `pokemon-center`). If one
     stamp was printed in more than one way on the same card, add a printing
     suffix, e.g. `sv08.5-082-stamp-set-logo-right` and
     `sv08.5-082-stamp-set-logo-left`. Choose a specific id from the start
     rather than a bare `-stamp`, because a second stamp on the same card
     would make a bare id ambiguous.
   - **Ids are permanent once a set is published.** Extra card ids, category
     ids and version kind ids are baked into the lock file and the app's
     saved data, so never rename them after publishing. (Renaming an extra
     card would retire its versions and add new ones.) Fix ids before the
     first publish.
   - Put your sources in a comment at the top. Check versions against at least
     two independent sources (TCGdex `variants_detailed`, a master set guide,
     a marketplace such as TCGplayer, CardTrader or PriceCharting).
3. Run `pnpm catalog build <id>`. It prints a summary line, e.g.
   `Prismatic Evolutions: 193 cards, 460 versions (Main set 180, Promos & stamped 13)`.
   A "fetched ≠ total" warning means TCGdex returned fewer cards than the set
   reports. Don't publish until that's fixed.
4. Spot-check the CSV in `catalog/dist/checklists/` against a marketplace, then
   send it to the owner for review.

TCGdex responses are cached in `catalog/.cache/` (not committed). Delete a file
there to fetch it again.

## Publishing and `--accept-changes`

Every card version gets a permanent position number. The app's offline QR
code is built from these positions, so they must never move once people
start using a set.

- **Before publishing**, `build` can be re-run as often as you like. Positions
  are worked out fresh each time and nothing is frozen.
- **`pnpm catalog publish <id>`** builds the set and writes
  `catalog/locks/<id>.lock.json`, which freezes every position. Only publish
  after the owner has signed off on the checklist. A set can only be
  published once.
- **After publishing**, if a rules change would add or remove versions, `build`
  stops and lists what would be added and retired. Re-run it with
  `--accept-changes` to accept the change. This bumps the set's
  `catalogVersion`, gives new versions new positions after all existing ones,
  and retires removed positions. Retired positions are never reused. Existing
  positions never change.
- `pnpm catalog build --all` rebuilds every set that has a rules file.
