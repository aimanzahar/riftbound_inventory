import { DOMAINS, DOMAIN_ORDER } from '../../../../shared/constants.ts';
import { cx } from '../../lib/format.ts';

export function domainColor(id: string): string {
  return DOMAINS[id]?.color ?? DOMAINS.colorless.color;
}
export function domainLabel(id: string): string {
  return DOMAINS[id]?.label ?? id;
}

export function sortDomains(ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    const ia = DOMAIN_ORDER.indexOf(a),
      ib = DOMAIN_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

/** Small coloured dots for a card's domains (colour + title, never colour alone). */
export function DomainPips({ domains, size = 'sm', className, withLabel }: { domains: string[]; size?: 'xs' | 'sm' | 'md'; className?: string; withLabel?: boolean }) {
  const ids = sortDomains(domains);
  if (!ids.length) return null;
  const px = size === 'xs' ? 'size-1.5' : size === 'sm' ? 'size-2' : 'size-2.5';
  return (
    <span className={cx('inline-flex items-center gap-1', className)} aria-label={`Domains: ${ids.map(domainLabel).join(', ')}`} title={ids.map(domainLabel).join(' / ')}>
      {ids.map((d) => (
        <span key={d} className={cx('inline-block shrink-0 rounded-full', px)} style={{ background: domainColor(d), boxShadow: '0 0 0 1px rgba(0,0,0,0.35)' }} aria-hidden />
      ))}
      {withLabel && <span className="text-xs text-muted">{ids.map(domainLabel).join(' / ')}</span>}
    </span>
  );
}

/** Chip-sized domain label (filter bar, drawer header). */
export function DomainChip({ id, active, count, onClick }: { id: string; active?: boolean; count?: number; onClick?: () => void }) {
  const color = domainColor(id);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors',
        active ? 'border-transparent text-[#0b0f17]' : 'border-border bg-surface-2 text-muted hover:text-fg hover:border-border-strong',
      )}
      style={active ? { background: color } : undefined}
    >
      {!active && <span className="size-2 rounded-full" style={{ background: color }} aria-hidden />}
      {domainLabel(id)}
      {count !== undefined && <span className={cx('tabular text-[11px]', active ? 'opacity-70' : 'text-faint')}>{count}</span>}
    </button>
  );
}
