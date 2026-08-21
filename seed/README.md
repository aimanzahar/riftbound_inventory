# seed/ — committed product catalog

`products.json` is the static, hand-verified product catalog that `sync/products.ts` loads into the
`products` / `product_contents` tables. It is **built once** by `scripts/build-products-seed.ts` and
committed; the app never calls the upstream sources at runtime.

## Regenerate

```
npm run seed:products
```

(`node scripts/build-products-seed.ts`; needs network; ~20 s; ≤4 req/s to dotgg.) The script fails with a
non-zero exit and does **not** overwrite `products.json` if any validation fails. Re-run when new precons
ship: add a `DeckSpec` (and the verbatim list to `docs/sources.md` §3) and run again. Every card id in the
output is checked against the Riot gallery, so a new set must be live in the gallery first.

## Format (contract consumed by `sync/products.ts`)

Array of `Product` (`shared/types.ts`):

```
{ id, name, set_code: 'OGN'|'OGS'|'SFD'|'UNL'|'VEN'|null,
  kind: 'starter_set'|'champion_deck'|'showdown_deck'|'prerift_kit'|'booster_pack'|'booster_box'|'bundle'|'other',
  release_date: 'YYYY-MM-DD'|null, msrp_usd|null, tcgplayer_id|null, image_url|null, source_url|null,
  fixed_contents: 1|0, notes|null,
  contents: [{ card_id: 'OGN-001', finish: 'normal', qty: 3 }] }   // sorted by card_id, empty when fixed_contents=0
```

Ids are stable slugs (`ogn-champion-deck-jinx`, `ven-pre-rift-kit-zed`, `unl-booster-pack`, …). Sorted by
set (OGN, OGS, SFD, UNL, VEN, none) → kind → fixed first → name.

## What is in it (2026-08-21 build: 93 products, 37 with fixed contents, 1 687 cards listed)

| Group | Products | Per-deck shape | List source → cross-check |
|---|---|---|---|
| Origins: Proving Grounds | `ogs-proving-grounds-box-set` (TCGplayer 635460, $39.99, 216 cards = all four decks) + 4 per-deck products (`…-deck-annie/lux/garen/master-yi`, not sold separately) | Legend 1 + 40 main + 12 runes + 1 battlefield = 54 | dotgg `getdeck` → matches `docs/sources.md` §3.1 |
| Origins Champion Decks | `ogn-champion-deck-jinx/viktor/lee-sin` (635371/635374/635375, $19.99) | 1 + 40 + 12 + 3 BF = 56 | dotgg → matches §3.2 |
| Spiritforged Champion Decks | `sfd-champion-deck-rumble/fiora` (661939/661942, $19.99) | 56 | dotgg → matches §3.3 (official Riot article) |
| Unleashed Champion Decks | `unl-champion-deck-vex/vi` (678155/678157) | 56 | dotgg → matches §3.4 |
| Vendetta Showdown Decks | `ven-showdown-decks-zed-vs-shen` (697971, $34.99, 112 cards) + `ven-showdown-deck-zed` / `-shen` | 56 each | Shen: dotgg; **Zed: Russeus RB-TCG-Arena JSON** (dotgg `zed-showdown-deck` is corrupt: 112 cards = Zed+Shen merged) → both match §3.5 |
| Spiritforged Pre-Rift kits | `sfd-pre-rift-kit-ezreal/renata-glasc/lucian/reksai/jax/irelia` | 15 cards, all 1x (Legend, champion, battlefield, 12 support) | hand-entered from §3.6 (riftmana) — no machine source |
| Unleashed Pre-Rift kits | `unl-pre-rift-kit-vi/jhin/ivern/master-yi/khazix/diana` | 15 × 1x | dotgg → matches §3.7; **Diana = `notes:'unconfirmed list'`** (see below) |
| Vendetta Pre-Rift kits | `ven-pre-rift-kit-jayce/kennen/akali/ambessa/nasus/zed/shen/renekton/mel` | 15 × 1x | dotgg → matches §3.8 |
| Riftbound Bulk Runes | `riftbound-bulk-runes` (678130, $19.99) | 54 × each of the 6 basic runes = 324 | product description (54 of each) |
| Sealed SKUs (56) | boosters, sleeved boosters, art bundles, displays, cases, vault bundles, Nexus Night packs, retail Pre-Rift kits (random legend) + event kits, deck displays, Radiance pre-orders, Worlds Bundle, Arcane Box, Secret Garden | `fixed_contents: 0`, `contents: []` | dotgg `getproducts` (productId = TCGplayer id, release epoch, image); kind derived from the name; MSRPs only where documented in `docs/sources.md` |

Validation performed on every build (script asserts, prints a table, exits 1 on failure):
per-deck counts as in the table above; kits exactly 15 distinct cards; composites = sum of parts;
every `card_id` present in the Riot gallery (`fromRiotId`); no duplicate product ids or content rows.
When a machine source disagrees with `docs/sources.md` §3, §3 wins and the discrepancy is written into
`notes` (none in the current build — all 26 dotgg/Russeus lists matched §3 exactly).

## Conventions

- **Runes** are always counted against the OGN basic printings `OGN-007` Fury, `OGN-042` Calm, `OGN-089`
  Mind, `OGN-126` Body, `OGN-166` Chaos, `OGN-214` Order (the script remaps `VEN-R0x` / alt-art runes to
  them and says so in `notes`). The physical printing inside a box may differ (e.g. hextechanalytics lists
  VEN-R05/VEN-R01 for the Zed Showdown deck); only the printing that gets the count is affected.
- Contents list only the cards in the Riot gallery: boosters inside champion decks/kits, promo cards,
  tokens, oversized battlefields, playmats etc. are described in `notes`, not in `contents`.
- `finish` is always `normal`.
- Pre-Rift kits: the retail SKU (`sfd/unl/ven-pre-rift-kit`) is a *random* one of the kit varieties, so it
  is `fixed_contents: 0`; buy the per-champion product for the list you actually received. Kits contain no
  runes.
- Per-deck products that are not their own SKU (`ogs-proving-grounds-deck-*`, `ven-showdown-deck-*`,
  all per-champion kits) have `tcgplayer_id: null` and borrow `release_date` / `image_url` from the parent
  SKU; `notes` names the parent.

## Known uncertainties

- **Unleashed Pre-Rift Diana kit**: dotgg lists 14 cards (no champion), hextechanalytics 16 (adds UNL-079
  Diana, Lunari and UNL-075 Gustwalker). We ship dotgg's 14 + UNL-079 (Gustwalker dropped) and mark
  `notes: 'unconfirmed list …'`.
- **Rune printings** inside Spiritforged/Unleashed/Vendetta precons are ambiguous across sources (OGN basics
  vs `VEN-R0x`); see Conventions.
- **Spiritforged Pre-Rift kits** exist only as hand-entered lists (riftmana; Jax confirmed against a
  Piltover Archive System deck).
- **Arcane Box Set / Worlds Bundle / Secret Garden** have fixed contents in reality, but their printings
  (`OGN-036a`… per dotgg, `SGN-001..003`) are not in the Riot gallery, so they stay `fixed_contents: 0`.
- **Bulk Runes**: "54 of each rune" is from the product description; the exact rune art is unknown (counted
  as OGN basics).
- **Release dates / images** for sealed SKUs are dotgg's (`releaseDate` epoch → UTC date); e.g. Secret
  Garden shows 2025-07-30, which looks wrong but is passed through unchanged. MSRP is null where
  `docs/sources.md` does not document it (UNL champion decks, boosters, Radiance pre-orders, …).
- Radiance (Oct 2026) SKUs are included with `set_code: null` (RAD is not in the allowed set codes) and
  `notes: 'Set/group: Radiance.'`; their decklists are unpublished.
