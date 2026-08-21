import type { ReactNode } from 'react';
import { cx } from '../../lib/format.ts';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}

export function EmptyState({ icon, title, description, action, className, compact }: EmptyStateProps) {
  return (
    <div className={cx('flex flex-col items-center justify-center text-center', compact ? 'px-4 py-8' : 'px-6 py-16', className)}>
      {icon && (
        <div className="mb-4 flex size-12 items-center justify-center rounded-2xl border border-border bg-surface-2 text-muted [&>svg]:size-6" aria-hidden>
          {icon}
        </div>
      )}
      <h3 className={cx('font-semibold tracking-tight text-fg', compact ? 'text-sm' : 'text-base')}>{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted">{description}</p>}
      {action && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}
