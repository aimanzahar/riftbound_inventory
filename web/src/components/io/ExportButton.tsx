import { useId, useState } from 'react';
import { Download } from 'lucide-react';
import { useStore } from '../../store/store.ts';
import { cx, fmtInt } from '../../lib/format.ts';

/**
 * Export CSV (`/api/export.csv`, server sets the filename) with an
 * "include zero-qty rows" toggle (`?include_zero=1` — keeps notes on cards you no longer own).
 */
export function ExportButton({ className }: { className?: string }) {
  const [includeZero, setIncludeZero] = useState(false);
  const id = useId();
  const rows = useStore((s) => {
    let n = 0;
    for (const r of s.inventory.values()) if (r.qty > 0 || (includeZero && r.note)) n++;
    return n;
  });
  const href = includeZero ? '/api/export.csv?include_zero=1' : '/api/export.csv';
  return (
    <div className={cx('flex flex-wrap items-center gap-x-4 gap-y-2', className)}>
      <a href={href} download className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3.5 text-sm font-semibold text-[#0b0f17] shadow-[0_1px_0_rgba(255,255,255,0.15)_inset] hover:bg-accent-strong focus-visible:ring-2 focus-visible:ring-accent/50" title={`${fmtInt(rows)} row${rows === 1 ? '' : 's'}`}>
        <Download className="size-4" aria-hidden />
        Export CSV
        <span className="tabular rounded-md bg-black/15 px-1.5 text-[11px] font-semibold">{fmtInt(rows)}</span>
      </a>
      <label htmlFor={id} className="inline-flex cursor-pointer items-center gap-2 text-sm text-muted select-none">
        <input id={id} type="checkbox" checked={includeZero} onChange={(e) => setIncludeZero(e.target.checked)} className="size-4 cursor-pointer accent-[var(--color-accent)]" />
        Include zero-qty rows
        <span className="hidden text-xs text-faint sm:inline">(keeps notes on cards you no longer own)</span>
      </label>
    </div>
  );
}
