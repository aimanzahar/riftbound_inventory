import { useEffect } from 'react';
import { Play, WandSparkles } from 'lucide-react';
import type { JobName } from '../../../../shared/constants.ts';
import type { JobStatus } from '../../../../shared/types.ts';
import { useStore } from '../../store/store.ts';
import { cx, relTime } from '../../lib/format.ts';
import { Badge } from '../ui/Badge.tsx';
import { Button } from '../ui/Button.tsx';

const LABEL: Record<string, { title: string; desc: string }> = {
  cards: { title: 'Card catalog', desc: 'Cards, alternate art and promos from Riot + DotGG. Daily, with catch-up on startup.' },
  products: { title: 'Products', desc: 'Precon contents from seed/products.json.' },
  images: { title: 'Card images', desc: 'Mirror images locally. Daily (no-op when complete).' },
  fx: { title: 'FX rate', desc: 'USD → MYR. Daily.' },
  prices: { title: 'Prices', desc: 'TCGplayer market via tcgcsv. Daily.' },
  meta: { title: 'Meta decks', desc: 'Tournament lists (riftools). Daily.' },
  backup: { title: 'Backup', desc: 'SQLite snapshot to data/backups. Daily.' },
  tips: { title: 'Card tips (Codex)', desc: 'Generate missing tips with Codex CLI. Manual.' },
};

function tone(s: JobStatus['last'] extends infer T ? (T extends { status: infer S } ? S : never) | null : never): 'success' | 'warning' | 'danger' | 'neutral' | 'accent' {
  switch (s) {
    case 'ok':
      return 'success';
    case 'partial':
      return 'warning';
    case 'error':
      return 'danger';
    case 'running':
      return 'accent';
    default:
      return 'neutral';
  }
}

/** Job table from /api/state jobs + live `job` SSE events, with Run-now buttons. */
export function JobsPanel() {
  const jobs = useStore((s) => s.jobs);
  const live = useStore((s) => s.jobLive);
  const runJob = useStore((s) => s.runJob);
  const refreshJobs = useStore((s) => s.refreshJobs);
  const images = useStore((s) => s.server?.images);

  useEffect(() => {
    void refreshJobs();
  }, [refreshJobs]);

  return (
    <div className="flex flex-col divide-y divide-border rounded-xl border border-border">
      {jobs.map((j) => {
        const l = live[j.name];
        const running = j.running || l?.status === 'running';
        const lastStatus = running ? 'running' : (j.last?.status ?? null);
        const msg = running ? (l?.message ?? 'running…') : (j.last?.message ?? null);
        const progress = running && l?.progress && l.progress.total > 0 ? Math.round((l.progress.done / l.progress.total) * 100) : null;
        const meta = LABEL[j.name] ?? { title: j.name, desc: '' };
        const isTips = j.name === 'tips';
        return (
          <div key={j.name} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{meta.title}</span>
                <Badge tone={tone(lastStatus)} size="xs" className="uppercase">
                  {lastStatus ?? 'never run'}
                </Badge>
                {j.name === 'images' && images && (
                  <span className="tabular text-[11px] text-muted">
                    {images.mirrored}/{images.total} mirrored
                  </span>
                )}
              </div>
              <p className="text-[12px] text-muted">{meta.desc}</p>
              <p className={cx('mt-0.5 truncate text-[11.5px]', lastStatus === 'error' ? 'text-danger' : 'text-faint')} title={msg ?? undefined}>
                {j.last ? `${j.last.trigger} · ${relTime(j.last.finished_at ?? j.last.started_at)} · ok ${j.last.items_ok}${j.last.items_failed ? ` / failed ${j.last.items_failed}` : ''}` : ''}
                {msg ? `${j.last ? ' — ' : ''}${msg}` : ''}
                {!running && j.next_due_at && j.interval_hours ? ` · next ${relTime(j.next_due_at)}` : ''}
              </p>
              {progress !== null && (
                <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${progress}%` }} />
                </div>
              )}
            </div>
            <Button
              variant={isTips ? 'primary' : 'outline'}
              size="sm"
              loading={running}
              onClick={() => void runJob(j.name as JobName)}
              leftIcon={isTips ? <WandSparkles className="size-4" /> : <Play className="size-3.5" />}
              className="shrink-0 self-start sm:self-center"
            >
              {isTips ? 'Generate missing tips (Codex)' : 'Run now'}
            </Button>
          </div>
        );
      })}
      {jobs.length === 0 && <p className="px-4 py-6 text-sm text-faint">Job status unavailable.</p>}
    </div>
  );
}
