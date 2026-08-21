import { useStore } from '../../store/store.ts';
import { useTotals } from '../../store/selectors.ts';
import { cx, fmtInt, fmtMYR, fmtUSD } from '../../lib/format.ts';
import { priceAgeLabel } from '../cards/PriceCell.tsx';

/** "612 / 1,012 unique · 1,870 cards · ≈ RM 4,320 (US$ 912) · FX 4.74 · prices 2 h ago" */
export function SummaryStrip({ visible, total, className }: { visible: number; total: number; className?: string }) {
  const t = useTotals();
  const fx = useStore((s) => s.fx);
  const pricesAt = useStore((s) => s.pricesFetchedAt);
  const filtered = visible !== total;
  return (
    <div className={cx('tabular flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12.5px] text-muted', className)} aria-label="Collection summary">
      <span>
        <strong className="font-semibold text-fg">{fmtInt(t.uniqueOwned)}</strong> / {fmtInt(t.uniqueTotal)} unique
      </span>
      <Dot />
      <span>
        <strong className="font-semibold text-fg">{fmtInt(t.copies)}</strong> cards
        {t.foilCopies > 0 && (
          <span className="ml-1 text-faint">
            (<span className="foil-text font-semibold">✦{fmtInt(t.foilCopies)}</span>)
          </span>
        )}
      </span>
      <Dot />
      {t.valueMyr !== null ? (
        <span title={t.unpricedCopies ? `${fmtInt(t.unpricedCopies)} copies have no price yet` : 'TCGplayer market × FX'}>
          ≈ <strong className="font-semibold text-fg">{fmtMYR(t.valueMyr, { compact: true })}</strong> <span className="text-faint">({fmtUSD(t.valueUsd, { compact: true })})</span>
        </span>
      ) : t.valueUsd > 0 ? (
        <span>
          ≈ <strong className="font-semibold text-fg">{fmtUSD(t.valueUsd, { compact: true })}</strong>
        </span>
      ) : (
        <span className="text-faint">no value yet</span>
      )}
      <Dot className="hidden sm:inline" />
      <span className={cx('hidden sm:inline', fx?.stale && 'text-warning')} title={fx ? `${fx.source} · ${fx.day}${fx.stale ? ' (stale)' : ''}` : 'No FX rate yet'}>
        FX {fx ? fx.rate.toFixed(2) : '—'}
      </span>
      <Dot className="hidden md:inline" />
      <span className="hidden md:inline">{priceAgeLabel(pricesAt)}</span>
      {filtered && (
        <>
          <span className="mx-1 hidden text-faint sm:inline">·</span>
          <span className="text-accent">
            showing {fmtInt(visible)} of {fmtInt(total)}
          </span>
        </>
      )}
    </div>
  );
}

function Dot({ className }: { className?: string }) {
  return (
    <span className={cx('text-faint', className)} aria-hidden>
      ·
    </span>
  );
}
