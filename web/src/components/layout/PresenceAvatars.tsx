import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store/store.ts';
import { Avatar } from '../ui/Avatar.tsx';
import { cx } from '../../lib/format.ts';

/** Who's connected right now. Me first (ringed); an avatar pulses briefly when that person changes something. */
export function PresenceAvatars({ className, max = 5 }: { className?: string; max?: number }) {
  const presence = useStore((s) => s.presence);
  const me = useStore((s) => s.me);
  const last = useStore((s) => s.recentChanges[0]);
  const [pulseId, setPulseId] = useState<{ id: string; n: number } | null>(null);

  useEffect(() => {
    if (!last?.device || last.device.id === me.id) return;
    setPulseId((p) => ({ id: last.device!.id, n: (p?.n ?? 0) + 1 }));
  }, [last, me.id]);

  const list = useMemo(() => {
    const others = presence.filter((p) => p.id !== me.id);
    const mine = presence.find((p) => p.id === me.id);
    return [...(mine ? [mine] : [{ id: me.id, name: me.name || 'You', color: me.color, tabs: 1 }]), ...others];
  }, [presence, me]);

  const shown = list.slice(0, max);
  const extra = list.length - shown.length;
  const label = list.length <= 1 ? 'Only you are connected' : `${list.length} connected: ${list.map((p) => p.name).join(', ')}`;

  return (
    <div className={cx('flex items-center', className)} aria-label={label} title={label}>
      <div className="flex -space-x-1.5">
        {shown.map((p) => (
          <span key={p.id} className={cx('rounded-full ring-2 ring-bg', p.id === me.id && 'relative z-10')}>
            <Avatar key={pulseId?.id === p.id ? pulseId.n : 0} name={p.id === me.id ? `${p.name} (you)` : p.name} color={p.color} size="sm" pulse={pulseId?.id === p.id} badge={p.tabs} />
          </span>
        ))}
      </div>
      {extra > 0 && <span className="ml-1.5 text-xs text-muted tabular">+{extra}</span>}
    </div>
  );
}
