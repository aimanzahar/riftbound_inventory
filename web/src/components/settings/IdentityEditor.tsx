import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { PALETTE } from '../../../../shared/constants.ts';
import { useStore } from '../../store/store.ts';
import { reconnectRealtime } from '../../lib/sse.ts';
import { cx } from '../../lib/format.ts';
import { Avatar } from '../ui/Avatar.tsx';
import { Button } from '../ui/Button.tsx';

export function IdentityEditor() {
  const me = useStore((s) => s.me);
  const register = useStore((s) => s.registerDevice);
  const [name, setName] = useState(me.name);
  const [color, setColor] = useState(me.color);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setName(me.name);
    setColor(me.color);
  }, [me.name, me.color]);
  const dirty = name.trim() !== me.name || color !== me.color;
  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    await register(name.trim(), color);
    reconnectRealtime();
    setBusy(false);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <Avatar name={name || '?'} color={color} size="lg" />
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Display name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={32}
            onKeyDown={(e) => e.key === 'Enter' && void save()}
            className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-[15px] text-fg focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Colour ${c}`}
            aria-pressed={color === c}
            onClick={() => setColor(c)}
            className={cx('flex size-8 items-center justify-center rounded-full transition-transform hover:scale-105', color === c && 'ring-2 ring-fg ring-offset-2 ring-offset-surface')}
            style={{ background: c }}
          >
            {color === c && <Check className="size-4 text-[#0b0f17]" aria-hidden />}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={() => void save()} disabled={!dirty || !name.trim()} loading={busy}>
          Save identity
        </Button>
        {saved && <span className="text-xs text-success">Saved</span>}
        <span className="tabular ml-auto truncate text-[11px] text-faint" title={me.id}>
          device {me.id.slice(0, 8)}
        </span>
      </div>
    </div>
  );
}
