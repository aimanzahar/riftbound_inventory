import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent as ReactClipboardEvent, type DragEvent as ReactDragEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CircleAlert, CircleCheck, FileSpreadsheet, FileUp, TriangleAlert, Upload } from 'lucide-react';
import type { Card, Finish, InventoryItem, InventoryMode, InventoryRow } from '../../../../shared/types.ts';
import { MAX_QTY } from '../../../../shared/constants.ts';
import { parseCsv } from '../../../../shared/csv.ts';
import { normalizeCommunityId } from '../../../../shared/ids.ts';
import { useStore } from '../../store/store.ts';
import { invKey } from '../../store/types.ts';
import { cx, fmtBytes, fmtInt, signed } from '../../lib/format.ts';
import { Dialog } from '../ui/Dialog.tsx';
import { Button } from '../ui/Button.tsx';
import { Segmented } from '../ui/Segmented.tsx';
import { Badge } from '../ui/Badge.tsx';

// ---------------------------------------------------------------------------
// pure analysis
// ---------------------------------------------------------------------------

type ColKey = 'card_id' | 'set_code' | 'number' | 'name' | 'finish' | 'qty' | 'note';
type ColumnMap = Record<ColKey, number>;

const HEADER_ALIASES: Record<string, ColKey> = {
  card_id: 'card_id',
  cardid: 'card_id',
  id: 'card_id',
  set_code: 'set_code',
  setcode: 'set_code',
  set: 'set_code',
  number: 'number',
  collector_number: 'number',
  no: 'number',
  num: 'number',
  '#': 'number',
  name: 'name',
  card_name: 'name',
  card: 'name',
  finish: 'finish',
  foil: 'finish',
  printing: 'finish',
  variant: 'finish',
  qty: 'qty',
  quantity: 'qty',
  count: 'qty',
  owned: 'qty',
  note: 'note',
  notes: 'note',
  comment: 'note',
};

export type ImportRowStatus = 'ok' | 'warn' | 'error';

export interface ImportRow {
  /** 1-based line in the file (header = 1) */
  line: number;
  status: ImportRowStatus;
  card_id: string | null;
  name: string | null;
  finish: Finish;
  qty: number | null;
  note: string | undefined;
  message: string;
}

export interface ImportAnalysis {
  fatal: string | null;
  header: string[];
  cols: ColumnMap;
  unknownColumns: string[];
  hasQty: boolean;
  hasNote: boolean;
  rows: ImportRow[];
  counts: { rows: number; ok: number; warn: number; error: number; unknown: number; duplicates: number; copies: number };
}

export interface ResolveCtx {
  cardsById: Map<string, Card>;
  /** lower-cased name → printings */
  byName: Map<string, Card[]>;
}

/** Same case rule as the server: set/prefix upper, trailing variant letter lower. */
export function normalizeCardId(raw: string): string {
  return normalizeCommunityId(raw) ?? raw.trim().toUpperCase();
}

function parseFinish(raw: string): Finish | null {
  const v = raw.trim().toLowerCase();
  if (v === '' || v === 'normal' || v === 'n' || v === 'nonfoil' || v === 'non-foil' || v === 'regular' || v === 'no' || v === 'false' || v === '0') return 'normal';
  if (v === 'foil' || v === 'f' || v === 'foiled' || v === 'yes' || v === 'true' || v === '1') return 'foil';
  return null;
}

export function buildNameIndex(cardsById: Map<string, Card>): Map<string, Card[]> {
  const m = new Map<string, Card[]>();
  for (const c of cardsById.values()) {
    const k = c.name.trim().toLowerCase();
    const arr = m.get(k);
    if (arr) arr.push(c);
    else m.set(k, [c]);
  }
  return m;
}

export function analyzeCsv(text: string, ctx: ResolveCtx): ImportAnalysis {
  const empty: ImportAnalysis = {
    fatal: null,
    header: [],
    cols: { card_id: -1, set_code: -1, number: -1, name: -1, finish: -1, qty: -1, note: -1 },
    unknownColumns: [],
    hasQty: false,
    hasNote: false,
    rows: [],
    counts: { rows: 0, ok: 0, warn: 0, error: 0, unknown: 0, duplicates: 0, copies: 0 },
  };
  const table = parseCsv(text);
  if (!table.length) return { ...empty, fatal: 'The file is empty.' };

  const header = table[0].map((h) => h.trim());
  const cols: ColumnMap = { ...empty.cols };
  const unknownColumns: string[] = [];
  header.forEach((h, i) => {
    const key = HEADER_ALIASES[h.toLowerCase().replace(/\s+/g, '_')];
    if (key && cols[key] < 0) cols[key] = i;
    else if (h) unknownColumns.push(h);
  });
  const base: ImportAnalysis = { ...empty, header, cols, unknownColumns, hasQty: cols.qty >= 0, hasNote: cols.note >= 0 };
  if (cols.card_id < 0 && !(cols.set_code >= 0 && cols.number >= 0)) {
    return {
      ...base,
      fatal: `The header row must contain “card_id” or both “set_code” and “number”. Found: ${header.filter(Boolean).join(', ') || '(nothing)'}.`,
    };
  }

  const rows: ImportRow[] = [];
  const seen = new Map<string, number>();
  const counts = { rows: 0, ok: 0, warn: 0, error: 0, unknown: 0, duplicates: 0, copies: 0 };

  for (let i = 1; i < table.length; i++) {
    const r = table[i];
    if (r.every((c) => c.trim() === '')) continue;
    const line = i + 1;
    const cell = (idx: number) => (idx >= 0 && idx < r.length ? r[idx].trim() : '');
    counts.rows++;

    const fail = (message: string, unknown = false) => {
      rows.push({ line, status: 'error', card_id: null, name: null, finish: 'normal', qty: null, note: undefined, message });
      counts.error++;
      if (unknown) counts.unknown++;
    };

    // ---- resolve the card ----
    let card: Card | undefined;
    const warns: string[] = [];
    const rawId = cell(cols.card_id);
    const rawSet = cell(cols.set_code);
    const rawNum = cell(cols.number);
    const rawName = cell(cols.name);
    if (rawId) {
      card = ctx.cardsById.get(normalizeCardId(rawId));
      if (!card) {
        const alt = normalizeCommunityId(rawId);
        if (alt) card = ctx.cardsById.get(alt);
      }
      if (!card) {
        fail(`Unknown card id “${rawId}”`, true);
        continue;
      }
    } else if (rawSet || rawNum) {
      if (!rawSet || !rawNum) {
        fail(rawSet ? 'Missing number' : 'Missing set_code');
        continue;
      }
      const id = normalizeCommunityId(`${rawSet}-${rawNum}`);
      card = id ? ctx.cardsById.get(id) : undefined;
      if (!card) {
        fail(`No card ${rawSet.toUpperCase()}-${rawNum} in the catalog`, true);
        continue;
      }
    } else if (rawName) {
      const matches = ctx.byName.get(rawName.toLowerCase()) ?? [];
      if (matches.length === 1) card = matches[0];
      else if (matches.length > 1) {
        const canon = matches.filter((c) => !c.variant_of);
        if (canon.length === 1) {
          card = canon[0];
          warns.push(`Name matches ${matches.length} printings — using ${card.id}`);
        } else {
          fail(`“${rawName}” matches ${matches.length} printings (${matches
            .slice(0, 3)
            .map((c) => c.id)
            .join(', ')}…) — add card_id or set_code + number`);
          continue;
        }
      }
      if (!card) {
        fail(`No card named “${rawName}”`, true);
        continue;
      }
    } else {
      fail('No card_id, set_code + number, or name');
      continue;
    }

    if (rawName && rawName.toLowerCase() !== card.name.trim().toLowerCase()) warns.push(`File says “${rawName}”, catalog says “${card.name}”`);

    // ---- finish ----
    const rawFinish = cell(cols.finish);
    const finish = parseFinish(rawFinish);
    if (finish === null) {
      fail(`Unknown finish “${rawFinish}” (use normal or foil)`);
      continue;
    }

    // ---- qty ----
    let qty = 1;
    if (cols.qty >= 0) {
      const rawQty = cell(cols.qty);
      if (rawQty === '') {
        fail('qty is empty');
        continue;
      }
      const n = Number(rawQty.replace(/,/g, ''));
      if (!Number.isInteger(n)) {
        fail(`qty “${rawQty}” is not a whole number`);
        continue;
      }
      if (n < 0 || n > MAX_QTY) {
        fail(`qty ${n} is out of range (0–${fmtInt(MAX_QTY)})`);
        continue;
      }
      qty = n;
    }

    const note = cols.note >= 0 ? cell(cols.note).slice(0, 500) : undefined;

    // ---- duplicates ----
    const key = invKey(card.id, finish);
    const firstLine = seen.get(key);
    if (firstLine !== undefined) {
      rows.push({ line, status: 'error', card_id: card.id, name: card.name, finish, qty, note, message: `Duplicate of line ${firstLine} (${card.id} ${finish})` });
      counts.error++;
      counts.duplicates++;
      continue;
    }
    seen.set(key, line);

    const status: ImportRowStatus = warns.length ? 'warn' : 'ok';
    rows.push({ line, status, card_id: card.id, name: card.name, finish, qty, note, message: warns.join(' · ') });
    if (status === 'warn') counts.warn++;
    else counts.ok++;
    counts.copies += qty;
  }

  return { ...base, rows, counts };
}

/** Items for POST /api/inventory. Merge only sets notes that are present; set/replace write the note column as-is. */
export function buildItems(a: ImportAnalysis, mode: InventoryMode): InventoryItem[] {
  const out: InventoryItem[] = [];
  for (const r of a.rows) {
    if (r.status === 'error' || !r.card_id || r.qty === null) continue;
    const item: InventoryItem = { card_id: r.card_id, finish: r.finish, qty: r.qty };
    if (mode === 'add') {
      if (r.note) item.note = r.note;
      if (r.qty === 0 && !r.note) continue; // no-op
    } else if (a.hasNote && r.note !== undefined) item.note = r.note;
    out.push(item);
  }
  return out;
}

export interface NetChange {
  /** net copies after applying */
  delta: number;
  /** rows that go down (set/replace) */
  decreases: number;
  /** inventory rows zeroed because they are not in the file (replace only) */
  zeroed: number;
}

export function computeNet(items: InventoryItem[], mode: InventoryMode, inventory: Map<string, InventoryRow>): NetChange {
  let delta = 0,
    decreases = 0,
    zeroed = 0;
  const listed = new Set<string>();
  for (const it of items) {
    const key = invKey(it.card_id, it.finish);
    listed.add(key);
    const cur = inventory.get(key)?.qty ?? 0;
    const q = it.qty ?? 0;
    if (mode === 'add') delta += q;
    else {
      delta += q - cur;
      if (q < cur) decreases++;
    }
  }
  if (mode === 'replace') {
    for (const row of inventory.values()) {
      if (row.qty > 0 && !listed.has(invKey(row.card_id, row.finish))) {
        zeroed++;
        delta -= row.qty;
      }
    }
  }
  return { delta, decreases, zeroed };
}

// ---------------------------------------------------------------------------
// dialog
// ---------------------------------------------------------------------------

interface Source {
  name: string;
  text: string;
  bytes: number;
}

const MODE_LABEL: Record<InventoryMode, string> = { add: 'Merge', set: 'Replace listed', replace: 'Replace all' };
const MODE_HELP: Record<InventoryMode, string> = {
  add: 'Adds the file’s quantities on top of what you own. Notes are written only where the file has one.',
  set: 'Sets each listed card to exactly the file’s quantity (and note). Cards not in the file are untouched.',
  replace: 'Sets the listed cards, then zeroes every other card in your collection. Type REPLACE to confirm.',
};
const ROW_H = 40;
const PREVIEW_LINES = 6;

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const cardsById = useStore((s) => s.cardsById);
  const inventory = useStore((s) => s.inventory);
  const importCsv = useStore((s) => s.importCsv);
  const byName = useMemo(() => buildNameIndex(cardsById), [cardsById]);

  const [source, setSource] = useState<Source | null>(null);
  const [mode, setMode] = useState<InventoryMode>('add');
  const [confirmText, setConfirmText] = useState('');
  const [skipErrors, setSkipErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);

  // reset when closed
  useEffect(() => {
    if (open) return;
    setSource(null);
    setMode('add');
    setConfirmText('');
    setSkipErrors(false);
    setBusy(false);
    setReadError(null);
  }, [open]);

  const analysis = useMemo(() => (source ? analyzeCsv(source.text, { cardsById, byName }) : null), [source, cardsById, byName]);
  const items = useMemo(() => (analysis && !analysis.fatal ? buildItems(analysis, mode) : []), [analysis, mode]);
  const net = useMemo(() => computeNet(items, mode, inventory), [items, mode, inventory]);

  const loadFile = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      setSource({ name: file.name, text, bytes: file.size });
      setReadError(null);
    } catch (e) {
      setReadError(`Couldn’t read ${file.name}: ${(e as Error).message}`);
    }
  }, []);
  const loadText = useCallback((text: string, name = 'pasted.csv') => {
    if (!text.trim()) return;
    setSource({ name, text, bytes: new Blob([text]).size });
    setReadError(null);
  }, []);

  const errors = analysis?.counts.error ?? 0;
  const blocked = !analysis || Boolean(analysis.fatal) || items.length === 0 || (errors > 0 && !skipErrors) || (mode === 'replace' && confirmText.trim() !== 'REPLACE') || busy;

  const apply = async () => {
    if (blocked || !analysis || !source) return;
    setBusy(true);
    const ok = await importCsv({ mode, items, csv_filename: source.name });
    setBusy(false);
    if (ok) onClose();
  };

  const applyLabel =
    mode === 'add' ? `Merge ${fmtInt(items.length)} row${items.length === 1 ? '' : 's'}` : mode === 'set' ? `Replace ${fmtInt(items.length)} listed row${items.length === 1 ? '' : 's'}` : `Replace entire collection`;

  return (
    <Dialog
      open={open}
      onClose={busy ? () => {} : onClose}
      title="Import CSV"
      description="Merge a list into your collection, or replace it. Nothing is written until you press Apply — and every import can be undone."
      size="xl"
      bodyClassName="flex flex-col gap-4"
      footer={
        <>
          {analysis && !analysis.fatal && (
            <span className="tabular mr-auto text-xs text-muted">
              {mode === 'add' ? (
                <>
                  Result: <strong className="font-semibold text-fg">{signed(net.delta)}</strong> copies
                </>
              ) : (
                <>
                  Result: net <strong className={cx('font-semibold', net.delta < 0 ? 'text-warning' : 'text-fg')}>{signed(net.delta)}</strong> copies
                  {net.decreases > 0 && ` · ${fmtInt(net.decreases)} row${net.decreases === 1 ? '' : 's'} go down`}
                  {mode === 'replace' && net.zeroed > 0 && <span className="text-danger"> · zeroes {fmtInt(net.zeroed)} row{net.zeroed === 1 ? '' : 's'} not in the file</span>}
                </>
              )}
            </span>
          )}
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={mode === 'replace' ? 'danger' : 'primary'} onClick={() => void apply()} disabled={blocked} loading={busy} leftIcon={<Upload className="size-4" />} title={errors > 0 && !skipErrors ? `Fix or skip the ${errors} row${errors === 1 ? '' : 's'} with errors first` : undefined}>
            {applyLabel}
          </Button>
        </>
      }
    >
      {!source ? (
        <Intake onFile={loadFile} onText={loadText} error={readError} />
      ) : (
        <>
          <SourceBar source={source} analysis={analysis} onReset={() => setSource(null)} />
          {analysis?.fatal ? (
            <div role="alert" className="flex gap-3 rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
              <div>
                <p className="font-medium text-fg">{analysis.fatal}</p>
                <p className="mt-1 text-xs text-muted">
                  Expected header: <code className="font-mono text-fg/80">card_id,set_code,number,name,finish,qty,note</code> — card_id alone is enough.
                </p>
              </div>
            </div>
          ) : (
            analysis && (
              <>
                <RawPreview text={source.text} />
                <SummaryChips a={analysis} />
                {analysis.unknownColumns.length > 0 && (
                  <p className="text-[11.5px] text-faint">
                    Ignored column{analysis.unknownColumns.length === 1 ? '' : 's'}: {analysis.unknownColumns.join(', ')}
                  </p>
                )}
                {!analysis.hasQty && <p className="text-[11.5px] text-warning">No qty column — every row counts as 1 copy.</p>}
                <PreviewTable rows={analysis.rows} />
                {errors > 0 && (
                  <label className="inline-flex cursor-pointer items-start gap-2 text-[13px] text-fg select-none">
                    <input type="checkbox" checked={skipErrors} onChange={(e) => setSkipErrors(e.target.checked)} className="mt-0.5 size-4 cursor-pointer accent-[var(--color-accent)]" />
                    <span>
                      Skip the {fmtInt(errors)} row{errors === 1 ? '' : 's'} with errors and import the other {fmtInt(analysis.counts.ok + analysis.counts.warn)}
                      <span className="block text-xs text-muted">Otherwise fix the file and choose it again.</span>
                    </span>
                  </label>
                )}
                <section className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2 p-3" aria-label="Import mode">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs font-semibold tracking-wider text-faint uppercase">Mode</span>
                    <Segmented<InventoryMode>
                      size="sm"
                      ariaLabel="Import mode"
                      value={mode}
                      onChange={(m) => {
                        setMode(m);
                        setConfirmText('');
                      }}
                      options={[
                        { value: 'add', label: MODE_LABEL.add, title: 'Add quantities (safe)' },
                        { value: 'set', label: MODE_LABEL.set, title: 'Set listed cards to the file’s quantities' },
                        { value: 'replace', label: MODE_LABEL.replace, title: 'Replace the whole collection with the file' },
                      ]}
                    />
                  </div>
                  <p className="text-[12.5px] text-muted">{MODE_HELP[mode]}</p>
                  {mode === 'replace' && (
                    <label className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                      <span className="text-[12.5px] font-medium text-danger">
                        This zeroes {fmtInt(net.zeroed)} row{net.zeroed === 1 ? '' : 's'} you own that aren’t in the file. Type <code className="font-mono">REPLACE</code> to confirm:
                      </span>
                      <input
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value)}
                        placeholder="REPLACE"
                        spellCheck={false}
                        autoComplete="off"
                        aria-label="Type REPLACE to confirm"
                        className="tabular h-9 w-36 rounded-lg border border-danger/40 bg-surface px-3 font-mono text-sm text-fg placeholder:text-faint focus:border-danger focus:outline-none focus:ring-2 focus:ring-danger/30"
                      />
                    </label>
                  )}
                </section>
              </>
            )
          )}
        </>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// pieces
// ---------------------------------------------------------------------------

function Intake({ onFile, onText, error }: { onFile: (f: File) => void; onText: (t: string) => void; error: string | null }) {
  const [drag, setDrag] = useState(false);
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const onDrop = (e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onFile(f);
    else {
      const t = e.dataTransfer.getData('text');
      if (t) onText(t);
    }
  };
  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onFile(f);
    e.target.value = '';
  };
  const onPasteZone = (e: ReactClipboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).tagName === 'TEXTAREA') return;
    const t = e.clipboardData.getData('text');
    if (t.trim()) {
      e.preventDefault();
      onText(t);
    }
  };
  const onTextChange = (v: string) => {
    setText(v);
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (!v.trim()) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      onText(v);
    }, 350);
  };

  return (
    <div className="flex flex-col gap-4" onPaste={onPasteZone}>
      <div
        role="button"
        tabIndex={0}
        aria-label="Choose a CSV file (or drop one here)"
        onClick={() => fileRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!drag) setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={cx(
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
          drag ? 'border-accent bg-accent/10' : 'border-border-strong bg-surface-2 hover:border-accent/60 hover:bg-surface-3',
        )}
      >
        <div className="flex size-12 items-center justify-center rounded-2xl border border-border bg-surface text-muted" aria-hidden>
          <FileUp className="size-6" />
        </div>
        <p className="text-sm font-semibold text-fg">{drag ? 'Drop it!' : 'Drop a CSV here, or click to choose a file'}</p>
        <p className="text-xs text-muted">
          Header: <code className="font-mono text-fg/80">card_id,set_code,number,name,finish,qty,note</code> — the export from this app round-trips; other lists need at least <code className="font-mono">card_id</code> or <code className="font-mono">set_code</code> + <code className="font-mono">number</code>.
        </p>
        <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={onPick} tabIndex={-1} />
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3 text-[11px] text-faint">
        <span className="h-px flex-1 bg-border" aria-hidden />
        or paste
        <span className="h-px flex-1 bg-border" aria-hidden />
      </div>
      <label className="flex flex-col gap-1">
        <span className="sr-only">Paste CSV text</span>
        <textarea
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          rows={5}
          spellCheck={false}
          placeholder={'card_id,finish,qty\nOGN-045,normal,3\nOGN-045,foil,1'}
          className="w-full resize-y rounded-xl border border-border bg-surface-2 px-3 py-2 font-mono text-xs text-fg placeholder:text-faint focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
      </label>
    </div>
  );
}

function SourceBar({ source, analysis, onReset }: { source: Source; analysis: ImportAnalysis | null; onReset: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-2 px-3 py-2">
      <FileSpreadsheet className="size-5 shrink-0 text-accent" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-fg" title={source.name}>
          {source.name}
        </p>
        <p className="tabular text-[11.5px] text-muted">
          {fmtBytes(source.bytes)}
          {analysis && !analysis.fatal ? ` · ${fmtInt(analysis.counts.rows)} data row${analysis.counts.rows === 1 ? '' : 's'} · columns: ${analysis.header.filter(Boolean).join(', ')}` : ''}
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onReset}>
        Choose another
      </Button>
    </div>
  );
}

function RawPreview({ text }: { text: string }) {
  const lines = useMemo(() => {
    const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    const all = body.split(/\r?\n/);
    const shown = all.slice(0, PREVIEW_LINES).map((l) => (l.length > 160 ? `${l.slice(0, 160)}…` : l));
    return { shown, more: Math.max(0, all.filter((l) => l.trim()).length - PREVIEW_LINES) };
  }, [text]);
  return (
    <pre className="tabular max-h-40 overflow-auto rounded-xl border border-border bg-bg px-3 py-2 font-mono text-[11px] leading-5 text-muted" aria-label="First lines of the file">
      {lines.shown.map((l, i) => (
        <span key={i} className={cx('block whitespace-pre', i === 0 && 'text-fg/80')}>
          <span className="mr-3 inline-block w-5 text-right text-faint select-none">{i + 1}</span>
          {l}
        </span>
      ))}
      {lines.more > 0 && <span className="block text-faint">… {fmtInt(lines.more)} more line{lines.more === 1 ? '' : 's'}</span>}
    </pre>
  );
}

function SummaryChips({ a }: { a: ImportAnalysis }) {
  const c = a.counts;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Import summary">
      <Badge tone="neutral" size="md">
        {fmtInt(c.rows)} row{c.rows === 1 ? '' : 's'}
      </Badge>
      <Badge tone="success" size="md">
        <CircleCheck className="size-3.5" aria-hidden /> {fmtInt(c.ok)} ok
      </Badge>
      {c.warn > 0 && (
        <Badge tone="warning" size="md">
          <TriangleAlert className="size-3.5" aria-hidden /> {fmtInt(c.warn)} warning{c.warn === 1 ? '' : 's'}
        </Badge>
      )}
      {c.error > 0 && (
        <Badge tone="danger" size="md">
          <CircleAlert className="size-3.5" aria-hidden /> {fmtInt(c.error)} error{c.error === 1 ? '' : 's'}
        </Badge>
      )}
      {c.unknown > 0 && (
        <Badge tone="outline" size="md">
          {fmtInt(c.unknown)} unknown card{c.unknown === 1 ? '' : 's'}
        </Badge>
      )}
      {c.duplicates > 0 && (
        <Badge tone="outline" size="md">
          {fmtInt(c.duplicates)} duplicate{c.duplicates === 1 ? '' : 's'}
        </Badge>
      )}
      <Badge tone="accent" size="md" className="ml-auto">
        {fmtInt(c.copies)} copies in file
      </Badge>
    </div>
  );
}

const COLS = 'grid-cols-[44px_minmax(0,1fr)_60px_52px] sm:grid-cols-[52px_minmax(0,1fr)_72px_56px_minmax(0,0.9fr)]';

function PreviewTable({ rows }: { rows: ImportRow[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<'all' | 'problems'>('all');
  const shown = useMemo(() => (filter === 'problems' ? rows.filter((r) => r.status !== 'ok') : rows), [rows, filter]);
  const v = useVirtualizer({ count: shown.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_H, overscan: 10 });
  const problems = rows.length - rows.filter((r) => r.status === 'ok').length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[12px] font-semibold tracking-wider text-faint uppercase">Preview</h3>
        {problems > 0 && (
          <Segmented<'all' | 'problems'>
            size="sm"
            ariaLabel="Preview filter"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All', count: rows.length },
              { value: 'problems', label: 'Problems', count: problems },
            ]}
          />
        )}
      </div>
      <div role="table" aria-label="Rows to import" aria-rowcount={shown.length + 1} className="overflow-hidden rounded-xl border border-border">
        <div role="row" className={cx('grid items-center gap-2 border-b border-border bg-surface-2 px-2 py-1.5 text-[10.5px] font-semibold tracking-wider text-faint uppercase', COLS)}>
          <span role="columnheader">Line</span>
          <span role="columnheader">Card</span>
          <span role="columnheader">Finish</span>
          <span role="columnheader" className="text-right">
            Qty
          </span>
          <span role="columnheader" className="hidden sm:block">
            Note
          </span>
        </div>
        <div ref={scrollRef} role="rowgroup" className="max-h-[min(40dvh,420px)] overflow-y-auto overscroll-contain">
          {shown.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-faint">No data rows.</p>
          ) : (
            <div style={{ height: v.getTotalSize(), position: 'relative', width: '100%' }}>
              {v.getVirtualItems().map((it) => {
                const r = shown[it.index];
                return <PreviewRow key={it.key} row={r} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: ROW_H, transform: `translateY(${it.start}px)` }} last={it.index === shown.length - 1} />;
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const STATUS_ICON = {
  ok: <CircleCheck className="size-3.5 text-success" aria-label="ok" />,
  warn: <TriangleAlert className="size-3.5 text-warning" aria-label="warning" />,
  error: <CircleAlert className="size-3.5 text-danger" aria-label="error" />,
} as const;

function PreviewRow({ row, style, last }: { row: ImportRow; style: React.CSSProperties; last: boolean }) {
  return (
    <div
      role="row"
      style={style}
      className={cx('grid items-center gap-2 px-2 text-[12.5px]', COLS, !last && 'border-b border-border', row.status === 'error' ? 'bg-danger/8' : row.status === 'warn' ? 'bg-warning/8' : '')}
      title={row.message || undefined}
    >
      <span role="cell" className="tabular flex items-center gap-1.5 text-muted">
        {STATUS_ICON[row.status]}
        {row.line}
      </span>
      <span role="cell" className="flex min-w-0 flex-col leading-tight">
        <span className="truncate">
          {row.card_id ? <span className="tabular mr-1.5 font-semibold text-fg">{row.card_id}</span> : null}
          <span className={cx('text-muted', !row.card_id && 'text-faint')}>{row.name ?? (row.card_id ? '' : '—')}</span>
        </span>
        {row.message && <span className={cx('truncate text-[11px]', row.status === 'error' ? 'text-danger' : 'text-warning')}>{row.message}</span>}
      </span>
      <span role="cell" className={cx('text-xs', row.finish === 'foil' ? 'foil-text font-semibold' : 'text-muted')}>
        {row.finish === 'foil' ? '✦ foil' : 'normal'}
      </span>
      <span role="cell" className={cx('tabular text-right font-semibold', row.qty === null ? 'text-faint' : 'text-fg')}>
        {row.qty ?? '—'}
      </span>
      <span role="cell" className="hidden truncate text-xs text-muted sm:block" title={row.note}>
        {row.note ?? ''}
      </span>
    </div>
  );
}
