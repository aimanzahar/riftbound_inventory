import { useEffect, useRef, useState } from 'react';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { useStore } from '../../store/store.ts';
import type { Toast } from '../../store/types.ts';
import { cx } from '../../lib/format.ts';
import { navigate, openCard } from '../../lib/router.ts';
import { Avatar } from './Avatar.tsx';

/**
 * Hand-rolled toasts. Bottom-right on desktop, top on phones. Auto-dismiss after `ttl`
 * (errors persist), pause while hovered, click → open the card / product.
 */
export function Toaster() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div
      aria-live="polite"
      aria-relevant="additions"
      className="pointer-events-none fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-[80] flex flex-col items-center gap-2 px-3 sm:inset-x-auto sm:top-auto sm:right-4 sm:bottom-4 sm:items-end"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useStore((s) => s.dismissToast);
  const [hover, setHover] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    if (!toast.ttl || hover) return;
    const remaining = Math.max(600, toast.at + toast.ttl - Date.now());
    timer.current = window.setTimeout(() => dismiss(toast.id), remaining);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [toast.at, toast.ttl, toast.id, hover, dismiss]);

  const clickable = Boolean(toast.cardId || toast.productId);
  const onOpen = () => {
    if (toast.cardId) openCard(toast.cardId);
    else if (toast.productId) navigate({ page: 'products', query: { product: toast.productId } });
    dismiss(toast.id);
  };

  const icon =
    toast.kind === 'error' ? (
      <CircleAlert className="size-4 text-danger" aria-hidden />
    ) : toast.kind === 'success' ? (
      <CircleCheck className="size-4 text-success" aria-hidden />
    ) : toast.kind === 'remote' && toast.agg ? (
      <Avatar name={toast.agg.who} color={toast.color ?? '#7c9cff'} size="xs" />
    ) : (
      <Info className="size-4 text-accent" aria-hidden />
    );

  return (
    <div
      role={toast.kind === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={cx(
        'pointer-events-auto fade-up flex w-full max-w-[380px] items-start gap-2.5 rounded-xl border bg-surface-2/95 px-3 py-2.5 text-[13px] leading-snug shadow-pop backdrop-blur',
        toast.kind === 'error' ? 'border-danger/40' : 'border-border',
      )}
      style={toast.color && toast.kind === 'remote' ? { borderLeft: `3px solid ${toast.color}` } : undefined}
    >
      <span className="mt-px shrink-0">{icon}</span>
      {clickable ? (
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left text-fg hover:underline underline-offset-2">
          {toast.text}
        </button>
      ) : (
        <span className="min-w-0 flex-1 text-fg">{toast.text}</span>
      )}
      {toast.actions?.map((a) => (
        <button
          key={a.label}
          type="button"
          onClick={() => {
            a.run();
            dismiss(toast.id);
          }}
          className="shrink-0 rounded-md px-1.5 py-0.5 text-xs font-semibold text-accent hover:bg-accent/10"
        >
          {a.label}
        </button>
      ))}
      <button type="button" aria-label="Dismiss" onClick={() => dismiss(toast.id)} className="-mr-1 shrink-0 rounded-md p-1 text-faint hover:bg-surface-3 hover:text-fg">
        <X className="size-3.5" />
      </button>
    </div>
  );
}
