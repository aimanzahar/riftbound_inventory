import type { Finish } from './types.ts';

export const FINISHES: readonly Finish[] = ['normal', 'foil'] as const;
export const DEFAULT_PLAYSET = 3;
export const RUNE_PLAYSET = 12;
export const MAX_QTY = 9999;
export const MAX_ITEMS_PER_REQUEST = 5000;

/** Device colour swatches (identity picker). */
export const PALETTE = [
  '#f97316', // orange
  '#22c55e', // green
  '#3b82f6', // blue
  '#a855f7', // purple
  '#ec4899', // pink
  '#eab308', // yellow
  '#14b8a6', // teal
  '#ef4444', // red
] as const;

/** Riftbound domains with display colours. Ids match Riot's gallery ids. */
export const DOMAINS: Record<string, { label: string; color: string; fg: string }> = {
  fury: { label: 'Fury', color: '#ef4444', fg: '#fff' },
  calm: { label: 'Calm', color: '#22c55e', fg: '#052e16' },
  mind: { label: 'Mind', color: '#3b82f6', fg: '#fff' },
  body: { label: 'Body', color: '#f97316', fg: '#431407' },
  chaos: { label: 'Chaos', color: '#a855f7', fg: '#fff' },
  order: { label: 'Order', color: '#eab308', fg: '#422006' },
  colorless: { label: 'Colorless', color: '#9ca3af', fg: '#111827' },
};
export const DOMAIN_ORDER = ['fury', 'calm', 'mind', 'body', 'chaos', 'order', 'colorless'];

export const RARITY_ORDER = ['Common', 'Uncommon', 'Rare', 'Epic', 'Showcase', 'Promo'];
export const TYPE_ORDER = ['Legend', 'Unit', 'Spell', 'Gear', 'Rune', 'Battlefield', 'Token'];

export const CHANGE_KINDS = ['inventory', 'tip', 'prices', 'fx', 'tips', 'catalog', 'settings', 'deck'] as const;
export const INVENTORY_REASONS = ['manual', 'pack', 'product', 'csv', 'note', 'undo'] as const;

export const JOB_NAMES = ['cards', 'products', 'images', 'fx', 'prices', 'meta', 'backup', 'tips'] as const;
export type JobName = (typeof JOB_NAMES)[number];
/** null = never auto-scheduled (manual only). */
export const JOB_INTERVAL_HOURS: Record<JobName, number | null> = {
  cards: 24,
  products: null,
  images: 24,
  fx: 24,
  prices: 24,
  meta: 24,
  backup: 24,
  tips: null,
};

export const CSV_HEADER = ['card_id', 'set_code', 'number', 'name', 'finish', 'qty', 'note'] as const;

export const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) riftbound-inventory/0.1 (+local personal collection tool)';
