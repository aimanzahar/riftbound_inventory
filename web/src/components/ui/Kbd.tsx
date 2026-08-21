import type { ReactNode } from 'react';
import { cx } from '../../lib/format.ts';

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cx(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-border-strong bg-surface-2 px-1.5 font-mono text-[11px] leading-none text-muted shadow-[0_1px_0_rgba(0,0,0,0.4)]',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export function Keys({ keys, className }: { keys: string[]; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1', className)}>
      {keys.map((k, i) => (
        <Kbd key={`${k}-${i}`}>{k}</Kbd>
      ))}
    </span>
  );
}
