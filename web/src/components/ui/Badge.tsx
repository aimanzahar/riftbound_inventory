import type { ReactNode } from 'react';
import { cx } from '../../lib/format.ts';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'foil' | 'outline';

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-surface-3 text-muted',
  accent: 'bg-accent/15 text-accent-strong',
  success: 'bg-success/15 text-[#86efac]',
  warning: 'bg-warning/15 text-[#fcd34d]',
  danger: 'bg-danger/15 text-[#fca5a5]',
  foil: 'bg-[linear-gradient(120deg,#f0abfc,#93c5fd,#fde68a)] text-[#1b1033] font-semibold',
  outline: 'border border-border-strong text-muted',
};

export function Badge({ tone = 'neutral', size = 'sm', className, children, title }: { tone?: BadgeTone; size?: 'xs' | 'sm' | 'md'; className?: string; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex shrink-0 items-center gap-1 rounded-md font-medium whitespace-nowrap tabular',
        size === 'xs' ? 'h-[18px] px-1.5 text-[10.5px]' : size === 'sm' ? 'h-5 px-1.5 text-[11px]' : 'h-6 px-2 text-xs',
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusDot({ color, className, pulse }: { color: string; className?: string; pulse?: boolean }) {
  return (
    <span className={cx('relative inline-flex size-2 shrink-0 rounded-full', className)} style={{ background: color }} aria-hidden>
      {pulse && <span className="absolute inset-0 animate-ping rounded-full opacity-60" style={{ background: color }} />}
    </span>
  );
}
