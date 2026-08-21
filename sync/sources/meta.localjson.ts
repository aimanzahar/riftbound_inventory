// Local-file meta source (fixtures / offline): { decks: [MetaDeckInput-like] } or a bare array.
// event_date accepts 'today' / 'today-Nd' so fixtures stay fresh.
import fs from 'node:fs';
import type { JobCtx } from '../types.ts';
import type { MetaDeckCardInput, MetaDeckInput } from './types.ts';
import { readJsonFile } from '../lib/files.ts';
import { resolveLocalFile } from './cards.localjson.ts';
import type { DeckSection } from '../../shared/types.ts';

const SECTIONS: readonly DeckSection[] = ['main', 'side', 'legend', 'champion', 'battlefield', 'runes'];

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function resolveRelativeDay(v: string | null): string | null {
  if (!v) return null;
  const m = v.match(/^today(?:-(\d+)d)?$/i);
  if (!m) return v;
  const d = new Date(Date.now() - Number(m[1] ?? 0) * 86400000);
  return d.toISOString().slice(0, 10);
}

export function coerceDeck(raw: Record<string, unknown>, index: number): MetaDeckInput | null {
  const source_url = str(raw.source_url) ?? `local://deck/${index}`;
  const cards: MetaDeckCardInput[] = [];
  for (const c of Array.isArray(raw.cards) ? (raw.cards as Record<string, unknown>[]) : []) {
    const qty = Math.floor(num(c.qty ?? c.count ?? c.quantity) ?? 0);
    if (qty <= 0) continue;
    const sec = str(c.section)?.toLowerCase() ?? 'main';
    cards.push({ code: str(c.code ?? c.card_id ?? c.public_code), name: str(c.name), qty, section: (SECTIONS as readonly string[]).includes(sec) ? (sec as DeckSection) : 'main' });
  }
  if (!cards.length) return null;
  return {
    source: str(raw.source) ?? 'localjson',
    source_url,
    name: str(raw.name) ?? str(raw.legend_name) ?? `Deck ${index + 1}`,
    legend_name: str(raw.legend_name),
    legend_code: str(raw.legend_code ?? raw.legend_public_code),
    champion_code: str(raw.champion_code ?? raw.champion_public_code),
    player: str(raw.player),
    event_name: str(raw.event_name),
    event_date: resolveRelativeDay(str(raw.event_date)),
    event_players: num(raw.event_players),
    event_tier: str(raw.event_tier),
    placement: num(raw.placement),
    region: str(raw.region),
    format: str(raw.format) ?? 'constructed',
    cards,
  };
}

export async function loadLocalDecks(ctx: Pick<JobCtx, 'cfg' | 'flags' | 'log'>): Promise<MetaDeckInput[]> {
  const file = resolveLocalFile(ctx, 'decks.json');
  if (!fs.existsSync(file)) throw new Error(`local deck file not found: ${file}`);
  const doc = readJsonFile<unknown>(file);
  const list = Array.isArray(doc) ? doc : Array.isArray((doc as { decks?: unknown[] }).decks) ? (doc as { decks: unknown[] }).decks : [];
  const out: MetaDeckInput[] = [];
  list.forEach((raw, i) => {
    const d = coerceDeck(raw as Record<string, unknown>, i);
    if (d) out.push(d);
  });
  ctx.log.info(`localjson decks: ${out.length} from ${file}`);
  return out;
}
