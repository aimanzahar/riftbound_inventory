import { useEffect } from 'react';
import { Database, HardDrive } from 'lucide-react';
import { useStore } from '../../store/store.ts';
import { fmtBytes, relTime } from '../../lib/format.ts';
import { Button } from '../ui/Button.tsx';

/** List of data/backups/*.db + “Backup now” (POST /api/jobs/backup/run). */
export function BackupsPanel() {
  const backups = useStore((s) => s.backups);
  const refreshJobs = useStore((s) => s.refreshJobs);
  const runJob = useStore((s) => s.runJob);
  const running = useStore((s) => s.jobs.find((j) => j.name === 'backup')?.running ?? false);
  const server = useStore((s) => s.server);

  useEffect(() => {
    void refreshJobs();
  }, [refreshJobs]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">Snapshots of the SQLite database. The 14 newest plus one per week for 8 weeks are kept.</p>
        <Button variant="primary" size="sm" loading={running} onClick={() => void runJob('backup')} leftIcon={<Database className="size-4" />}>
          Backup now
        </Button>
      </div>
      {backups.length === 0 ? (
        <p className="text-sm text-faint">No backups yet.</p>
      ) : (
        <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-xl border border-border">
          {backups.map((b) => (
            <li key={b.file} className="flex items-center gap-3 px-3 py-2 text-[13px]">
              <HardDrive className="size-4 shrink-0 text-faint" aria-hidden />
              <code className="min-w-0 flex-1 truncate font-mono text-xs">{b.file}</code>
              <span className="tabular shrink-0 text-xs text-muted">{fmtBytes(b.size_bytes)}</span>
              <span className="tabular shrink-0 text-xs text-faint">{relTime(b.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-faint">
        Restore: stop the server, copy a backup over <code className="font-mono">{server ? `${server.data_dir}\\app.db` : 'data/app.db'}</code>, delete the -wal/-shm files, start again.
      </p>
    </div>
  );
}
