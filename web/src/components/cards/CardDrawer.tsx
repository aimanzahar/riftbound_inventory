import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, X } from 'lucide-react';
import type { Card, PriceHistoryPoint } from '../../../../shared/types.ts';
import { DOMAINS } from '../../../../shared/constants.ts';
import { api } from '../../lib/api.ts';
import { useStore } from '../../store/store.ts';
import { usePrintingsOf, useProductsForCard, useQty } from '../../store/selectors.ts';
import { invKey } from '../../store/types.ts';
import { closeCard, navigate, openCard } from '../../lib/router.ts';
import { cx, fmtMYR, fmtUSD, relTime, usdToMyr } from '../../lib/format.ts';
import { CardImage } from './CardImage.tsx';
import { DomainPips, domainColor, domainLabel, sortDomains } from './DomainPips.tsx';
import { QtyStepper } from './QtyStepper.tsx';
import { TipEditor } from './TipEditor.tsx';
import { Sparkline } from './Sparkline.tsx';
import { UsageList } from './UsageList.tsx';
import { MyDecksList } from '../decks/MyDecksList.tsx';
import { CardHistory } from './CardHistory.tsx';
import { RARITY_COLORS } from './CardTile.tsx';
import { Button } from '../ui/Button.tsx';
import { Badge } from '../ui/Badge.tsx';
import { Kbd } from '../ui/Kbd.tsx';

export interface CardDrawerProps {
  cardId: string;
  visibleIds: string[];
  /** phone/tablet overlay variant (shows its own close affordance) */
  overlay?: boolean;
}

/** `#/card/<id>`: everything about one printing. ←/→ step through the current visible list. */
export function CardDrawer({ cardId, visibleIds, overlay }: CardDrawerProps) {
  const card = useStore((s) => s.cardsById.get(cardId));
  const boot = useStore((s) => s.boot);
  const scrollRef = useRef<HTMLDivElement>(null);

  const idx = visibleIds.indexOf(cardId);
  const prevId = idx > 0 ? visibleIds[idx - 1] : null;
  const nextId = idx >= 0 && idx < visibleIds.length - 1 ? visibleIds[idx + 1] : null;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [cardId]);

  // ←/→ inside the drawer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'ArrowLeft' && prevId) {
        e.preventDefault();
        openCard(prevId, { replace: true });
      } else if (e.key === 'ArrowRight' && nextId) {
        e.preventDefault();
        openCard(nextId, { replace: true });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prevId, nextId]);

  if (!card) {
    return (
      <div className="flex h-full flex-col">
        <DrawerHeader title={boot === 'ready' ? 'Card not found' : 'Loading…'} subtitle={cardId} prevId={null} nextId={null} overlay={overlay} />
        <div className="p-5 text-sm text-muted">{boot === 'ready' ? `No card with id ${cardId} in the catalog.` : 'Loading catalog…'}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" aria-label={`${card.name} details`}>
      <DrawerHeader title={card.name} subtitle={card.id} prevId={prevId} nextId={nextId} overlay={overlay} position={idx >= 0 ? { i: idx + 1, n: visibleIds.length } : null} />
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="flex flex-col gap-6 px-5 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <Hero card={card} />
          <Section title="Tip">
            <TipEditor cardId={card.id} />
          </Section>
          <Section title="Inventory">
            <InventoryPanel card={card} />
          </Section>
          <Section title="Price">
            <PricePanel card={card} />
          </Section>
          <Section title="In my decks">
            <MyDecksList card={card} />
          </Section>
          <Section title="Used in meta decks">
            <UsageList card={card} />
          </Section>
          <Section title="Found in products">
            <ProductsPanel card={card} />
          </Section>
          <PrintingsPanel card={card} />
          <Section title="History">
            <CardHistory cardId={card.id} />
          </Section>
        </div>
      </div>
    </div>
  );
}

function DrawerHeader({ title, subtitle, prevId, nextId, overlay, position }: { title: string; subtitle: string; prevId: string | null; nextId: string | null; overlay?: boolean; position?: { i: number; n: number } | null }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
      <Button variant="ghost" size="icon-sm" aria-label="Close details" onClick={closeCard} leftIcon={overlay ? <ChevronLeft className="size-5" /> : <X className="size-4" />} />
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[15px] font-semibold tracking-tight">{title}</h2>
        <p className="tabular truncate text-[11px] text-muted">
          {subtitle}
          {position && <span className="text-faint"> · {position.i} of {position.n}</span>}
        </p>
      </div>
      <div className="flex items-center gap-0.5">
        <Button variant="ghost" size="icon-sm" aria-label="Previous card" title="Previous (←)" disabled={!prevId} onClick={() => prevId && openCard(prevId, { replace: true })} leftIcon={<ChevronLeft className="size-4" />} />
        <Button variant="ghost" size="icon-sm" aria-label="Next card" title="Next (→)" disabled={!nextId} onClick={() => nextId && openCard(nextId, { replace: true })} leftIcon={<ChevronRight className="size-4" />} />
      </div>
    </header>
  );
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-faint">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Hero({ card }: { card: Card }) {
  const domains = sortDomains(card.domains);
  const accent = domainColor(domains[0] ?? 'colorless');
  return (
    <div className="flex flex-col gap-4">
      <div className="relative mx-auto w-full max-w-[300px] overflow-hidden rounded-xl shadow-pop" style={{ boxShadow: `0 0 0 1px color-mix(in oklab, ${accent} 45%, transparent), 0 18px 50px rgba(0,0,0,0.5)` }}>
        <CardImage card={card} kind="full" eager rounded="rounded-xl" />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {card.type && (
            <Badge tone="outline" size="md">
              {card.supertype && card.supertype !== card.type ? `${card.supertype} ${card.type}` : card.type}
            </Badge>
          )}
          {card.rarity && (
            <Badge tone="outline" size="md">
              <span className="size-2 rounded-full" style={{ background: RARITY_COLORS[card.rarity] ?? '#6b7280' }} aria-hidden />
              {card.rarity}
            </Badge>
          )}
          {domains.map((d) => (
            <Badge key={d} size="md" className="text-[#0b0f17]" tone="neutral" title={DOMAINS[d]?.label}>
              <span className="rounded px-1" style={{ background: domainColor(d), color: DOMAINS[d]?.fg ?? '#000' }}>
                {domainLabel(d)}
              </span>
            </Badge>
          ))}
          {card.banned === 1 && (
            <Badge tone="danger" size="md">
              Banned
            </Badge>
          )}
          {card.variant_kind && (
            <Badge tone="neutral" size="md" className="capitalize">
              {card.variant_kind.replace('_', ' ')}
            </Badge>
          )}
        </div>
        <dl className="tabular grid grid-cols-3 gap-2 text-center">
          <Stat label="Energy" value={card.energy} />
          <Stat label="Might" value={card.might} />
          <Stat label="Power" value={card.power} />
        </dl>
        {card.rules_text && <RulesText text={card.rules_text} />}
        {card.flavor && <p className="text-[13px] leading-relaxed text-muted italic">{card.flavor}</p>}
        <p className="text-[11px] text-faint">
          {card.public_code ?? card.id}
          {card.artist ? ` · Illustrated by ${card.artist}` : ''}
          {card.tags.length ? ` · ${card.tags.join(', ')}` : ''}
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-2 py-1.5">
      <dt className="text-[10px] font-medium uppercase tracking-wider text-faint">{label}</dt>
      <dd className={cx('text-base font-semibold', value === null ? 'text-faint' : 'text-fg')}>{value === null ? '—' : value}</dd>
    </div>
  );
}

const TOKEN_RE = /:rb_([a-z0-9_]+):|\[([^\]\n]{1,24})\]/g;

/** Rules text with Riot's `:rb_energy_3:` / `:rb_rune_fury:` / `:rb_exhaust:` tokens rendered as glyphs. */
export function RulesText({ text, className }: { text: string; className?: string }) {
  const parts = useMemo(() => {
    const out: ReactNode[] = [];
    let last = 0;
    let i = 0;
    for (const m of text.matchAll(TOKEN_RE)) {
      const start = m.index ?? 0;
      if (start > last) out.push(text.slice(last, start));
      out.push(<Glyph key={i++} token={m[1] ?? m[2] ?? ''} />);
      last = start + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }, [text]);
  return <p className={cx('text-[13.5px] leading-relaxed whitespace-pre-line text-fg/90', className)}>{parts}</p>;
}

function Glyph({ token }: { token: string }) {
  const t = token.trim().toLowerCase();
  const energy = t.match(/^energy_?(\d+|x)$/) ?? t.match(/^(\d+|x)$/);
  if (energy) {
    const n = energy[1] ?? energy[0];
    return (
      <span className="glyph" title={`${n} energy`}>
        {n}
      </span>
    );
  }
  if (/^(a|any|any rune|rune_rainbow|rune_any|rainbow)$/.test(t)) return <span className="glyph" title="Any rune">◈</span>;
  const rune = t.match(/^rune_?([a-z]+)$/) ?? t.match(/^([a-z]+) rune$/);
  if (rune && DOMAINS[rune[1]]) {
    const id = rune[1];
    return <span className="glyph" style={{ background: domainColor(id), color: DOMAINS[id]?.fg ?? '#000', borderColor: 'transparent' }} title={`${domainLabel(id)} rune`} aria-label={`${domainLabel(id)} rune`}>
      {domainLabel(id)[0]}
    </span>;
  }
  if (t === 'exhaust' || t === '>') return <span className="glyph" title="Exhaust">↻</span>;
  if (t === 's' || t === 'star' || t === 'signature') return <span className="glyph" title="Signature">★</span>;
  // keyword chip: [Reaction], [Action], [Showdown], [Accelerate]…
  return <span className="rounded-[4px] bg-surface-3 px-1 py-px text-[0.85em] font-semibold tracking-wide text-fg">{token.replace(/_/g, ' ')}</span>;
}

function InventoryPanel({ card }: { card: Card }) {
  const row = useStore((s) => s.inventory.get(invKey(card.id, 'normal')));
  const setNote = useStore((s) => s.setNote);
  const normal = useQty(card.id, 'normal');
  const foil = useQty(card.id, 'foil');
  const [note, setNoteLocal] = useState(row?.note ?? '');
  const timer = useRef<number | null>(null);
  const dirty = useRef(false);

  useEffect(() => {
    if (!dirty.current) setNoteLocal(row?.note ?? '');
  }, [row?.note, card.id]);

  const commit = (v: string) => {
    setNoteLocal(v);
    dirty.current = true;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      dirty.current = false;
      if (v !== (row?.note ?? '')) void setNote(card.id, 'normal', v);
    }, 600);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2">
          <span className="text-sm text-muted">Normal</span>
          <QtyStepper cardId={card.id} finish="normal" label={card.name} isolate={false} />
        </div>
        <div className={cx('flex items-center justify-between gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2', card.has_foil === 0 && 'opacity-60')}>
          <span className="foil-text text-sm font-semibold">✦ Foil</span>
          <QtyStepper cardId={card.id} finish="foil" label={card.name} isolate={false} />
        </div>
      </div>
      <p className="text-[11px] text-faint">
        {normal + foil > 0 ? `You own ${normal + foil} cop${normal + foil === 1 ? 'y' : 'ies'}` : 'Not in your collection yet'}
        {row?.updated_at ? ` · updated ${relTime(row.updated_at)}` : ''}
        {card.has_foil === 0 ? ' · no foil printing known' : ''}
      </p>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-muted">Note</span>
        <input
          value={note}
          onChange={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              (e.target as HTMLInputElement).blur();
            }
          }}
          maxLength={500}
          placeholder="Condition, where it is, who borrowed it…"
          className="h-9 rounded-lg border border-border bg-surface-2 px-3 text-sm text-fg placeholder:text-faint focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
      </label>
    </div>
  );
}

function PricePanel({ card }: { card: Card }) {
  const normal = useStore((s) => s.prices.get(invKey(card.id, 'normal')));
  const foilP = useStore((s) => s.prices.get(invKey(card.id, 'foil')));
  const fx = useStore((s) => s.fx);
  const [history, setHistory] = useState<PriceHistoryPoint[] | null>(null);

  useEffect(() => {
    let alive = true;
    setHistory(null);
    api
      .priceHistory(card.id, 90)
      .then((r) => alive && setHistory(r.history))
      .catch(() => alive && setHistory([]));
    return () => {
      alive = false;
    };
  }, [card.id]);

  const p = normal ?? foilP;
  if (!p) return <p className="text-sm text-faint">No price yet. Prices come from TCGplayer (via tcgcsv) once the “prices” job has run.</p>;
  const usd = p.usd_market ?? p.usd_mid;
  const myr = usdToMyr(usd, fx?.rate ?? null);
  const series = (history ?? []).filter((h) => h.finish === p.finish).map((h) => ({ day: h.day, value: h.usd_market }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="tabular text-2xl font-semibold tracking-tight">{myr !== null ? fmtMYR(myr) : fmtUSD(usd)}</div>
          <div className="tabular text-xs text-muted">
            {myr !== null ? `${fmtUSD(usd)} market` : 'TCGplayer market'}
            {fx ? ` · FX ${fx.rate.toFixed(3)}${fx.stale ? ' (stale)' : ''}` : ' · no FX rate yet'}
          </div>
        </div>
        <a
          href={tcgplayerUrl(card)}
          target="_blank"
          rel="noopener noreferrer"
          title={card.tcgplayer_id ? `Open this printing on TCGplayer (product #${card.tcgplayer_id})` : 'Search this card on TCGplayer'}
          className="group text-right text-[11px] text-faint hover:text-accent focus-visible:text-accent"
        >
          <span className="underline decoration-dotted underline-offset-2 group-hover:decoration-solid">{p.source.startsWith('tcgplayer') ? 'TCGplayer' : p.source} ↗</span>
          <br />
          fetched {relTime(p.fetched_at)}
        </a>
      </div>
      <dl className="tabular grid grid-cols-3 gap-2 text-center text-xs">
        <Money label="Low" usd={p.usd_low} />
        <Money label="Mid" usd={p.usd_mid} />
        <Money label="High" usd={p.usd_high} />
      </dl>
      {foilP && normal && (
        <p className="tabular text-xs text-muted">
          Foil: <span className="foil-text font-semibold">{fmtUSD(foilP.usd_market ?? foilP.usd_mid)}</span>
          {fx && (foilP.usd_market ?? foilP.usd_mid) !== null ? ` (${fmtMYR(usdToMyr(foilP.usd_market ?? foilP.usd_mid, fx.rate))})` : ''}
        </p>
      )}
      <div>
        <div className="mb-1 text-[11px] text-faint">Last 90 days (USD market)</div>
        {history === null ? <div className="skeleton h-14 w-full rounded-lg" /> : <Sparkline points={series} width={360} height={56} className="max-w-full" />}
      </div>
    </div>
  );
}

/** TCGplayer page for this printing (product id from the catalog), or a TCGplayer search for the card name. */
export function tcgplayerUrl(card: Pick<Card, 'name' | 'tcgplayer_id'>): string {
  if (card.tcgplayer_id) return `https://www.tcgplayer.com/product/${card.tcgplayer_id}`;
  return `https://www.tcgplayer.com/search/riftbound-league-of-legends-trading-card-game/product?q=${encodeURIComponent(card.name)}`;
}

function Money({ label, usd }: { label: string; usd: number | null }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-2 py-1.5">
      <dt className="text-[10px] font-medium uppercase tracking-wider text-faint">{label}</dt>
      <dd className={cx('font-semibold', usd === null ? 'text-faint' : 'text-fg')}>{fmtUSD(usd)}</dd>
    </div>
  );
}

function ProductsPanel({ card }: { card: Card }) {
  const products = useProductsForCard(card.id);
  if (!products.length) return <p className="text-sm text-faint">Not part of any fixed-list product.</p>;
  return (
    <ul className="flex flex-col gap-1">
      {products.map((p) => {
        const qty = p.contents.filter((c) => c.card_id === card.id).reduce((a, c) => a + c.qty, 0);
        return (
          <li key={p.id}>
            <button type="button" onClick={() => navigate({ page: 'products', query: { product: p.id } })} title="Open this product" className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-left text-xs hover:border-border-strong">
              <span className="min-w-0 truncate font-medium text-fg">{p.name}</span>
              <span className="flex shrink-0 items-center gap-1.5 text-muted">
                <Badge tone="neutral" size="xs">
                  ×{qty}
                </Badge>
                <ExternalLink className="size-3.5 text-faint" aria-hidden />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function PrintingsPanel({ card }: { card: Card }) {
  const printings = usePrintingsOf(card);
  if (!printings.length) return null;
  return (
    <Section title="Other printings">
      <div className="flex flex-wrap gap-1.5">
        {printings.map((p) => (
          <button key={p.id} type="button" onClick={() => openCard(p.id, { replace: true })} className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 text-xs text-muted hover:border-border-strong hover:text-fg">
            <span className="tabular">{p.id}</span>
            {p.variant_kind && <span className="text-faint capitalize">{p.variant_kind.replace('_', ' ')}</span>}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-faint">
        Owned counts for duplicates and meta usage are pooled across printings. <Kbd>←</Kbd> <Kbd>→</Kbd> step through the list.
      </p>
    </Section>
  );
}

export { DomainPips };
