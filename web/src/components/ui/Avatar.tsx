import { cx } from '../../lib/format.ts';

export interface AvatarProps {
  name: string;
  color: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  /** brief ring animation (remote activity) */
  pulse?: boolean;
  title?: string;
  className?: string;
  /** shows a small count bubble (open tabs) */
  badge?: number;
}

const SIZE = { xs: 'size-5 text-[9px]', sm: 'size-7 text-[11px]', md: 'size-9 text-[13px]', lg: 'size-14 text-xl' };

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({ name, color, size = 'sm', pulse, title, className, badge }: AvatarProps) {
  return (
    <span
      title={title ?? name}
      aria-label={name}
      role="img"
      className={cx('relative inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold tracking-tight', SIZE[size], pulse && 'avatar-pulse', className)}
      style={{ background: `color-mix(in oklab, ${color} 28%, var(--color-surface-2))`, color, boxShadow: `0 0 0 1.5px color-mix(in oklab, ${color} 70%, transparent) inset`, ['--pulse-color' as string]: color }}
    >
      {initials(name)}
      {badge !== undefined && badge > 1 && (
        <span className="absolute -right-1 -bottom-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-surface-3 px-0.5 text-[9px] font-semibold text-muted ring-2 ring-surface">{badge}</span>
      )}
    </span>
  );
}
