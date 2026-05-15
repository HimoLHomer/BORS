const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse a stored calendar day `YYYY-MM-DD` as UTC midnight (no local TZ shift). */
export function parseIsoDateOnly(iso: string): Date | null {
  const t = iso.trim();
  const m = t.match(ISO_DATE);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  return Number.isNaN(ms) ? null : new Date(ms);
}

/** Finnish-style numeric date (e.g. 14.5.2026) for display only; storage stays ISO. */
export function formatDateFi(isoDate: string | null | undefined): string {
  if (isoDate == null || !String(isoDate).trim()) return '—';
  const d = parseIsoDateOnly(String(isoDate));
  if (!d) return String(isoDate);
  return new Intl.DateTimeFormat('fi-FI', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).format(d);
}

/** Month+year label from stored `YYYY-MM` (e.g. `Jan 2026`). */
export function formatMonthYearFi(monthKey: string): string {
  const m = /^(\d{4})-(\d{1,2})$/.exec(monthKey.trim());
  if (!m) return monthKey;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12 || !Number.isFinite(y)) return monthKey;
  return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(
    new Date(y, mo - 1, 1)
  );
}

/** Short label for charts (Finnish month + day). */
export function formatShortMonthDayFi(isoDate: string): string {
  const d = parseIsoDateOnly(isoDate);
  if (!d) return isoDate;
  return new Intl.DateTimeFormat('fi-FI', { month: 'short', day: 'numeric' }).format(d);
}

/** 24h clock in Finnish locale. */
export function formatTimeFi(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('fi-FI', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/** Today’s calendar date in Europe/Helsinki as `YYYY-MM-DD` (for comparing to stored history rows). */
export function todayIsoDateHelsinki(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Helsinki',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  if (y && m && d) return `${y}-${m}-${d}`;
  return now.toISOString().slice(0, 10);
}
