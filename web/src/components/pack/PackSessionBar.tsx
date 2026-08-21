import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { cx, fmtInt, fmtMYR, fmtUSD, relTime } from '../../lib/format.ts';
import { Button } from '../ui/Button.tsx';
import { usePack, usePackSession } from './packStore.ts';

/** "This session: 24 cards · ≈ RM 120 (US$ 26) · 4 new uniques" + Finish (summary toast, clears the session). */
export function PackSessionBar({ className }: { className?: string }) {
  const stats = usePackSession();
  const startedAt = usePack((s) => s.startedAt);
  const finishSession = usePack((s) => s.finishSession);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const t = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, [startedAt]);

  const empty = stats.entries === 0;
  return (
    <div className={cx('flex shrink-0 items-center gap-3 border-t border-border bg-surface/70 px-4 py-2 backdrop-blur sm:px-6', className)} style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
      <p className="tabular flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5 text-[12.5px] text-muted" aria-live="polite" aria-atomic="true">
        <span className="text-faint">This session:</span>
        {empty ? (
          <span>no cards yet</span>
        ) : (
          <>
            <span>
              <strong className="font-semibold text-fg">{fmtInt(stats.cards)}</strong> card{stats.cards === 1 ? '' : 's'}
              {stats.foil > 0 && (
                <span className="ml-1 text-faint">
                  (<span className="foil-text font-semibold">✦{fmtInt(stats.foil)}</span>)
                </span>
              )}
            </span>
            <Dot />
            {stats.usd > 0 && stats.myr !== null ? (
              <span title={stats.unpriced ? `${fmtInt(stats.unpriced)} copies have no price yet` : 'TCGplayer market × FX'}>
                ≈ <strong className="font-semibold text-fg">{fmtMYR(stats.myr, { compact: true })}</strong> <span className="text-faint">({fmtUSD(stats.usd, { compact: true })})</span>
              </span>
            ) : stats.usd > 0 ? (
              <span>
                ≈ <strong className="font-semibold text-fg">{fmtUSD(stats.usd, { compact: true })}</strong>
              </span>
            ) : (
              <span className="text-faint">no price yet</span>
            )}
            <Dot />
            <span>
              <strong className={cx('font-semibold', stats.newUniques > 0 ? 'text-[#86efac]' : 'text-fg')}>{fmtInt(stats.newUniques)}</strong> new unique{stats.newUniques === 1 ? '' : 's'}
            </span>
            {startedAt && (
              <>
                <Dot className="hidden sm:inline" />
                <span className="hidden text-faint sm:inline">started {relTime(startedAt)}</span>
              </>
            )}
          </>
        )}
      </p>
      <Button variant="primary" size="sm" disabled={empty} onClick={finishSession} leftIcon={<Check className="size-4" />} className="pointer-coarse:h-11" title="Show a summary and start a fresh session">
        Finish
      </Button>
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
