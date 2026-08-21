import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import type { PurchasePreview, PurchaseSeverity } from '../../../../shared/types.ts';
import { cx, fmtInt, fmtMYR, fmtUSD, usdToMyr } from '../../lib/format.ts';

export interface DupBannerProps {
  preview: PurchasePreview;
  /** MSRP per unit (USD) */
  msrpUsd: number | null;
  fxRate: number | null;
  /** red severity: "Add anyway" acknowledgement */
  ack: boolean;
  onAck: (v: boolean) => void;
  className?: string;
}

type Tone = PurchaseSeverity | 'neutral';

const TONE: Record<Tone, { box: string; icon: string }> = {
  red: { box: 'border-danger/45 bg-danger/10', icon: 'text-danger' },
  amber: { box: 'border-warning/45 bg-warning/10', icon: 'text-warning' },
  green: { box: 'border-success/40 bg-success/10', icon: 'text-success' },
  neutral: { box: 'border-border bg-surface-2', icon: 'text-muted' },
};

/** Estimated value line: "Contents ≈ US$38.00 (RM 154) vs MSRP US$19.99 · 20 of 24 priced" */
export function valueLine(preview: PurchasePreview, msrpUsd: number | null, fxRate: number | null): string {
  const s = preview.summary;
  if (s.distinct === 0) return '';
  if (s.priced_lines === 0 || s.est_value_usd <= 0) return 'No market prices yet for these cards.';
  const myr = usdToMyr(s.est_value_usd, fxRate);
  let out = `Contents ≈ ${fmtUSD(s.est_value_usd)}${myr !== null ? ` (${fmtMYR(myr)})` : ''}`;
  if (msrpUsd !== null && msrpUsd > 0) {
    const msrp = msrpUsd * preview.qty;
    out += ` vs MSRP ${fmtUSD(msrp)}`;
    out += ` · ${Math.round((s.est_value_usd / msrp) * 100)} % of MSRP`;
  }
  if (s.priced_lines < s.distinct) out += ` · ${fmtInt(s.priced_lines)} of ${fmtInt(s.distinct)} priced`;
  return out;
}

/**
 * Duplicate warning by severity (from the server preview):
 *  red   — already bought / nothing new → requires the "Add anyway" checkbox
 *  amber — some duplicates
 *  green — all new
 */
export function DupBanner({ preview, msrpUsd, fxRate, ack, onAck, className }: DupBannerProps) {
  const s = preview.summary;
  const tone: Tone = s.distinct === 0 ? 'neutral' : s.severity;
  const t = TONE[tone];
  const Icon = tone === 'red' ? CircleAlert : tone === 'amber' ? TriangleAlert : tone === 'green' ? CircleCheck : Info;
  const value = valueLine(preview, msrpUsd, fxRate);
  const red = tone === 'red';

  return (
    <div role={red ? 'alert' : 'status'} className={cx('flex gap-3 rounded-xl border p-3', t.box, className)}>
      <Icon className={cx('mt-0.5 size-5 shrink-0', t.icon)} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] leading-snug font-medium text-fg">{s.headline}</p>
        {value && <p className="tabular mt-1 text-xs text-muted">{value}</p>}
        {s.distinct > 0 && (
          <p className="tabular mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-muted">
            <span>
              <strong className="font-semibold text-success">{fmtInt(s.new_copies)}</strong> new
            </span>
            <span>
              <strong className={cx('font-semibold', s.dup_copies ? 'text-warning' : 'text-muted')}>{fmtInt(s.dup_copies)}</strong> duplicate{s.dup_copies === 1 ? '' : 's'}
            </span>
            {s.beyond_playset_copies > 0 && (
              <span>
                <strong className="font-semibold text-danger">{fmtInt(s.beyond_playset_copies)}</strong> beyond a playset
              </span>
            )}
          </p>
        )}
        {red && (
          <label className="mt-2.5 inline-flex cursor-pointer items-center gap-2 text-[13px] text-fg select-none">
            <input type="checkbox" checked={ack} onChange={(e) => onAck(e.target.checked)} className="size-4 cursor-pointer accent-[var(--color-danger)]" />
            Add anyway — I know these are duplicates
          </label>
        )}
      </div>
    </div>
  );
}
