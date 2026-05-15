import { FI_LOCALE } from './formatNumber';

/** FX rate to EUR (Yahoo `USDEUR=X` style: multiply amount in `currency` to get EUR). */
export function fxToEur(currency: string | undefined, exchangeRates: Record<string, number>): number {
  const c = (currency || 'EUR').toUpperCase();
  if (c === 'EUR') return 1;
  return exchangeRates[c] ?? 0;
}

/** Live quote currency when known (e.g. SEK for `.ST`), else the holding's book currency. */
export function holdingQuoteFxToEur(
  symbol: string,
  assetCurrency: string,
  quoteCurrencies: Record<string, string>,
  exchangeRates: Record<string, number>
): number {
  const quoteCcy = (quoteCurrencies[symbol] || assetCurrency || 'EUR').toUpperCase();
  const qFx = fxToEur(quoteCcy, exchangeRates);
  if (qFx > 0) return qFx;
  const aFx = fxToEur(assetCurrency, exchangeRates);
  return aFx > 0 ? aFx : 1;
}

/** Finnish currency display (e.g. `1 234,56 €`). */
export function formatCurrency(value: number, currency: string = 'EUR'): string {
  if (!Number.isFinite(value)) {
    return new Intl.NumberFormat(FI_LOCALE, {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(0);
  }
  return new Intl.NumberFormat(FI_LOCALE, {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
