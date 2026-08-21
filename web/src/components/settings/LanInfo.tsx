import { useState } from 'react';
import { Check, Copy, Smartphone } from 'lucide-react';
import { useStore } from '../../store/store.ts';
import { Button } from '../ui/Button.tsx';

/** LAN URLs for the other device + copy buttons. */
export function LanInfo() {
  const server = useStore((s) => s.server);
  const urls = server?.lan_urls ?? [];
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (u: string) => {
    try {
      await navigator.clipboard.writeText(u);
      setCopied(u);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard needs a secure context; the text is selectable */
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">Open one of these on a phone or another PC on the same Wi-Fi. Changes sync instantly between devices.</p>
      {urls.length === 0 ? (
        <p className="text-sm text-faint">No LAN address detected — the PC may be offline, or connect via http://localhost:8787 on this machine.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {urls.map((u, i) => (
            <li key={u} className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
              <Smartphone className="size-4 shrink-0 text-faint" aria-hidden />
              <code className="min-w-0 flex-1 select-all truncate font-mono text-[13px] text-fg">{u}</code>
              {i === 0 && <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent-strong">likely</span>}
              <Button variant="ghost" size="icon-sm" aria-label={`Copy ${u}`} onClick={() => void copy(u)} leftIcon={copied === u ? <Check className="size-4 text-success" /> : <Copy className="size-4" />} />
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-faint">
        If the phone can’t connect, allow the app through Windows Firewall (Private networks) — see README. Data folder: <code className="font-mono">{server?.data_dir ?? '…'}</code>
      </p>
    </div>
  );
}
