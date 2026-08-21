import { useCallback, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Minus, Plus } from 'lucide-react';
import type { Finish } from '../../../../shared/types.ts';
import { cx } from '../../lib/format.ts';
import { useStore } from '../../store/store.ts';
import { useQty } from '../../store/selectors.ts';

export interface QtyStepperProps {
  cardId: string;
  finish: Finish;
  size?: 'sm' | 'md' | 'lg';
  /** accessible name prefix, e.g. the card name */
  label: string;
  className?: string;
  /** show finish tag inside (✦ foil) */
  showFinish?: boolean;
  /** stop pointer/keyboard events from bubbling to the tile (default true) */
  isolate?: boolean;
}

const HOLD_DELAY = 420;
const HOLD_INTERVAL = 110;

/**
 * [−] n [+] with press-and-hold repeat, 44 px targets on touch, haptic tick on touch changes.
 * Shift+click adjusts the OTHER finish (foil ⇄ normal) — handy on the grid.
 */
export function QtyStepper({ cardId, finish, size = 'md', label, className, showFinish, isolate = true }: QtyStepperProps) {
  const qty = useQty(cardId, finish);
  const adjust = useStore((s) => s.adjust);
  const hold = useRef<{ timer: number | null; interval: number | null; fired: boolean }>({ timer: null, interval: null, fired: false });

  const stop = useCallback(() => {
    const h = hold.current;
    if (h.timer !== null) window.clearTimeout(h.timer);
    if (h.interval !== null) window.clearInterval(h.interval);
    h.timer = null;
    h.interval = null;
  }, []);
  useEffect(() => stop, [stop]);

  const step = useCallback(
    (delta: number, e?: { shiftKey?: boolean; pointerType?: string }) => {
      const f: Finish = e?.shiftKey ? (finish === 'foil' ? 'normal' : 'foil') : finish;
      adjust(cardId, f, delta);
      if (e?.pointerType === 'touch' && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try {
          navigator.vibrate(10);
        } catch {
          /* ignore */
        }
      }
    },
    [adjust, cardId, finish],
  );

  const onDown = (delta: number) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    if (isolate) e.stopPropagation();
    const shift = e.shiftKey;
    const pt = e.pointerType;
    hold.current.fired = false;
    stop();
    hold.current.timer = window.setTimeout(() => {
      hold.current.fired = true;
      step(delta, { shiftKey: shift, pointerType: pt });
      hold.current.interval = window.setInterval(() => step(delta, { shiftKey: shift, pointerType: pt }), HOLD_INTERVAL);
    }, HOLD_DELAY);
  };
  const onUp = () => stop();
  const onClick = (delta: number) => (e: React.MouseEvent<HTMLButtonElement>) => {
    if (isolate) e.stopPropagation();
    if (hold.current.fired) {
      hold.current.fired = false;
      return; // the hold already applied steps
    }
    step(delta, { shiftKey: e.shiftKey, pointerType: (e.nativeEvent as PointerEvent).pointerType });
  };

  const h = size === 'lg' ? 'h-11' : size === 'sm' ? 'h-7' : 'h-8';
  const num = size === 'lg' ? 'min-w-10 text-lg' : size === 'sm' ? 'min-w-6 text-[13px]' : 'min-w-7 text-sm';
  const icon = size === 'lg' ? 'size-5' : 'size-4';
  const foil = finish === 'foil';

  return (
    <div
      className={cx('stepper inline-flex shrink-0 items-stretch overflow-hidden rounded-lg border border-border bg-surface-2', h, className)}
      role="group"
      aria-label={`${label}${foil ? ' foil' : ''} quantity`}
      onKeyDown={isolate ? (e) => e.stopPropagation() : undefined}
      onPointerDown={isolate ? (e) => e.stopPropagation() : undefined}
    >
      <button
        type="button"
        aria-label={`Remove one ${foil ? 'foil ' : ''}${label}`}
        disabled={qty <= 0}
        onPointerDown={onDown(-1)}
        onPointerUp={onUp}
        onPointerLeave={onUp}
        onPointerCancel={onUp}
        onClick={onClick(-1)}
        onContextMenu={(e) => e.preventDefault()}
        className={cx('stepper-btn flex items-center justify-center px-2 text-muted transition-colors hover:bg-surface-3 hover:text-fg active:bg-border disabled:opacity-30 disabled:hover:bg-transparent', h)}
      >
        <Minus className={icon} aria-hidden />
      </button>
      <output
        aria-live="off"
        className={cx('tabular flex items-center justify-center px-1 font-semibold', num, qty > 0 ? (foil ? 'foil-text' : 'text-fg') : 'text-faint')}
        title={foil ? 'Foil copies' : 'Copies'}
      >
        {showFinish && foil && <span className="mr-0.5 text-[0.8em]">✦</span>}
        {qty}
      </output>
      <button
        type="button"
        aria-label={`Add one ${foil ? 'foil ' : ''}${label}`}
        onPointerDown={onDown(1)}
        onPointerUp={onUp}
        onPointerLeave={onUp}
        onPointerCancel={onUp}
        onClick={onClick(1)}
        onContextMenu={(e) => e.preventDefault()}
        className={cx('stepper-btn flex items-center justify-center px-2 text-muted transition-colors hover:bg-surface-3 hover:text-fg active:bg-border', h)}
      >
        <Plus className={icon} aria-hidden />
      </button>
    </div>
  );
}
