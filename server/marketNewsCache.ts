import type { MarketTopStory } from "../src/marketTopStories";

export type MarketNewsResult = {
  stories: MarketTopStory[];
  marketDate: string;
  asOf: string;
  cached: boolean;
};

type CacheEntry = {
  marketDate: string;
  result: Omit<MarketNewsResult, "cached">;
};

const cache = new Map<string, CacheEntry>();

export function marketNewsCacheKey(parts: { variant: string; marketDate: string }): string {
  return `v8-recency|${parts.variant}|${parts.marketDate}`;
}

export function getCachedMarketNews(key: string, marketDate: string): MarketNewsResult | null {
  const entry = cache.get(key);
  if (!entry || entry.marketDate !== marketDate) {
    if (entry) cache.delete(key);
    return null;
  }
  return { ...entry.result, cached: true };
}

export function setCachedMarketNews(
  key: string,
  marketDate: string,
  result: Omit<MarketNewsResult, "cached">
): void {
  cache.set(key, { marketDate, result });
}

export function clearMarketNewsCache(): void {
  cache.clear();
}
