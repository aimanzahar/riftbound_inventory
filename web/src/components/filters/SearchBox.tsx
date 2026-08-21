import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useStore } from '../../store/store.ts';
import { cx } from '../../lib/format.ts';
import { Kbd } from '../ui/Kbd.tsx';

let activeInput: HTMLInputElement | null = null;
/** Focus the mounted search box (hotkeys `/`, Ctrl+K). */
export function focusSearch(): boolean {
  if (!activeInput) return false;
  activeInput.focus();
  activeInput.select();
  return true;
}

/** Debounced (60 ms) search bound to the store; Esc clears, then blurs. */
export function SearchBox({ className, autoFocus, placeholder = 'Search name or number…', compact }: { className?: string; autoFocus?: boolean; placeholder?: string; compact?: boolean }) {
  const search = useStore((s) => s.ui.search);
  const setSearch = useStore((s) => s.setSearch);
  const [value, setValue] = useState(search);
  const ref = useRef<HTMLInputElement>(null);
  const timer = useRef<number | null>(null);

  // external changes (route / reset) → local
  useEffect(() => {
    if (search !== value && document.activeElement !== ref.current) setValue(search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    activeInput = ref.current;
    return () => {
      if (activeInput === ref.current) activeInput = null;
    };
  }, []);

  const commit = (v: string, immediate = false) => {
    setValue(v);
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (immediate) {
      timer.current = null;
      setSearch(v);
      return;
    }
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setSearch(v);
    }, 60);
  };

  return (
    <div className={cx('relative flex min-w-0 items-center', className)}>
      <Search className="pointer-events-none absolute left-2.5 size-4 text-faint" aria-hidden />
      <input
        ref={ref}
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            if (value) {
              e.preventDefault();
              e.stopPropagation();
              commit('', true);
            } else ref.current?.blur();
          }
          if (e.key === 'Enter') commit(value, true);
        }}
        placeholder={placeholder}
        aria-label="Search cards"
        autoComplete="off"
        spellCheck={false}
        className={cx(
          'h-9 w-full min-w-0 rounded-lg border border-border bg-surface-2 pl-8 text-sm text-fg placeholder:text-faint focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/30 [&::-webkit-search-cancel-button]:appearance-none',
          value ? 'pr-8' : compact ? 'pr-3' : 'pr-10',
        )}
      />
      {value ? (
        <button type="button" aria-label="Clear search" onClick={() => commit('', true)} className="absolute right-1.5 rounded-md p-1 text-faint hover:bg-surface-3 hover:text-fg">
          <X className="size-3.5" />
        </button>
      ) : (
        !compact && (
          <span className="pointer-events-none absolute right-2 hidden sm:inline-flex" aria-hidden>
            <Kbd>/</Kbd>
          </span>
        )
      )}
    </div>
  );
}
