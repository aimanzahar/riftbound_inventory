import type { Finish, JobEvent } from '../../../shared/types.ts';

export type OwnFilter = 'all' | 'owned' | 'missing' | 'extras';

export interface Filters {
  sets: string[];
  domains: string[];
  types: string[];
  rarities: string[];
  own: OwnFilter;
  /** only cards owned in foil */
  foil: boolean;
  /** only cards used by current meta decks */
  meta: boolean;
}

export const EMPTY_FILTERS: Filters = { sets: [], domains: [], types: [], rarities: [], own: 'all', foil: false, meta: false };

export type SortKey = 'number' | 'name' | 'price' | 'qty' | 'recent';
export const SORT_KEYS: readonly SortKey[] = ['number', 'name', 'price', 'qty', 'recent'];
export const SORT_LABELS: Record<SortKey, string> = {
  number: 'Set & number',
  name: 'Name',
  price: 'Price (high → low)',
  qty: 'Quantity (high → low)',
  recent: 'Recently changed',
};

export type ViewMode = 'grid' | 'list';

export type Connection = 'connecting' | 'live' | 'reconnecting' | 'offline';

export type BootStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface UiState {
  filters: Filters;
  sort: SortKey;
  view: ViewMode;
  search: string;
  /** card id shown in the drawer (mirrors the route) */
  drawerCardId: string | null;
  /** pack mode: current set code */
  packSet: string | null;
  /** when true, steppers edit the foil finish */
  foilSticky: boolean;
  /** shortcuts help dialog */
  helpOpen: boolean;
}

export type ToastKind = 'info' | 'success' | 'error' | 'remote';

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
  /** created at (ms) — also used for coalescing */
  at: number;
  /** auto-dismiss after ms; 0 = sticky */
  ttl: number;
  /** coalescing key (e.g. `inv:<deviceId>`) */
  key?: string;
  /** accumulated remote inventory change */
  agg?: { delta: number; ids: string[]; count: number; who: string };
  /** click target */
  cardId?: string;
  productId?: string;
  /** actor colour (remote changes) */
  color?: string;
  actions?: ToastAction[];
}

export interface Pulse {
  color: string;
  at: number;
  /** bump to restart the animation */
  n: number;
}

export type JobLive = Record<string, JobEvent & { at: number }>;

export function invKey(cardId: string, finish: Finish): string {
  return `${cardId}:${finish}`;
}
