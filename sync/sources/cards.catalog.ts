import type { JobCtx } from '../types.ts';
import type { CardSourceResult } from './types.ts';
import { fetchRiotCatalog } from './cards.riot.ts';
import { fetchDotggCatalog } from './cards.dotgg.ts';

/** Both feeds are independently useful; a missing source never removes catalog rows. */
export async function fetchCombinedCatalog(ctx: Pick<JobCtx, 'log' | 'signal' | 'progress'>): Promise<CardSourceResult> {
  const results = await Promise.allSettled([fetchRiotCatalog(ctx), fetchDotggCatalog(ctx)]);
  const [riot, dotgg] = results.map((r) => r.status === 'fulfilled' && r.value.cards.length ? r.value : null);
  const warnings: string[] = [];
  let failed = 0;
  results.forEach((r, i) => {
    if (r.status === 'rejected' || !r.value.cards.length) {
      failed++;
      warnings.push(`${i === 0 ? 'riot' : 'dotgg'} unavailable: ${r.status === 'rejected' ? String(r.reason) : 'empty catalog'}`);
    } else {
      failed += r.value.diagnostics?.failed ?? 0;
      warnings.push(...(r.value.diagnostics?.warnings ?? []));
    }
  });
  if (!riot && !dotgg) throw new Error(warnings.join(' · '));
  if (ctx.signal.aborted) throw ctx.signal.reason;
  const cards = new Map(dotgg?.cards.map((c) => [c.id, c]) ?? []);
  for (const card of riot?.cards ?? []) {
    const extra = cards.get(card.id);
    cards.set(card.id, { ...card,
      canonical_name: extra?.canonical_name ?? card.name,
      printing_kind: extra?.printing_kind,
      flavor: card.flavor ?? extra?.flavor ?? null,
      image_url: card.image_url ?? extra?.image_url ?? null,
    });
  }
  const sets = new Map(dotgg?.sets.map((s) => [s.code, s]) ?? []);
  for (const set of riot?.sets ?? []) sets.set(set.code, set);
  for (const warning of warnings) ctx.log.warn(warning);
  return { source: [riot?.source, dotgg?.source].filter(Boolean).join('+'), cards: [...cards.values()],
    sets: [...sets.values()], join: dotgg?.join, diagnostics: { failed, warnings } };
}
