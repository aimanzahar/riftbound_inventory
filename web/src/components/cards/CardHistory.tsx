import { useEffect, useState } from 'react';
import { Undo2 } from 'lucide-react';
import type { Change } from '../../../../shared/types.ts';
import { changeSummary } from '../../../../shared/summarize.ts';
import { api, errorMessage } from '../../lib/api.ts';
import { useStore } from '../../store/store.ts';
import { cx, relTime } from '../../lib/format.ts';
import { Button } from '../ui/Button.tsx';
import { Skeleton } from '../ui/Skeleton.tsx';

/** Last 20 changes touching a card, with Undo. Re-fetches when the global seq moves. */
export function CardHistory({ cardId, limit = 20 }: { cardId: string; limit?: number }) {
  const seq = useStore((s) => s.seq);
  const cardsById = useStore((s) => s.cardsById);
  const me = useStore((s) => s.me);
  const undo = useStore((s) => s.undo);
  const [items, setItems] = useState<Change[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busySeq, setBusySeq] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const t = window.setTimeout(() => {
      api
        .changes({ card_id: cardId, limit })
        .then((r) => {
          if (!alive) return;
          setItems(r.changes);
          setErr(null);
        })
        .catch((e) => alive && setErr(errorMessage(e)));
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [cardId, limit, seq]);

  if (err) return <p className="text-sm text-danger">Couldn’t load history: {err}</p>;
  if (!items)
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  if (!items.length) return <p className="text-sm text-faint">No changes yet.</p>;

  return (
    <ol className="flex flex-col divide-y divide-border">
      {items.map((c) => {
        const { text } = changeSummary(c, (id) => cardsById.get(id));
        const mine = c.device?.id === me.id;
        const canUndo = c.kind === 'inventory' && !c.undone;
        return (
          <li key={c.seq} className={cx('flex items-start gap-2.5 py-2 text-[13px]', c.undone && 'opacity-55')}>
            <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: c.device?.color ?? 'var(--color-faint)' }} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className={cx('leading-snug', c.undone && 'line-through')}>{mine ? text.replace(/^\S+/, 'You') : text}</p>
              <p className="mt-0.5 text-[11px] text-faint">
                {relTime(c.ts)}
                {c.reason ? ` · ${c.reason}` : ''}
                {c.undone ? ' · undone' : ''}
              </p>
            </div>
            {canUndo && (
              <Button
                variant="ghost"
                size="xs"
                leftIcon={<Undo2 className="size-3.5" />}
                loading={busySeq === c.seq}
                onClick={async () => {
                  setBusySeq(c.seq);
                  await undo(c.seq);
                  setBusySeq(null);
                }}
              >
                Undo
              </Button>
            )}
          </li>
        );
      })}
    </ol>
  );
}
