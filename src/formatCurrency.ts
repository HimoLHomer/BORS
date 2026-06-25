import { FI_LOCALE } from './formatNumber';

/** FX rate to EUR (Yahoo `USDEUR=X` style: multiply amount in `currency` to get EUR). */
export function fxToEur(currency: string | undefined, exchangeRates: Record<string, number>): number {
  const c = (currency || 'EUR').toUpperCase();
  if (c === 'EUR') return 1;
  return exchangeRates[c] ?? 0;
}

/** Convert `amount` from `fromCurrency` to `toCurrency` via EUR pivot. */
export function convertAmountBetweenCurrencies(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  exchangeRates: Record<string, number>
): number | null {
  if (!Number.isFinite(amount)) return null;
  const from = (fromCurrency || 'EUR').toUpperCase();
  const to = (toCurrency || 'EUR').toUpperCase();
  if (from === to) return amount;
  const fromFx = fxToEur(from, exchangeRates);
  const toFx = fxToEur(to, exchangeRates);
  if (!(fromFx > 0) || !(toFx > 0)) return null;
  return (amount * fromFx) / toFx;
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

/** Currencies that must have FX rates before EUR portfolio totals are trustworthy. */
export function portfolioFxCurrencies(
  assets: { symbol: string; currency: string }[],
  quoteCurrencies: Record<string, string>
): string[] {
  const set = new Set<string>();
  for (const a of assets) {
    set.add((quoteCurrencies[a.symbol] || a.currency || 'EUR').toUpperCase());
    set.add((a.currency || 'EUR').toUpperCase());
  }
  return [...set];
}

/** True when every non-EUR currency used by holdings has a positive rate in `exchangeRates`. */
export function portfolioFxReady(
  assets: { symbol: string; currency: string }[],
  quoteCurrencies: Record<string, string>,
  exchangeRates: Record<string, number>
): boolean {
  for (const c of portfolioFxCurrencies(assets, quoteCurrencies)) {
    if (c === 'EUR') continue;
    const rate = exchangeRates[c];
    if (!(typeof rate === 'number' && rate > 0)) return false;
  }
  return true;
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

/** English currency display (e.g. `€1,234.56`). */
export function formatCurrencyEn(value: number, currency: string = 'EUR'): string {
  const ccy = currency.toUpperCase();
  const opts = {
    style: 'currency' as const,
    currency: ccy,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  };
  if (!Number.isFinite(value)) {
    return new Intl.NumberFormat('en-US', opts).format(0);
  }
  return new Intl.NumberFormat('en-US', opts).format(value);
}
