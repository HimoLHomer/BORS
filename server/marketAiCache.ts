const CACHE_TTL_MS = 10 * 60 * 1000;
/** Bump when prompt contract changes so stale results are not reused. */
const CACHE_PROMPT_VERSION = "v14-sanitize-story-fields";

type CacheEntry = {
  expiresAt: number;
  result: import("./ai/types").MarketSummaryResult;
};

const cache = new Map<string, CacheEntry>();

export function marketAiCacheKey(parts: {
  variant: string;
  marketDate: string;
}): string {
  return [CACHE_PROMPT_VERSION, parts.variant, parts.marketDate].join("|");
}

export function getCachedMarketSummary(key: string): import("./ai/types").MarketSummaryResult | null {
  const entry = cache.get(key);
  if (!entry || Date.now() > entry.expiresAt) {
    if (entry) cache.delete(key);
    return null;
  }
  return { ...entry.result, cached: true };
}

export function setCachedMarketSummary(
  key: string,
  result: import("./ai/types").MarketSummaryResult
): void {
  cache.set(key, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    result,
  });
}
