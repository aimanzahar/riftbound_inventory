import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, Minus, Plus, ScanLine, X } from 'lucide-react';
import type { Product, PurchasePreview } from '../../../../shared/types.ts';
import { api, errorMessage } from '../../lib/api.ts';
import { cx, fmtDate, fmtInt, fmtMYR, fmtUSD, usdToMyr } from '../../lib/format.ts';
import { openCard } from '../../lib/router.ts';
import { useStore } from '../../store/store.ts';
import { usePreview } from '../cards/previewStore.ts';
import { Badge } from '../ui/Badge.tsx';
import { Button } from '../ui/Button.tsx';
import { Skeleton } from '../ui/Skeleton.tsx';
import { ContentsTable } from './ContentsTable.tsx';
import { DupBanner } from './DupBanner.tsx';
import { ProductImage, contentsSummary, fallbackCardFor, isFixedList, kindLabel, kindTone, packHashFor } from './ProductCard.tsx';

const MAX_QTY = 20;
const PREVIEW_DEBOUNCE = 220;

export interface PurchaseDialogProps {
  product: Product | null;
  open: boolean;
  onClose: () => void;
}

/**
 * "I bought X": qty → debounced GET /preview → DupBanner + ContentsTable → POST /buy via the store.
 *
 * Rendered as a NON-modal <dialog open> overlay (portal on <body>) rather than showModal(): the
 * top layer would sit above the hover preview portal, and the contents rows must preview like tiles.
 * We still trap Tab, close on Esc/backdrop, lock body scroll and mark aria-modal; `dialog[open]`
 * keeps the global hotkeys quiet.
 */
export function PurchaseDialog({ product, open, onClose }: PurchaseDialogProps) {
  if (!open || !product || typeof document === 'undefined') return null;
  return createPortal(<PurchasePanel key={product.id} product={product} onClose={onClose} />, document.body);
}

function PurchasePanel({ product, onClose }: { product: Product; onClose: () => void }) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const cardsById = useStore((s) => s.cardsById);
  const fxRate = useStore((s) => s.fx?.rate ?? null);
  const seq = useStore((s) => s.seq);
  const buyProduct = useStore((s) => s.buyProduct);
  const hidePreview = usePreview((s) => s.hide);

  const [qty, setQty] = useState(1);
  const [preview, setPreview] = useState<PurchasePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  /** bumped by the Retry button so the preview effect re-runs with the same qty */
  const [retryTick, setRetryTick] = useState(0);
  const reqCounter = useRef(0);

  const fixed = isFixedList(product);
  const fallback = useMemo(() => fallbackCardFor(product, cardsById), [product, cardsById]);
  const { copies, distinct } = useMemo(() => contentsSummary(product), [product]);

  // ---- focus / scroll lock / esc ----
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // a touch sheet (native modal) on top handles its own Esc
      if (usePreview.getState().sheetCardId) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = bodyOverflow;
      hidePreview();
      prev?.focus?.({ preventScroll: true });
    };
  }, [onClose, hidePreview]);

  const trapTab = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const focusables = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((el) => el.getClientRects().length > 0);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && (active === first || active === panelRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // ---- preview (debounced; refetched when the collection changes) ----
  useEffect(() => {
    if (!fixed) {
      setLoading(false);
      return;
    }
    let alive = true;
    const id = ++reqCounter.current;
    setLoading(true);
    const t = window.setTimeout(() => {
      api
        .preview(product.id, qty)
        .then((p) => {
          if (!alive || id !== reqCounter.current) return;
          setPreview(p);
          setError(null);
        })
        .catch((e: unknown) => {
          if (!alive || id !== reqCounter.current) return;
          setError(errorMessage(e));
        })
        .finally(() => {
          if (alive && id === reqCounter.current) setLoading(false);
        });
    }, PREVIEW_DEBOUNCE);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [product.id, qty, seq, fixed, retryTick]);

  // a new quantity is a new decision
  useEffect(() => setAck(false), [qty]);

  const setQtyClamped = useCallback((n: number) => setQty(Math.max(1, Math.min(MAX_QTY, Math.floor(Number.isFinite(n) ? n : 1)))), []);

  const severity = preview?.summary.severity ?? 'green';
  const red = Boolean(preview && preview.summary.distinct > 0 && severity === 'red');
  const canConfirm = fixed && !busy && !loading && !error && Boolean(preview) && (preview?.summary.distinct ?? 0) > 0 && (!red || ack);
  const totalCopies = preview?.summary.copies ?? copies * qty;

  const confirm = async () => {
    if (!canConfirm) return;
    setBusy(true);
    const ok = await buyProduct(product.id, qty);
    setBusy(false);
    if (ok) onClose();
  };

  const onOpenCard = (id: string) => {
    onClose();
    openCard(id);
  };

  const msrpMyr = usdToMyr(product.msrp_usd, fxRate);

  return (
    <dialog
      open
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-[60] m-0 flex h-full w-full max-h-none max-w-none items-end justify-center border-0 bg-transparent p-0 text-fg sm:items-center"
    >
      <div className="absolute inset-0 bg-[rgba(3,6,12,0.72)] backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        tabIndex={-1}
        onKeyDown={trapTab}
        className="fade-up relative flex max-h-[92dvh] w-full flex-col rounded-t-2xl border-t border-border bg-surface shadow-pop outline-none sm:max-h-[min(88dvh,920px)] sm:w-[min(calc(100vw-2rem),780px)] sm:rounded-2xl sm:border"
      >
        {/* header */}
        <header className="flex items-start gap-3 px-4 pt-4 pb-3 sm:px-5 sm:pt-5">
          <ProductImage product={product} fallbackCard={fallback} className="size-16 shrink-0 rounded-lg border border-border" imgClassName="p-1" />
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base leading-tight font-semibold tracking-tight">
              {product.name}
            </h2>
            <p className="tabular mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              <Badge tone={kindTone(product.kind)} size="xs">
                {kindLabel(product.kind)}
              </Badge>
              {product.set_code && <span className="font-medium text-fg/80">{product.set_code}</span>}
              {product.release_date && <span>{fmtDate(product.release_date)}</span>}
              {product.msrp_usd !== null && (
                <span title="MSRP">
                  MSRP {fmtUSD(product.msrp_usd)}
                  {msrpMyr !== null && <span className="text-faint"> ≈ {fmtMYR(msrpMyr)}</span>}
                </span>
              )}
              {fixed && (
                <span>
                  {fmtInt(copies)} cards · {fmtInt(distinct)} unique
                </span>
              )}
              {product.source_url && (
                <a href={product.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent hover:text-accent-strong" title={product.source_url}>
                  source <ExternalLink className="size-3" aria-hidden />
                </a>
              )}
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose} leftIcon={<X className="size-4" />} />
        </header>

        {/* body */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4 sm:px-5">
          {!fixed ? (
            <RandomContents product={product} />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <QtyControl value={qty} onChange={setQtyClamped} disabled={busy} />
                <p className="tabular text-sm text-muted">
                  {qty > 1 ? `${qty} × ${fmtInt(copies)} = ` : ''}
                  <strong className="font-semibold text-fg">{fmtInt(totalCopies)}</strong> cards will be added
                </p>
              </div>

              {error ? (
                <div role="alert" className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-fg">
                  Couldn’t load the preview: {error}
                  <Button variant="outline" size="xs" className="ml-3" onClick={() => setRetryTick((t) => t + 1)}>
                    Retry
                  </Button>
                </div>
              ) : preview ? (
                <div className={cx(loading && 'opacity-70 transition-opacity')} aria-busy={loading}>
                  <DupBanner preview={preview} msrpUsd={product.msrp_usd} fxRate={fxRate} ack={ack} onAck={setAck} />
                </div>
              ) : (
                <Skeleton className="h-[76px] w-full" rounded="rounded-xl" />
              )}

              <section aria-label="Contents" className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-[12px] font-semibold tracking-wider text-faint uppercase">Contents</h3>
                  {preview && preview.summary.distinct > 0 && (
                    <p className="tabular text-[11.5px] text-muted">
                      <span className="text-success">{preview.summary.new_distinct} new</span> · <span className={preview.summary.partial_distinct ? 'text-warning' : ''}>{preview.summary.partial_distinct} partial</span> ·{' '}
                      <span className={preview.summary.owned_distinct ? 'text-danger' : ''}>{preview.summary.owned_distinct} owned</span>
                    </p>
                  )}
                </div>
                {preview ? <ContentsTable lines={preview.lines} onOpenCard={onOpenCard} /> : <Skeleton className="h-48 w-full" rounded="rounded-xl" />}
                <p className="text-[11px] text-faint">Hover a row for the card preview · click a name to open it in the collection.</p>
              </section>

              {product.notes && <p className="text-[12px] leading-relaxed text-muted">{product.notes}</p>}
            </>
          )}
        </div>

        {/* footer */}
        <footer className="flex items-center justify-end gap-2 border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
          {fixed && preview && preview.summary.distinct > 0 && (
            <span className="tabular mr-auto text-xs text-muted">
              {fmtInt(preview.summary.new_copies)} new · {fmtInt(preview.summary.dup_copies)} dup
            </span>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {fixed ? (
            <Button variant={red ? 'danger' : 'primary'} onClick={() => void confirm()} disabled={!canConfirm} loading={busy} title={red && !ack ? 'Tick “Add anyway” first' : undefined}>
              {red ? `Add anyway (${fmtInt(totalCopies)} cards)` : `Add ${fmtInt(totalCopies)} cards`}
            </Button>
          ) : (
            <a href={packHashFor(product)} onClick={onClose} className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3.5 text-sm font-semibold text-[#0b0f17] hover:bg-accent-strong">
              <ScanLine className="size-4" aria-hidden />
              Open Pack mode
            </a>
          )}
        </footer>
      </div>
    </dialog>
  );
}

function QtyControl({ value, onChange, disabled }: { value: number; onChange: (n: number) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium text-muted">Quantity</span>
      <div role="group" aria-label="Quantity" className="stepper inline-flex h-9 items-stretch overflow-hidden rounded-lg border border-border bg-surface-2">
        <button type="button" aria-label="One fewer" disabled={disabled || value <= 1} onClick={() => onChange(value - 1)} className="stepper-btn flex items-center justify-center px-2 text-muted hover:bg-surface-3 hover:text-fg disabled:opacity-30">
          <Minus className="size-4" aria-hidden />
        </button>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_QTY}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Quantity"
          className="tabular w-12 bg-transparent text-center text-sm font-semibold text-fg outline-none"
        />
        <button type="button" aria-label="One more" disabled={disabled || value >= MAX_QTY} onClick={() => onChange(value + 1)} className="stepper-btn flex items-center justify-center px-2 text-muted hover:bg-surface-3 hover:text-fg disabled:opacity-30">
          <Plus className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

function RandomContents({ product }: { product: Product }) {
  return (
    <div className="flex flex-col gap-3">
      <Callout>
        <p className="text-[13.5px] font-medium text-fg">This product has random contents, so there’s no fixed card list to add.</p>
        <p className="mt-1 text-xs text-muted">
          Open the packs and type the collector numbers in <strong className="font-semibold text-fg">Pack mode</strong>{product.set_code ? ` (pre-set to ${product.set_code})` : ''} — each card lands in your collection as you go.
        </p>
      </Callout>
      {product.notes && <p className="text-[12px] leading-relaxed text-muted">{product.notes}</p>}
    </div>
  );
}

function Callout({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-border bg-surface-2 p-3">{children}</div>;
}
