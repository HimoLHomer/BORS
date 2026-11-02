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
  /** Full server schedule; preferred for calendar projection. */
  calendarPayoutDates?: string[];
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

export type BuildProjectedPaymentsOptions = {
  /** Fixed "today" for tests (Helsinki YYYY-MM-DD). */
  todayYmd?: string;
  /**
   * Per-holding start dates (keyed by apiHoldingKey/manualHoldingKey). Unredeemed payouts on or
   * after the start stay on the calendar until redeemed; holdings without one start today.
   */
  trackingStarts?: DividendTrackingStarts;
};

export function endOfCurrentYearYmd(todayYmd: string = todayIsoDateHelsinki()): string {
  return `${todayYmd.slice(0, 4)}-12-31`;
}

export function filterPayDatesInRange(
  dates: string[] | undefined,
  fromYmd: string,
  toYmd: string
): string[] {
  if (!dates?.length) return [];
  const valid = dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= fromYmd && d <= toYmd);
  return [...new Set(valid)].sort();
}

export function payDateSourceRank(source: PayDateSource | undefined): number {
  switch (source) {
    case 'yahoo':
      return 4;
    case 'manual':
      return 3;
    case 'estimated':
      return 2;
    case 'fallback':
      return 1;
    default:
      return 0;
  }
}

function parseYmdUtc(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, mo, d] = s.split('-').map(Number);
  if (!y || !mo || !d) return null;
  const t = Date.UTC(y, mo - 1, d);
  return Number.isNaN(t) ? null : new Date(t);
}

function formatYmdUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function frequencyStepMonths(freq: DividendPayoutFrequency): number {
  if (freq === 'monthly') return 1;
  if (freq === 'quarterly') return 3;
  return 12;
}

function addMonthsUtc(d: Date, n: number): Date {
  const x = new Date(d.getTime());
  x.setUTCMonth(x.getUTCMonth() + n);
  return x;
}

function subtractMonthsFromYmd(ymd: string, frequency: DividendPayoutFrequency): string | null {
  const d = parseYmdUtc(ymd);
  if (!d) return null;
  return formatYmdUtc(addMonthsUtc(d, -frequencyStepMonths(frequency)));
}

/**
 * Pay dates before today but on/after the holding's tracking start, walking back from the
 * first upcoming date. Payouts from before the holding was added never appear.
 */
export function pastPayDatesSinceTrackingStart(
  firstUpcomingYmd: string | null | undefined,
  frequency: DividendPayoutFrequency,
  trackingStartYmd: string,
  todayYmd: string
): string[] {
  if (!firstUpcomingYmd || !/^\d{4}-\d{2}-\d{2}$/.test(firstUpcomingYmd)) return [];
  const out: string[] = [];
  let cur = firstUpcomingYmd;
  let guard = 0;
  while (guard < 600) {
    const prev = subtractMonthsFromYmd(cur, frequency);
    if (!prev || prev < trackingStartYmd) break;
    if (prev < todayYmd) out.push(prev);
    cur = prev;
    guard += 1;
  }
  return out.sort();
}

function mergeUpcomingWithPastSinceTrackingStart(
  upcomingDates: string[],
  frequency: DividendPayoutFrequency,
  trackingStartYmd: string,
  todayYmd: string
): string[] {
  const firstUpcoming = [...upcomingDates].sort()[0];
  const past = pastPayDatesSinceTrackingStart(firstUpcoming, frequency, trackingStartYmd, todayYmd);
  return [...new Set([...past, ...upcomingDates])].sort();
}

/* ------------------------------------------------------------------ */
/* Tracking start: the day the calendar first saw each holding.        */
/* ------------------------------------------------------------------ */

export const DIVIDEND_TRACKING_START_STORAGE_KEY = 'bors_dividend_tracking_start';

/** One-time leniency for holdings that existed when tracking was introduced. */
export const TRACKING_MIGRATION_LOOKBACK_DAYS = 31;

export const DIVIDEND_TRACKING_CHANGED_EVENT = 'bors-dividend-tracking-changed';

/** Start date per holding key, as consumed by buildProjectedPayments. */
export type DividendTrackingStarts = Record<string, string>;

export type DividendTrackingState = {
  /** Day tracking was first introduced; holdings first seen that day get the lookback. */
  migratedOn: string;
  holdings: DividendTrackingStarts;
};

export function apiHoldingKey(symbol: string): string {
  return `api-${symbol}`;
}

export function manualHoldingKey(id: string): string {
  return `manual-${id}`;
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Returns null when nothing valid has been stored yet (first run). */
export function loadTrackingState(): DividendTrackingState | null {
  try {
    const raw = localStorage.getItem(DIVIDEND_TRACKING_START_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const o = parsed as Record<string, unknown>;
    if (typeof o.migratedOn !== 'string' || !YMD_RE.test(o.migratedOn)) return null;
    if (!o.holdings || typeof o.holdings !== 'object' || Array.isArray(o.holdings)) return null;
    const holdings: DividendTrackingStarts = {};
    for (const [k, v] of Object.entries(o.holdings as Record<string, unknown>)) {
      if (typeof v === 'string' && YMD_RE.test(v)) holdings[k] = v;
    }
    return { migratedOn: o.migratedOn, holdings };
  } catch {
    return null;
  }
}

export function saveTrackingState(state: DividendTrackingState): void {
  try {
    localStorage.setItem(DIVIDEND_TRACKING_START_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

/** Call when a holding is deleted, so re-adding it later starts fresh. */
export function forgetTrackedHoldings(holdingKeys: string[]): void {
  const state = loadTrackingState();
  if (!state || !holdingKeys.some((k) => k in state.holdings)) return;
  const holdings = { ...state.holdings };
  for (const k of holdingKeys) delete holdings[k];
  saveTrackingState({ ...state, holdings });
  window.dispatchEvent(new Event(DIVIDEND_TRACKING_CHANGED_EVENT));
}

function subtractDaysFromYmd(ymd: string, days: number): string {
  const d = parseYmdUtc(ymd);
  if (!d) return ymd;
  d.setUTCDate(d.getUTCDate() - days);
  return formatYmdUtc(d);
}

/**
 * Records today as the start for holdings seen for the first time. Holdings are never dropped
 * here, since rows can arrive in parts; deleting a holding clears it via forgetTrackedHoldings.
 * Returns the same object when nothing changed.
 */
export function reconcileTrackingState(
  stored: DividendTrackingState | null,
  holdingKeys: string[],
  todayYmd: string
): DividendTrackingState {
  const prev: DividendTrackingState = stored ?? { migratedOn: todayYmd, holdings: {} };
  const newStart =
    prev.migratedOn === todayYmd ? subtractDaysFromYmd(todayYmd, TRACKING_MIGRATION_LOOKBACK_DAYS) : todayYmd;
  const missing = [...new Set(holdingKeys)].filter((k) => !(k in prev.holdings));
  if (missing.length === 0 && stored != null) return prev;
  const holdings = { ...prev.holdings };
  for (const key of missing) holdings[key] = newStart;
  return { migratedOn: prev.migratedOn, holdings };
}

/** Project pay dates from anchor through untilYmd (inclusive), starting at first date >= fromYmd. */
export function projectPayoutDatesFromAnchor(
  anchorYmd: string,
  frequency: DividendPayoutFrequency,
  untilYmd: string,
  fromYmd: string = todayIsoDateHelsinki()
): string[] {
  const anchor = parseYmdUtc(anchorYmd);
  const until = parseYmdUtc(untilYmd);
  const from = parseYmdUtc(fromYmd);
  if (!anchor || !until || !from) return [];

  const step = frequencyStepMonths(frequency);
  let cur = new Date(anchor.getTime());
  let guard = 0;
  while (cur.getTime() < from.getTime() && guard < 600) {
    cur = addMonthsUtc(cur, step);
    guard += 1;
  }

  const out: string[] = [];
  guard = 0;
  while (cur.getTime() <= until.getTime() && guard < 600) {
    const ymd = formatYmdUtc(cur);
    if (ymd >= fromYmd && ymd <= untilYmd) out.push(ymd);
    cur = addMonthsUtc(cur, step);
    guard += 1;
  }
  return out;
}

function projectFallbackMonthKeys(
  startMonthKey: string,
  frequency: DividendPayoutFrequency,
  endMonthKey: string
): string[] {
  const out: string[] = [];
  let cur = startMonthKey;
  let guard = 0;
  while (cur <= endMonthKey && guard < 600) {
    out.push(cur);
    cur = addMonthsToMonthKey(cur, frequencyStepMonths(frequency));
    guard += 1;
  }
  return out;
}

type PaymentCandidate = { holdingKey: string; payment: ScheduledDividendPayment };

function compareScheduledPayments(a: ScheduledDividendPayment, b: ScheduledDividendPayment): number {
  const da = a.payDateYmd ?? '';
  const db = b.payDateYmd ?? '';
  if (da && db && da !== db) return da.localeCompare(db);
  if (da && !db) return -1;
  if (!da && db) return 1;
  return a.name.localeCompare(b.name);
}

function compareByAmountDescThenDateThenName(
  a: { amountEur: number; payDateYmd?: string; name: string },
  b: { amountEur: number; payDateYmd?: string; name: string }
): number {
  const amountDiff = b.amountEur - a.amountEur;
  if (amountDiff !== 0) return amountDiff;
  const da = a.payDateYmd ?? '';
  const db = b.payDateYmd ?? '';
  if (da !== db) return da.localeCompare(db);
  return a.name.localeCompare(b.name);
}

export function dedupeProjectedPaymentsByMonth(candidates: PaymentCandidate[]): ScheduledDividendPayment[] {
  const best = new Map<string, ScheduledDividendPayment>();

  for (const { holdingKey, payment } of candidates) {
    const key = `${holdingKey}|${payment.monthKey}`;
    const existing = best.get(key);
    if (!existing) {
      best.set(key, payment);
      continue;
    }

    const rankNew = payDateSourceRank(payment.payDateSource);
    const rankOld = payDateSourceRank(existing.payDateSource);
    if (rankNew > rankOld) {
      best.set(key, payment);
      continue;
    }
    if (rankNew < rankOld) continue;

    const datedNew = payment.payDateYmd != null;
    const datedOld = existing.payDateYmd != null;
    if (datedNew && !datedOld) {
      best.set(key, payment);
    }
  }

  return [...best.values()].sort(compareScheduledPayments);
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
  monthKey: string,
  redeemedIds: Set<string>,
  dividendTaxRatePercent: number
): ScheduledDividendPayment | null {
  if (!Number.isFinite(annualIncomeEur) || annualIncomeEur <= 0) return null;
  const amountEur = paymentAmountEur(annualIncomeEur, frequency, dividendTaxRatePercent);
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

function pushScheduledDates(
  candidates: PaymentCandidate[],
  holdingKey: string,
  source: DividendPaymentSource,
  sourceId: string,
  name: string,
  ticker: string,
  annualIncomeEur: number,
  frequency: DividendPayoutFrequency,
  dates: string[],
  payDateSource: PayDateSource,
  redeemedIds: Set<string>,
  dividendTaxRatePercent: number
): void {
  for (const payDateYmd of dates) {
    const payment = scheduleOnePayment(
      source,
      sourceId,
      name,
      ticker,
      annualIncomeEur,
      frequency,
      payDateYmd,
      payDateSource,
      redeemedIds,
      dividendTaxRatePercent
    );
    if (payment) candidates.push({ holdingKey, payment });
  }
}

function pushFallbackMonths(
  candidates: PaymentCandidate[],
  holdingKey: string,
  source: DividendPaymentSource,
  sourceId: string,
  name: string,
  ticker: string,
  annualIncomeEur: number,
  frequency: DividendPayoutFrequency,
  monthKeys: string[],
  redeemedIds: Set<string>,
  dividendTaxRatePercent: number
): void {
  for (const monthKey of monthKeys) {
    const payment = projectFallbackNextSlot(
      source,
      sourceId,
      name,
      ticker,
      annualIncomeEur,
      frequency,
      monthKey,
      redeemedIds,
      dividendTaxRatePercent
    );
    if (payment) candidates.push({ holdingKey, payment });
  }
}

function apiPayDatesForRow(
  row: ApiDividendPaymentInput,
  frequency: DividendPayoutFrequency,
  todayYmd: string,
  yearEndYmd: string,
  trackingStartYmd: string
): string[] {
  const fromCalendar = filterPayDatesInRange(row.calendarPayoutDates, trackingStartYmd, yearEndYmd);
  const hasUpcomingInCalendar = fromCalendar.some((d) => d >= todayYmd);

  let known = fromCalendar;
  if (!hasUpcomingInCalendar) {
    const anchor = row.nextPayDateYmd ?? firstUpcomingPayDateYmd(row.calendarPayoutDates, todayYmd);
    if (anchor) {
      known = [...new Set([...known, ...projectPayoutDatesFromAnchor(anchor, frequency, yearEndYmd, todayYmd)])];
    }
  }
  if (!known.length) return [];

  // Fill in past slots the server schedule no longer lists, back to the tracking start.
  return mergeUpcomingWithPastSinceTrackingStart(known, frequency, trackingStartYmd, todayYmd);
}

export function buildProjectedPayments(
  apiRows: ApiDividendPaymentInput[],
  manualRows: ManualDividendPaymentInput[],
  redeemed: RedeemedDividendPayment[],
  startMonthKey: string = helsinkiMonthKeyFromToday(),
  dividendTaxRatePercent = 0,
  options?: BuildProjectedPaymentsOptions
): ScheduledDividendPayment[] {
  const todayYmd = options?.todayYmd ?? todayIsoDateHelsinki();
  const yearEndYmd = endOfCurrentYearYmd(todayYmd);
  const endMonthKey = yearEndYmd.slice(0, 7);
  const redeemedIds = new Set(redeemed.map((r) => r.id));
  const candidates: PaymentCandidate[] = [];

  const trackingStartFor = (holdingKey: string): string => {
    const start = options?.trackingStarts?.[holdingKey];
    return start && start < todayYmd ? start : todayYmd;
  };

  for (const row of apiRows) {
    const frequency = parseFrequency(row.payoutFrequency);
    const holdingKey = apiHoldingKey(row.symbol);
    const payDateSource = mapApiPayDateSource(row.payDateSource);
    const dates = apiPayDatesForRow(row, frequency, todayYmd, yearEndYmd, trackingStartFor(holdingKey));

    if (dates.length) {
      pushScheduledDates(
        candidates,
        holdingKey,
        'api',
        row.symbol,
        row.name,
        row.ticker,
        row.estimatedAnnualIncomeEur,
        frequency,
        dates,
        payDateSource,
        redeemedIds,
        dividendTaxRatePercent
      );
    } else {
      pushFallbackMonths(
        candidates,
        holdingKey,
        'api',
        row.symbol,
        row.name,
        row.ticker,
        row.estimatedAnnualIncomeEur,
        frequency,
        projectFallbackMonthKeys(startMonthKey, frequency, endMonthKey),
        redeemedIds,
        dividendTaxRatePercent
      );
    }
  }

  for (const m of manualRows) {
    const frequency = m.payoutFrequency;
    const holdingKey = manualHoldingKey(m.id);
    const anchorYmd =
      m.payoutAnchorDate && /^\d{4}-\d{2}-\d{2}$/.test(m.payoutAnchorDate.trim())
        ? m.payoutAnchorDate.trim()
        : null;

    if (anchorYmd) {
      const dates = projectPayoutDatesFromAnchor(anchorYmd, frequency, yearEndYmd, trackingStartFor(holdingKey));
      pushScheduledDates(
        candidates,
        holdingKey,
        'manual',
        m.id,
        m.name,
        m.ticker,
        m.annualIncomeEur,
        frequency,
        dates,
        'manual',
        redeemedIds,
        dividendTaxRatePercent
      );
    } else {
      pushFallbackMonths(
        candidates,
        holdingKey,
        'manual',
        m.id,
        m.name,
        m.ticker,
        m.annualIncomeEur,
        frequency,
        [startMonthKey],
        redeemedIds,
        dividendTaxRatePercent
      );
    }
  }

  return dedupeProjectedPaymentsByMonth(candidates);
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
    const list = [...(map.get(monthKey) ?? [])].sort(compareByAmountDescThenDateThenName);
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
    const list = [...(map.get(monthKey) ?? [])].sort(compareByAmountDescThenDateThenName);
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
