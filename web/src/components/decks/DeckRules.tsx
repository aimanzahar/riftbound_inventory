import { Check, TriangleAlert } from 'lucide-react';
import type { DeckValidation } from '../../../../shared/deckRules.ts';
import { cx } from '../../lib/format.ts';
import { SECTION_LABELS } from '../meta/metaModel.ts';

/**
 * Deck-construction guidance: section counters against their targets plus playset / banned warnings.
 * Advisory only — nothing here blocks a save.
 */
export function DeckRules({ validation, className }: { validation: DeckValidation; className?: string }) {
  const { sections, issues, legal } = validation;
  const warnings = issues.filter((i) => i.kind === 'over_playset' || i.kind === 'banned');
  return (
    <div className={cx('flex flex-col gap-2 rounded-xl border border-border bg-surface-2 p-3', className)}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold tracking-wider text-faint uppercase">Deck rules</h3>
        {legal ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#86efac]">
            <Check className="size-3.5" aria-hidden />
            Legal
          </span>
        ) : (
          <span className="text-[11px] font-medium text-faint">{issues.length} to fix</span>
        )}
      </div>

      <ul className="flex flex-col gap-1">
        {sections.map((s) => {
          if (s.target === null && s.count === 0) return null; // hide an empty sideboard
          const tone = s.target === null ? 'text-faint' : s.ok ? 'text-[#86efac]' : 'text-[#fcd34d]';
          return (
            <li key={s.section} className="tabular flex items-baseline justify-between gap-2 text-[12px]">
              <span className="truncate text-muted">
                {SECTION_LABELS[s.section]}
                {s.target === null && <span className="text-faint"> (optional)</span>}
              </span>
              <span className={cx('shrink-0 font-medium', tone)}>
                {s.count}
                {s.target !== null && `/${s.target}`}
                {s.target !== null && s.ok && ' ✓'}
              </span>
            </li>
          );
        })}
      </ul>

      {(warnings.length > 0 || issues.some((i) => i.kind !== 'over_playset' && i.kind !== 'banned')) && (
        <ul className="flex flex-col gap-1 border-t border-border pt-2">
          {issues
            .filter((i) => i.kind === 'section_over' || i.kind === 'section_under')
            .map((i) => (
              <li key={`${i.kind}-${i.section}`} className="flex items-start gap-1.5 text-[11.5px] leading-snug text-[#fcd34d]">
                <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden />
                <span>
                  <span className="font-medium">{SECTION_LABELS[i.section!]}</span> {i.text}
                </span>
              </li>
            ))}
          {warnings.map((i) => (
            <li key={`${i.kind}-${i.card_id}`} className="flex items-start gap-1.5 text-[11.5px] leading-snug text-[#fca5a5]">
              <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden />
              <span>{i.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
