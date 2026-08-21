import type { Db } from '../db/open.ts';
import { all, getSetting, one } from '../db/open.ts';
import { HttpError } from '../http/body.ts';
import { analyzePurchase } from '../../shared/dupes.ts';
import type { Card, DeviceRef, InventoryItem, ProductContent, ProductKind, PurchasePreview } from '../../shared/types.ts';
import { timesBought } from './changes.ts';
import { applyInventory } from './inventory.ts';

interface ProductRow {
  id: string;
  name: string;
  kind: ProductKind;
  fixed_contents: number;
  active: number;
}

function loadProduct(db: Db, id: string): { product: ProductRow; contents: ProductContent[] } {
  const product = one<ProductRow>(db, 'SELECT id, name, kind, fixed_contents, active FROM products WHERE id = ?', id);
  if (!product) throw new HttpError(404, 'NOT_FOUND', `Product ${id} not found`);
  const contents = all<ProductContent>(db, 'SELECT card_id, finish, qty FROM product_contents WHERE product_id = ? ORDER BY card_id, finish', id).map((c) => ({ ...c, qty: Number(c.qty) }));
  return { product, contents };
}

export function previewPurchase(db: Db, productId: string, qty: number): PurchasePreview {
  return db.read(() => {
    const { product, contents } = loadProduct(db, productId);
    const ids = [...new Set(contents.map((c) => c.card_id))];
    const cardsById = new Map<string, Pick<Card, 'id' | 'variant_of' | 'type' | 'name'>>();
    const canonIds = new Set<string>();
    if (ids.length) {
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        for (const c of all<Pick<Card, 'id' | 'variant_of' | 'type' | 'name'>>(db, `SELECT id, variant_of, type, name FROM cards WHERE id IN (${chunk.map(() => '?').join(',')})`, ...chunk)) {
          cardsById.set(c.id, c);
          canonIds.add(c.variant_of ?? c.id);
        }
      }
    }
    // owned per canonical id: sum over all printings (variant_of = canon OR id = canon) and finishes
    const ownedByCanonical = new Map<string, number>();
    const priceByCard = new Map<string, number>();
    const canonArr = [...canonIds];
    for (let i = 0; i < canonArr.length; i += 500) {
      const chunk = canonArr.slice(i, i + 500);
      const ph = chunk.map(() => '?').join(',');
      for (const r of all<{ canon: string; qty: number }>(
        db,
        `SELECT COALESCE(c.variant_of, c.id) AS canon, SUM(i.qty) AS qty
         FROM inventory i JOIN cards c ON c.id = i.card_id
         WHERE COALESCE(c.variant_of, c.id) IN (${ph}) GROUP BY canon`,
        ...chunk,
      ))
        ownedByCanonical.set(r.canon, Number(r.qty));
    }
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      for (const r of all<{ card_id: string; usd_market: number | null }>(db, `SELECT card_id, usd_market FROM prices WHERE finish='normal' AND card_id IN (${chunk.map(() => '?').join(',')})`, ...chunk))
        if (r.usd_market !== null) priceByCard.set(r.card_id, Number(r.usd_market));
    }
    const tb = timesBought(db, product.id);
    return analyzePurchase({
      product: { id: product.id, name: product.name, kind: product.kind, contents },
      qty,
      ownedByCanonical,
      cardsById,
      priceByCard,
      playset: getSetting<number>(db, 'playset_size', 3),
      runePlayset: getSetting<number>(db, 'rune_playset_size', 12),
      timesBought: tb.count,
      lastBought: tb.last,
    });
  });
}

export function buyProduct(db: Db, productId: string, qty: number, op_id: string, device: DeviceRef | null) {
  const { product, contents } = loadProduct(db, productId);
  if (!product.fixed_contents || !product.active || contents.length === 0) throw new HttpError(409, 'NOT_PURCHASABLE', 'This product has no fixed card list (open packs in Pack mode instead)');
  const q = Math.max(1, Math.min(20, Math.floor(qty || 1)));
  const items: InventoryItem[] = contents.map((c) => ({ card_id: c.card_id, finish: c.finish, qty: c.qty * q }));
  return applyInventory(db, {
    op_id,
    reason: 'product',
    mode: 'add',
    items,
    device,
    entity: product.id,
    product: { id: product.id, name: product.name, qty: q },
  });
}
