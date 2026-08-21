import { useEffect, useRef, type ReactNode, type SyntheticEvent } from 'react';
import { X } from 'lucide-react';
import { cx } from '../../lib/format.ts';
import { Button } from './Button.tsx';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children?: ReactNode;
  /** phone: bottom sheet; desktop: 'center' dialog or 'right' panel */
  desktop?: 'center' | 'right';
  className?: string;
  bodyClassName?: string;
}

/** Bottom sheet on phones (<640 px), centered dialog / right panel on larger screens. Native <dialog>. */
export function Sheet({ open, onClose, title, children, desktop = 'center', className, bodyClassName }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      try {
        d.showModal();
      } catch {
        d.setAttribute('open', '');
      }
    } else if (!open && d.open) d.close();
  }, [open]);

  const onCancel = (e: SyntheticEvent<HTMLDialogElement>) => {
    e.preventDefault();
    onClose();
  };

  return (
    <dialog
      ref={ref}
      onCancel={onCancel}
      onClose={() => {
        if (open) onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cx(
        'sheet fixed m-0 max-h-none max-w-none border-border bg-surface p-0 text-fg shadow-pop backdrop:bg-transparent',
        // phone: bottom sheet
        'inset-x-0 top-auto bottom-0 w-full rounded-t-2xl border-t',
        // desktop
        desktop === 'center'
          ? 'sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-[min(92vw,520px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border'
          : 'sm:inset-y-0 sm:right-0 sm:left-auto sm:h-full sm:w-[min(100vw,440px)] sm:rounded-none sm:border-l',
        className,
      )}
    >
      {open && (
        <div className={cx('flex flex-col', desktop === 'right' ? 'h-full sm:h-dvh' : 'max-h-[88dvh] sm:max-h-[85dvh]')}>
          <div className="sheet-grip mx-auto mt-2 h-1 w-10 rounded-full bg-border-strong sm:hidden" aria-hidden />
          <header className="flex items-center gap-3 px-4 pt-3 pb-2 sm:px-5 sm:pt-5">
            <div className="min-w-0 flex-1 text-base font-semibold tracking-tight">{title}</div>
            <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose} leftIcon={<X className="size-4" />} />
          </header>
          <div className={cx('min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-5 sm:pb-5', bodyClassName)}>{children}</div>
        </div>
      )}
    </dialog>
  );
}
