/**
 * Yahoo quotes some listings in a currency's minor unit (London in pence as `GBp`/`GBX`,
 * Johannesburg in cents as `ZAc`, Tel Aviv in agorot as `ILA`). Everything downstream
 * upper-cases currency codes and looks up EUR rates for the major unit, so a pence price
 * would be valued 100x too high. These helpers rescale Yahoo results to the major unit.
 *
 * Units checked against live Yahoo data (VOD.L, ULVR.L): prices, chart closes and chart
 * dividend amounts are in pence; `dividendRate` / `trailingAnnualDividendRate` are already
 * in the major unit of `financialCurrency`; `dividendYield` is right while
 * `trailingAnnualDividendYield` is computed from the pence price and is 100x too small.
 */

const MINOR_TO_MAJOR: Record<string, { major: string; factor: number }> = {
  GBp: { major: "GBP", factor: 100 },
  GBX: { major: "GBP", factor: 100 },
  ZAc: { major: "ZAR", factor: 100 },
  ZAC: { major: "ZAR", factor: 100 },
  ILA: { major: "ILS", factor: 100 },
};

/** Minor-unit info for a Yahoo currency code (case-sensitive: `GBP` is pounds, `GBp` pence). */
export function minorCurrencyInfo(currency: unknown): { major: string; factor: number } | null {
  if (typeof currency !== "string") return null;
  return MINOR_TO_MAJOR[currency.trim()] ?? null;
}

/** Major-unit code for a currency (`GBp` → `GBP`); other codes are returned unchanged. */
export function majorCurrencyCode(currency: string): string {
  return minorCurrencyInfo(currency)?.major ?? currency;
}

const QUOTE_PRICE_FIELDS = [
  "regularMarketPrice",
  "regularMarketPreviousClose",
  "regularMarketOpen",
  "regularMarketDayHigh",
  "regularMarketDayLow",
  "regularMarketChange",
  "previousClose",
  "open",
  "dayHigh",
  "dayLow",
  "bid",
  "ask",
  "fiftyTwoWeekHigh",
  "fiftyTwoWeekLow",
  "fiftyTwoWeekHighChange",
  "fiftyTwoWeekLowChange",
  "fiftyDayAverage",
  "fiftyDayAverageChange",
  "twoHundredDayAverage",
  "twoHundredDayAverageChange",
  "postMarketPrice",
  "postMarketChange",
  "preMarketPrice",
  "preMarketChange",
  "chartPreviousClose",
] as const;

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function scaleFields(o: Rec, fields: readonly string[], factor: number): void {
  for (const k of fields) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) o[k] = v / factor;
  }
}

/** Rescale one quote-like object (a `quote()` row, or the `price`/`summaryDetail` module). */
function normalizeQuoteLike(o: Rec): Rec {
  const info = minorCurrencyInfo(o.currency);
  if (!info) return o;
  const out: Rec = { ...o, currency: info.major };
  scaleFields(out, QUOTE_PRICE_FIELDS, info.factor);
  const ty = out.trailingAnnualDividendYield;
  if (typeof ty === "number" && Number.isFinite(ty)) out.trailingAnnualDividendYield = ty * info.factor;
  return out;
}

/** `yahooFinance.quote()` result: one quote, an array, or a symbol-keyed map. */
export function normalizeQuoteResult<T>(result: T): T {
  if (Array.isArray(result)) return result.map((q) => (isRec(q) ? normalizeQuoteLike(q) : q)) as T;
  if (!isRec(result)) return result;
  if ("symbol" in result || "currency" in result) return normalizeQuoteLike(result) as T;
  // `return: "object"` form: { [symbol]: quote }
  const out: Rec = {};
  for (const [k, v] of Object.entries(result)) out[k] = isRec(v) ? normalizeQuoteLike(v) : v;
  return out as T;
}

/** `yahooFinance.quoteSummary()` result: rescale the `price` and `summaryDetail` modules. */
export function normalizeQuoteSummaryResult<T>(result: T): T {
  if (!isRec(result)) return result;
  const out: Rec = { ...result };
  if (isRec(out.price)) out.price = normalizeQuoteLike(out.price);
  if (isRec(out.summaryDetail)) {
    // summaryDetail.currency can be missing; fall back to the price module's code.
    const sd = out.summaryDetail;
    const cur = sd.currency ?? (isRec(result.price) ? result.price.currency : undefined);
    out.summaryDetail = normalizeQuoteLike({ ...sd, currency: cur });
  }
  return out as T;
}

const BAR_FIELDS = ["open", "high", "low", "close", "adjclose"] as const;

/** `yahooFinance.chart()` result, array form (`quotes`) or raw form (`indicators`). */
export function normalizeChartResult<T>(result: T): T {
  if (!isRec(result) || !isRec(result.meta)) return result;
  const info = minorCurrencyInfo(result.meta.currency);
  if (!info) return result;
  const f = info.factor;
  const meta: Rec = { ...result.meta, currency: info.major };
  scaleFields(meta, QUOTE_PRICE_FIELDS, f);
  const out: Rec = { ...result, meta };

  if (Array.isArray(result.quotes)) {
    out.quotes = result.quotes.map((bar) => {
      if (!isRec(bar)) return bar;
      const b = { ...bar };
      scaleFields(b, BAR_FIELDS, f);
      return b;
    });
  }
  if (isRec(result.indicators)) {
    const ind: Rec = { ...result.indicators };
    const scaleSeries = (s: unknown) => (Array.isArray(s) ? s.map((v) => (typeof v === "number" ? v / f : v)) : s);
    if (Array.isArray(ind.quote)) {
      ind.quote = ind.quote.map((q) => {
        if (!isRec(q)) return q;
        const nq: Rec = { ...q };
        for (const k of BAR_FIELDS) if (k in nq) nq[k] = scaleSeries(nq[k]);
        return nq;
      });
    }
    if (Array.isArray(ind.adjclose)) {
      ind.adjclose = ind.adjclose.map((a) => (isRec(a) ? { ...a, adjclose: scaleSeries(a.adjclose) } : a));
    }
    out.indicators = ind;
  }
  if (isRec(result.events) && result.events.dividends != null) {
    const divs = result.events.dividends;
    const scaleDiv = (d: unknown) =>
      isRec(d) && typeof d.amount === "number" ? { ...d, amount: d.amount / f } : d;
    out.events = {
      ...result.events,
      dividends: Array.isArray(divs)
        ? divs.map(scaleDiv)
        : isRec(divs)
          ? Object.fromEntries(Object.entries(divs).map(([k, v]) => [k, scaleDiv(v)]))
          : divs,
    };
  }
  return out as T;
}

/** A holding stored in a minor unit (older data): price per unit and currency in the major unit. */
export function normalizeHoldingCurrency<T extends { currency?: string; averagePrice?: number }>(asset: T): T {
  const info = minorCurrencyInfo(asset.currency);
  if (!info) return asset;
  const avg = Number(asset.averagePrice);
  return {
    ...asset,
    currency: info.major,
    averagePrice: Number.isFinite(avg) ? avg / info.factor : asset.averagePrice,
  };
}
