import { useEffect, useRef, useState } from 'react';
import { ArrowUpDown, Check } from 'lucide-react';
import { useStore } from '../../store/store.ts';
import { SORT_KEYS, SORT_LABELS, type SortKey } from '../../store/types.ts';
import { cx } from '../../lib/format.ts';

const SHORT: Record<SortKey, string> = { number: 'Number', name: 'Name', price: 'Price', qty: 'Qty', recent: 'Recent' };

/** Sort popover (keyboard: arrows + Enter, Esc closes). */
export function SortMenu({ className, compact }: { className?: string; compact?: boolean }) {
  const sort = useStore((s) => s.ui.sort);
  const setSort = useStore((s) => s.setSort);
  const searching = useStore((s) => s.ui.search.trim().length > 0);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey, true);
    const active = listRef.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    active?.focus();
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const onListKey = (e: React.KeyboardEvent) => {
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    }
  };

  return (
    <div ref={root} className={cx('relative', className)}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title={searching ? 'Sorted by relevance while searching' : `Sort: ${SORT_LABELS[sort]}`}
        className={cx(
          'inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 text-[13px] font-medium text-muted transition-colors hover:text-fg',
          compact && 'w-8 justify-center px-0',
        )}
      >
        <ArrowUpDown className="size-4" aria-hidden />
        {!compact && <span>{searching ? 'Relevance' : SHORT[sort]}</span>}
      </button>
      {open && (
        <div
          ref={listRef}
          role="menu"
          aria-label="Sort cards"
          onKeyDown={onListKey}
          className="fade-up absolute right-0 z-40 mt-1 w-56 overflow-hidden rounded-xl border border-border bg-surface-2 p-1 shadow-pop"
        >
          {SORT_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              role="menuitemradio"
              aria-checked={sort === k}
              onClick={() => {
                setSort(k);
                setOpen(false);
              }}
              className={cx('flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-surface-3', sort === k ? 'text-fg' : 'text-muted')}
            >
              {SORT_LABELS[k]}
              {sort === k && <Check className="size-4 text-accent" aria-hidden />}
            </button>
          ))}
          {searching && <p className="px-2.5 pt-1.5 pb-1 text-[11px] text-faint">Search results are ranked by relevance; sorting applies when the search is cleared.</p>}
        </div>
      )}
    </div>
  );
}
