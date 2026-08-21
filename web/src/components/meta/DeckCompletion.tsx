import { cx } from '../../lib/format.ts';

export interface DeckCompletionProps {
  /** copies you own (already capped at `total`) */
  owned: number;
  /** copies the list needs */
  total: number;
  size?: 'sm' | 'md';
  /** bar only — no “You own 37/40 · 92 %” caption */
  bare?: boolean;
  /** caption prefix (default “You own”) */
  prefix?: string;
  className?: string;
}

export type CompletionTone = 'complete' | 'partial' | 'missing';

export function completionTone(owned: number, total: number): CompletionTone {
  if (total > 0 && owned >= total) return 'complete';
  return owned > 0 ? 'partial' : 'missing';
}

/** “You own 37/40” progress bar — green when complete, accent while partial, faint when nothing yet. */
export function DeckCompletion({ owned, total, size = 'sm', bare, prefix = 'You own', className }: DeckCompletionProps) {
  const pct = total > 0 ? Math.min(1, Math.max(0, owned / total)) : 0;
  const tone = completionTone(owned, total);
  const bar = tone === 'complete' ? 'bg-success' : tone === 'partial' ? 'bg-accent' : 'bg-faint/60';
  const label = `${prefix} ${owned} of ${total} cards (${Math.round(pct * 100)}%)`;
  return (
    <div className={cx('flex min-w-0 flex-col gap-1', className)}>
      {!bare && (
        <div className="tabular flex items-baseline justify-between gap-2 text-[11px] leading-none">
          <span className="truncate text-muted">
            {prefix} <span className={cx('font-semibold', tone === 'complete' ? 'text-[#86efac]' : tone === 'partial' ? 'text-fg' : 'text-faint')}>{owned}/{total}</span>
          </span>
          <span className={cx('shrink-0', tone === 'complete' ? 'text-[#86efac]' : 'text-faint')}>{Math.round(pct * 100)}%</span>
        </div>
      )}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, total)}
        aria-valuenow={Math.min(owned, total)}
        aria-label={label}
        title={label}
        className={cx('w-full overflow-hidden rounded-full bg-surface-3', size === 'md' ? 'h-2' : 'h-1.5')}
      >
        <div className={cx('h-full rounded-full transition-[width] duration-300', bar)} style={{ width: `${pct * 100}%` }} />
      </div>
    </div>
  );
}
