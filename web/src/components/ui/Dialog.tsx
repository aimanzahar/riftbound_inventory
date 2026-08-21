import { useEffect, useRef, type ReactNode, type SyntheticEvent } from 'react';
import { X } from 'lucide-react';
import { cx } from '../../lib/format.ts';
import { Button } from './Button.tsx';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** hide the × button */
  noClose?: boolean;
  /** disallow Esc / backdrop close (e.g. first-launch identity) */
  modal?: boolean;
  className?: string;
  bodyClassName?: string;
}

const SIZE = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl', xl: 'max-w-4xl' };

/** Native <dialog> (focus trap, Esc, inert background) with our styling. */
export function Dialog({ open, onClose, title, description, children, footer, size = 'md', noClose, modal, className, bodyClassName }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useRef(`dlg-${Math.random().toString(36).slice(2, 8)}`).current;

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
    if (!modal) onClose();
  };
  const onBackdrop = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (modal) return;
    if (e.target === ref.current) onClose();
  };

  return (
    <dialog
      ref={ref}
      onCancel={onCancel}
      onClose={() => {
        if (open) onClose();
      }}
      onClick={onBackdrop}
      aria-labelledby={title ? titleId : undefined}
      className={cx(
        'm-auto w-[calc(100%-2rem)] rounded-2xl border border-border bg-surface p-0 text-fg shadow-pop',
        'backdrop:bg-transparent open:fade-up',
        SIZE[size],
        className,
      )}
    >
      {open && (
        <div className="flex max-h-[min(85dvh,900px)] flex-col">
          {(title || !noClose) && (
            <header className="flex items-start gap-3 px-5 pt-5 pb-3">
              <div className="min-w-0 flex-1">
                {title && (
                  <h2 id={titleId} className="text-base font-semibold tracking-tight">
                    {title}
                  </h2>
                )}
                {description && <p className="mt-1 text-sm text-muted">{description}</p>}
              </div>
              {!noClose && <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose} leftIcon={<X className="size-4" />} />}
            </header>
          )}
          <div className={cx('min-h-0 flex-1 overflow-y-auto px-5', title ? 'pb-5' : 'py-5', bodyClassName)}>{children}</div>
          {footer && <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
