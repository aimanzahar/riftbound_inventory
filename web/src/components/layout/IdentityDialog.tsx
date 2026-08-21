import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { PALETTE } from '../../../../shared/constants.ts';
import { useStore } from '../../store/store.ts';
import { Dialog } from '../ui/Dialog.tsx';
import { Button } from '../ui/Button.tsx';
import { Avatar } from '../ui/Avatar.tsx';
import { Brand } from './NavTabs.tsx';
import { cx } from '../../lib/format.ts';

/** First-launch “Who’s this?” — name + 8 colour swatches. Can't be dismissed until a name is given. */
export function IdentityDialog({ open }: { open: boolean }) {
  const me = useStore((s) => s.me);
  const register = useStore((s) => s.registerDevice);
  const [name, setName] = useState(me.name);
  const [color, setColor] = useState(me.color);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 50);
  }, [open]);

  const valid = name.trim().length > 0;
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    await register(name.trim(), color);
    setBusy(false);
  };

  return (
    <Dialog open={open} onClose={() => {}} modal noClose size="sm" bodyClassName="pb-6">
      <form onSubmit={submit} className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <Brand className="size-10 text-base" />
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Who’s this?</h2>
            <p className="text-sm text-muted">Your name and colour tag every change you make, so the other device knows who did what.</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Avatar name={name || '?'} color={color} size="lg" />
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">Name</span>
            <input
              ref={input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={32}
              placeholder="e.g. Aiman"
              autoComplete="nickname"
              className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-[15px] text-fg placeholder:text-faint focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          </label>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-xs font-medium text-muted">Colour</legend>
          <div className="grid grid-cols-8 gap-2">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Colour ${c}`}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
                className={cx('flex aspect-square items-center justify-center rounded-full transition-transform hover:scale-105', color === c && 'ring-2 ring-fg ring-offset-2 ring-offset-surface')}
                style={{ background: c }}
              >
                {color === c && <Check className="size-4 text-[#0b0f17]" aria-hidden />}
              </button>
            ))}
          </div>
        </fieldset>
        <Button type="submit" variant="primary" size="lg" disabled={!valid} loading={busy} className="w-full">
          Start collecting
        </Button>
      </form>
    </Dialog>
  );
}
