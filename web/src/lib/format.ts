const intFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return intFmt.format(n);
}

function moneyDigits(n: number, compact: boolean): string {
  if (compact && Math.abs(n) >= 1000) return money0.format(n);
  return money2.format(n);
}

/** 'US$2.62' / compact 'US$1,234' */
export function fmtUSD(n: number | null | undefined, opts: { compact?: boolean; symbol?: string } = {}): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${opts.symbol ?? 'US$'}${moneyDigits(n, opts.compact ?? false)}`;
}

/** 'RM 12.40' / compact 'RM 4,320' */
export function fmtMYR(n: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `RM ${moneyDigits(n, opts.compact ?? false)}`;
}

export function usdToMyr(usd: number | null | undefined, rate: number | null | undefined): number | null {
  if (usd === null || usd === undefined || !rate) return null;
  return usd * rate;
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${fmtInt(n)} ${n === 1 ? one : many}`;
}

const MIN = 60_000,
  HOUR = 3_600_000,
  DAY = 86_400_000;

/** 'just now', '4 min ago', '2 h ago', '3 d ago', then a short date. */
export function relTime(iso: string | number | Date | null | undefined, now: number = Date.now()): string {
  if (iso === null || iso === undefined) return '—';
  const t = typeof iso === 'number' ? iso : new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const diff = now - t;
  if (diff < 0) return diff > -MIN ? 'just now' : `in ${relSpan(-diff)}`;
  if (diff < 45_000) return 'just now';
  if (diff < HOUR) return `${Math.round(diff / MIN)} min ago`;
  if (diff < DAY) return `${Math.round(diff / HOUR)} h ago`;
  if (diff < 14 * DAY) return `${Math.round(diff / DAY)} d ago`;
  return fmtDate(t);
}

function relSpan(ms: number): string {
  if (ms < HOUR) return `${Math.round(ms / MIN)} min`;
  if (ms < DAY) return `${Math.round(ms / HOUR)} h`;
  return `${Math.round(ms / DAY)} d`;
}

/** Compact age for chips: 'now', '2h', '3d' */
export function ageShort(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const diff = Math.max(0, now - t);
  if (diff < MIN) return 'now';
  if (diff < HOUR) return `${Math.round(diff / MIN)}m`;
  if (diff < DAY) return `${Math.round(diff / HOUR)}h`;
  return `${Math.round(diff / DAY)}d`;
}

export function fmtDate(iso: string | number | Date | null | undefined): string {
  if (iso === null || iso === undefined) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

export function fmtDateTime(iso: string | number | Date | null | undefined): string {
  if (iso === null || iso === undefined) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function wordCount(s: string): number {
  const t = s.trim();
  return t ? t.split(/\s+/).length : 0;
}

export function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Hours since an ISO timestamp (Infinity when missing/invalid). */
export function hoursSince(iso: string | null | undefined, now: number = Date.now()): number {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return Infinity;
  return (now - t) / HOUR;
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
