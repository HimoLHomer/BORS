import type { Asset } from './types';
import { computeBlendedYieldSummary, type DividendRowForYield } from './blendedYieldSummary';
import { saveBlendedYieldCache } from './blendedYieldCache';
import { loadManualDividendPositions } from './manualDividends';

type PortfolioDividendsResponse = {
  rows: DividendRowForYield[];
  rates?: Record<string, number>;
};

/** Fetch dividends via the same API as Dividends Engine and compute blended yield. */
export async function fetchBlendedDividendYieldPercent(
  assets: Asset[],
  marketPrices: Record<string, number>,
  exchangeRates: Record<string, number>
): Promise<{ avgYieldPercent: number; totalAnnualEur: number }> {
  const manualRows = loadManualDividendPositions();

  if (assets.length === 0) {
    const summary = computeBlendedYieldSummary(
      assets,
      [],
      manualRows,
      marketPrices,
      exchangeRates
    );
    if (summary.avgYieldPercent > 0) {
      saveBlendedYieldCache({
        avgYieldPercent: summary.avgYieldPercent,
        totalAnnualEur: summary.totalAnnualEur,
      });
    }
    return summary;
  }

  const holdings = assets.map((a) => ({
    symbol: a.symbol,
    displaySymbol: a.displaySymbol ?? null,
    quantity: a.quantity,
    currency: a.currency,
    livePrice: marketPrices[a.symbol],
    averagePrice: a.averagePrice,
  }));

  const res = await fetch('/api/portfolio/dividends', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ holdings, baseCurrency: 'EUR' }),
    cache: 'no-store',
  });

  const raw = await res.text();
  let payload: PortfolioDividendsResponse = { rows: [] };
  try {
    payload = JSON.parse(raw) as PortfolioDividendsResponse;
  } catch {
    return { avgYieldPercent: 0, totalAnnualEur: 0 };
  }

  if (!res.ok || !Array.isArray(payload.rows)) {
    return { avgYieldPercent: 0, totalAnnualEur: 0 };
  }

  const rates: Record<string, number> = {
    EUR: 1,
    ...exchangeRates,
    ...(payload.rates ?? {}),
  };

  const summary = computeBlendedYieldSummary(
    assets,
    payload.rows,
    manualRows,
    marketPrices,
    rates
  );

  if (summary.avgYieldPercent > 0) {
    saveBlendedYieldCache({
      avgYieldPercent: summary.avgYieldPercent,
      totalAnnualEur: summary.totalAnnualEur,
    });
  }

  return summary;
}
