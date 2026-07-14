import type { Asset } from './types';

/** Dividends API payload shape (mirrors DividendsEngine). */
export type DividendsPayloadCache = {
  rows: unknown[];
  totalAnnualIncomeEur: number;
  totalHoldingsValueEur: number;
  averagePortfolioYieldPercent: number;
  rates?: Record<string, number>;
};

const CACHE_TTL_MS = 15 * 60 * 1000;

let cache: {
  key: string;
  payload: DividendsPayloadCache;
  fetchedAt: number;
} | null = null;

export function dividendsHoldingsKey(assets: Asset[]): string {
  return assets
    .map((a) => `${a.symbol}:${a.quantity}:${a.displaySymbol?.trim() ?? ''}:${a.currency}`)
    .join('|');
}

export function readDividendsPayloadCache(key: string): {
  payload: DividendsPayloadCache;
  fetchedAt: number;
  fresh: boolean;
} | null {
  if (!cache || cache.key !== key) return null;
  return {
    payload: cache.payload,
    fetchedAt: cache.fetchedAt,
    fresh: Date.now() - cache.fetchedAt < CACHE_TTL_MS,
  };
}

export function writeDividendsPayloadCache(key: string, payload: DividendsPayloadCache): void {
  cache = { key, payload, fetchedAt: Date.now() };
}

export const DIVIDENDS_PAYLOAD_CACHE_TTL_MS = CACHE_TTL_MS;
