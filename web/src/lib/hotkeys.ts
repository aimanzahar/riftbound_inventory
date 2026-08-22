import type { Page } from './router.ts';

export interface HotkeyHandlers {
  focusSearch(): void;
  escape(): void;
  goto(page: Page): void;
  pack(): void;
  help(): void;
  toggleView?(): void;
  toggleFoil?(): void;
}

/** True when typing into a field (hotkeys must stay out of the way). */
export function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file'].includes(type);
  }
  return tag === 'TEXTAREA' || tag === 'SELECT';
}

function modalOpen(): boolean {
  return Boolean(document.querySelector('dialog[open]'));
}

const CHORD_PAGES: Record<string, Page> = { c: 'collection', p: 'products', d: 'meta', m: 'meta', b: 'decks', a: 'activity', s: 'settings', k: 'pack' };

/** Global keyboard shortcuts. Returns an uninstall function. */
export function installHotkeys(h: HotkeyHandlers): () => void {
  let chordUntil = 0;
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    const key = e.key;
    const mod = e.ctrlKey || e.metaKey;

    // Ctrl/Cmd+K always focuses search (even inside inputs)
    if (mod && (key === 'k' || key === 'K')) {
      e.preventDefault();
      h.focusSearch();
      return;
    }
    if (key === 'Escape') {
      if (isEditable(e.target) && (e.target as HTMLElement).tagName === 'TEXTAREA') return;
      if (modalOpen()) return; // native <dialog> handles Esc itself
      h.escape();
      return;
    }
    if (isEditable(e.target) || mod || e.altKey) return;
    if (modalOpen()) return;

    const now = Date.now();
    if (now < chordUntil) {
      chordUntil = 0;
      const page = CHORD_PAGES[key.toLowerCase()];
      if (page) {
        e.preventDefault();
        h.goto(page);
      }
      return;
    }
    switch (key) {
      case '/':
        e.preventDefault();
        h.focusSearch();
        return;
      case '?':
        e.preventDefault();
        h.help();
        return;
      case 'g':
        chordUntil = now + 1000;
        return;
      case 'p':
        e.preventDefault();
        h.pack();
        return;
      case 'v':
        h.toggleView?.();
        return;
      case 'f':
        h.toggleFoil?.();
        return;
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}

export const SHORTCUTS: Array<{ keys: string[]; label: string }> = [
  { keys: ['/'], label: 'Focus search' },
  { keys: ['Ctrl', 'K'], label: 'Focus search (anywhere)' },
  { keys: ['Esc'], label: 'Close drawer / clear search' },
  { keys: ['↑', '↓', '←', '→'], label: 'Move between cards' },
  { keys: ['Enter'], label: 'Open card details' },
  { keys: ['+', '−'], label: 'Add / remove one copy' },
  { keys: ['Shift', '+'], label: 'Add / remove a foil copy' },
  { keys: ['v'], label: 'Toggle grid / list' },
  { keys: ['f'], label: 'Toggle foil editing' },
  { keys: ['p'], label: 'Pack mode' },
  { keys: ['g', 'c'], label: 'Go to Collection' },
  { keys: ['g', 'p'], label: 'Go to Products' },
  { keys: ['g', 'd'], label: 'Go to Meta decks' },
  { keys: ['g', 'b'], label: 'Go to My decks' },
  { keys: ['g', 'a'], label: 'Go to Activity' },
  { keys: ['g', 's'], label: 'Go to Settings' },
  { keys: ['?'], label: 'This help' },
];
