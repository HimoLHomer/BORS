import type YahooFinance from "yahoo-finance2";
import type { Asset } from "../src/types";
import { getEurRates } from "./fxRates";

type YahooClient = InstanceType<typeof YahooFinance>;

/**
 * Today's market value in EUR of `quantity` shares of a holding, from a live Yahoo quote.
 * Returns null when no price or rate is available (offline, unknown symbol).
 */
export async function holdingMarketValueEur(
  yahooFinance: YahooClient | undefined,
  asset: Pick<Asset, "symbol" | "currency">,
  quantity: number
): Promise<number | null> {
  if (!yahooFinance || !asset.symbol?.trim() || !(quantity > 0)) return null;
  try {
    const q: any = await yahooFinance.quote(asset.symbol.trim());
    const price = Number(q?.regularMarketPrice);
    if (!(price > 0)) return null;
    const currency = String(q?.currency || asset.currency || "EUR").toUpperCase();
    const rates = await getEurRates(yahooFinance, [currency]);
    const fx = rates[currency];
    if (!(fx && fx > 0)) return null;
    return quantity * price * fx;
  } catch {
    return null;
  }
}
