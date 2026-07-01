import { describe, expect, it } from 'vitest';
import { mergeHoldingPurchase } from './mergeHoldingPurchase';

describe('mergeHoldingPurchase', () => {
  const rates = { EUR: 1, USD: 0.92 };

  it('averages cost when adding shares in same currency', () => {
    const r = mergeHoldingPurchase({
      quantity: 10,
      averagePrice: 100,
      holdingCurrency: 'EUR',
      addQuantity: 10,
      addPricePerUnit: 120,
      addCurrency: 'EUR',
      exchangeRates: rates,
    });
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.quantity).toBe(20);
    expect(r.averagePrice).toBe(110);
  });

  it('rejects non-positive add quantity', () => {
    const r = mergeHoldingPurchase({
      quantity: 10,
      averagePrice: 100,
      holdingCurrency: 'EUR',
      addQuantity: 0,
      addPricePerUnit: 50,
      addCurrency: 'EUR',
      exchangeRates: rates,
    });
    expect(r).toEqual({ error: 'Enter a positive number of shares to add.' });
  });
});
