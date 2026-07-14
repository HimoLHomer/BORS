/** In-memory cache for Yahoo dividend fundamentals (per listing symbol). */

const CACHE_TTL_MS = 30 * 60 * 1000;

export type CachedDividendBundle = {
  divSym: string;
  sum: Record<string, unknown>;
  divList: { date?: Date | string; amount?: number }[];
  fundQuote: unknown;
  listQuote: unknown;
};

type Entry = { expiresAt: number; value: CachedDividendBundle };

const cache = new Map<string, Entry>();

export function dividendFetchCacheKey(sym: string, displaySymbol?: string | null): string {
  return `${sym.trim()}|${(displaySymbol ?? '').trim()}`;
}

export function getCachedDividendBundle(key: string): CachedDividendBundle | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

export function setCachedDividendBundle(key: string, value: CachedDividendBundle): void {
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
}

/** Strong chart + trailing rate — skip remaining UCITS fallback tickers. */
export const DIVIDEND_BUNDLE_SCORE_GOOD_ENOUGH = 7;

/** ~14 months of daily bars — enough for trailing 12m distributions. */
export const DIVIDEND_CHART_LOOKBACK_DAYS = 420;
