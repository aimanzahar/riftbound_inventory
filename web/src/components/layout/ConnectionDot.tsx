import { useStore } from '../../store/store.ts';
import type { Connection } from '../../store/types.ts';
import { cx } from '../../lib/format.ts';

const META: Record<Connection, { label: string; color: string; pulse: boolean }> = {
  connecting: { label: 'Connecting…', color: 'var(--color-muted)', pulse: true },
  live: { label: 'Live — changes sync instantly', color: 'var(--color-success)', pulse: false },
  reconnecting: { label: 'Reconnecting… edits are queued and retried', color: 'var(--color-warning)', pulse: true },
  offline: { label: 'Offline — edits will be sent when you’re back', color: 'var(--color-danger)', pulse: false },
};

export function ConnectionDot({ withLabel, className }: { withLabel?: boolean; className?: string }) {
  const c = useStore((s) => s.connection);
  const m = META[c];
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-xs text-muted', className)} title={m.label} aria-label={m.label} role="status">
      <span className="relative inline-flex size-2">
        {m.pulse && <span className="absolute inline-flex size-full animate-ping rounded-full opacity-70" style={{ background: m.color }} />}
        <span className="relative inline-flex size-2 rounded-full" style={{ background: m.color }} />
      </span>
      {withLabel && <span className="capitalize">{c === 'live' ? 'Live' : c === 'reconnecting' ? 'Reconnecting' : c === 'offline' ? 'Offline' : 'Connecting'}</span>}
    </span>
  );
}
