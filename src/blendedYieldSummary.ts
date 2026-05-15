import type { Asset } from './types';
import type { ManualDividendPosition } from './manualDividends';

export type DividendRowForYield = {
  estimatedAnnualIncomeEur: number;
  error: boolean;
};

export type BlendedYieldSummary = {
  totalAnnualEur: number;
  avgYieldPercent: number;
};

function isDividendPayer(r: DividendRowForYield): boolean {
  if (r.error) return false;
  return Number.isFinite(r.estimatedAnnualIncomeEur) && r.estimatedAnnualIncomeEur > 0;
}

function fxToEur(currency: string | undefined, exchangeRates: Record<string, number>): number {
  const c = (currency || 'EUR').toUpperCase();
  if (c === 'EUR') return 1;
  return exchangeRates[c] ?? exchangeRates[currency ?? ''] ?? 0;
}

function assetPositionValueEur(
  a: Asset,
  marketPrices: Record<string, number>,
  exchangeRates: Record<string, number>
): number {
  const px = marketPrices[a.symbol] ?? a.averagePrice;
  const fx = fxToEur(a.currency, exchangeRates);
  const v = a.quantity * px * fx;
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

function shortSymbolKey(sym: string): string {
  const s = sym.trim().toUpperCase();
  return s.includes('.') ? (s.split('.')[0] ?? s) : s;
}

function assetsMatchingLink(assets: Asset[], linkedSymbol: string | null): Asset[] {
  if (!linkedSymbol?.trim()) return [];
  const t = linkedSymbol.trim().toUpperCase();
  const base = shortSymbolKey(t);
  return assets.filter((a) => {
    const sym = a.symbol?.trim().toUpperCase() ?? '';
    const disp = a.displaySymbol != null ? String(a.displaySymbol).trim().toUpperCase() : '';
    return (
      sym === t ||
      disp === t ||
      shortSymbolKey(sym) === base ||
      (disp !== '' && shortSymbolKey(disp) === base)
    );
  });
}

function effectiveManualDenominatorEur(
  m: ManualDividendPosition,
  assets: Asset[],
  marketPrices: Record<string, number>,
  exchangeRates: Record<string, number>
): number | null {
  const linked = assetsMatchingLink(assets, m.linkedSymbol);
  if (linked.length) {
    const v = linked.reduce((s, a) => s + assetPositionValueEur(a, marketPrices, exchangeRates), 0);
    return v > 0 ? v : null;
  }
  if (m.notionalValueEur != null && m.notionalValueEur > 0) return m.notionalValueEur;
  return null;
}

/** Same formula as Dividends Engine “Average yield (blended)” card — only dividend-paying lines in the API denominator. */
export function computeBlendedYieldSummary(
  assets: Asset[],
  rows: DividendRowForYield[],
  manualRows: ManualDividendPosition[],
  marketPrices: Record<string, number>,
  exchangeRates: Record<string, number>
): BlendedYieldSummary {
  const dividendPayingRows = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => isDividendPayer(row));

  let apiAnnualEur = 0;
  let apiValueEur = 0;
  for (const { row, index } of dividendPayingRows) {
    apiAnnualEur += row.estimatedAnnualIncomeEur;
    const a = assets[index];
    if (a) {
      apiValueEur += assetPositionValueEur(a, marketPrices, exchangeRates);
    }
  }

  const apiYieldPercent = apiValueEur > 0 ? (apiAnnualEur / apiValueEur) * 100 : 0;

  const manualAnnualSum = manualRows.reduce(
    (s, m) => s + (Number.isFinite(m.annualIncomeEur) ? m.annualIncomeEur : 0),
    0
  );
  const manualDenominatorSum = manualRows.reduce((s, m) => {
    const d = effectiveManualDenominatorEur(m, assets, marketPrices, exchangeRates);
    return s + (d != null && Number.isFinite(d) ? d : 0);
  }, 0);

  const totalAnnualEur = Math.round((apiAnnualEur + manualAnnualSum) * 100) / 100;
  const denom = apiValueEur + manualDenominatorSum;
  const avgYieldPercent =
    denom > 0
      ? Math.round(((totalAnnualEur / denom) * 100) * 100) / 100
      : Math.round(apiYieldPercent * 100) / 100;

  return { totalAnnualEur, avgYieldPercent };
}
