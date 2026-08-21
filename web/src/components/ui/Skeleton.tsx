import { cx } from '../../lib/format.ts';

export function Skeleton({ className, rounded = 'rounded-md' }: { className?: string; rounded?: string }) {
  return <div aria-hidden className={cx('skeleton', rounded, className)} />;
}

/** Placeholder matching a CardTile's footprint (used while the catalog loads). */
export function SkeletonTile({ style }: { style?: React.CSSProperties }) {
  return (
    <div style={style} className="flex flex-col gap-2 rounded-card border border-border bg-surface p-2" aria-hidden>
      <Skeleton className="aspect-[5/7] w-full" rounded="rounded-lg" />
      <Skeleton className="h-3.5 w-4/5" />
      <Skeleton className="h-3 w-2/5" />
      <Skeleton className="h-8 w-full" rounded="rounded-lg" />
    </div>
  );
}

export function SkeletonRows({ rows = 8 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2 p-4" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-10 w-7" rounded="rounded" />
          <Skeleton className="h-3.5 flex-1" />
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="h-8 w-24" rounded="rounded-lg" />
        </div>
      ))}
    </div>
  );
}
