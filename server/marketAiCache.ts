import { createHash } from "node:crypto";
import type { AiProviderId } from "./ai/types";
import type { MarketSummaryResult } from "./ai/types";

const CACHE_TTL_MS = 10 * 60 * 1000;
/** Bump when prompt contract changes so stale vague summaries are not reused. */
const CACHE_PROMPT_VERSION = "v7";

type CacheEntry = {
  expiresAt: number;
  result: MarketSummaryResult;
};

const cache = new Map<string, CacheEntry>();

export function marketAiCacheKey(parts: {
  provider: AiProviderId;
  variant: string;
  marketDate: string;
  changePercent: number;
  label: string;
  moversFingerprint: string;
}): string {
  const changeBucket = (Math.round(parts.changePercent * 100) / 100).toFixed(2);
  return [
    CACHE_PROMPT_VERSION,
    parts.provider,
    parts.variant,
    parts.marketDate,
    changeBucket,
    parts.label.trim().toUpperCase(),
    parts.moversFingerprint,
  ].join("|");
}

export function moversFingerprint(
  gainers: { symbol: string; changePercent: number }[],
  losers: { symbol: string; changePercent: number }[]
): string {
  const payload = JSON.stringify({ gainers, losers });
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

export function getCachedMarketSummary(key: string): MarketSummaryResult | null {
  const entry = cache.get(key);
  if (!entry || Date.now() > entry.expiresAt) {
    if (entry) cache.delete(key);
    return null;
  }
  return { ...entry.result, cached: true };
}

export function setCachedMarketSummary(key: string, result: MarketSummaryResult): void {
  cache.set(key, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    result: { ...result, cached: false },
  });
}
