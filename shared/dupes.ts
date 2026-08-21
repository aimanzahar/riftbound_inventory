// Pure duplicate-purchase analysis. Used by the server preview route and unit tests.
import type { Card, Finish, ProductContent, PurchaseLine, PurchasePreview, PurchaseSeverity } from './types.ts';

export interface AnalyzeArgs {
  product: { id: string; name: string; kind: PurchasePreview['product']['kind']; contents: ProductContent[] };
  qty: number;
  /** owned copies per CANONICAL card id (all finishes, all printings summed) */
  ownedByCanonical: Map<string, number>;
  /** card id -> card (for type/variant_of lookup) */
  cardsById: Map<string, Pick<Card, 'id' | 'variant_of' | 'type' | 'name'>>;
  /** usd market price per card id (normal finish) */
  priceByCard: Map<string, number>;
  playset: number;
  runePlayset: number;
  timesBought: number;
  lastBought: { ts: string; device_name: string | null } | null;
}

export function canonicalId(card: { id: string; variant_of: string | null } | undefined, id: string): string {
  return card?.variant_of ?? card?.id ?? id;
}

export function analyzePurchase(a: AnalyzeArgs): PurchasePreview {
  const qty = Math.max(1, Math.floor(a.qty || 1));
  // Aggregate contents by canonical id (same card in two printings counts together).
  const byCanon = new Map<string, { in_product: number; first: { card_id: string; finish: Finish } }>();
  for (const c of a.product.contents) {
    const card = a.cardsById.get(c.card_id);
    const canon = canonicalId(card, c.card_id);
    const cur = byCanon.get(canon);
    const add = c.qty * qty;
    if (cur) cur.in_product += add;
    else byCanon.set(canon, { in_product: add, first: { card_id: c.card_id, finish: c.finish } });
  }

  const lines: PurchaseLine[] = [];
  let newCopies = 0,
    dupCopies = 0,
    beyond = 0,
    est = 0,
    priced = 0,
    newDistinct = 0,
    partialDistinct = 0,
    ownedDistinct = 0,
    copies = 0;

  // Track running owned within this purchase so two lines of the same canonical don't double count.
  for (const [canon, v] of byCanon) {
    const card = a.cardsById.get(v.first.card_id) ?? a.cardsById.get(canon);
    const owned_now = a.ownedByCanonical.get(canon) ?? 0;
    const owned_after = owned_now + v.in_product;
    const P = card?.type === 'Rune' ? a.runePlayset : a.playset;
    const status: PurchaseLine['status'] = owned_now >= v.in_product ? 'owned' : owned_now > 0 ? 'partial' : 'new';
    const dup = Math.min(v.in_product, owned_now);
    const bp = Math.max(0, owned_after - P) - Math.max(0, owned_now - P);
    const price = a.priceByCard.get(v.first.card_id) ?? a.priceByCard.get(canon);
    if (price !== undefined && price !== null) {
      est += price * v.in_product;
      priced++;
    }
    lines.push({ card_id: v.first.card_id, finish: v.first.finish, in_product: v.in_product, owned_now, owned_after, status, dup_copies: dup, beyond_playset: bp });
    copies += v.in_product;
    newCopies += v.in_product - dup;
    dupCopies += dup;
    beyond += bp;
    if (status === 'new') newDistinct++;
    else if (status === 'partial') partialDistinct++;
    else ownedDistinct++;
  }
  lines.sort((x, y) => (x.status === y.status ? x.card_id.localeCompare(y.card_id) : rank(x.status) - rank(y.status)));

  const distinct = byCanon.size;
  let severity: PurchaseSeverity = 'green';
  if (a.timesBought > 0 || (distinct > 0 && newCopies === 0)) severity = 'red';
  else if (dupCopies > 0) severity = 'amber';

  let headline: string;
  if (distinct === 0) headline = 'This product has no fixed card list.';
  else if (severity === 'red' && a.timesBought > 0)
    headline = `You already bought this ×${a.timesBought}${a.lastBought ? ` (${fmtDate(a.lastBought.ts)}${a.lastBought.device_name ? `, ${a.lastBought.device_name}` : ''})` : ''}. Buying again adds ${newCopies} new card${newCopies === 1 ? '' : 's'} and ${dupCopies} duplicate${dupCopies === 1 ? '' : 's'}.`;
  else if (severity === 'red') headline = `You already own every card in this product. Buying it adds ${dupCopies} duplicates.`;
  else if (severity === 'amber')
    headline = `${ownedDistinct + partialDistinct} of ${distinct} cards are already in your collection. Buying adds ${newCopies} new and ${dupCopies} duplicate cop${dupCopies === 1 ? 'y' : 'ies'}${beyond ? ` (${beyond} beyond a playset of ${a.playset})` : ''}.`;
  else headline = `All ${copies} cards are new to your collection.`;

  return {
    product: { id: a.product.id, name: a.product.name, kind: a.product.kind },
    qty,
    times_bought: a.timesBought,
    last_bought: a.lastBought,
    lines,
    summary: {
      distinct,
      copies,
      new_distinct: newDistinct,
      partial_distinct: partialDistinct,
      owned_distinct: ownedDistinct,
      new_copies: newCopies,
      dup_copies: dupCopies,
      beyond_playset_copies: beyond,
      est_value_usd: Math.round(est * 100) / 100,
      priced_lines: priced,
      severity,
      headline,
    },
  };
}

function rank(s: PurchaseLine['status']): number {
  return s === 'owned' ? 0 : s === 'partial' ? 1 : 2;
}
function fmtDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
