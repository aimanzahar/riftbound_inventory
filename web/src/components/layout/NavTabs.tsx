import type { ReactNode } from 'react';
import { Activity, Boxes, Layers, LayoutGrid, ScanLine, Settings, Swords } from 'lucide-react';
import { go, useRoute, type Page } from '../../lib/router.ts';
import { useStore } from '../../store/store.ts';
import { cx } from '../../lib/format.ts';

export const NAV: Array<{ page: Page; label: string; icon: ReactNode; short: string }> = [
  { page: 'collection', label: 'Collection', short: 'Cards', icon: <LayoutGrid className="size-[18px]" aria-hidden /> },
  { page: 'products', label: 'Products', short: 'Products', icon: <Boxes className="size-[18px]" aria-hidden /> },
  { page: 'meta', label: 'Meta decks', short: 'Meta', icon: <Swords className="size-[18px]" aria-hidden /> },
  { page: 'decks', label: 'My decks', short: 'Decks', icon: <Layers className="size-[18px]" aria-hidden /> },
  { page: 'pack', label: 'Pack mode', short: 'Pack', icon: <ScanLine className="size-[18px]" aria-hidden /> },
  { page: 'activity', label: 'Activity', short: 'Activity', icon: <Activity className="size-[18px]" aria-hidden /> },
  { page: 'settings', label: 'Settings', short: 'Settings', icon: <Settings className="size-[18px]" aria-hidden /> },
];

/** Horizontal tabs (640–1023 px). */
export function NavTabs({ className }: { className?: string }) {
  const route = useRoute();
  return (
    <nav aria-label="Primary" className={cx('no-scrollbar flex items-center gap-0.5 overflow-x-auto', className)}>
      {NAV.map((n) => {
        const active = route.page === n.page;
        return (
          <button
            key={n.page}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={() => go(n.page)}
            className={cx(
              'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors',
              active ? 'bg-surface-3 text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
            )}
          >
            {n.icon}
            {n.label}
          </button>
        );
      })}
    </nav>
  );
}

/** Left rail (≥1024 px). */
export function NavRail({ className }: { className?: string }) {
  const route = useRoute();
  const name = useStore((s) => s.settings.collection_name);
  return (
    <aside className={cx('flex w-[216px] shrink-0 flex-col border-r border-border bg-surface/60', className)}>
      <div className="flex h-14 items-center gap-2.5 px-4">
        <Brand />
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[13px] font-semibold tracking-tight">{name || 'Riftbound Inventory'}</div>
          <div className="text-[11px] text-faint">LAN · realtime</div>
        </div>
      </div>
      <nav aria-label="Primary" className="flex flex-1 flex-col gap-0.5 px-2.5 pt-1">
        {NAV.map((n) => {
          const active = route.page === n.page;
          return (
            <button
              key={n.page}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => go(n.page)}
              className={cx(
                'group relative flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] font-medium transition-colors',
                active ? 'bg-surface-3 text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
              )}
            >
              {active && <span className="absolute top-1/2 -left-2.5 h-5 w-[3px] -translate-y-1/2 rounded-r bg-accent" aria-hidden />}
              <span className={cx(active ? 'text-accent' : 'text-faint group-hover:text-muted')}>{n.icon}</span>
              {n.label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

/** Bottom tab bar (<640 px). */
export function BottomTabs({ className }: { className?: string }) {
  const route = useRoute();
  return (
    <nav aria-label="Primary" className={cx('pb-safe grid grid-cols-7 border-t border-border bg-surface/95 backdrop-blur', className)}>
      {NAV.map((n) => {
        const active = route.page === n.page;
        return (
          <button
            key={n.page}
            type="button"
            aria-current={active ? 'page' : undefined}
            aria-label={n.label}
            onClick={() => go(n.page)}
            className={cx('flex h-[52px] flex-col items-center justify-center gap-0.5 text-[10px] font-medium', active ? 'text-accent' : 'text-muted')}
          >
            {n.icon}
            <span>{n.short}</span>
          </button>
        );
      })}
    </nav>
  );
}

export function Brand({ className }: { className?: string }) {
  return (
    <span className={cx('flex size-8 shrink-0 items-center justify-center rounded-lg bg-[linear-gradient(135deg,#7c9cff,#a855f7)] text-[13px] font-black tracking-tighter text-[#0b0f17] shadow-[0_1px_0_rgba(255,255,255,0.25)_inset]', className)} aria-hidden>
      RB
    </span>
  );
}
