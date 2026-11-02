import type YahooFinance from "yahoo-finance2";

type YahooClient = InstanceType<typeof YahooFinance>;

/** EUR per 1 unit of currency, e.g. { USD: 0.86 }. */
export type EurRates = Record<string, number>;

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { rate: number; at: number }>();

/** Seed the cache from rates already fetched elsewhere (e.g. /api/quotes). */
export function rememberEurRates(rates: EurRates): void {
  const now = Date.now();
  for (const [cur, rate] of Object.entries(rates)) {
    if (cur !== "EUR" && typeof rate === "number" && rate > 0) cache.set(cur.toUpperCase(), { rate, at: now });
  }
}

async function fetchEurRate(yahooFinance: YahooClient, cur: string): Promise<number | undefined> {
  try {
    const direct: any = await yahooFinance.quote(`${cur}EUR=X`);
    if (typeof direct?.regularMarketPrice === "number" && direct.regularMarketPrice > 0) {
      return direct.regularMarketPrice;
    }
  } catch {
    /* try inverse */
  }
  try {
    const inverse: any = await yahooFinance.quote(`EUR${cur}=X`);
    if (typeof inverse?.regularMarketPrice === "number" && inverse.regularMarketPrice > 0) {
      return 1 / inverse.regularMarketPrice;
    }
  } catch {
    /* unavailable */
  }
  return undefined;
}

/**
 * Current EUR rates for the given currencies (cached for 10 minutes). Currencies whose rate
 * cannot be fetched are left out, so callers can tell "unknown" from a real rate.
 */
export async function getEurRates(
  yahooFinance: YahooClient | undefined,
  currencies: (string | undefined)[]
): Promise<EurRates> {
  const out: EurRates = { EUR: 1 };
  const now = Date.now();
  const wanted = [...new Set(currencies.map((c) => (c || "EUR").toUpperCase()))].filter((c) => c !== "EUR");
  await Promise.all(
    wanted.map(async (cur) => {
      const hit = cache.get(cur);
      if (hit && now - hit.at < CACHE_TTL_MS) {
        out[cur] = hit.rate;
        return;
      }
      const rate = yahooFinance ? await fetchEurRate(yahooFinance, cur) : undefined;
      if (rate != null) {
        cache.set(cur, { rate, at: now });
        out[cur] = rate;
      } else if (hit) {
        out[cur] = hit.rate; // stale beats none
      }
    })
  );
  return out;
}
