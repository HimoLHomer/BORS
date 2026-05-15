import type { DividendPayoutFrequency } from './manualDividends';
import { perPaymentAmountEur } from './manualDividends';
import { todayIsoDateHelsinki } from './formatDate';

export const REDEEMED_DIVIDENDS_STORAGE_KEY = 'bors_redeemed_dividend_payments';

export const REDEEMED_DIVIDENDS_CHANGED_EVENT = 'bors-redeemed-dividends-changed';

export type DividendPaymentSource = 'api' | 'manual';

export type ScheduledDividendPayment = {
  id: string;
  monthKey: string;
  name: string;
  ticker: string;
  amountEur: number;
  source: DividendPaymentSource;
  frequency: DividendPayoutFrequency;
};

export type RedeemedDividendPayment = {
  id: string;
  redeemedAt: string;
  monthKey: string;
  name: string;
  ticker: string;
  amountEur: number;
  source: DividendPaymentSource;
  frequency: DividendPayoutFrequency;
};

export type MonthPaymentGroup = {
  monthKey: string;
  payments: ScheduledDividendPayment[];
  totalEur: number;
};

export type MonthRedeemedGroup = {
  monthKey: string;
  payments: RedeemedDividendPayment[];
  totalEur: number;
};

const HORIZON_MONTHS = 12;
const DEFAULT_FREQUENCY: DividendPayoutFrequency = 'quarterly';

export type ApiDividendPaymentInput = {
  symbol: string;
  name: string;
  ticker: string;
  estimatedAnnualIncomeEur: number;
  payoutFrequency?: DividendPayoutFrequency | null;
};

export type ManualDividendPaymentInput = {
  id: string;
  name: string;
  ticker: string;
  annualIncomeEur: number;
  payoutFrequency: DividendPayoutFrequency;
};

export function notifyRedeemedDividendsChanged(): void {
  window.dispatchEvent(new Event(REDEEMED_DIVIDENDS_CHANGED_EVENT));
}

export function loadRedeemed(): RedeemedDividendPayment[] {
  try {
    const raw = localStorage.getItem(REDEEMED_DIVIDENDS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => {
        if (!x || typeof x !== 'object') return null;
        const o = x as Record<string, unknown>;
        const id = typeof o.id === 'string' ? o.id : '';
        const redeemedAt = typeof o.redeemedAt === 'string' ? o.redeemedAt : '';
        const monthKey = typeof o.monthKey === 'string' ? o.monthKey : '';
        const name = typeof o.name === 'string' ? o.name : '';
        const ticker = typeof o.ticker === 'string' ? o.ticker : '';
        const amountEur = typeof o.amountEur === 'number' ? o.amountEur : parseFloat(String(o.amountEur ?? ''));
        const source = o.source === 'api' || o.source === 'manual' ? o.source : null;
        const frequency =
          o.frequency === 'monthly' || o.frequency === 'quarterly' || o.frequency === 'annual'
            ? o.frequency
            : null;
        if (!id || !redeemedAt || !monthKey || !name || !source || !frequency) return null;
        if (!Number.isFinite(amountEur) || amountEur < 0) return null;
        return {
          id,
          redeemedAt,
          monthKey,
          name,
          ticker,
          amountEur,
          source,
          frequency,
        } satisfies RedeemedDividendPayment;
      })
      .filter((x): x is RedeemedDividendPayment => x != null);
  } catch {
    return [];
  }
}

export function saveRedeemed(rows: RedeemedDividendPayment[]): void {
  localStorage.setItem(REDEEMED_DIVIDENDS_STORAGE_KEY, JSON.stringify(rows));
  notifyRedeemedDividendsChanged();
}

export function parseFrequency(
  f: DividendPayoutFrequency | null | undefined
): DividendPayoutFrequency {
  if (f === 'monthly' || f === 'quarterly' || f === 'annual') return f;
  return DEFAULT_FREQUENCY;
}

export function helsinkiMonthKeyFromToday(): string {
  return todayIsoDateHelsinki().slice(0, 7);
}

export function addMonthsToMonthKey(monthKey: string, months: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey.trim());
  if (!m) return monthKey;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (!y || mo < 1 || mo > 12) return monthKey;
  const d = new Date(Date.UTC(y, mo - 1 + months, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthOffsetForSlot(freq: DividendPayoutFrequency, slot: number): number {
  if (freq === 'monthly') return slot;
  if (freq === 'quarterly') return slot * 3;
  return slot * 12;
}

function maxSlotsForFrequency(freq: DividendPayoutFrequency): number {
  if (freq === 'monthly') return HORIZON_MONTHS;
  if (freq === 'quarterly') return Math.ceil(HORIZON_MONTHS / 3);
  return 1;
}

function projectForHolding(
  source: DividendPaymentSource,
  sourceId: string,
  name: string,
  ticker: string,
  annualIncomeEur: number,
  frequency: DividendPayoutFrequency,
  startMonthKey: string,
  redeemedIds: Set<string>
): ScheduledDividendPayment[] {
  if (!Number.isFinite(annualIncomeEur) || annualIncomeEur <= 0) return [];
  const amountEur = Math.round(perPaymentAmountEur(annualIncomeEur, frequency) * 100) / 100;
  const out: ScheduledDividendPayment[] = [];
  const slots = maxSlotsForFrequency(frequency);
  for (let slot = 0; slot < slots; slot++) {
    const offset = monthOffsetForSlot(frequency, slot);
    if (offset >= HORIZON_MONTHS) break;
    const monthKey = addMonthsToMonthKey(startMonthKey, offset);
    const id = `${source}-${sourceId}-${monthKey}-${slot}`;
    if (redeemedIds.has(id)) continue;
    out.push({
      id,
      monthKey,
      name,
      ticker,
      amountEur,
      source,
      frequency,
    });
  }
  return out;
}

export function buildProjectedPayments(
  apiRows: ApiDividendPaymentInput[],
  manualRows: ManualDividendPaymentInput[],
  redeemed: RedeemedDividendPayment[],
  startMonthKey: string = helsinkiMonthKeyFromToday()
): ScheduledDividendPayment[] {
  const redeemedIds = new Set(redeemed.map((r) => r.id));
  const out: ScheduledDividendPayment[] = [];
  for (const row of apiRows) {
    out.push(
      ...projectForHolding(
        'api',
        row.symbol,
        row.name,
        row.ticker,
        row.estimatedAnnualIncomeEur,
        parseFrequency(row.payoutFrequency),
        startMonthKey,
        redeemedIds
      )
    );
  }
  for (const m of manualRows) {
    out.push(
      ...projectForHolding(
        'manual',
        m.id,
        m.name,
        m.ticker,
        m.annualIncomeEur,
        m.payoutFrequency,
        startMonthKey,
        redeemedIds
      )
    );
  }
  return out;
}

export function groupScheduledByMonth(
  payments: ScheduledDividendPayment[],
  descending = false
): MonthPaymentGroup[] {
  const map = new Map<string, ScheduledDividendPayment[]>();
  for (const p of payments) {
    const list = map.get(p.monthKey) ?? [];
    list.push(p);
    map.set(p.monthKey, list);
  }
  const keys = [...map.keys()].sort((a, b) => (descending ? b.localeCompare(a) : a.localeCompare(b)));
  return keys.map((monthKey) => {
    const list = [...(map.get(monthKey) ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    const totalEur = list.reduce((s, p) => s + p.amountEur, 0);
    return { monthKey, payments: list, totalEur };
  });
}

export function groupRedeemedByMonth(
  redeemed: RedeemedDividendPayment[],
  descending = true
): MonthRedeemedGroup[] {
  const map = new Map<string, RedeemedDividendPayment[]>();
  for (const p of redeemed) {
    const list = map.get(p.monthKey) ?? [];
    list.push(p);
    map.set(p.monthKey, list);
  }
  const keys = [...map.keys()].sort((a, b) => (descending ? b.localeCompare(a) : a.localeCompare(b)));
  return keys.map((monthKey) => {
    const list = [...(map.get(monthKey) ?? [])].sort(
      (a, b) => b.redeemedAt.localeCompare(a.redeemedAt) || a.name.localeCompare(b.name)
    );
    const totalEur = list.reduce((s, p) => s + p.amountEur, 0);
    return { monthKey, payments: list, totalEur };
  });
}

export function redeemPayment(
  redeemed: RedeemedDividendPayment[],
  payment: ScheduledDividendPayment
): RedeemedDividendPayment[] {
  if (redeemed.some((r) => r.id === payment.id)) return redeemed;
  const entry: RedeemedDividendPayment = {
    id: payment.id,
    redeemedAt: new Date().toISOString(),
    monthKey: payment.monthKey,
    name: payment.name,
    ticker: payment.ticker,
    amountEur: payment.amountEur,
    source: payment.source,
    frequency: payment.frequency,
  };
  return [...redeemed, entry];
}

export function unredeemPayment(
  redeemed: RedeemedDividendPayment[],
  id: string
): RedeemedDividendPayment[] {
  return redeemed.filter((r) => r.id !== id);
}
