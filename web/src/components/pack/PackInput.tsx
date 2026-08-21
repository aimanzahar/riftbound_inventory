import { useEffect, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { CornerDownLeft, Delete, Sparkles } from 'lucide-react';
import type { Card } from '../../../../shared/types.ts';
import { useStore } from '../../store/store.ts';
import { useOwnedTotal, useQty } from '../../store/selectors.ts';
import { cx } from '../../lib/format.ts';
import { preload } from '../../lib/images.ts';
import { useIsCoarse, useIsPhone } from '../../lib/useMediaQuery.ts';
import { Segmented } from '../ui/Segmented.tsx';
import { Kbd } from '../ui/Kbd.tsx';
import { CardImage } from '../cards/CardImage.tsx';
import { usePreview, rectOf } from '../cards/previewStore.ts';
import { printingLabel, usePack, useResolution, type Resolution } from './packStore.ts';

/** Set selector · sticky Foil toggle · huge input · live match line / printing picker · phone buttons. */
export function PackInput({ inputRef, className }: { inputRef: RefObject<HTMLInputElement | null>; className?: string }) {
  const sets = useStore((s) => s.sets);
  const packSet = useStore((s) => s.ui.packSet);
  const setPackSet = useStore((s) => s.setPackSet);
  const foilSticky = useStore((s) => s.ui.foilSticky);
  const toggleFoil = useStore((s) => s.toggleFoilSticky);
  const input = usePack((s) => s.input);
  const setInput = usePack((s) => s.setInput);
  const picker = usePack((s) => s.picker);
  const shakeN = usePack((s) => s.shakeN);
  const submit = usePack((s) => s.submit);
  const backspace = usePack((s) => s.backspace);
  const cycleSet = usePack((s) => s.cycleSet);
  const movePicker = usePack((s) => s.movePicker);
  const pickIndex = usePack((s) => s.pickIndex);
  const closePicker = usePack((s) => s.closePicker);
  const res = useResolution();
  const wrapRef = useRef<HTMLDivElement>(null);
  const coarse = useIsCoarse();
  const phone = useIsPhone();

  // rejected Enter → shake the input (restartable)
  useEffect(() => {
    if (!shakeN) return;
    const el = wrapRef.current;
    if (!el) return;
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
    const t = window.setTimeout(() => el.classList.remove('shake'), 520);
    return () => window.clearTimeout(t);
  }, [shakeN]);

  const refocus = () => inputRef.current?.focus();

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return; // Ctrl+Z is handled page-wide
    if (picker) {
      switch (e.key) {
        case 'Enter':
          e.preventDefault();
          submit();
          return;
        case 'Escape':
        case 'Backspace':
          e.preventDefault();
          closePicker();
          return;
        case 'ArrowRight':
        case 'ArrowDown':
          e.preventDefault();
          movePicker(1);
          return;
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          movePicker(-1);
          return;
        case 'Tab':
          e.preventDefault();
          return;
      }
      if (/^[1-9]$/.test(e.key)) {
        e.preventDefault();
        pickIndex(Number(e.key) - 1);
        return;
      }
      if (e.key.length === 1) e.preventDefault(); // the picker is modal
      return;
    }
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        submit();
        return;
      case 'Backspace':
        if (!input) {
          e.preventDefault();
          backspace(); // undo the last entry
        }
        return;
      case 'Tab':
        if (!e.shiftKey) {
          e.preventDefault();
          cycleSet(1); // Shift+Tab keeps its native meaning so the controls above stay reachable
        }
        return;
      case 'Escape':
        if (input) {
          e.preventDefault();
          setInput('');
        }
        return;
      case 'f':
      case 'F':
        if (!input) {
          e.preventDefault();
          toggleFoil();
        }
        return;
    }
  };

  // phone helpers (keep the keyboard open: never move focus off the input)
  const keepFocus = (e: ReactPointerEvent<HTMLButtonElement>) => e.preventDefault();
  const onTimes = () => {
    const s = usePack.getState();
    if (s.picker) return;
    const m = s.input.match(/^(.*?)[x*]\d{0,3}$/i);
    if (m) s.setInput(m[1]);
    else if (s.input) s.appendInput('x3');
    refocus();
  };

  const currentSet = sets.find((s) => s.code === packSet) ?? null;

  return (
    <div className={cx('flex flex-col gap-3 border-b border-border px-4 pt-3 pb-3 sm:px-6', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<string>
          ariaLabel="Set (Tab cycles)"
          value={packSet ?? ''}
          onChange={(v) => {
            setPackSet(v);
            refocus();
          }}
          options={sets.map((s) => ({ value: s.code, label: s.code, title: `${s.name}${s.release_date ? ` · ${s.release_date.slice(0, 4)}` : ''} — Tab cycles sets` }))}
          className="pointer-coarse:[&_button]:h-10"
        />
        <button
          type="button"
          onClick={() => {
            toggleFoil();
            refocus();
          }}
          aria-pressed={foilSticky}
          title={foilSticky ? 'Entries are FOIL unless you say otherwise (F)' : 'Entries are normal — press F for foil'}
          className={cx(
            'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium transition-colors pointer-coarse:h-10',
            foilSticky ? 'border-chaos/60 bg-chaos/15 text-[#e9d5ff]' : 'border-border bg-surface-2 text-muted hover:text-fg',
          )}
        >
          <Sparkles className="size-4" aria-hidden />
          Foil
          <Kbd className="ml-0.5 hidden sm:inline-flex">F</Kbd>
        </button>
        <span className="ml-auto hidden items-center gap-1.5 text-[11.5px] text-faint md:inline-flex" aria-hidden>
          <Kbd>Tab</Kbd> set <span className="mx-0.5">·</span> <Kbd>F</Kbd> foil <span className="mx-0.5">·</span> <Kbd>⌫</Kbd> undo last <span className="mx-0.5">·</span> <Kbd>Ctrl</Kbd>
          <Kbd>Z</Kbd>
        </span>
      </div>

      <div ref={wrapRef} className="relative">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          readOnly={Boolean(picker)}
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="done"
          inputMode={phone ? 'numeric' : 'text'}
          placeholder={currentSet ? '45' : '—'}
          aria-label={`Collector number${currentSet ? ` in ${currentSet.name}` : ''}`}
          aria-describedby="pack-match"
          aria-invalid={res.kind === 'no-card' || res.kind === 'no-set' || res.kind === 'invalid'}
          className={cx(
            'tabular h-16 w-full rounded-2xl border-2 bg-surface pr-28 pl-5 text-4xl font-semibold tracking-tight text-fg outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-faint/50 sm:h-20 sm:pr-36 sm:text-5xl',
            picker ? 'border-accent/60 ring-4 ring-accent/15' : res.kind === 'no-card' || res.kind === 'no-set' ? 'border-danger/60 focus:ring-4 focus:ring-danger/15' : 'border-border focus:border-accent focus:ring-4 focus:ring-accent/20',
          )}
        />
        <div className="pointer-events-none absolute inset-y-0 right-4 flex items-center gap-2 text-lg font-semibold sm:right-5 sm:text-xl" aria-hidden>
          {foilSticky && <span className="foil-text">✦ FOIL</span>}
          <span className="tabular text-faint">{res.kind === 'match' ? res.set : (packSet ?? '')}</span>
        </div>
      </div>

      <div id="pack-match" aria-live="polite" className="min-h-7">
        {picker ? <PickerRow /> : <MatchLine res={res} />}
      </div>

      {(coarse || phone) && (
        <div className="grid grid-cols-4 gap-2" aria-label="Entry helpers">
          <button
            type="button"
            onPointerDown={keepFocus}
            onClick={() => {
              toggleFoil();
              refocus();
            }}
            aria-pressed={foilSticky}
            aria-label="Toggle foil"
            className={cx('h-11 rounded-xl border text-[15px] font-semibold', foilSticky ? 'border-chaos/60 bg-chaos/15 text-[#e9d5ff]' : 'border-border bg-surface-2 text-fg')}
          >
            ✦ F
          </button>
          <button type="button" onPointerDown={keepFocus} onClick={onTimes} aria-label="Times three" className="tabular h-11 rounded-xl border border-border bg-surface-2 text-[15px] font-semibold text-fg">
            ×3
          </button>
          <button
            type="button"
            onPointerDown={keepFocus}
            onClick={() => {
              submit();
              refocus();
            }}
            aria-label="Add"
            className="flex h-11 items-center justify-center rounded-xl bg-accent text-[#0b0f17]"
          >
            <CornerDownLeft className="size-5" aria-hidden />
          </button>
          <button
            type="button"
            onPointerDown={keepFocus}
            onClick={() => {
              backspace();
              refocus();
            }}
            aria-label="Delete / undo last"
            className="flex h-11 items-center justify-center rounded-xl border border-border bg-surface-2 text-fg"
          >
            <Delete className="size-5" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function MatchLine({ res }: { res: Resolution }) {
  switch (res.kind) {
    case 'empty':
      return (
        <p className="flex flex-wrap items-center gap-x-1.5 text-[13px] text-muted">
          <span>Type a collector number, then</span>
          <Kbd>Enter</Kbd>
          <span className="hidden text-faint sm:inline">
            — <code className="tabular">45</code> · <code className="tabular">45f</code> foil · <code className="tabular">45x3</code> ×3 · <code className="tabular">7a</code> alt art · <code className="tabular">sfd12</code> other set · <code className="tabular">r1</code> rune · <code className="tabular">t2</code> token
          </span>
        </p>
      );
    case 'invalid':
      return <p className="text-[13px] text-warning">Not a valid entry — try 45, 45f, 45x3, ogn45, 7a, r1 or t2.</p>;
    case 'no-set':
      return (
        <p className="text-[13px] font-medium text-[#fca5a5]" role="status">
          No set {res.set}
        </p>
      );
    case 'no-card':
      return (
        <p className="text-[13px] font-medium text-[#fca5a5]" role="status">
          No card {res.number} in {res.set}
        </p>
      );
    case 'match':
      return <MatchCard res={res} />;
  }
}

function MatchCard({ res }: { res: Extract<Resolution, { kind: 'match' }> }) {
  const { card, entry, candidates, ambiguous, set } = res;
  const owned = useOwnedTotal(card.id);
  const ownedFinish = useQty(card.id, entry.finish);
  const number = card.id.slice(set.length + 1);
  return (
    <p className="tabular flex flex-wrap items-baseline gap-x-1.5 text-[13.5px] text-muted">
      <span className="font-semibold text-fg">{number}</span>
      <span className="text-faint">·</span>
      <span className="font-semibold text-fg">{card.name}</span>
      {card.variant_kind && <span className="text-xs text-faint">({printingLabel(card)})</span>}
      <span className="text-faint">·</span>
      <span>
        owned <span className={cx('font-semibold', owned > 0 ? 'text-fg' : 'text-faint')}>{owned}</span>
        {entry.finish === 'foil' && (
          <span className="ml-1">
            (<span className="foil-text font-semibold">✦{ownedFinish}</span>)
          </span>
        )}
      </span>
      {entry.finish === 'foil' && (
        <>
          <span className="text-faint">·</span>
          <span className="foil-text font-semibold">✦ foil</span>
        </>
      )}
      {entry.qty > 1 && (
        <>
          <span className="text-faint">·</span>
          <span className="font-semibold text-accent-strong">×{entry.qty}</span>
        </>
      )}
      {ambiguous && (
        <>
          <span className="text-faint">·</span>
          <span className="text-accent-strong">
            {candidates.length} printings ({candidates
              .slice(1)
              .map((c) => c.id.slice(set.length + 1))
              .join(', ')}) — <Kbd>Enter</Kbd> to choose
          </span>
        </>
      )}
    </p>
  );
}

// ---------------------------------------------------------------------------

function PickerRow() {
  const picker = usePack((s) => s.picker);
  const cardsById = useStore((s) => s.cardsById);
  if (!picker) return null;
  return (
    <div role="listbox" aria-label="Choose a printing" className="fade-up flex flex-wrap items-center gap-2">
      <span className="mr-1 text-[13px] text-muted">
        Which printing? <Kbd>1</Kbd>–<Kbd>{picker.ids.length}</Kbd> · <Kbd>Enter</Kbd> for the highlighted · <Kbd>Esc</Kbd> back
      </span>
      {picker.ids.map((id, i) => {
        const card = cardsById.get(id);
        return card ? <PickerOption key={id} card={card} index={i} active={i === picker.index} finish={picker.finish} /> : null;
      })}
    </div>
  );
}

function PickerOption({ card, index, active, finish }: { card: Card; index: number; active: boolean; finish: 'normal' | 'foil' }) {
  const owned = useOwnedTotal(card.id);
  const pickIndex = usePack((s) => s.pickIndex);
  const show = usePreview((s) => s.show);
  const hide = usePreview((s) => s.hide);
  const ref = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  const onEnter = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.pointerType !== 'mouse') return;
    void preload(card, 'full');
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      const thumb = ref.current?.querySelector('[data-thumb]') ?? ref.current;
      if (thumb) show(card.id, rectOf(thumb), 'mouse');
    }, 120);
  };
  const onLeave = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.pointerType !== 'mouse') return;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    hide(card.id);
  };
  const number = card.id.slice(card.set_code.length + 1);
  return (
    <button
      ref={ref}
      type="button"
      role="option"
      aria-selected={active}
      tabIndex={-1}
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => {
        hide(card.id);
        pickIndex(index);
      }}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      className={cx(
        'flex h-14 items-center gap-2.5 rounded-xl border pr-3 pl-2 text-left transition-colors',
        active ? 'border-accent bg-accent/10 ring-2 ring-accent/30' : 'border-border bg-surface-2 hover:border-border-strong hover:bg-surface-3',
      )}
    >
      <Kbd className={cx(active && 'border-accent/60 text-accent-strong')}>{index + 1}</Kbd>
      <span data-thumb className="w-8 shrink-0">
        <CardImage card={card} kind="thumb" rounded="rounded" />
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="tabular text-[13px] font-semibold text-fg">
          {number} <span className="font-normal text-muted">· {printingLabel(card)}</span>
        </span>
        <span className="tabular text-[11px] text-muted">
          owned {owned}
          {finish === 'foil' && <span className="foil-text ml-1 font-semibold">✦ foil</span>}
        </span>
      </span>
    </button>
  );
}
