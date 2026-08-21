import { useEffect, useState, type ReactNode } from 'react';
import { Upload } from 'lucide-react';
import { useStore } from '../store/store.ts';
import { useTotals } from '../store/selectors.ts';
import { fmtInt, fmtMYR, fmtUSD } from '../lib/format.ts';
import { IdentityEditor } from '../components/settings/IdentityEditor.tsx';
import { LanInfo } from '../components/settings/LanInfo.tsx';
import { JobsPanel } from '../components/settings/JobsPanel.tsx';
import { BackupsPanel } from '../components/settings/BackupsPanel.tsx';
import { ExportButton } from '../components/io/ExportButton.tsx';
import { ImportDialog } from '../components/io/ImportDialog.tsx';
import { Button } from '../components/ui/Button.tsx';

function Card({ title, description, children, id }: { title: string; description?: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5">
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export function SettingsPage() {
  const [importOpen, setImportOpen] = useState(false);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6">
        <Card title="Who’s this device" description="Your name and colour tag every change you make.">
          <IdentityEditor />
        </Card>
        <Card title="Other devices" description="Realtime over your Wi-Fi — no accounts, no cloud.">
          <LanInfo />
        </Card>
        <Card title="Collection settings" description="Playset sizes drive the “Extras” filter and duplicate warnings. The manual FX rate is only used if the live rate can’t be fetched.">
          <CollectionSettings />
        </Card>
        <Card title="Data jobs" description="Everything refreshes on a schedule while the server runs; run anything now if you don’t want to wait.">
          <JobsPanel />
        </Card>
        <Card title="Backups">
          <BackupsPanel />
        </Card>
        <Card title="Import & export" description="CSV with header card_id,set_code,number,name,finish,qty,note (UTF-8 BOM, CRLF). Import merges or replaces, with a preview and Undo.">
          <div className="flex flex-col gap-3">
            <ExportButton />
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" onClick={() => setImportOpen(true)} leftIcon={<Upload className="size-4" />}>
                Import CSV
              </Button>
              <span className="text-xs text-faint">File, drag &amp; drop, or paste · Merge / Replace listed / Replace all</span>
            </div>
          </div>
          <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
        </Card>
        <Card title="About">
          <Stats />
        </Card>
      </div>
    </div>
  );
}

function CollectionSettings() {
  const settings = useStore((s) => s.settings);
  const save = useStore((s) => s.saveSettings);
  const fx = useStore((s) => s.fx);
  const [playset, setPlayset] = useState(String(settings.playset_size));
  const [rune, setRune] = useState(String(settings.rune_playset_size));
  const [manual, setManual] = useState(settings.fx_manual_rate === null ? '' : String(settings.fx_manual_rate));
  const [name, setName] = useState(settings.collection_name);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setPlayset(String(settings.playset_size));
    setRune(String(settings.rune_playset_size));
    setManual(settings.fx_manual_rate === null ? '' : String(settings.fx_manual_rate));
    setName(settings.collection_name);
  }, [settings]);

  const manualNum = manual.trim() === '' ? null : Number(manual);
  const manualValid = manualNum === null || (Number.isFinite(manualNum) && manualNum > 0.5 && manualNum < 20);
  const dirty = Number(playset) !== settings.playset_size || Number(rune) !== settings.rune_playset_size || manualNum !== settings.fx_manual_rate || name.trim() !== settings.collection_name;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirty || !manualValid) return;
    setBusy(true);
    const ok = await save({ playset_size: Math.max(1, Math.min(99, Number(playset) || 3)), rune_playset_size: Math.max(1, Math.min(99, Number(rune) || 12)), fx_manual_rate: manualNum, collection_name: name.trim() || 'Riftbound Inventory' });
    setBusy(false);
    if (ok) {
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    }
  };
  const input = 'h-9 rounded-lg border border-border bg-surface-2 px-3 text-sm text-fg tabular focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/30';
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted">Collection name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted">Manual FX (1 USD → MYR)</span>
          <input value={manual} onChange={(e) => setManual(e.target.value)} inputMode="decimal" placeholder={fx ? `live ${fx.rate.toFixed(4)}` : 'e.g. 4.70'} className={input} aria-invalid={!manualValid} />
          {!manualValid && <span className="text-[11px] text-danger">Enter a rate between 0.5 and 20, or leave blank.</span>}
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted">Playset size (cards)</span>
          <input type="number" min={1} max={99} value={playset} onChange={(e) => setPlayset(e.target.value)} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted">Rune playset size</span>
          <input type="number" min={1} max={99} value={rune} onChange={(e) => setRune(e.target.value)} className={input} />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={!dirty || !manualValid} loading={busy}>
          Save settings
        </Button>
        {saved && <span className="text-xs text-success">Saved</span>}
        <span className="ml-auto text-[11px] text-faint">{fx ? `Live FX ${fx.rate.toFixed(4)} (${fx.source}, ${fx.day})${fx.stale ? ' — stale' : ''}` : 'No live FX yet'}</span>
      </div>
    </form>
  );
}

function Stats() {
  const t = useTotals();
  const server = useStore((s) => s.server);
  const cards = useStore((s) => s.cardIds.length);
  const sets = useStore((s) => s.sets.length);
  const products = useStore((s) => s.products.length);
  const decks = useStore((s) => s.decks.length);
  const tips = useStore((s) => s.tips.size);
  const seq = useStore((s) => s.seq);
  const rows: Array<[string, string]> = [
    ['Catalog', `${fmtInt(cards)} printings · ${sets} sets · ${products} products · ${decks} meta decks · ${fmtInt(tips)} tips`],
    ['Collection', `${fmtInt(t.uniqueOwned)} / ${fmtInt(t.uniqueTotal)} unique · ${fmtInt(t.copies)} copies${t.foilCopies ? ` (${t.foilCopies} foil)` : ''}`],
    ['Value', t.valueMyr !== null ? `${fmtMYR(t.valueMyr)} (${fmtUSD(t.valueUsd)})` : fmtUSD(t.valueUsd)],
    ['Images', server ? `${fmtInt(server.images.mirrored)} / ${fmtInt(server.images.total)} mirrored locally` : '—'],
    ['Server', server ? `v${server.version} · up since ${new Date(server.started_at).toLocaleString()} · change #${seq}` : '—'],
    ['Data folder', server?.data_dir ?? '—'],
  ];
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="tabular break-all text-fg">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
