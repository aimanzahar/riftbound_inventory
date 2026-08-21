import { useEffect, useRef } from 'react';
import { useStore } from '../store/store.ts';
import { isEditable } from '../lib/hotkeys.ts';
import { setQuery, useRoute } from '../lib/router.ts';
import { PackInput } from '../components/pack/PackInput.tsx';
import { PackFlash } from '../components/pack/PackFlash.tsx';
import { PackLog } from '../components/pack/PackLog.tsx';
import { PackSessionBar } from '../components/pack/PackSessionBar.tsx';
import { usePack } from '../components/pack/packStore.ts';
import { Skeleton } from '../components/ui/Skeleton.tsx';

/**
 * Pack mode (#/pack): keyboard-first entry of collector numbers.
 *  - set selector (Tab cycles, remembered, `?set=XXX` honoured), sticky Foil (F when empty), huge autofocused input
 *  - printable keys pressed anywhere on the page are routed into the input; Ctrl+Z / Backspace-on-empty undo the last entry
 *  - every change goes through store.adjust(..., {reason:'pack'}) / store.undo(seq)
 */
export function PackPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const route = useRoute();
  const boot = useStore((s) => s.boot);
  const sets = useStore((s) => s.sets);
  const packSet = useStore((s) => s.ui.packSet);
  const setPackSet = useStore((s) => s.setPackSet);

  // `#/pack?set=SFD` → select that set once, then drop it from the query so Tab-cycling sticks
  useEffect(() => {
    const raw = route.query.get('set');
    if (!raw || !sets.length) return;
    const code = raw.trim().toUpperCase();
    if (sets.some((s) => s.code === code) && code !== useStore.getState().ui.packSet) setPackSet(code);
    const next = new URLSearchParams(route.query);
    next.delete('set');
    setQuery(next);
  }, [route, sets, setPackSet]);

  // remembered set if still valid, else the newest set
  useEffect(() => {
    if (!sets.length) return;
    if (!packSet || !sets.some((s) => s.code === packSet)) setPackSet(sets[sets.length - 1].code);
  }, [sets, packSet, setPackSet]);

  // autofocus (again once the catalog is in, in case the input mounted disabled)
  useEffect(() => {
    inputRef.current?.focus();
  }, [boot]);

  // page-wide key routing — capture phase so it runs before the app's hotkeys
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (document.querySelector('dialog[open]')) return;
      const input = inputRef.current;
      if (!input) return;
      const target = e.target as HTMLElement | null;
      const inInput = target === input;
      const mod = e.ctrlKey || e.metaKey;
      // Ctrl/Cmd+Z → undo the last entry (also while typing)
      if (mod && !e.shiftKey && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
        if (!inInput && isEditable(target)) return;
        e.preventDefault();
        void usePack.getState().undoLast();
        return;
      }
      if (inInput || mod || e.altKey) return; // the input handles its own keys
      if (isEditable(target)) return; // some other field (tip editor, settings…)
      const pack = usePack.getState();
      const key = e.key;
      if (key.length === 1 && /[0-9a-z*-]/i.test(key)) {
        e.preventDefault();
        if (pack.picker) {
          if (/^[1-9]$/.test(key)) pack.pickIndex(Number(key) - 1);
        } else if (!pack.input && (key === 'f' || key === 'F')) {
          useStore.getState().toggleFoilSticky();
        } else {
          pack.appendInput(key);
        }
        input.focus();
        return;
      }
      // Enter / Backspace / Escape only when nothing interactive has focus (buttons keep theirs)
      if (target?.closest?.('button, a, [role="button"], [role="listitem"], summary, select, textarea, input, [contenteditable]')) return;
      if (key === 'Enter') {
        e.preventDefault();
        pack.submit();
        input.focus();
      } else if (key === 'Backspace') {
        e.preventDefault();
        pack.backspace();
        input.focus();
      } else if (key === 'Escape' && pack.picker) {
        e.preventDefault();
        pack.closePicker();
        input.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // an undo of one of our entries arriving from anywhere (Activity page, the other device) marks the row undone
  useEffect(
    () =>
      useStore.subscribe((s, prev) => {
        if (s.recentChanges === prev.recentChanges) return;
        const c = s.recentChanges[0];
        if (c && c.kind === 'inventory' && c.undo_of !== null) usePack.getState().markUndoneBySeq(c.undo_of);
      }),
    [],
  );

  if (boot !== 'ready') {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 sm:p-6" aria-busy="true" aria-label="Loading pack mode">
        <Skeleton className="h-8 w-64" rounded="rounded-lg" />
        <Skeleton className="h-16 w-full sm:h-20" rounded="rounded-2xl" />
        <Skeleton className="h-4 w-72" />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_auto_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-[auto_minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_420px]">
        <PackInput inputRef={inputRef} className="lg:col-start-1 lg:row-start-1" />
        <PackFlash className="border-b border-border lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:border-b-0 lg:border-l" />
        <PackLog className="min-h-0 lg:col-start-1 lg:row-start-2" />
      </div>
      <PackSessionBar />
    </div>
  );
}
