export type DividendPayoutFrequency = 'monthly' | 'quarterly' | 'annual';

export type ManualDividendPosition = {
  id: string;
  name: string;
  annualIncomeEur: number;
  notionalValueEur: number | null;
  /** Shares / fund units — used to show annual dividend per share (EUR). */
  units: number | null;
  payoutFrequency: DividendPayoutFrequency;
  /** Anchor pay date (YYYY-MM-DD); used to project recurring payouts on the calendar. */
  payoutAnchorDate: string | null;
};

export const MANUAL_DIVIDENDS_STORAGE_KEY = 'bors_manual_dividend_positions';

export const MANUAL_DIVIDENDS_CHANGED_EVENT = 'bors-manual-dividends-changed';

export function notifyManualDividendsChanged(): void {
  window.dispatchEvent(new Event(MANUAL_DIVIDENDS_CHANGED_EVENT));
}

const DEFAULT_FREQUENCY: DividendPayoutFrequency = 'quarterly';

function parseFrequency(raw: unknown): DividendPayoutFrequency {
  if (raw === 'monthly' || raw === 'quarterly' || raw === 'annual') return raw;
  return DEFAULT_FREQUENCY;
}

export function loadManualDividendPositions(): ManualDividendPosition[] {
  try {
    const raw = localStorage.getItem(MANUAL_DIVIDENDS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => {
        if (!x || typeof x !== 'object') return null;
        const o = x as Record<string, unknown>;
        const id = typeof o.id === 'string' ? o.id : crypto.randomUUID();
        const name = typeof o.name === 'string' ? o.name.trim() : '';
        const annual =
          typeof o.annualIncomeEur === 'number' ? o.annualIncomeEur : parseFloat(String(o.annualIncomeEur ?? ''));
        const nv = o.notionalValueEur;
        const notional =
          nv == null || nv === ''
            ? null
            : typeof nv === 'number' && Number.isFinite(nv)
              ? nv
              : parseFloat(String(nv));
        const u = o.units ?? o.shareQuantity ?? o.shares;
        const units =
          u == null || u === ''
            ? null
            : typeof u === 'number' && Number.isFinite(u) && u > 0
              ? u
              : parseFloat(String(u));
        const unitsNorm =
          units != null && Number.isFinite(units) && units > 0 ? units : null;
        const payoutFrequency = parseFrequency(o.payoutFrequency);
        const pad = o.payoutAnchorDate ?? o.nextPayoutDate;
        const payoutAnchorDate =
          typeof pad === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(pad.trim()) ? pad.trim() : null;
        if (!name || !Number.isFinite(annual) || annual < 0) return null;
        return {
          id,
          name,
          annualIncomeEur: annual,
          notionalValueEur:
            notional != null && Number.isFinite(notional) && notional > 0 ? notional : null,
          units: unitsNorm,
          payoutFrequency,
          payoutAnchorDate,
        } satisfies ManualDividendPosition;
      })
      .filter((x): x is ManualDividendPosition => x != null);
  } catch {
    return [];
  }
}

export function saveManualDividendPositions(rows: ManualDividendPosition[]): void {
  localStorage.setItem(MANUAL_DIVIDENDS_STORAGE_KEY, JSON.stringify(rows));
  notifyManualDividendsChanged();
}

export function sumManualAnnualIncomeEur(rows: ManualDividendPosition[]): number {
  return rows.reduce((s, m) => s + (Number.isFinite(m.annualIncomeEur) ? m.annualIncomeEur : 0), 0);
}

export function frequencyLabel(f: DividendPayoutFrequency): string {
  switch (f) {
    case 'monthly':
      return 'Monthly';
    case 'quarterly':
      return 'Quarterly';
    case 'annual':
      return 'Annual';
    default:
      return f;
  }
}

export function perPaymentAmountEur(annualIncomeEur: number, f: DividendPayoutFrequency): number {
  if (f === 'monthly') return annualIncomeEur / 12;
  if (f === 'quarterly') return annualIncomeEur / 4;
  return annualIncomeEur;
}

export function averageMonthlyIncomeEur(annualIncomeEur: number): number {
  return annualIncomeEur / 12;
}

function parseYMD(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, mo, d] = s.split('-').map(Number);
  if (!y || !mo || !d) return null;
  const t = Date.UTC(y, mo - 1, d);
  return Number.isNaN(t) ? null : new Date(t);
}

function formatYMD(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addMonths(d: Date, n: number): Date {
  const x = new Date(d.getTime());
  x.setUTCMonth(x.getUTCMonth() + n);
  return x;
}

function advanceToUpcomingOrToday(anchor: Date, freq: DividendPayoutFrequency): Date {
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let cur = new Date(anchor.getTime());
  const step = freq === 'monthly' ? 1 : freq === 'quarterly' ? 3 : 12;
  let guard = 0;
  while (cur.getTime() < todayUtc && guard < 600) {
    cur = addMonths(cur, step);
    guard++;
  }
  return cur;
}

export type PayoutCalendarEvent = { name: string; kind: string; date: string };

/** Synthetic pay events for manual rows (same shape as feed-backed calendar entries). */
export function manualPositionPayoutEvents(m: ManualDividendPosition): PayoutCalendarEvent[] {
  if (!m.payoutAnchorDate) return [];
  const anchor = parseYMD(m.payoutAnchorDate);
  if (!anchor) return [];
  const step = m.payoutFrequency === 'monthly' ? 1 : m.payoutFrequency === 'quarterly' ? 3 : 12;
  const count = m.payoutFrequency === 'monthly' ? 18 : m.payoutFrequency === 'quarterly' ? 12 : 6;
  const out: PayoutCalendarEvent[] = [];
  let cur = advanceToUpcomingOrToday(anchor, m.payoutFrequency);
  for (let i = 0; i < count; i++) {
    out.push({ name: m.name, kind: 'Dividend pay', date: formatYMD(cur) });
    cur = addMonths(cur, step);
  }
  return out;
}
