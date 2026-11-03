import type YahooFinance from "yahoo-finance2";
import type { Asset, PortfolioFlow } from "../src/types";
import { TRANSFER_IN_NOTE } from "../src/flowNotes";
import { isoDateFromTimestampHelsinki } from "../src/formatDate";
import { getEurRates } from "./fxRates";

type YahooClient = InstanceType<typeof YahooFinance>;

export type PortfolioIntradayPoint = { t: number; value: number };

export type PortfolioIntraday = {
  /** Helsinki date of the latest session shown (today, or the last trading day). */
  date: string;
  /** Helsinki dates included, oldest first (one for 1D, up to five for 5D). */
  days: string[];
  /** Portfolio value in EUR (holdings at current share counts + cash) at each bar. */
  points: PortfolioIntradayPoint[];
  /** Value at the close before the first day shown, + cash. */
  baselineEur: number;
};

export type PortfolioIntradayRange = "1D" | "5D";

type Bar = { t: number; close: number };

const RANGE_CONFIG: Record<PortfolioIntradayRange, { interval: "5m" | "30m"; days: number; lookbackDays: number }> = {
  "1D": { interval: "5m", days: 1, lookbackDays: 6 },
  // Enough calendar days to cover five trading days across weekends and holidays.
  "5D": { interval: "30m", days: 5, lookbackDays: 12 },
};
const CACHE_TTL_MS = 3 * 60 * 1000;

const cache = new Map<PortfolioIntradayRange, { key: string; at: number; result: PortfolioIntraday | null }>();

/** Regular trading hours (epoch ms) of the exchange's current or next session, from chart meta. */
type Session = { start: number; end: number };

type BarsResult = { bars: Bar[]; currency: string | null; previousClose: number | null; session: Session | null };

/**
 * Per-symbol chart cache, shared by the portfolio series and the holdings sparklines (both ask
 * for the same 1D bars on page load). Adding one holding then fetches one chart, not all of
 * them, and concurrent callers share a request already in flight.
 */
const BARS_TTL_MS = 60_000;
const barsCache = new Map<string, { at: number; promise: Promise<BarsResult> }>();

function fetchBars(
  yahooFinance: YahooClient,
  symbol: string,
  now: Date,
  range: PortfolioIntradayRange
): Promise<BarsResult> {
  const key = `${range}|${symbol}`;
  const hit = barsCache.get(key);
  if (hit && Math.abs(now.getTime() - hit.at) < BARS_TTL_MS) return hit.promise;
  const promise = fetchBarsUncached(yahooFinance, symbol, now, range);
  barsCache.set(key, { at: now.getTime(), promise });
  // A failed fetch should be retried on the next request, not served for a minute.
  void promise.then((r) => {
    if (r.bars.length === 0 && barsCache.get(key)?.promise === promise) barsCache.delete(key);
  });
  return promise;
}

async function fetchBarsUncached(
  yahooFinance: YahooClient,
  symbol: string,
  now: Date,
  range: PortfolioIntradayRange
): Promise<BarsResult> {
  const { interval, lookbackDays } = RANGE_CONFIG[range];
  try {
    const chart: any = await yahooFinance.chart(
      symbol,
      // Regular hours only: the library default includes pre/post-market and overnight bars,
      // which would fill nights and weekends for US stocks.
      {
        period1: new Date(now.getTime() - lookbackDays * 86_400_000),
        period2: now,
        interval,
        includePrePost: false,
      },
      { validateResult: false }
    );
    const bars: Bar[] = [];
    for (const q of chart?.quotes ?? []) {
      const t = new Date(q.date).getTime();
      if (Number.isFinite(t) && typeof q.close === "number" && q.close > 0) bars.push({ t, close: q.close });
    }
    bars.sort((a, b) => a.t - b.t);
    const meta = chart?.meta ?? {};
    const prev = Number(meta.chartPreviousClose ?? meta.previousClose);
    const regular = meta.currentTradingPeriod?.regular;
    const start = new Date(regular?.start ?? NaN).getTime();
    const end = new Date(regular?.end ?? NaN).getTime();
    return {
      bars,
      currency: meta.currency ? String(meta.currency).toUpperCase() : null,
      previousClose: Number.isFinite(prev) && prev > 0 ? prev : null,
      session: Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null,
    };
  } catch {
    return { bars: [], currency: null, previousClose: null, session: null };
  }
}

/** Last bar at or before t (bars sorted ascending), else undefined. */
function lastAtOrBefore(bars: Bar[], t: number): Bar | undefined {
  let lo = 0;
  let hi = bars.length - 1;
  let found: Bar | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid]!.t <= t) {
      found = bars[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * Rebuild the portfolio's value through the latest trading day (1D, 5-minute bars) or the
 * last five trading days (5D, 30-minute bars), for the current holdings and cash. Shares bought
 * during the period count as the money paid until the purchase time, so buying doesn't look
 * like market movement. Holdings whose market is closed stay flat at their last price.
 */
export async function buildPortfolioIntraday(
  yahooFinance: YahooClient,
  assets: Asset[],
  cashEur: number,
  now: Date = new Date(),
  range: PortfolioIntradayRange = "1D",
  flows: Pick<PortfolioFlow, "kind" | "assetSymbol" | "amountEur" | "note" | "date" | "createdAt">[] = []
): Promise<PortfolioIntraday | null> {
  const held = assets.filter((a) => a.symbol?.trim() && Number(a.quantity) > 0);
  const key = JSON.stringify([held.map((a) => [a.symbol, a.quantity, a.currency]), cashEur, flows.length]);
  const hit = cache.get(range);
  if (hit && hit.key === key && now.getTime() - hit.at < CACHE_TTL_MS) return hit.result;
  const remember = (result: PortfolioIntraday | null) => {
    cache.set(range, { key, at: now.getTime(), result });
    return result;
  };

  const series = await Promise.all(held.map((a) => fetchBars(yahooFinance, a.symbol.trim(), now, range)));

  const currencies = [
    ...new Set(held.map((a, i) => (series[i]!.currency || a.currency || "EUR").toUpperCase())),
  ].filter((c) => c !== "EUR");
  const [fxBars, spotRates] = await Promise.all([
    Promise.all(currencies.map((c) => fetchBars(yahooFinance, `${c}EUR=X`, now, range))),
    getEurRates(yahooFinance, currencies),
  ]);
  const fxByCurrency = new Map(currencies.map((c, i) => [c, fxBars[i]!.bars]));

  const fxAt = (currency: string, t: number): number => {
    if (currency === "EUR") return 1;
    const bars = fxByCurrency.get(currency) ?? [];
    return lastAtOrBefore(bars, t)?.close ?? bars[0]?.close ?? spotRates[currency] ?? 1;
  };

  // Days to show: the latest Helsinki dates any holding traded on.
  const tradedDates = new Set<string>();
  for (const s of series) {
    for (const b of s.bars) {
      const d = isoDateFromTimestampHelsinki(b.t);
      if (d) tradedDates.add(d);
    }
  }
  const days = [...tradedDates].sort().slice(-RANGE_CONFIG[range].days);
  const firstDay = days[0];
  const date = days[days.length - 1];
  if (!firstDay || !date) return remember(null);
  const inRange = (t: number) => {
    const d = isoDateFromTimestampHelsinki(t);
    return d != null && d >= firstDay;
  };

  const sessionTimes = new Set<number>();
  const perHolding = held.map((a, i) => {
    const s = series[i]!;
    const currency = (s.currency || a.currency || "EUR").toUpperCase();
    const dayBars = s.bars.filter((b) => inRange(b.t));
    const before = s.bars.filter((b) => !inRange(b.t));
    for (const b of dayBars) sessionTimes.add(b.t);
    // Start price: last bar before the first day, else Yahoo's previous close (1D only:
    // for 5D it refers to the latest session), else the first bar shown.
    const prevClose = range === "1D" ? s.previousClose : null;
    const startPrice = before[before.length - 1]?.close ?? prevClose ?? dayBars[0]?.close ?? 0;
    const qty = Number(a.quantity);
    // No market price at all: value it flat at cost, as the rest of the app does.
    const flatValueEur =
      startPrice > 0
        ? null
        : qty * Number(a.averagePrice || 0) * fxAt((a.currency || "EUR").toUpperCase(), now.getTime());
    const priceEurAt = (t: number) =>
      (lastAtOrBefore(dayBars, t)?.close ?? startPrice) * fxAt(currency, t);

    // Purchases during the period: until bought, those shares count as the money paid.
    const purchases = flows
      .filter(
        (f) =>
          f.kind === "buy" &&
          f.assetSymbol === a.symbol &&
          f.note !== TRANSFER_IN_NOTE &&
          f.amountEur > 0 &&
          f.date >= firstDay
      )
      .map((f) => {
        const t = Date.parse(f.createdAt);
        const p = Number.isFinite(t) ? priceEurAt(t) : 0;
        return { t, amountEur: f.amountEur, shares: p > 0 ? f.amountEur / p : 0 };
      })
      .filter((p) => Number.isFinite(p.t) && p.shares > 0);

    const valueAt = (t: number): number => {
      if (flatValueEur != null) return flatValueEur;
      let shares = qty;
      let notYetBoughtEur = 0;
      for (const p of purchases) {
        if (p.t > t) {
          shares -= p.shares;
          notYetBoughtEur += p.amountEur;
        }
      }
      return Math.max(0, shares) * priceEurAt(t) + notYetBoughtEur;
    };
    return { valueAt };
  });

  const times = [...sessionTimes].sort((x, y) => x - y);
  if (times.length === 0) return remember(null);

  const firstT = times[0]!;
  const baselineEur = cashEur + perHolding.reduce((sum, h) => sum + h.valueAt(firstT - 1), 0);

  const points: PortfolioIntradayPoint[] = times.map((t) => ({
    t,
    value: Math.round((cashEur + perHolding.reduce((sum, h) => sum + h.valueAt(t), 0)) * 100) / 100,
  }));

  return remember({ date, days, points, baselineEur: Math.round(baselineEur * 100) / 100 });
}

/* ------------------------------------------------------------------ */
/* Per-holding sparklines (Holdings table)                             */
/* ------------------------------------------------------------------ */

export type HoldingSparkline = {
  /** Prices through the holding's latest trading day (downsampled), in its quote currency. */
  points: number[];
  /** Bar times (epoch ms) for `points`. */
  times: number[];
  /** That day's regular trading hours (epoch ms), so a session in progress fills only part of the line. */
  sessionStart: number;
  sessionEnd: number;
  /** Close before that day, for the up/down colour and a baseline. */
  previousClose: number | null;
};

const SPARKLINE_POINTS = 48;
let sparklineCache: { key: string; at: number; result: Record<string, HoldingSparkline> } | null = null;

function downsample<T>(values: T[], max: number): T[] {
  if (values.length <= max) return values;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(values[Math.round((i * (values.length - 1)) / (max - 1))]!);
  return out;
}

const DAY_MS = 86_400_000;

/**
 * Regular hours of the day the bars cover. Chart meta gives the current (or next) session; for
 * an earlier day it is shifted back by whole days. Without meta, the bars' own span is used.
 */
function sessionForDay(dayBars: Bar[], session: Session | null): Session {
  const first = dayBars[0]!.t;
  const last = dayBars[dayBars.length - 1]!.t;
  if (!session) return { start: first, end: last };
  const shift = Math.round((session.start - first) / DAY_MS) * DAY_MS;
  const start = Math.min(session.start - shift, first);
  const end = Math.max(session.end - shift, last);
  return { start, end };
}

/** Each holding's 5-minute prices for its own latest trading day. */
export async function buildHoldingSparklines(
  yahooFinance: YahooClient,
  symbols: string[],
  now: Date = new Date()
): Promise<Record<string, HoldingSparkline>> {
  const unique = [...new Set(symbols.map((s) => s.trim()).filter(Boolean))].sort();
  const key = unique.join("|");
  if (sparklineCache && sparklineCache.key === key && now.getTime() - sparklineCache.at < CACHE_TTL_MS) {
    return sparklineCache.result;
  }
  const series = await Promise.all(unique.map((s) => fetchBars(yahooFinance, s, now, "1D")));
  const result: Record<string, HoldingSparkline> = {};
  unique.forEach((symbol, i) => {
    const { bars, previousClose, session } = series[i]!;
    const last = bars[bars.length - 1];
    if (!last) return;
    const day = isoDateFromTimestampHelsinki(last.t);
    const dayBars = bars.filter((b) => isoDateFromTimestampHelsinki(b.t) === day);
    const before = bars.filter((b) => isoDateFromTimestampHelsinki(b.t)! < day!);
    if (dayBars.length < 2) return;
    const sampled = downsample(dayBars, SPARKLINE_POINTS);
    const { start, end } = sessionForDay(dayBars, session);
    result[symbol] = {
      points: sampled.map((b) => b.close),
      times: sampled.map((b) => b.t),
      sessionStart: start,
      sessionEnd: end,
      previousClose: before[before.length - 1]?.close ?? previousClose,
    };
  });
  sparklineCache = { key, at: now.getTime(), result };
  return result;
}
