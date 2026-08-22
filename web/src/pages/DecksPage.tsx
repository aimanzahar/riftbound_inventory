import { useState } from 'react';
import { Layers, Plus } from 'lucide-react';
import { useStore } from '../store/store.ts';
import { navigate, useRoute } from '../lib/router.ts';
import { Button } from '../components/ui/Button.tsx';
import { EmptyState } from '../components/ui/EmptyState.tsx';
import { Skeleton } from '../components/ui/Skeleton.tsx';
import { Segmented } from '../components/ui/Segmented.tsx';
import { DeckEditor } from '../components/decks/DeckEditor.tsx';
import { DeckGalleryCard } from '../components/decks/DeckGallery.tsx';
import { NewDeckDialog } from '../components/decks/DeckDialogs.tsx';
import { useUserDeck, useUserDecks } from '../components/decks/deckModel.ts';

/**
 * `#/decks` — decks you build yourself.
 *   level 1: gallery of deck tiles ("Active" / "All" including archived)
 *   level 2: `?deck=<id>` → the builder (catalog picker + editable list + rules)
 */
export function DecksPage() {
  const route = useRoute();
  const boot = useStore((s) => s.boot);
  const [showArchived, setShowArchived] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const decks = useUserDecks(showArchived);
  const total = useStore((s) => s.user_decks.length);
  const selectedId = route.query.get('deck');
  const selected = useUserDeck(selectedId);

  const open = (id: string | null) => navigate({ page: 'decks', cardId: route.cardId, query: id ? { deck: id } : null });

  if (boot !== 'ready') {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3 p-4" aria-busy="true" aria-label="Loading decks">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-40 rounded-card" />
        ))}
      </div>
    );
  }

  // a `?deck=` that no longer exists (deleted on the other device) falls back to the gallery
  if (selectedId && selected) return <DeckEditor key={selected.id} deck={selected} onBack={() => open(null)} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <h2 className="text-[15px] font-semibold tracking-tight">My decks</h2>
        <span className="tabular text-[11.5px] text-faint">
          {decks.length} {decks.length === 1 ? 'deck' : 'decks'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {total > decks.filter((d) => !d.archived).length || showArchived ? (
            <Segmented
              size="sm"
              ariaLabel="Which decks to show"
              value={showArchived ? 'all' : 'active'}
              onChange={(v) => setShowArchived(v === 'all')}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'all', label: 'All' },
              ]}
            />
          ) : null}
          <Button variant="primary" size="sm" onClick={() => setNewOpen(true)} leftIcon={<Plus className="size-4" />}>
            New deck
          </Button>
        </div>
      </header>

      {decks.length === 0 ? (
        <EmptyState
          icon={<Layers />}
          title={total === 0 ? 'No decks yet' : 'No active decks'}
          description={
            total === 0
              ? 'Build a deck from your collection. Cards you don’t own yet are welcome too — they show as missing, with what it would cost to finish. Every card in a deck gets tagged in your Collection.'
              : 'Every deck is archived. Switch to “All” to see them.'
          }
          action={
            <Button variant="primary" onClick={() => setNewOpen(true)} leftIcon={<Plus className="size-4" />}>
              New deck
            </Button>
          }
        />
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {decks.map((d) => (
            <DeckGalleryCard key={d.id} deck={d} onOpen={() => open(d.id)} />
          ))}
        </ul>
      )}

      <NewDeckDialog open={newOpen} onClose={() => setNewOpen(false)} onCreated={(d) => open(d.id)} />
    </div>
  );
}
