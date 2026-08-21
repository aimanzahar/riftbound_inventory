import { useMemo } from 'react';
import { ExternalLink } from 'lucide-react';
import type { Card, Deck } from '../../../../shared/types.ts';
import { useStore } from '../../store/store.ts';
import { canonicalOf } from '../../store/selectors.ts';
import { fmtDate } from '../../lib/format.ts';
import { Badge } from '../ui/Badge.tsx';
import { navigate } from '../../lib/router.ts';

/** “Used in meta decks”: archetype rollup by legend + example decklists. Everything links into `#/meta?card=<id>`. */
export function UsageList({ card }: { card: Card }) {
  const decks = useStore((s) => s.decks);
  const canon = canonicalOf(card);

  const { using, byLegend, totalByLegend } = useMemo(() => {
    const using: Array<{ deck: Deck; qty: number }> = [];
    const totalByLegend = new Map<string, number>();
    for (const d of decks) {
      const legend = d.legend_name ?? 'Unknown legend';
      totalByLegend.set(legend, (totalByLegend.get(legend) ?? 0) + 1);
      let qty = 0;
      for (const c of d.cards) if (c.card_id === canon) qty += c.qty;
      if (qty > 0) using.push({ deck: d, qty });
    }
    const byLegend = new Map<string, { decks: number; copies: number }>();
    for (const u of using) {
      const legend = u.deck.legend_name ?? 'Unknown legend';
      const e = byLegend.get(legend) ?? { decks: 0, copies: 0 };
      e.decks++;
      e.copies += u.qty;
      byLegend.set(legend, e);
    }
    using.sort((a, b) => (a.deck.placement ?? 999) - (b.deck.placement ?? 999) || (b.deck.event_date ?? '').localeCompare(a.deck.event_date ?? ''));
    return { using, byLegend, totalByLegend };
  }, [decks, canon]);

  /** open the meta page narrowed to this card (optionally straight into one archetype / deck) */
  const openMeta = (legend?: string, deckId?: string) => {
    const q: Record<string, string> = {};
    if (legend) q.legend = legend;
    if (deckId) q.deck = deckId;
    navigate({ page: 'meta', cardId: card.id, query: q });
  };

  if (!decks.length) return <p className="text-sm text-faint">No meta decks loaded yet. Run the “meta” job from Settings.</p>;
  if (!using.length) return <p className="text-sm text-faint">Not played in any tracked meta deck.</p>;

  const legends = [...byLegend.entries()].sort((a, b) => b[1].decks - a[1].decks).slice(0, 6);
  const examples = using.slice(0, 3);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        In <strong className="text-fg">{using.length}</strong> of {decks.length} tracked decks
      </p>
      <ul className="flex flex-col gap-1">
        {legends.map(([legend, e]) => (
          <li key={legend}>
            <button
              type="button"
              onClick={() => openMeta(legend)}
              className="flex w-full items-center justify-between gap-3 rounded-md px-1.5 py-1 text-left text-sm hover:bg-surface-2"
              title={`Show ${legend} decks using ${card.name}`}
            >
              <span className="min-w-0 truncate font-medium">{legend}</span>
              <span className="tabular shrink-0 text-xs text-muted">
                {e.decks}/{totalByLegend.get(legend) ?? e.decks} decks · avg {(e.copies / e.decks).toFixed(1)}×
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-faint">Example lists</span>
        {examples.map(({ deck, qty }) => (
          <div key={deck.id} className="relative">
            <button
              type="button"
              onClick={() => openMeta(deck.legend_name ?? undefined, deck.id)}
              className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 py-1.5 pr-9 pl-2.5 text-left text-xs hover:border-border-strong"
              title="Open this list in Meta decks"
            >
              <span className="min-w-0 truncate">
                <span className="font-medium text-fg">{deck.name}</span>
                <span className="text-muted">
                  {' '}
                  · {deck.event_name ?? deck.source}
                  {deck.placement ? ` · #${deck.placement}` : ''}
                  {deck.event_date ? ` · ${fmtDate(deck.event_date)}` : ''}
                </span>
              </span>
              <Badge tone="neutral" size="xs">
                ×{qty}
              </Badge>
            </button>
            <a
              href={deck.source_url}
              target="_blank"
              rel="noreferrer noopener"
              aria-label="Open source list"
              title={deck.source_url}
              className="absolute top-1/2 right-1.5 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded text-faint hover:bg-surface-3 hover:text-fg"
            >
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => openMeta()} className="self-start text-xs font-medium text-accent underline-offset-2 hover:underline">
        See all decks using {card.name} →
      </button>
    </div>
  );
}
