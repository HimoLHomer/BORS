import type { Asset } from "../src/types";
import { fxToEur, holdingQuoteFxToEur } from "../src/formatCurrency";
import { parseIsoDateOnly } from "../src/formatDate";
import { getPortfolioDb } from "./portfolio";

type YahooFinanceLike = {
  chart: (
    symbol: string,
    opts: { period1: Date; period2: Date; interval: "1d" },
    options?: { validateResult?: boolean }
  ) => Promise<{
    meta?: { currency?: string };
    quotes?: Array<{ date?: Date; close?: number | null }>;
  } | null>;
};

type DailySeries = Map<string, number>;

function chartDateToIso(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Helsinki",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (y && m && day) return `${y}-${m}-${day}`;
  return d.toISOString().slice(0, 10);
}

function quotesToDailySeries(
  quotes: Array<{ date?: Date; close?: number | null }> | undefined
): DailySeries {
  const series: DailySeries = new Map();
  for (const q of quotes ?? []) {
    if (!q.date) continue;
    const close = q.close;
    if (typeof close !== "number" || !Number.isFinite(close) || close <= 0) continue;
    series.set(chartDateToIso(q.date), close);
  }
  return series;
}

/** Last known close on or before `targetIso` in the series. */
export function closeOnOrBefore(series: DailySeries, targetIso: string): number | null {
  const target = parseIsoDateOnly(targetIso);
  if (!target) return null;
  let bestDate: string | null = null;
  let bestClose: number | null = null;
  for (const [iso, close] of series) {
    const d = parseIsoDateOnly(iso);
    if (!d || d.getTime() > target.getTime()) continue;
    if (bestDate == null || iso > bestDate) {
      bestDate = iso;
      bestClose = close;
    }
  }
  return bestClose;
}

function loadPortfolioAssets(): Asset[] {
  const rows = getPortfolioDb()
    .prepare("SELECT id, payload FROM assets")
    .all() as { id: string; payload: string }[];
  return rows.map((row) => {
    const a = JSON.parse(row.payload) as Asset;
    return { ...a, id: row.id };
  });
}

function loadCashEur(): number {
  const row = getPortfolioDb()
    .prepare("SELECT amount_eur FROM portfolio_cash WHERE id = 1")
    .get() as { amount_eur: unknown } | undefined;
  const raw = row?.amount_eur;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? parseFloat(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function periodBoundsForDates(dates: string[]): { period1: Date; period2: Date } | null {
  const parsed = dates.map(parseIsoDateOnly).filter((d): d is Date => d != null);
  if (parsed.length === 0) return null;
  const minMs = Math.min(...parsed.map((d) => d.getTime()));
  const maxMs = Math.max(...parsed.map((d) => d.getTime()));
  const period1 = new Date(minMs);
  period1.setUTCDate(period1.getUTCDate() - 7);
  const period2 = new Date(maxMs);
  period2.setUTCDate(period2.getUTCDate() + 1);
  return { period1, period2 };
}

async function fetchSymbolSeries(
  yahooFinance: YahooFinanceLike,
  symbol: string,
  period1: Date,
  period2: Date
): Promise<{ series: DailySeries; quoteCurrency: string | null }> {
  try {
    const chart = await yahooFinance.chart(
      symbol,
      { period1, period2, interval: "1d" },
      { validateResult: false }
    );
    const currency = chart?.meta?.currency
      ? String(chart.meta.currency).toUpperCase()
      : null;
    return { series: quotesToDailySeries(chart?.quotes), quoteCurrency: currency };
  } catch {
    return { series: new Map(), quoteCurrency: null };
  }
}

async function fetchFxSeries(
  yahooFinance: YahooFinanceLike,
  currency: string,
  period1: Date,
  period2: Date
): Promise<DailySeries> {
  const c = currency.toUpperCase();
  if (c === "EUR") return new Map();
  try {
    const chart = await yahooFinance.chart(
      `${c}EUR=X`,
      { period1, period2, interval: "1d" },
      { validateResult: false }
    );
    return quotesToDailySeries(chart?.quotes);
  } catch {
    return new Map();
  }
}

function fxRateOnDate(
  currency: string,
  targetIso: string,
  fxSeriesByCurrency: Map<string, DailySeries>,
  staticFallback: Record<string, number>
): number {
  const c = (currency || "EUR").toUpperCase();
  if (c === "EUR") return 1;
  const fromSeries = closeOnOrBefore(fxSeriesByCurrency.get(c) ?? new Map(), targetIso);
  if (fromSeries != null && fromSeries > 0) return fromSeries;
  return staticFallback[c] ?? 0;
}

const FX_STATIC_FALLBACK: Record<string, number> = {
  USD: 0.92,
  GBP: 1.17,
  SEK: 0.088,
};

export type PortfolioValuationInputs = {
  assets: Asset[];
  cashEur: number;
  symbolCloses: Map<string, DailySeries>;
  quoteCurrencies: Record<string, string>;
  fxSeriesByCurrency: Map<string, DailySeries>;
};

export function computePortfolioTotalEurOnDate(
  asOfDate: string,
  inputs: PortfolioValuationInputs
): number | null {
  if (!parseIsoDateOnly(asOfDate)) return null;

  const exchangeRates: Record<string, number> = { EUR: 1 };
  const currencies = new Set<string>(["EUR"]);
  for (const asset of inputs.assets) {
    const qc = (inputs.quoteCurrencies[asset.symbol] || asset.currency || "EUR").toUpperCase();
    currencies.add(qc);
    currencies.add((asset.currency || "EUR").toUpperCase());
  }
  for (const c of currencies) {
    if (c === "EUR") continue;
    const rate = fxRateOnDate(c, asOfDate, inputs.fxSeriesByCurrency, FX_STATIC_FALLBACK);
    if (!(rate > 0)) return null;
    exchangeRates[c] = rate;
  }

  let holdingsEur = 0;
  for (const asset of inputs.assets) {
    const series = inputs.symbolCloses.get(asset.symbol);
    const close = series ? closeOnOrBefore(series, asOfDate) : null;
    const price = close ?? (asset.averagePrice > 0 ? asset.averagePrice : null);
    if (price == null || !Number.isFinite(price)) return null;
    const priceFx = holdingQuoteFxToEur(
      asset.symbol,
      asset.currency,
      inputs.quoteCurrencies,
      exchangeRates
    );
    if (!(priceFx > 0)) return null;
    holdingsEur += asset.quantity * price * priceFx;
  }

  return Math.round((holdingsEur + inputs.cashEur) * 100) / 100;
}

export async function buildPortfolioValuationInputs(
  yahooFinance: YahooFinanceLike,
  dates: string[]
): Promise<PortfolioValuationInputs> {
  const assets = loadPortfolioAssets();
  const cashEur = loadCashEur();
  const bounds = periodBoundsForDates(dates);
  const symbolCloses = new Map<string, DailySeries>();
  const quoteCurrencies: Record<string, string> = {};

  if (bounds && assets.length > 0) {
    await Promise.all(
      assets.map(async (asset) => {
        const { series, quoteCurrency } = await fetchSymbolSeries(
          yahooFinance,
          asset.symbol,
          bounds.period1,
          bounds.period2
        );
        symbolCloses.set(asset.symbol, series);
        if (quoteCurrency) quoteCurrencies[asset.symbol] = quoteCurrency;
      })
    );
  }

  const fxCurrencies = new Set<string>();
  for (const asset of assets) {
    fxCurrencies.add((quoteCurrencies[asset.symbol] || asset.currency || "EUR").toUpperCase());
    fxCurrencies.add((asset.currency || "EUR").toUpperCase());
  }
  fxCurrencies.delete("EUR");

  const fxSeriesByCurrency = new Map<string, DailySeries>();
  if (bounds) {
    await Promise.all(
      [...fxCurrencies].map(async (c) => {
        const series = await fetchFxSeries(yahooFinance, c, bounds.period1, bounds.period2);
        fxSeriesByCurrency.set(c, series);
      })
    );
  }

  return { assets, cashEur, symbolCloses, quoteCurrencies, fxSeriesByCurrency };
}

export async function computePortfolioTotalsForDates(
  yahooFinance: YahooFinanceLike,
  dates: string[]
): Promise<Map<string, number>> {
  const unique = [...new Set(dates.filter((d) => parseIsoDateOnly(d)))].sort();
  const out = new Map<string, number>();
  if (unique.length === 0) return out;

  const inputs = await buildPortfolioValuationInputs(yahooFinance, unique);
  if (inputs.assets.length === 0 && inputs.cashEur <= 0) return out;

  for (const date of unique) {
    const total = computePortfolioTotalEurOnDate(date, inputs);
    if (total != null && total > 0) out.set(date, total);
  }
  return out;
}
