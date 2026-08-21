import { memo, useEffect, useState } from 'react';
import { Package, ScanLine } from 'lucide-react';
import type { Card, Product, ProductKind } from '../../../../shared/types.ts';
import type { ProductStatus } from '../../store/selectors.ts';
import { cx, fmtDate, fmtInt, fmtMYR, fmtUSD, usdToMyr } from '../../lib/format.ts';
import { buildHash } from '../../lib/router.ts';
import { Badge, type BadgeTone } from '../ui/Badge.tsx';
import { CardImage } from '../cards/CardImage.tsx';

// ---------------------------------------------------------------------------
// shared product helpers (used by the page + dialog)
// ---------------------------------------------------------------------------

export const KIND_ORDER: readonly ProductKind[] = ['starter_set', 'champion_deck', 'showdown_deck', 'prerift_kit', 'booster_pack', 'booster_box', 'bundle', 'other'];

export const KIND_LABEL: Record<ProductKind, string> = {
  starter_set: 'Starter set',
  champion_deck: 'Champion deck',
  showdown_deck: 'Showdown deck',
  prerift_kit: 'Pre-Rift kit',
  booster_pack: 'Booster pack',
  booster_box: 'Booster box',
  bundle: 'Bundle',
  other: 'Other',
};

export const KIND_PLURAL: Record<ProductKind, string> = {
  starter_set: 'Starter sets',
  champion_deck: 'Champion decks',
  showdown_deck: 'Showdown decks',
  prerift_kit: 'Pre-Rift kits',
  booster_pack: 'Booster packs',
  booster_box: 'Booster boxes',
  bundle: 'Bundles',
  other: 'Other',
};

export const KIND_TONE: Record<ProductKind, BadgeTone> = {
  starter_set: 'success',
  champion_deck: 'accent',
  showdown_deck: 'warning',
  prerift_kit: 'neutral',
  booster_pack: 'outline',
  booster_box: 'outline',
  bundle: 'outline',
  other: 'neutral',
};

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind as ProductKind] ?? kind.replace(/_/g, ' ');
}
export function kindPlural(kind: string): string {
  return KIND_PLURAL[kind as ProductKind] ?? kind.replace(/_/g, ' ');
}
export function kindTone(kind: string): BadgeTone {
  return KIND_TONE[kind as ProductKind] ?? 'neutral';
}

/** true when the product can be "bought" into the inventory (fixed card list) */
export function isFixedList(p: Product): boolean {
  return p.fixed_contents !== 0 && p.contents.length > 0;
}

export function contentsSummary(p: Product): { copies: number; distinct: number } {
  const ids = new Set<string>();
  let copies = 0;
  for (const c of p.contents) {
    ids.add(c.card_id);
    copies += c.qty;
  }
  return { copies, distinct: ids.size };
}

/** Legend → champion → first card: used when the product has no image (or it fails to load). */
export function fallbackCardFor(p: Product, cardsById: Map<string, Card>): Card | undefined {
  let champion: Card | undefined;
  let first: Card | undefined;
  for (const c of p.contents) {
    const card = cardsById.get(c.card_id);
    if (!card) continue;
    if (card.type === 'Legend') return card;
    if (!champion && card.supertype === 'Champion') champion = card;
    if (!first) first = card;
  }
  return champion ?? first;
}

/** `#/pack?set=OGN` (or plain `#/pack` for products without a set) */
export function packHashFor(p: Product): string {
  return buildHash({ page: 'pack', query: p.set_code ? { set: p.set_code } : null });
}

export type PillKind = 'random' | 'bought' | 'complete' | 'partial' | 'none';

export interface ProductPill {
  kind: PillKind;
  text: string;
  tone: BadgeTone;
}

/** Status pill computed client-side from purchases + inventory. */
export function productPill(p: Product, st: ProductStatus, boughtQty: number): ProductPill {
  if (!isFixedList(p)) return { kind: 'random', text: 'Random contents', tone: 'outline' };
  if (st.timesBought > 0) {
    const lb = st.lastBought;
    const who = lb?.device?.name;
    const n = Math.max(boughtQty, st.timesBought);
    return { kind: 'bought', text: `Bought ×${n}${lb ? ` · ${fmtDate(lb.ts)}${who ? ` by ${who}` : ''}` : ''}`, tone: 'success' };
  }
  if (st.pctOwned !== null && st.pctOwned >= 1) return { kind: 'complete', text: 'Contents 100 % owned', tone: 'accent' };
  if (st.pctOwned !== null && st.pctOwned > 0) return { kind: 'partial', text: `Not bought · ${Math.round(st.pctOwned * 100)} % owned`, tone: 'neutral' };
  return { kind: 'none', text: 'Not bought', tone: 'neutral' };
}

// ---------------------------------------------------------------------------
// product image: product.image_url → legend/first card (CardImage chain) → icon
// ---------------------------------------------------------------------------

export function ProductImage({ product, fallbackCard, className, imgClassName }: { product: Product; fallbackCard?: Card; className?: string; imgClassName?: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [product.image_url]);
  const useRemote = Boolean(product.image_url) && !broken;
  return (
    <div className={cx('relative overflow-hidden bg-surface-2', className)}>
      {useRemote ? (
        <img src={product.image_url ?? undefined} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setBroken(true)} className={cx('absolute inset-0 h-full w-full object-contain p-3', imgClassName)} />
      ) : fallbackCard ? (
        <div className="absolute inset-0 flex items-center justify-center p-2">
          <div className="h-full" style={{ aspectRatio: '5 / 7' }}>
            <CardImage card={fallbackCard} kind="thumb" />
          </div>
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-faint" aria-hidden>
          <Package className="size-10" />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// card
// ---------------------------------------------------------------------------

export interface ProductCardProps {
  product: Product;
  status: ProductStatus;
  /** Σ qty over non-undone purchases */
  boughtQty: number;
  fallbackCard?: Card;
  fxRate: number | null;
  onOpen: (product: Product) => void;
}

function ProductCardInner({ product, status, boughtQty, fallbackCard, fxRate, onOpen }: ProductCardProps) {
  const pill = productPill(product, status, boughtQty);
  const { copies, distinct } = contentsSummary(product);
  const myr = usdToMyr(product.msrp_usd, fxRate);
  const fixed = isFixedList(product);
  const aria = `${product.name}, ${kindLabel(product.kind)}${fixed ? `, ${copies} cards` : ''}${product.msrp_usd !== null ? `, MSRP ${fmtUSD(product.msrp_usd)}` : ''}. ${pill.text}.`;

  return (
    <article
      className={cx(
        'group relative flex h-full flex-col overflow-hidden rounded-xl border bg-surface text-left transition-[border-color,box-shadow] duration-150',
        'hover:border-border-strong hover:shadow-[0_6px_24px_rgba(0,0,0,0.35)] focus-within:border-accent',
        pill.kind === 'bought' ? 'border-success/30' : 'border-border',
      )}
      data-product={product.id}
    >
      <ProductImage product={product} fallbackCard={fallbackCard} className="aspect-[4/3] w-full" />

      {/* top-left kind badge, top-right MSRP */}
      <div className="pointer-events-none absolute top-2 left-2 flex items-center gap-1">
        <Badge tone={kindTone(product.kind)} size="xs">
          {kindLabel(product.kind)}
        </Badge>
      </div>
      {product.msrp_usd !== null && (
        <span className="tabular pointer-events-none absolute top-2 right-2 rounded-md bg-bg/85 px-1.5 py-0.5 text-[11px] font-semibold text-fg shadow backdrop-blur" title={myr !== null ? `MSRP ${fmtUSD(product.msrp_usd)} ≈ ${fmtMYR(myr)}` : 'MSRP'}>
          {fmtUSD(product.msrp_usd)}
        </span>
      )}

      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <h3 className="line-clamp-2 text-[13.5px] leading-[18px] font-semibold tracking-tight text-fg" title={product.name}>
          {product.name}
        </h3>
        <p className="tabular flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-muted">
          {product.set_code && <span className="font-medium text-fg/80">{product.set_code}</span>}
          {product.set_code && <Dot />}
          {fixed ? (
            <span>
              {fmtInt(copies)} cards · {fmtInt(distinct)} unique
            </span>
          ) : (
            <span>random contents</span>
          )}
          {product.release_date && (
            <>
              <Dot />
              <span className="text-faint">{fmtDate(product.release_date)}</span>
            </>
          )}
        </p>
        {myr !== null && product.msrp_usd !== null && <p className="tabular text-[11.5px] text-faint">MSRP ≈ {fmtMYR(myr)}</p>}

        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
          <Badge tone={pill.tone} size="sm" className="max-w-full overflow-hidden" title={pill.text}>
            <span className="min-w-0 truncate">{pill.text}</span>
          </Badge>
          {pill.kind === 'random' && (
            <a
              href={packHashFor(product)}
              onClick={(e) => e.stopPropagation()}
              className="relative z-20 inline-flex h-5 items-center gap-1 rounded-md px-1 text-[11px] font-medium text-accent hover:bg-accent/10 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-accent/40"
              title="Add the cards you open in Pack mode"
            >
              <ScanLine className="size-3" aria-hidden />
              Open in Pack mode
            </a>
          )}
        </div>
      </div>

      {/* the whole card is one button (the Pack-mode link floats above it) */}
      <button type="button" aria-label={aria} onClick={() => onOpen(product)} className="absolute inset-0 z-10 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-inset" />
    </article>
  );
}

function Dot() {
  return (
    <span className="text-faint" aria-hidden>
      ·
    </span>
  );
}

export const ProductCard = memo(ProductCardInner);
