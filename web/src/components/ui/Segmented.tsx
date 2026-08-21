import type { ReactNode } from 'react';
import { cx } from '../../lib/format.ts';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  title?: string;
  count?: number;
  disabled?: boolean;
}

export interface SegmentedProps<T extends string> {
  options: Array<SegmentedOption<T>>;
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  ariaLabel: string;
  className?: string;
  /** icons only (labels become tooltips) */
  iconOnly?: boolean;
}

export function Segmented<T extends string>({ options, value, onChange, size = 'md', ariaLabel, className, iconOnly }: SegmentedProps<T>) {
  return (
    <div role="group" aria-label={ariaLabel} className={cx('inline-flex shrink-0 items-center rounded-lg border border-border bg-surface-2 p-0.5', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            aria-label={iconOnly && typeof o.label === 'string' ? o.label : undefined}
            title={o.title ?? (iconOnly && typeof o.label === 'string' ? o.label : undefined)}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cx(
              'inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors duration-100 disabled:opacity-40',
              size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-3 text-[13px]',
              iconOnly && (size === 'sm' ? 'w-7 px-0' : 'w-8 px-0'),
              active ? 'bg-surface-3 text-fg shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]' : 'text-muted hover:text-fg',
            )}
          >
            {o.icon}
            {!iconOnly && o.label}
            {o.count !== undefined && <span className={cx('tabular text-[11px]', active ? 'text-muted' : 'text-faint')}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
