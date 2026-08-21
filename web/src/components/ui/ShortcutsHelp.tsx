import { SHORTCUTS } from '../../lib/hotkeys.ts';
import { Dialog } from './Dialog.tsx';
import { Keys } from './Kbd.tsx';

export function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const half = Math.ceil(SHORTCUTS.length / 2);
  const cols = [SHORTCUTS.slice(0, half), SHORTCUTS.slice(half)];
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" description="Shortcuts are off while you type in a field." size="lg">
      <div className="grid gap-x-10 gap-y-1 sm:grid-cols-2">
        {cols.map((col, i) => (
          <ul key={i} className="divide-y divide-border">
            {col.map((s) => (
              <li key={s.label} className="flex items-center justify-between gap-4 py-2 text-sm">
                <span className="text-muted">{s.label}</span>
                <Keys keys={s.keys} />
              </li>
            ))}
          </ul>
        ))}
      </div>
    </Dialog>
  );
}
