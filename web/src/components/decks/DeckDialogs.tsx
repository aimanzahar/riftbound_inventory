import { useEffect, useMemo, useRef, useState } from 'react';
import type { Deck, UserDeck } from '../../../../shared/types.ts';
import { PALETTE } from '../../../../shared/constants.ts';
import { planMetaExport, sideCopiesOf } from '../../../../shared/metaExport.ts';
import { useStore } from '../../store/store.ts';
import { cx, fmtDate, fmtInt } from '../../lib/format.ts';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { deckLines, tierLabel } from '../meta/metaModel.ts';

const INPUT =
  'h-10 rounded-lg border border-border bg-surface-2 px-3 text-[15px] text-fg placeholder:text-faint focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/30';

function ColorPicker({ value, onChange }: { value: string | null; onChange: (c: string | null) => void }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-xs font-medium text-muted">Chip colour</legend>
      <div className="flex flex-wrap gap-1.5">
        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Colour ${c}`}
            aria-pressed={value === c}
            onClick={() => onChange(value === c ? null : c)}
            className={cx('size-7 rounded-full border-2 transition-transform', value === c ? 'border-fg scale-110' : 'border-transparent hover:scale-105')}
            style={{ background: c }}
          />
        ))}
      </div>
      <p className="text-[11px] text-faint">Shown on collection cards that this deck uses.</p>
    </fieldset>
  );
}

/** Create a deck. Resolves through the store, which ingests the change so SSE and local agree. */
export function NewDeckDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (deck: UserDeck) => void }) {
  const createDeck = useStore((s) => s.createDeck);
  const [name, setName] = useState('');
  const [color, setColor] = useState<string | null>(PALETTE[0]);
  const [busy, setBusy] = useState(false);
  const valid = name.trim().length > 0;

  useEffect(() => {
    if (open) {
      setName('');
      setColor(PALETTE[Math.floor(Math.random() * PALETTE.length)]);
      setBusy(false);
    }
  }, [open]);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    const deck = await createDeck(name.trim(), { color });
    setBusy(false);
    if (deck) {
      onClose();
      onCreated?.(deck);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="New deck" description="Build it from anything in the catalog — cards you don’t own yet show as missing." size="sm">
      <form onSubmit={submit} className="flex flex-col gap-5">
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Deck name</span>
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Jinx Aggro" className={INPUT} />
        </label>
        <ColorPicker value={color} onChange={setColor} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!valid} loading={busy}>
            Create deck
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Rename / recolour / archive, plus a guarded delete. */
export function DeckSettingsDialog({ deck, open, onClose, onDeleted }: { deck: UserDeck; open: boolean; onClose: () => void; onDeleted?: () => void }) {
  const updateDeck = useStore((s) => s.updateDeck);
  const deleteDeck = useStore((s) => s.deleteDeck);
  const [name, setName] = useState(deck.name);
  const [notes, setNotes] = useState(deck.notes);
  const [color, setColor] = useState<string | null>(deck.color);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const valid = name.trim().length > 0;

  useEffect(() => {
    if (open) {
      setName(deck.name);
      setNotes(deck.notes);
      setColor(deck.color);
      setConfirmDelete(false);
      setBusy(false);
    }
  }, [open, deck]);

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    const ok = await updateDeck(deck.id, { name: name.trim(), notes, color });
    setBusy(false);
    if (ok) onClose();
  };

  const toggleArchive = async () => {
    setBusy(true);
    await updateDeck(deck.id, { archived: !deck.archived });
    setBusy(false);
    onClose();
  };

  const remove = async () => {
    setBusy(true);
    const ok = await deleteDeck(deck.id);
    setBusy(false);
    if (ok) {
      onClose();
      onDeleted?.();
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Deck settings" size="sm">
      <form onSubmit={save} className="flex flex-col gap-5">
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Deck name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={INPUT} />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="Sideboard plan, cards to buy, who it beats…"
            className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-[14px] text-fg placeholder:text-faint focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </label>
        <ColorPicker value={color} onChange={setColor} />

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
          <Button type="button" variant="outline" size="sm" onClick={toggleArchive} disabled={busy}>
            {deck.archived ? 'Unarchive' : 'Archive'}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!valid} loading={busy}>
              Save
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2 rounded-xl border border-danger/30 bg-danger/5 p-3">
          {confirmDelete ? (
            <>
              <p className="text-[12.5px] leading-snug text-[#fca5a5]">
                Delete “{deck.name}” and its {deck.cards.length} line{deck.cards.length === 1 ? '' : 's'}? This can’t be undone — archive it instead if you might want it back.
              </p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                  Keep it
                </Button>
                <Button type="button" variant="danger" size="sm" onClick={remove} loading={busy}>
                  Delete for good
                </Button>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12.5px] text-muted">Done with this deck?</span>
              <Button type="button" variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            </div>
          )}
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Copy a scraped meta decklist into a new deck of your own.
 * Champions fold into the main deck and unresolved lines are dropped — see shared/metaExport.ts.
 */
export function ExportDeckDialog({ deck, open, onClose, onCreated }: { deck: Deck; open: boolean; onClose: () => void; onCreated?: (deck: UserDeck) => void }) {
  const createDeck = useStore((s) => s.createDeck);
  const deckCards = useStore((s) => s.deckCards);
  const cardsById = useStore((s) => s.cardsById);
  const [name, setName] = useState('');
  const [color, setColor] = useState<string | null>(PALETTE[0]);
  const [includeSide, setIncludeSide] = useState(true);
  const [busy, setBusy] = useState(false);
  // a deck created by a submit whose card write then failed — reused so a retry fills it in
  // instead of creating a second empty deck. Cleared on open; the dialog itself stays mounted.
  const created = useRef<UserDeck | null>(null);

  const lines = useMemo(() => deckLines(deck), [deck]);
  const sideCopies = useMemo(() => sideCopiesOf(lines), [lines]);
  const plan = useMemo(
    () => planMetaExport({ lines, unresolved: deck.unresolved, knownCardIds: cardsById, includeSide }),
    [lines, deck, cardsById, includeSide],
  );
  const notes = useMemo(() => {
    const where = [deck.player, deck.event_name, fmtDate(deck.event_date), deck.region, deck.event_tier ? tierLabel(deck.event_tier) : null].filter(Boolean).join(' · ');
    return ['Exported from meta decks.', where, deck.source_url].filter(Boolean).join('\n').slice(0, 2000);
  }, [deck]);

  useEffect(() => {
    if (open) {
      setName(deck.name.slice(0, 60));
      setColor(PALETTE[Math.floor(Math.random() * PALETTE.length)]);
      setIncludeSide(true);
      setBusy(false);
      created.current = null;
    }
  }, [open, deck]);

  const skippedCopies = plan.skipped.reduce((n, s) => n + s.qty, 0);
  const valid = name.trim().length > 0 && plan.items.length > 0;

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    const deckName = name.trim();
    const target = created.current ?? (await createDeck(deckName, { color, notes }));
    created.current = target;
    if (target && !(await deckCards(target.id, 'set', plan.items, deckName))) {
      setBusy(false); // the store toasted — leave the dialog open so the retry fills this same deck
      return;
    }
    setBusy(false);
    if (target) {
      onClose();
      onCreated?.(target);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Export to My decks" description="Copies the whole list, so cards you don’t own yet show as missing in the builder." size="sm">
      <form onSubmit={submit} className="flex flex-col gap-5">
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Deck name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={INPUT} />
        </label>
        <ColorPicker value={color} onChange={setColor} />

        {sideCopies > 0 && (
          <label className="flex items-center gap-2.5 text-[13px] text-fg">
            <input type="checkbox" checked={includeSide} onChange={(e) => setIncludeSide(e.target.checked)} className="size-4 accent-[#7c9cff]" />
            Include sideboard <span className="tabular text-faint">({fmtInt(sideCopies)} cards)</span>
          </label>
        )}

        <p className="tabular text-[12px] leading-snug text-muted">
          {plan.items.length === 0 ? (
            <span className="text-[#fca5a5]">Nothing in this list could be matched to the catalog — there’s nothing to export.</span>
          ) : (
            <>
              <strong className="font-semibold text-fg">{fmtInt(plan.copies)} cards</strong>
              {plan.sideCopies > 0 ? <span className="text-faint"> · {fmtInt(plan.sideCopies)} sideboard</span> : ''}
              {skippedCopies > 0 && (
                <span className="text-faint" title={plan.skipped.map((s) => `${s.qty}× ${s.label}`).join('\n')}>
                  {' · '}
                  {fmtInt(skippedCopies)} not in the catalog, skipped
                </span>
              )}
            </>
          )}
        </p>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!valid} loading={busy}>
            Export deck
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
