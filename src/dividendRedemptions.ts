import type { DividendPayoutFrequency } from './manualDividends';
import { nextManualPayoutDateYmd, perPaymentAmountEur } from './manualDividends';
import { dividendNetEur } from './fireProjectionEngine';
import { todayIsoDateHelsinki } from './formatDate';

export const REDEEMED_DIVIDENDS_STORAGE_KEY = 'bors_redeemed_dividend_payments';

export const REDEEMED_DIVIDENDS_CHANGED_EVENT = 'bors-redeemed-dividends-changed';

export type DividendPaymentSource = 'api' | 'manual';

export type PayDateSource = 'yahoo' | 'estimated' | 'manual' | 'fallback';

export type ScheduledDividendPayment = {
  id: string;
  monthKey: string;
  name: string;
  ticker: string;
  amountEur: number;
  source: DividendPaymentSource;
  frequency: DividendPayoutFrequency;
  payDateYmd?: string;
  payDateSource?: PayDateSource;
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
  payDateSource?: PayDateSource;
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

const DEFAULT_FREQUENCY: DividendPayoutFrequency = 'quarterly';

export type ApiDividendPaymentInput = {
  symbol: string;
  name: string;
  ticker: string;
  estimatedAnnualIncomeEur: number;
  payoutFrequency?: DividendPayoutFrequency | null;
  nextPayDateYmd?: string | null;
  payDateSource?: 'yahoo' | 'estimated' | 'none';
};

export type ManualDividendPaymentInput = {
  id: string;
  name: string;
  ticker: string;
  annualIncomeEur: number;
  payoutFrequency: DividendPayoutFrequency;
  payoutAnchorDate?: string | null;
};

export function payDateLabel(source: PayDateSource | undefined): string {
  switch (source) {
    case 'yahoo':
      return 'Official';
    case 'manual':
      return 'Manual';
    case 'estimated':
    case 'fallback':
      return 'Estimated';
    default:
      return 'Estimated';
  }
}

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
        const payDateSource =
          o.payDateSource === 'yahoo' ||
          o.payDateSource === 'estimated' ||
          o.payDateSource === 'manual' ||
          o.payDateSource === 'fallback'
            ? o.payDateSource
            : undefined;
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
          ...(payDateSource ? { payDateSource } : {}),
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

/** First upcoming ISO date from a sorted or unsorted list. */
export function firstUpcomingPayDateYmd(
  dates: string[] | undefined,
  todayYmd: string = todayIsoDateHelsinki()
): string | null {
  if (!dates?.length) return null;
  const valid = dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  return valid.find((d) => d >= todayYmd) ?? null;
}

export function resolveApiNextPayDate(input: {
  calendarPayoutDates?: string[];
  dividendDate?: string | null;
  calendarPayoutSource?: 'yahoo' | 'estimated' | 'none';
  todayYmd?: string;
}): { nextPayDateYmd: string; payDateSource: 'yahoo' | 'estimated' } | null {
  const today = input.todayYmd ?? todayIsoDateHelsinki();
  const fromList = firstUpcomingPayDateYmd(input.calendarPayoutDates, today);
  const dividendDate =
    input.dividendDate && /^\d{4}-\d{2}-\d{2}$/.test(input.dividendDate) && input.dividendDate >= today
      ? input.dividendDate
      : null;
  const nextPayDateYmd = fromList ?? dividendDate;
  if (!nextPayDateYmd) return null;
  const payDateSource = input.calendarPayoutSource === 'yahoo' ? 'yahoo' : 'estimated';
  return { nextPayDateYmd, payDateSource };
}

function mapApiPayDateSource(
  source: ApiDividendPaymentInput['payDateSource']
): PayDateSource {
  if (source === 'yahoo') return 'yahoo';
  if (source === 'estimated') return 'estimated';
  return 'fallback';
}

function paymentAmountEur(annualIncomeEur: number, frequency: DividendPayoutFrequency, taxRatePercent: number): number {
  const gross = perPaymentAmountEur(annualIncomeEur, frequency);
  return dividendNetEur(gross, taxRatePercent);
}

function scheduleOnePayment(
  source: DividendPaymentSource,
  sourceId: string,
  name: string,
  ticker: string,
  annualIncomeEur: number,
  frequency: DividendPayoutFrequency,
  payDateYmd: string,
  payDateSource: PayDateSource,
  redeemedIds: Set<string>,
  dividendTaxRatePercent: number
): ScheduledDividendPayment | null {
  if (!Number.isFinite(annualIncomeEur) || annualIncomeEur <= 0) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payDateYmd)) return null;
  const amountEur = paymentAmountEur(annualIncomeEur, frequency, dividendTaxRatePercent);
  const monthKey = payDateYmd.slice(0, 7);
  const id = `${source}-${sourceId}-${payDateYmd}`;
  if (redeemedIds.has(id)) return null;
  return {
    id,
    monthKey,
    name,
    ticker,
    amountEur,
    source,
    frequency,
    payDateYmd,
    payDateSource,
  };
}

function projectFallbackNextSlot(
  source: DividendPaymentSource,
  sourceId: string,
  name: string,
  ticker: string,
  annualIncomeEur: number,
  frequency: DividendPayoutFrequency,
  startMonthKey: string,
  redeemedIds: Set<string>,
  dividendTaxRatePercent: number
): ScheduledDividendPayment | null {
  if (!Number.isFinite(annualIncomeEur) || annualIncomeEur <= 0) return null;
  const amountEur = paymentAmountEur(annualIncomeEur, frequency, dividendTaxRatePercent);
  const monthKey = startMonthKey;
  const id = `${source}-${sourceId}-${monthKey}-0`;
  if (redeemedIds.has(id)) return null;
  return {
    id,
    monthKey,
    name,
    ticker,
    amountEur,
    source,
    frequency,
    payDateSource: 'fallback',
  };
}

export function buildProjectedPayments(
  apiRows: ApiDividendPaymentInput[],
  manualRows: ManualDividendPaymentInput[],
  redeemed: RedeemedDividendPayment[],
  startMonthKey: string = helsinkiMonthKeyFromToday(),
  dividendTaxRatePercent = 0
): ScheduledDividendPayment[] {
  const redeemedIds = new Set(redeemed.map((r) => r.id));
  const out: ScheduledDividendPayment[] = [];

  for (const row of apiRows) {
    const frequency = parseFrequency(row.payoutFrequency);
    const payDateYmd = row.nextPayDateYmd ?? null;
    if (payDateYmd) {
      const payment = scheduleOnePayment(
        'api',
        row.symbol,
        row.name,
        row.ticker,
        row.estimatedAnnualIncomeEur,
        frequency,
        payDateYmd,
        mapApiPayDateSource(row.payDateSource),
        redeemedIds,
        dividendTaxRatePercent
      );
      if (payment) out.push(payment);
    } else {
      const payment = projectFallbackNextSlot(
        'api',
        row.symbol,
        row.name,
        row.ticker,
        row.estimatedAnnualIncomeEur,
        frequency,
        startMonthKey,
        redeemedIds,
        dividendTaxRatePercent
      );
      if (payment) out.push(payment);
    }
  }

  for (const m of manualRows) {
    const frequency = m.payoutFrequency;
    const payDateYmd = nextManualPayoutDateYmd(m.payoutAnchorDate, frequency);
    if (payDateYmd) {
      const payment = scheduleOnePayment(
        'manual',
        m.id,
        m.name,
        m.ticker,
        m.annualIncomeEur,
        frequency,
        payDateYmd,
        'manual',
        redeemedIds,
        dividendTaxRatePercent
      );
      if (payment) out.push(payment);
    } else {
      const payment = projectFallbackNextSlot(
        'manual',
        m.id,
        m.name,
        m.ticker,
        m.annualIncomeEur,
        frequency,
        startMonthKey,
        redeemedIds,
        dividendTaxRatePercent
      );
      if (payment) out.push(payment);
    }
  }

  return out;
}

function compareScheduledPayments(a: ScheduledDividendPayment, b: ScheduledDividendPayment): number {
  const da = a.payDateYmd ?? '';
  const db = b.payDateYmd ?? '';
  if (da && db && da !== db) return da.localeCompare(db);
  if (da && !db) return -1;
  if (!da && db) return 1;
  return a.name.localeCompare(b.name);
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
    const list = [...(map.get(monthKey) ?? [])].sort(compareScheduledPayments);
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
    ...(payment.payDateSource ? { payDateSource: payment.payDateSource } : {}),
  };
  return [...redeemed, entry];
}

export function unredeemPayment(
  redeemed: RedeemedDividendPayment[],
  id: string
): RedeemedDividendPayment[] {
  return redeemed.filter((r) => r.id !== id);
}
