import type { Express, Request, Response } from "express";

export type DividendHoldingIn = {
  symbol: string;
  /** Dashboard ticker (e.g. O) when `symbol` is a local listing (e.g. RY6.F). */
  displaySymbol?: string | null;
  quantity: number;
  currency: string;
  livePrice?: number;
  averagePrice?: number;
};

/** Exchange suffix on Yahoo symbols (e.g. `MI` in `VUCP.MI`). */
function listingExchangeSuffix(sym: string): string | null {
  const m = /^[A-Z0-9-]+\.([A-Z]{1,3})$/i.exec(sym.trim());
  return m ? m[1]!.toUpperCase() : null;
}

/** Listings where Yahoo chart dividend history is usually complete for UCITS distributing ETFs. */
const UCITS_DIVIDEND_CHART_SUFFIXES = new Set(["MI", "AS", "L"]);

/** Thin local listings (Nordic, XETRA, etc.) — try cross-listed tickers for chart distributions. */
function listingNeedsUcitsDividendFallback(sym: string): boolean {
  const sfx = listingExchangeSuffix(sym);
  if (!sfx || sfx.length < 2) return false;
  return !UCITS_DIVIDEND_CHART_SUFFIXES.has(sfx);
}

/**
 * UCITS / European listings (.MI, .HE, …) carry dividend history on the listing ticker.
 * US primaries on thin foreign listings (e.g. `RY6.F` + display `O`) use the display symbol.
 */
function preferListingSymbolForDividends(sym: string): boolean {
  const suffix = listingExchangeSuffix(sym);
  return suffix != null && suffix.length >= 2;
}

/** Dividend fundamentals from primary ticker when holding is a foreign listing. */
export function yahooDividendSymbol(sym: string, displaySymbol?: string | null): string {
  const s = sym.trim();
  const d = displaySymbol?.trim();
  if (!d) return s;
  if (d.includes(".")) return s;
  if (d.length > 8) return s;
  if (d.toUpperCase() === s.toUpperCase()) return s;
  if (preferListingSymbolForDividends(s)) return s;
  return d;
}

/**
 * Alternate Yahoo tickers when a local UCITS listing has no dividend feed (common for dist ETFs).
 * VUCP.HE / VUCP.DU often missing; VUCP.MI usually has chart distributions.
 * Some distributing ETFs never publish yield in quoteSummary — only chart `events.dividends`.
 */
export function yahooDividendSymbolFallbacks(sym: string, displaySymbol?: string | null): string[] {
  const primary = yahooDividendSymbol(sym, displaySymbol);
  const out: string[] = [];
  const add = (c: string) => {
    const t = c.trim();
    if (!t) return;
    if (!out.some((x) => x.toUpperCase() === t.toUpperCase())) out.push(t);
  };
  add(primary);
  add(sym.trim());
  const base = sym.includes(".") ? (sym.split(".")[0] ?? sym) : sym.trim();
  if (sym.includes(".") && listingNeedsUcitsDividendFallback(sym)) {
    add(`${base}.MI`);
    add(`${base}.AS`);
    add(`${base}.L`);
  }
  if (!sym.includes(".") && primary.toUpperCase() === (displaySymbol?.trim().toUpperCase() ?? primary.toUpperCase())) {
    add(`${base}.MI`);
    add(`${base}.AS`);
    add(`${base}.L`);
  }
  return out;
}

/** Sum chart distribution amounts in the trailing ~12 months (distributing ETFs / UCITS). */
export function trailingAnnualDividendPerShareFromChart(
  divs: { date?: Date | string; amount?: number }[] | undefined | null
): number | null {
  if (!divs?.length) return null;
  const cutoff = Date.now() - 365.25 * 86400000;
  let sum = 0;
  for (const d of divs) {
    const t = new Date(d.date as Date).getTime();
    const amt = d.amount;
    if (!Number.isFinite(t) || t < cutoff || typeof amt !== "number" || !Number.isFinite(amt) || amt <= 0) {
      continue;
    }
    sum += amt;
  }
  return sum > 0 ? Math.round(sum * 10000) / 10000 : null;
}

export function dividendBundleScore(
  sum: {
    summaryDetail?: {
      trailingAnnualDividendRate?: number;
      dividendRate?: number;
    };
    price?: { regularMarketPrice?: number };
  },
  divList: { date?: Date | string; amount?: number }[]
): number {
  const sd = sum.summaryDetail;
  const trail =
    typeof sd?.trailingAnnualDividendRate === "number" && sd.trailingAnnualDividendRate > 0
      ? sd.trailingAnnualDividendRate
      : typeof sd?.dividendRate === "number" && sd.dividendRate > 0
        ? sd.dividendRate
        : null;
  const chartTrail = trailingAnnualDividendPerShareFromChart(divList);
  let score = 0;
  if (chartTrail != null && chartTrail > 0) score += 5;
  if (divList.length >= 4) score += 3;
  if (trail != null && trail > 0) score += 2;
  if (dividendYieldPercentFromQuoteSummary(sum) != null) score += 2;
  if (typeof sum.price?.regularMarketPrice === "number" && sum.price.regularMarketPrice > 0) score += 1;
  return score;
}

export function toIsoDate(d: unknown): string | null {
  if (d == null) return null;
  if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  if (typeof d === "string") {
    const t = Date.parse(d);
    if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
    return d.slice(0, 10);
  }
  if (typeof d === "number") {
    const ms = d > 1e12 ? d : d * 1000;
    const dt = new Date(ms);
    if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  }
  return null;
}

/** Yahoo: yield often 0–1 as fraction; sometimes already a percent. */
export function normalizeYieldToPercent(raw: unknown): number | null {
  if (raw == null || typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return null;
  if (raw > 0 && raw <= 1) return raw * 100;
  if (raw > 1 && raw <= 100) return raw;
  return raw > 100 ? null : raw * 100;
}

/** Same yield source as `/api/portfolio/dividends` (summaryDetail + price), not `quote()`. */
export function dividendYieldPercentFromQuoteSummary(sum: {
  summaryDetail?: {
    dividendRate?: number;
    dividendYield?: number;
    trailingAnnualDividendRate?: number;
    trailingAnnualDividendYield?: number;
  };
  price?: { regularMarketPrice?: number };
}): number | null {
  const sd = sum.summaryDetail;
  const price = sum.price;
  const perShareDirect =
    typeof sd?.trailingAnnualDividendRate === "number" && Number.isFinite(sd.trailingAnnualDividendRate)
      ? sd.trailingAnnualDividendRate
      : typeof sd?.dividendRate === "number" && Number.isFinite(sd.dividendRate)
        ? sd.dividendRate
        : null;
  const livePx = typeof price?.regularMarketPrice === "number" ? price.regularMarketPrice : null;
  const yYield =
    sd?.trailingAnnualDividendYield ??
    sd?.dividendYield ??
    (perShareDirect != null && livePx ? perShareDirect / livePx : null);
  return normalizeYieldToPercent(yYield);
}

/** Yield from `quote()` when quoteSummary is empty (rare listings). */
export type InferredDividendPayoutFrequency = "monthly" | "quarterly" | "annual";

/** Yahoo chart may return dividends as an array or a timestamp-keyed object. */
export function chartDividendsToList(
  dividends: unknown
): { date?: Date | string; amount?: number }[] {
  if (!dividends) return [];
  if (Array.isArray(dividends)) return dividends;
  if (typeof dividends === "object") {
    return Object.values(dividends as Record<string, { date?: Date | string; amount?: number }>);
  }
  return [];
}

function classifyGapMedianDays(med: number): InferredDividendPayoutFrequency {
  if (med < 50) return "monthly";
  if (med < 130) return "quarterly";
  return "annual";
}

/** Infer pay cadence from Yahoo chart dividend events (recent gaps weighted). */
export function inferPayoutFrequencyFromChartDividends(
  divs: { date?: Date | string; amount?: number }[] | undefined | null
): InferredDividendPayoutFrequency | null {
  if (!divs || divs.length < 2) return null;
  const times = divs
    .map((d) => new Date(d.date as Date).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  if (times.length < 2) return null;
  const gapsDays: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const gap = (times[i]! - times[i - 1]!) / (86400 * 1000);
    if (gap >= 18 && gap <= 400) gapsDays.push(gap);
  }
  if (gapsDays.length === 0) return null;

  const recentGaps = gapsDays.slice(-4);
  const sortedRecent = [...recentGaps].sort((a, b) => a - b);
  const recentMed = sortedRecent[Math.floor(sortedRecent.length / 2)]!;
  const lastGap = gapsDays[gapsDays.length - 1]!;

  if (lastGap >= 70 && lastGap <= 120) return "quarterly";
  if (lastGap >= 18 && lastGap <= 45 && recentMed < 50) return "monthly";

  const priorGaps = gapsDays.slice(-5, -1);
  if (priorGaps.length >= 3 && lastGap >= 65 && lastGap <= 130) {
    const priorSorted = [...priorGaps].sort((a, b) => a - b);
    const priorMed = priorSorted[Math.floor(priorSorted.length / 2)]!;
    if (priorMed < 50) return "quarterly";
  }

  const lastPay = times[times.length - 1]!;
  const paysInYear = times.filter((t) => t >= lastPay - 365.25 * 86400000).length;
  // Trailing payment count is misleading after a cadence change (e.g. STAG monthly → quarterly).
  if (paysInYear >= 10 && lastGap < 65) return "monthly";
  if (paysInYear >= 3 && paysInYear <= 5 && lastGap >= 65) return "quarterly";
  if (lastGap >= 65 && lastGap <= 130) return "quarterly";

  return classifyGapMedianDays(recentMed);
}

export type CalendarPayoutSource = "yahoo" | "estimated" | "none";

function formatYmdUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addMonthsUtc(d: Date, n: number): Date {
  const x = new Date(d.getTime());
  x.setUTCMonth(x.getUTCMonth() + n);
  return x;
}

function addDaysUtc(d: Date, days: number): Date {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

function parseYmdUtc(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const day = Number(m[3]);
  const d = new Date(Date.UTC(y, mo, day));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Days from ex-dividend to payment when Yahoo provides both calendar dates. */
export function inferExToPayLagDays(
  exDate: string | null,
  payDate: string | null
): number | null {
  const ex = exDate ? parseYmdUtc(exDate) : null;
  const pay = payDate ? parseYmdUtc(payDate) : null;
  if (!ex || !pay) return null;
  const lag = Math.round((pay.getTime() - ex.getTime()) / 86400000);
  if (lag >= 5 && lag <= 60) return lag;
  return null;
}

/** Typical pay day of month for monthly distributors (JEPG ~5–8, VUCP ~1–7). */
const MONTHLY_PAY_DAY_OF_MONTH = 5;

/**
 * Heuristic pay date from an ex-date when only chart history exists.
 * Monthly UCITS funds often pay in the first week of the month after ex-month.
 */
export function estimatePayDateFromExUtc(
  exUtc: Date,
  freq: InferredDividendPayoutFrequency
): Date {
  if (freq === "monthly") {
    let m = exUtc.getUTCMonth() + 1;
    let y = exUtc.getUTCFullYear();
    if (m > 11) {
      m = 0;
      y += 1;
    }
    let pay = new Date(Date.UTC(y, m, MONTHLY_PAY_DAY_OF_MONTH));
    if (pay.getTime() <= exUtc.getTime()) {
      m += 1;
      if (m > 11) {
        m = 0;
        y += 1;
      }
      pay = new Date(Date.UTC(y, m, MONTHLY_PAY_DAY_OF_MONTH));
    }
    return pay;
  }
  if (freq === "quarterly") return addDaysUtc(exUtc, 21);
  return addDaysUtc(exUtc, 30);
}

const MIN_EX_TO_PAY_LAG = 10;
const MAX_EX_TO_PAY_LAG = 45;

/** Median ex→pay lag inferred from chart ex-dates (JEPG/VUCP-style monthly ~13–15d). */
export function inferExToPayLagFromChartExDates(
  divs: { date?: Date | string }[] | undefined | null,
  freq: InferredDividendPayoutFrequency | null
): number | null {
  if (!freq || !divs?.length) return null;
  const times = divs
    .map((d) => new Date(d.date as Date).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  if (times.length < 2) return null;

  const lags: number[] = [];
  for (const t of times.slice(-8)) {
    const ex = new Date(t);
    const exUtc = new Date(Date.UTC(ex.getUTCFullYear(), ex.getUTCMonth(), ex.getUTCDate()));
    const payUtc = estimatePayDateFromExUtc(exUtc, freq);
    const lag = Math.round((payUtc.getTime() - exUtc.getTime()) / 86400000);
    if (lag >= MIN_EX_TO_PAY_LAG && lag <= MAX_EX_TO_PAY_LAG) lags.push(lag);
  }
  if (lags.length === 0) return null;
  lags.sort((a, b) => a - b);
  return lags[Math.floor(lags.length / 2)]!;
}

function defaultExToPayLagDays(freq: InferredDividendPayoutFrequency): number {
  if (freq === "monthly") return 14;
  if (freq === "quarterly") return 21;
  return 30;
}

function advanceAnchorToUpcomingUtc(anchor: Date, freq: InferredDividendPayoutFrequency): Date {
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let cur = new Date(anchor.getTime());
  const step = freq === "monthly" ? 1 : freq === "quarterly" ? 3 : 12;
  let guard = 0;
  while (cur.getTime() < todayUtc && guard < 600) {
    cur = addMonthsUtc(cur, step);
    guard += 1;
  }
  return cur;
}

function scheduleCount(freq: InferredDividendPayoutFrequency): number {
  if (freq === "monthly") return 18;
  if (freq === "quarterly") return 12;
  return 6;
}

/** Project pay dates forward from a known payment anchor (Yahoo pay date or manual anchor). */
function projectedPayoutDatesFromAnchor(
  payAnchorYmd: string,
  freq: InferredDividendPayoutFrequency,
  count: number
): string[] {
  const parsed = parseYmdUtc(payAnchorYmd);
  if (!parsed) return [];
  const step = freq === "monthly" ? 1 : freq === "quarterly" ? 3 : 12;
  let cur = advanceAnchorToUpcomingUtc(parsed, freq);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(formatYmdUtc(cur));
    cur = addMonthsUtc(cur, step);
  }
  return out;
}

/**
 * Yahoo chart `events.dividends` are ex-dividend dates, not payment dates.
 * Monthly: pay ~first week of month after ex-month (not a flat +N from last ex).
 * Quarterly/annual: last ex + inferred lag days.
 */
function projectedPayoutDatesFromChartDividends(
  divList: { date?: Date | string }[] | undefined,
  freq: InferredDividendPayoutFrequency | null,
  exToPayLagDays: number,
  count: number
): string[] {
  if (!freq || !divList?.length) return [];
  const times = divList
    .map((d) => new Date(d.date as Date).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  if (times.length === 0) return [];
  const lastEx = new Date(times[times.length - 1]!);
  const lastExUtc = new Date(Date.UTC(lastEx.getUTCFullYear(), lastEx.getUTCMonth(), lastEx.getUTCDate()));
  const payAnchor =
    freq === "monthly"
      ? estimatePayDateFromExUtc(lastExUtc, freq)
      : addDaysUtc(lastExUtc, exToPayLagDays);
  return projectedPayoutDatesFromAnchor(formatYmdUtc(payAnchor), freq, count);
}

export function buildCalendarPayoutSchedule(
  officialPay: string | null,
  officialEx: string | null,
  divList: { date?: Date | string }[] | undefined,
  freq: InferredDividendPayoutFrequency | null
): { dates: string[]; source: CalendarPayoutSource } {
  const effectiveFreq =
    freq ?? (divList && divList.length >= 2 ? inferPayoutFrequencyFromChartDividends(divList) : null);
  const lag =
    inferExToPayLagDays(officialEx, officialPay) ??
    inferExToPayLagFromChartExDates(divList, effectiveFreq) ??
    (effectiveFreq ? defaultExToPayLagDays(effectiveFreq) : null);

  if (officialPay && effectiveFreq) {
    return {
      dates: projectedPayoutDatesFromAnchor(officialPay, effectiveFreq, scheduleCount(effectiveFreq)),
      source: "yahoo",
    };
  }

  if (officialPay) {
    return { dates: [officialPay], source: "yahoo" };
  }

  if (effectiveFreq && lag != null) {
    const est = projectedPayoutDatesFromChartDividends(divList, effectiveFreq, lag, 14);
    if (est.length) return { dates: est, source: "estimated" };
  }

  return { dates: [], source: "none" };
}

/** Yield from `quote()` when quoteSummary is empty (rare listings). */
export function dividendYieldPercentFromQuote(detail: {
  trailingAnnualDividendYield?: number;
  dividendYield?: number;
  trailingAnnualDividendRate?: number;
  regularMarketPrice?: number;
}): number | null {
  const yYield =
    detail?.trailingAnnualDividendYield ??
    detail?.dividendYield ??
    (typeof detail?.trailingAnnualDividendRate === "number" &&
    Number.isFinite(detail.trailingAnnualDividendRate) &&
    typeof detail?.regularMarketPrice === "number" &&
    Number.isFinite(detail.regularMarketPrice) &&
    detail.regularMarketPrice > 0
      ? detail.trailingAnnualDividendRate / detail.regularMarketPrice
      : null);
  return normalizeYieldToPercent(yYield);
}

