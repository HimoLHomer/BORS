import type { AiProviderId } from "./ai/types";

const CACHE_TTL_MS = 10 * 60 * 1000;
/** Bump when prompt contract changes so stale results are not reused. */
const CACHE_PROMPT_VERSION = "v8-top-stories";

type CacheEntry = {
  expiresAt: number;
  result: import("./ai/types").MarketSummaryResult;
};

const cache = new Map<string, CacheEntry>();

export function marketAiCacheKey(parts: {
  provider: AiProviderId;
  variant: string;
  marketDate: string;
}): string {
  return [
    CACHE_PROMPT_VERSION,
    parts.provider,
    parts.variant,
    parts.marketDate,
  ].join("|");
}

/** @deprecated Top-stories cache no longer keys on movers. */
export function moversFingerprint(
  gainers: { symbol: string; changePercent: number }[],
  losers: { symbol: string; changePercent: number }[]
): string {
  const payload = JSON.stringify({ gainers, losers });
  return payload.length > 0 ? "legacy" : "";
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
    result: { ...result, cached: false },
  });
}
