import { describe, expect, it } from 'vitest';
import { fxToEur, holdingQuoteFxToEur } from './formatCurrency';

describe('formatCurrency FX helpers', () => {
  const rates = { EUR: 1, USD: 0.92, GBP: 1.17 };

  it('fxToEur returns 1 for EUR', () => {
    expect(fxToEur('EUR', rates)).toBe(1);
  });

  it('fxToEur looks up uppercase currency', () => {
    expect(fxToEur('usd', rates)).toBe(0.92);
  });

  it('holdingQuoteFxToEur prefers live quote currency', () => {
    expect(
      holdingQuoteFxToEur('AAPL', 'EUR', { AAPL: 'USD' }, rates)
    ).toBe(0.92);
  });
});
