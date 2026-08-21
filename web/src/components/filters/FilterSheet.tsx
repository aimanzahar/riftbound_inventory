import { create } from 'zustand';
import { useStore } from '../../store/store.ts';
import { useVisibleIds } from '../../store/selectors.ts';
import { activeFilterCount } from '../../store/filters.ts';
import { fmtInt } from '../../lib/format.ts';
import { Sheet } from '../ui/Sheet.tsx';
import { Button } from '../ui/Button.tsx';
import { FilterGroups } from './FilterBar.tsx';

/** Open state shared between the TopBar button (phone) and the sheet. */
export const useFilterSheet = create<{ open: boolean; setOpen: (v: boolean) => void }>()((set) => ({ open: false, setOpen: (open) => set({ open }) }));

/** Mobile filter sheet — same groups as the bar, stacked. */
export function FilterSheet() {
  const open = useFilterSheet((s) => s.open);
  const setOpen = useFilterSheet((s) => s.setOpen);
  const filters = useStore((s) => s.ui.filters);
  const resetFilters = useStore((s) => s.resetFilters);
  const visible = useVisibleIds();
  const n = activeFilterCount(filters);
  return (
    <Sheet open={open} onClose={() => setOpen(false)} title="Filters">
      <div className="flex flex-col gap-4 pb-20">
        <FilterGroups vertical />
      </div>
      <div className="pb-safe sticky bottom-0 -mx-4 flex items-center gap-2 border-t border-border bg-surface px-4 py-3 sm:-mx-5 sm:px-5">
        <Button variant="ghost" size="md" onClick={resetFilters} disabled={n === 0}>
          Clear all
        </Button>
        <Button variant="primary" size="md" className="flex-1" onClick={() => setOpen(false)}>
          Show {fmtInt(visible.length)} cards
        </Button>
      </div>
    </Sheet>
  );
}
