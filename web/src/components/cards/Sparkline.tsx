import { useMemo } from 'react';
import { cx, fmtUSD } from '../../lib/format.ts';

export interface SparkPoint {
  day: string;
  value: number | null;
}

/** Inline SVG sparkline (90-day price). No deps. */
export function Sparkline({ points, width = 280, height = 56, className, stroke = 'var(--color-accent)' }: { points: SparkPoint[]; width?: number; height?: number; className?: string; stroke?: string }) {
  const d = useMemo(() => {
    const vals = points.filter((p) => p.value !== null) as Array<{ day: string; value: number }>;
    if (vals.length < 2) return null;
    const min = Math.min(...vals.map((v) => v.value));
    const max = Math.max(...vals.map((v) => v.value));
    const span = max - min || 1;
    const padX = 2,
      padY = 4;
    const t0 = new Date(vals[0].day).getTime();
    const t1 = new Date(vals[vals.length - 1].day).getTime();
    const tspan = t1 - t0 || 1;
    const pts = vals.map((v) => {
      const x = padX + ((new Date(v.day).getTime() - t0) / tspan) * (width - padX * 2);
      const y = padY + (1 - (v.value - min) / span) * (height - padY * 2);
      return [x, y] as const;
    });
    const path = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const area = `${path} L${pts[pts.length - 1][0].toFixed(1)},${height} L${pts[0][0].toFixed(1)},${height} Z`;
    const first = vals[0].value,
      last = vals[vals.length - 1].value;
    return { path, area, min, max, first, last, lastPt: pts[pts.length - 1] };
  }, [points, width, height]);

  if (!d) {
    return (
      <div className={cx('flex h-14 items-center justify-center rounded-lg border border-dashed border-border text-xs text-faint', className)} style={{ width }}>
        Not enough history yet
      </div>
    );
  }
  const delta = d.last - d.first;
  const pct = d.first ? (delta / d.first) * 100 : 0;
  const up = delta >= 0;
  const color = delta === 0 ? stroke : up ? 'var(--color-success)' : 'var(--color-danger)';
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Price trend: ${fmtUSD(d.first)} to ${fmtUSD(d.last)}`} className="block max-w-full">
        <defs>
          <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={d.area} fill="url(#spark-fill)" />
        <path d={d.path} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={d.lastPt[0]} cy={d.lastPt[1]} r="2.5" fill={color} />
      </svg>
      <div className="flex items-center justify-between text-[11px] tabular text-muted">
        <span>
          low {fmtUSD(d.min)} · high {fmtUSD(d.max)}
        </span>
        <span style={{ color }}>
          {up ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
        </span>
      </div>
    </div>
  );
}
