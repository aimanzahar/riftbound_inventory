import { useCallback, useMemo, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react';

export interface LongPressOptions {
  /** hold duration in ms (default 450) */
  ms?: number;
  /** cancel when the pointer moves further than this (px) */
  moveTolerance?: number;
  /** also fire for mouse pointers (default: touch/pen only) */
  mouse?: boolean;
  /** vibrate on fire when supported (default true) */
  haptic?: boolean;
}

export interface LongPressHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerLeave: (e: ReactPointerEvent<HTMLElement>) => void;
  onContextMenu: (e: ReactMouseEvent<HTMLElement>) => void;
  onClickCapture: (e: ReactMouseEvent<HTMLElement>) => void;
  onTouchEnd: (e: ReactTouchEvent<HTMLElement>) => void;
}

/**
 * Long-press (touch/pen) detector. Suppresses the click that follows a fired long-press
 * and the context menu (so the tile never shows the browser callout).
 */
export function useLongPress(onLongPress: (e: { clientX: number; clientY: number; target: EventTarget | null }) => void, opts: LongPressOptions = {}): LongPressHandlers {
  const ms = opts.ms ?? 450;
  const tol = opts.moveTolerance ?? 10;
  const allowMouse = opts.mouse ?? false;
  const haptic = opts.haptic ?? true;

  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const cbRef = useRef(onLongPress);
  cbRef.current = onLongPress;

  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    start.current = null;
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!allowMouse && e.pointerType === 'mouse') return;
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      const target = e.target;
      const x = e.clientX,
        y = e.clientY;
      clear();
      start.current = { x, y };
      timer.current = window.setTimeout(() => {
        timer.current = null;
        fired.current = true;
        if (haptic && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          try {
            navigator.vibrate(10);
          } catch {
            /* ignore */
          }
        }
        cbRef.current({ clientX: x, clientY: y, target });
      }, ms);
    },
    [allowMouse, clear, haptic, ms],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!start.current) return;
      if (Math.abs(e.clientX - start.current.x) > tol || Math.abs(e.clientY - start.current.y) > tol) clear();
    },
    [clear, tol],
  );

  const end = useCallback(() => clear(), [clear]);

  const onContextMenu = useCallback((e: ReactMouseEvent<HTMLElement>) => {
    // touch long-press would otherwise pop the native menu / image callout
    if (fired.current || start.current) e.preventDefault();
  }, []);

  const onClickCapture = useCallback((e: ReactMouseEvent<HTMLElement>) => {
    if (fired.current) {
      e.preventDefault();
      e.stopPropagation();
      fired.current = false;
    }
  }, []);

  const onTouchEnd = useCallback((e: ReactTouchEvent<HTMLElement>) => {
    // after a fired long-press, swallow the synthetic click that follows touchend
    if (fired.current && e.cancelable) e.preventDefault();
  }, []);

  return useMemo(
    () => ({ onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end, onPointerLeave: end, onContextMenu, onClickCapture, onTouchEnd }),
    [onPointerDown, onPointerMove, end, onContextMenu, onClickCapture, onTouchEnd],
  );
}
