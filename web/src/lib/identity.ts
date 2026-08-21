import { PALETTE } from '../../../shared/constants.ts';
import { uuid } from './uuid.ts';

export interface Identity {
  id: string;
  name: string;
  color: string;
}

const KEY = 'rb.device';
let cached: Identity | null = null;

function isColor(c: unknown): c is string {
  return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
}

function persist(id: Identity): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(id));
  } catch {
    /* private mode / quota — identity lives in memory for this session */
  }
}

/** Load (or mint) this browser's identity. Stable per browser profile. */
export function loadIdentity(): Identity {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const j = JSON.parse(raw) as Partial<Identity>;
      if (j && typeof j.id === 'string' && j.id.length >= 8) {
        cached = { id: j.id, name: typeof j.name === 'string' ? j.name.slice(0, 32) : '', color: isColor(j.color) ? j.color : PALETTE[0] };
        return cached;
      }
    }
  } catch {
    /* fall through to a fresh identity */
  }
  cached = { id: uuid(), name: '', color: PALETTE[Math.floor(Math.random() * PALETTE.length)] };
  persist(cached);
  return cached;
}

export function saveIdentity(patch: Partial<Pick<Identity, 'name' | 'color'>>): Identity {
  const cur = loadIdentity();
  const next: Identity = {
    id: cur.id,
    name: patch.name !== undefined ? patch.name.trim().slice(0, 32) : cur.name,
    color: patch.color !== undefined && isColor(patch.color) ? patch.color : cur.color,
  };
  cached = next;
  persist(next);
  return next;
}

export function getDeviceId(): string {
  return loadIdentity().id;
}

export function isRegistered(): boolean {
  return loadIdentity().name.trim().length > 0;
}
