import type { Finish } from '../../../../shared/types.ts';
import { cx, fmtMYR, fmtUSD, hoursSince, usdToMyr } from '../../lib/format.ts';
import { useStore } from '../../store/store.ts';
import { priceIsStale } from '../../store/selectors.ts';
import { invKey } from '../../store/types.ts';

export interface PriceCellProps {
  cardId: string;
  finish?: Finish;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  /** put MYR and USD on one line */
  inline?: boolean;
  className?: string;
}

/**
 * MYR primary, USD secondary. '—' when no price. Amber when the price or FX is stale.
 * Foil falls back to the normal-finish price (marked ≈).
 */
export function PriceCell({ cardId, finish = 'normal', size = 'sm', inline, className }: PriceCellProps) {
  // Rares/Epics only exist as foil in Riftbound, so a "normal" lookup falls back to the foil price (marked ✦);
  // a foil lookup falls back to the normal price (marked ≈).
  const other: Finish = finish === 'foil' ? 'normal' : 'foil';
  const price = useStore((s) => s.prices.get(invKey(cardId, finish)) ?? s.prices.get(invKey(cardId, other)));
  const exact = useStore((s) => s.prices.has(invKey(cardId, finish)));
  const fx = useStore((s) => s.fx);
  const usd = price?.usd_market ?? price?.usd_mid ?? null;
  const myr = usdToMyr(usd, fx?.rate ?? null);
  const stale = Boolean(price && (priceIsStale(price.fetched_at) || fx?.stale));
  const approx = Boolean(price && !exact);
  const foilOnly = approx && finish === 'normal';

  const primary = size === 'lg' ? 'text-2xl font-semibold' : size === 'md' ? 'text-sm font-semibold' : size === 'sm' ? 'text-[12.5px] font-semibold' : 'text-[11px] font-semibold';
  const secondary = size === 'lg' ? 'text-sm' : size === 'md' ? 'text-xs' : 'text-[10.5px]';

  if (usd === null) {
    return (
      <span className={cx('tabular text-faint', primary, className)} title="No price yet">
        —
      </span>
    );
  }
  const title = `${fmtUSD(usd)} TCGplayer market${fx ? ` · FX ${fx.rate.toFixed(3)}` : ''}${stale ? ' · stale' : ''}${foilOnly ? ' · foil-only printing (foil price)' : approx ? ' · normal-finish price' : ''}`;
  return (
    <span className={cx('tabular inline-flex min-w-0', inline ? 'items-baseline gap-1.5' : 'flex-col leading-tight', stale ? 'text-warning' : 'text-fg', className)} title={title}>
      <span className={cx('truncate', primary)}>
        {foilOnly ? <span className="foil-text mr-0.5 font-normal">✦</span> : approx && <span className="mr-0.5 font-normal text-muted">≈</span>}
        {myr !== null ? fmtMYR(myr) : fmtUSD(usd)}
      </span>
      {myr !== null && <span className={cx('truncate', secondary, stale ? 'text-warning/80' : 'text-muted')}>{fmtUSD(usd, { symbol: '$' })}</span>}
    </span>
  );
}

export function priceAgeLabel(fetchedAt: string | null | undefined): string {
  const h = hoursSince(fetchedAt);
  if (!Number.isFinite(h)) return 'no prices yet';
  if (h < 1) return 'prices just now';
  if (h < 48) return `prices ${Math.round(h)} h ago`;
  return `prices ${Math.round(h / 24)} d ago`;
}
