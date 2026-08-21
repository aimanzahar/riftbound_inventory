# Riftbound Inventory

A local, realtime card inventory for **Riftbound: League of Legends TCG** — built for two people in the same house.
One Node process on your PC, opened from any phone/laptop on the same Wi-Fi. Everything lives in one SQLite file.

- Track exactly what you own (normal + foil), per printing, with notes.
- **"I bought product X"** adds a whole precon/starter deck in one click and warns you when you already own it.
- Current **TCGplayer USD** prices with a live **MYR** column (refreshed daily).
- Every card image mirrored locally; hover any card for a large preview + a short usage tip (generated once with Codex CLI, editable).
- **"Where is this card used"** — current meta decks / archetypes per card (weekly refresh).
- Realtime: changes made on one device appear instantly on the other, with "who changed what" and undo.
- Fast entry: search + click, **pack-opening keyboard mode**, CSV import/export.

## Requirements

- Windows/macOS/Linux with **Node.js 22.18 – 22.x** (uses the built-in `node:sqlite`, no native build).
- Optional: [Codex CLI](https://github.com/openai/codex) on `PATH` to generate card tips (`codex exec`).

## Quick start

```bash
npm install
npm run setup      # builds the web app and runs all data syncs (cards, products, images, fx, prices, meta)
npm start          # http://localhost:8787  (also prints your LAN URL, e.g. http://192.168.1.20:8787)
```

Windows: double-click `start.cmd`. On first run Windows Firewall asks to allow Node on **Private** networks — say yes.
If phones still can't connect:

```bash
netsh advfirewall firewall add rule name="Riftbound 8787" dir=in action=allow protocol=TCP localport=8787
```

Open the LAN URL on your brother's phone. Each device picks a name + colour on first launch.

## Development

```bash
npm run dev        # one process: API + Vite HMR on :8787 (LAN too); server restarts on changes under server/ shared/ sync/
npm run typecheck
npm test
```

## Data & backups

Everything is in `./data/` (override with `DATA_DIR`):

```
data/app.db            SQLite (WAL) — the whole inventory + catalog + prices + meta + tips + change log
data/images/           mirrored card images (webp) + thumb/
data/backups/          daily verified backups (14 daily + 8 weekly kept)
data/tips/             Codex prompts/outputs for tip generation
```

Backup = copy the `data/` folder. Restore = stop the server, copy a backup over `data/app.db`, delete `app.db-wal` / `app.db-shm`.

## Sync jobs

Jobs run automatically inside the server (fx/prices/images daily, meta/cards weekly, backup daily) and can be run by hand:

```bash
npm run sync:cards     # Riot card gallery → cards/sets (+ TCGplayer ids via DotGG)
npm run sync:products  # seed/products.json → products + fixed contents
npm run sync:images    # mirror images (--limit N)
npm run sync:fx        # USD→MYR
npm run sync:prices    # tcgcsv.com (TCGplayer) prices
npm run sync:meta      # riftools.app tournament decklists (--limit N)
npm run sync:tips      # Codex tips for cards without one (--batch 20 --max-batches N --ids OGN-001,OGN-002 --force)
npm run backup
```

Sources, URL shapes and caveats are documented in [`docs/sources.md`](docs/sources.md).

## CSV format

`card_id,set_code,number,name,finish,qty,note` — UTF-8 with BOM, CRLF. Import accepts `card_id` **or** `set_code`+`number`
(name is informational); `finish` defaults to `normal`. Import modes: Merge (add), Replace listed (set), Replace all.

## Environment (optional `.env`)

See [`.env.example`](.env.example): `PORT`, `HOST`, `DATA_DIR`, `NO_SCHEDULER`, `CODEX_MODEL`, `CARD_SOURCE`, `PRICE_SOURCE`, `META_SOURCE`.

## Legal

Fan-made, non-commercial. Riftbound and all card images/text are © Riot Games; used under Riot's Legal Jibber Jabber policy.
Prices via TCGplayer (tcgcsv.com mirror). Tournament data via riftools.app / TopDeck.gg (credit where due).
