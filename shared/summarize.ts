// Human-readable one-liners for change rows (toasts, activity feed, pack log). Pure.
import type { Change, InventoryPayload, TipPayload, PricesPayload, FxPayload, TipsPayload, CatalogPayload, UserDeckPayload } from './types.ts';

export interface MinimalCard {
  id: string;
  name: string;
}

export function changeSummary(c: Change, cardsById: Map<string, MinimalCard> | ((id: string) => MinimalCard | undefined)): { text: string; cardIds: string[] } {
  const lookup = typeof cardsById === 'function' ? cardsById : (id: string) => cardsById.get(id);
  const who = c.device?.name ?? 'System';
  switch (c.kind) {
    case 'inventory': {
      const p = c.payload as InventoryPayload;
      const ids = [...new Set(p.lines.map((l) => l.card_id))];
      if (c.reason === 'undo') return { text: `${who} undid a change${p.lines.length ? ` (${p.lines.length} card${p.lines.length === 1 ? '' : 's'})` : ''}`, cardIds: ids };
      if (c.reason === 'product' && p.product) return { text: `${who} added ${p.product.name}${p.product.qty > 1 ? ` ×${p.product.qty}` : ''} (${sumAbs(p)} cards)`, cardIds: ids };
      if (c.reason === 'csv') return { text: `${who} imported CSV${p.csv_filename ? ` “${p.csv_filename}”` : ''}: ${p.lines.length} rows, ${signed(p.summary.copies_delta)} copies`, cardIds: ids };
      if (c.reason === 'note') {
        const l = p.lines[0];
        const n = l ? lookup(l.card_id)?.name ?? l.card_id : '';
        return { text: `${who} edited the note on ${n}`, cardIds: ids };
      }
      if (p.lines.length === 1) {
        const l = p.lines[0];
        const name = lookup(l.card_id)?.name ?? l.card_id;
        const d = l.qty - l.prev_qty;
        const foil = l.finish === 'foil' ? ' ✦' : '';
        if (p.mode === 'add' || d !== 0) return { text: `${who} ${signed(d)} ${name}${foil} → ${l.qty}`, cardIds: ids };
        return { text: `${who} updated ${name}${foil}`, cardIds: ids };
      }
      const names = ids.slice(0, 3).map((id) => lookup(id)?.name ?? id);
      const more = ids.length > 3 ? `, +${ids.length - 3} more` : '';
      return { text: `${who} ${signed(p.summary.copies_delta)} cards (${names.join(', ')}${more})`, cardIds: ids };
    }
    case 'tip': {
      const p = c.payload as TipPayload;
      return { text: `${who} edited the tip for ${lookup(p.card_id)?.name ?? p.card_id}`, cardIds: [p.card_id] };
    }
    case 'prices': {
      const p = c.payload as PricesPayload;
      return { text: `Prices updated (${p.count} cards)`, cardIds: [] };
    }
    case 'fx': {
      const p = c.payload as FxPayload;
      return { text: `FX updated: 1 USD = ${p.rate.toFixed(3)} MYR`, cardIds: [] };
    }
    case 'tips': {
      const p = c.payload as TipsPayload;
      return { text: `Generated ${p.count} card tips`, cardIds: [] };
    }
    case 'catalog': {
      const p = c.payload as CatalogPayload;
      return { text: `Catalog updated (${p.what})`, cardIds: [] };
    }
    case 'settings':
      return { text: `${who} changed settings`, cardIds: [] };
    case 'deck': {
      const p = c.payload as UserDeckPayload;
      const ids = [...new Set((p.lines ?? []).map((l) => l.card_id))];
      if (c.reason === 'create') return { text: `${who} created the deck “${p.name}”`, cardIds: [] };
      if (c.reason === 'delete') return { text: `${who} deleted the deck “${p.name}”`, cardIds: [] };
      if (c.reason === 'update') return { text: `${who} edited the deck “${p.name}”`, cardIds: [] };
      if (ids.length === 1) {
        const l = (p.lines ?? [])[0];
        const name = lookup(l.card_id)?.name ?? l.card_id;
        return { text: `${who} ${signed(l.qty - l.prev_qty)} ${name} in “${p.name}” → ${l.qty}`, cardIds: ids };
      }
      const names = ids.slice(0, 3).map((id) => lookup(id)?.name ?? id);
      const more = ids.length > 3 ? `, +${ids.length - 3} more` : '';
      return { text: `${who} ${signed(p.summary.copies_delta)} cards in “${p.name}” (${names.join(', ')}${more})`, cardIds: ids };
    }
    default:
      return { text: `${who} made a change`, cardIds: [] };
  }
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}
function sumAbs(p: InventoryPayload): number {
  return p.lines.reduce((a, l) => a + Math.abs(l.qty - l.prev_qty), 0);
}
