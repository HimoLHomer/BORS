import type { Asset } from "../src/types";
import { NEW_HOLDING_NOTE, TRANSFER_IN_NOTE } from "../src/flowNotes";
import { parseIsoDateOnly, todayIsoDateHelsinki } from "../src/formatDate";
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

/** A buy or sell logged after some day, used to step holdings back from today. */
export type AssetFlow = { date: string; amountEur: number; symbol: string; note: string | null };
/** A cash deposit (+) or withdrawal (−). */
export type CashFlow = { date: string; amountEur: number };

/** Buys/sells and cash changes dated after `afterDate`, newest first. */
function loadFlowsAfter(afterDate: string): { assetFlows: AssetFlow[]; cashFlows: CashFlow[] } {
  const rows = getPortfolioDb()
    .prepare(
      `SELECT date, amount_eur, kind, asset_symbol, note FROM portfolio_flows
       WHERE date > ? ORDER BY date DESC, id DESC`
    )
    .all(afterDate) as {
    date: string;
    amount_eur: number;
    kind: string;
    asset_symbol: string | null;
    note: string | null;
  }[];
  const assetFlows: AssetFlow[] = [];
  const cashFlows: CashFlow[] = [];
  for (const r of rows) {
    if (!Number.isFinite(r.amount_eur)) continue;
    if (r.kind === "cash") {
      cashFlows.push({ date: r.date, amountEur: r.amount_eur });
    } else if ((r.kind === "buy" || r.kind === "sell") && r.asset_symbol?.trim()) {
      assetFlows.push({ date: r.date, amountEur: r.amount_eur, symbol: r.asset_symbol.trim(), note: r.note });
    }
  }
  return { assetFlows, cashFlows };
}

function periodBounds(minIso: string, maxIso: string): { period1: Date; period2: Date } | null {
  const min = parseIsoDateOnly(minIso);
  const max = parseIsoDateOnly(maxIso);
  if (!min || !max) return null;
  const period1 = new Date(min.getTime());
  period1.setUTCDate(period1.getUTCDate() - 7);
  const period2 = new Date(max.getTime());
  period2.setUTCDate(period2.getUTCDate() + 1);
  return { period1, period2 };
}

/** `ok: false` when the request failed, as opposed to Yahoo returning no closes. */
async function fetchSymbolSeries(
  yahooFinance: YahooFinanceLike,
  symbol: string,
  period1: Date,
  period2: Date
): Promise<{ ok: boolean; series: DailySeries; quoteCurrency: string | null }> {
  try {
    const chart = await yahooFinance.chart(
      symbol,
      { period1, period2, interval: "1d" },
      { validateResult: false }
    );
    if (!chart) return { ok: false, series: new Map(), quoteCurrency: null };
    const currency = chart.meta?.currency
      ? String(chart.meta.currency).toUpperCase()
      : null;
    return { ok: true, series: quotesToDailySeries(chart.quotes), quoteCurrency: currency };
  } catch {
    return { ok: false, series: new Map(), quoteCurrency: null };
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

export type PortfolioValuationInputs = {
  /** Current holdings and cash: the starting point later flows are undone from. */
  assets: Asset[];
  cashEur: number;
  /** Buys/sells dated after the earliest valued day, newest first. */
  assetFlows: AssetFlow[];
  /** Cash deposits/withdrawals dated after the earliest valued day. */
  cashFlows: CashFlow[];
  symbolCloses: Map<string, DailySeries>;
  /** Symbols whose price history could not be fetched: days that need them are not valued. */
  failedSymbols: Set<string>;
  quoteCurrencies: Record<string, string>;
  fxSeriesByCurrency: Map<string, DailySeries>;
};

/** EUR per unit of `currency` on `date`, or 0 when no rate is known (never a guessed rate). */
function fxOnDate(currency: string, date: string, inputs: PortfolioValuationInputs): number {
  const c = (currency || "EUR").toUpperCase();
  if (c === "EUR") return 1;
  const rate = closeOnOrBefore(inputs.fxSeriesByCurrency.get(c) ?? new Map(), date);
  return rate != null && rate > 0 ? rate : 0;
}

/** One share's close in EUR on `date`, or null when the close or FX rate is unknown. */
function sharePriceEurOnDate(
  symbol: string,
  date: string,
  inputs: PortfolioValuationInputs,
  assetCurrency: string
): number | null {
  if (inputs.failedSymbols.has(symbol)) return null;
  const close = closeOnOrBefore(inputs.symbolCloses.get(symbol) ?? new Map(), date);
  if (close == null) return null;
  const fx = fxOnDate(inputs.quoteCurrencies[symbol] || assetCurrency, date, inputs);
  return fx > 0 ? close * fx : null;
}

export type HoldingPosition = {
  shares: number;
  /** Separate holdings of this symbol (duplicate tickers are allowed). */
  lots: number;
  /** Average purchase price, for symbols Yahoo has no closes for. */
  costPerShare: number;
  costCurrency: string;
};

/**
 * Holdings at the end of `asOfDate`: today's holdings with every later buy and sale undone. A
 * buy or sale becomes shares at that day's close; a new holding (or transfer in) is taken out
 * whole when it is the symbol's only lot. Null when a flow's day has no price.
 */
export function holdingsOnDate(
  asOfDate: string,
  inputs: PortfolioValuationInputs
): Map<string, HoldingPosition> | null {
  const positions = new Map<string, HoldingPosition>();
  for (const a of inputs.assets) {
    const symbol = a.symbol?.trim();
    const qty = Number(a.quantity);
    if (!symbol || !Number.isFinite(qty) || qty <= 0) continue;
    const p = positions.get(symbol) ?? { shares: 0, lots: 0, costPerShare: 0, costCurrency: a.currency || "EUR" };
    const cost = p.shares * p.costPerShare + qty * (a.averagePrice > 0 ? a.averagePrice : 0);
    p.shares += qty;
    p.lots += 1;
    p.costPerShare = cost / p.shares;
    positions.set(symbol, p);
  }

  for (const f of inputs.assetFlows) {
    if (f.date <= asOfDate) continue;
    const p = positions.get(f.symbol) ?? { shares: 0, lots: 0, costPerShare: 0, costCurrency: "EUR" };
    const opensHolding = f.amountEur > 0 && (f.note === NEW_HOLDING_NOTE || f.note === TRANSFER_IN_NOTE);
    if (opensHolding && p.lots <= 1) {
      p.shares = 0;
      p.lots = 0;
    } else {
      const price = sharePriceEurOnDate(f.symbol, f.date, inputs, p.costCurrency);
      if (price == null || !(price > 0)) return null;
      // Undo the flow: a buy added shares, a sale (negative amount) took them away.
      p.shares = Math.max(0, p.shares - f.amountEur / price);
      if (opensHolding) p.lots -= 1;
      else if (f.amountEur < 0 && p.lots === 0) p.lots = 1;
    }
    positions.set(f.symbol, p);
  }
  return positions;
}

/** Cash at the end of `asOfDate`: today's cash with later deposits and withdrawals undone. */
export function cashOnDate(asOfDate: string, inputs: PortfolioValuationInputs): number {
  const later = inputs.cashFlows.reduce((s, f) => (f.date > asOfDate ? s + f.amountEur : s), 0);
  return Math.max(0, inputs.cashEur - later);
}

/**
 * Portfolio value in EUR at the end of `asOfDate`, from that day's closes and FX rates. Null
 * when a needed price or rate is missing, so the day stays empty and is retried later instead of
 * being stored with a guess. A holding Yahoo has no closes for (the fetch itself succeeded) is
 * valued at its average purchase price, as on the dashboard.
 */
export function computePortfolioTotalEurOnDate(
  asOfDate: string,
  inputs: PortfolioValuationInputs
): number | null {
  if (!parseIsoDateOnly(asOfDate)) return null;
  const positions = holdingsOnDate(asOfDate, inputs);
  if (!positions) return null;

  let holdingsEur = 0;
  for (const [symbol, p] of positions) {
    if (!(p.shares > 1e-9)) continue;
    if (inputs.failedSymbols.has(symbol)) return null;
    const price = sharePriceEurOnDate(symbol, asOfDate, inputs, p.costCurrency);
    if (price != null) {
      holdingsEur += p.shares * price;
      continue;
    }
    const hasCloses = (inputs.symbolCloses.get(symbol)?.size ?? 0) > 0;
    if (hasCloses || !(p.costPerShare > 0)) return null;
    const fx = fxOnDate(p.costCurrency, asOfDate, inputs);
    if (!(fx > 0)) return null;
    holdingsEur += p.shares * p.costPerShare * fx;
  }

  return Math.round((holdingsEur + cashOnDate(asOfDate, inputs)) * 100) / 100;
}

export async function buildPortfolioValuationInputs(
  yahooFinance: YahooFinanceLike,
  dates: string[]
): Promise<PortfolioValuationInputs> {
  const assets = loadPortfolioAssets();
  const cashEur = loadCashEur();
  const sorted = dates.filter((d) => parseIsoDateOnly(d)).sort();
  const earliest = sorted[0];
  const { assetFlows, cashFlows } = earliest ? loadFlowsAfter(earliest) : { assetFlows: [], cashFlows: [] };
  const symbolCloses = new Map<string, DailySeries>();
  const failedSymbols = new Set<string>();
  const quoteCurrencies: Record<string, string> = {};

  // Later buys and sales are priced on their own days, so closes then reach today.
  const latest = assetFlows.length > 0 ? todayIsoDateHelsinki() : sorted[sorted.length - 1];
  const bounds = earliest && latest ? periodBounds(earliest, latest) : null;
  const symbols = new Set<string>([
    ...assets.map((a) => a.symbol?.trim()).filter((s): s is string => !!s),
    ...assetFlows.map((f) => f.symbol),
  ]);

  if (bounds) {
    await Promise.all(
      [...symbols].map(async (symbol) => {
        const { ok, series, quoteCurrency } = await fetchSymbolSeries(
          yahooFinance,
          symbol,
          bounds.period1,
          bounds.period2
        );
        if (!ok) failedSymbols.add(symbol);
        symbolCloses.set(symbol, series);
        if (quoteCurrency) quoteCurrencies[symbol] = quoteCurrency;
      })
    );
  }

  const fxCurrencies = new Set<string>();
  for (const asset of assets) {
    fxCurrencies.add((quoteCurrencies[asset.symbol] || asset.currency || "EUR").toUpperCase());
    fxCurrencies.add((asset.currency || "EUR").toUpperCase());
  }
  for (const f of assetFlows) fxCurrencies.add((quoteCurrencies[f.symbol] || "EUR").toUpperCase());
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

  return {
    assets,
    cashEur,
    assetFlows,
    cashFlows,
    symbolCloses,
    failedSymbols,
    quoteCurrencies,
    fxSeriesByCurrency,
  };
}

export async function computePortfolioTotalsForDates(
  yahooFinance: YahooFinanceLike,
  dates: string[]
): Promise<Map<string, number>> {
  const unique = [...new Set(dates.filter((d) => parseIsoDateOnly(d)))].sort();
  const out = new Map<string, number>();
  if (unique.length === 0) return out;

  const inputs = await buildPortfolioValuationInputs(yahooFinance, unique);
  const nothingHeld =
    inputs.assets.length === 0 && inputs.cashEur <= 0 && inputs.assetFlows.length === 0 && inputs.cashFlows.length === 0;
  if (nothingHeld) return out;

  for (const date of unique) {
    const total = computePortfolioTotalEurOnDate(date, inputs);
    if (total != null && total > 0) out.set(date, total);
  }
  return out;
}
