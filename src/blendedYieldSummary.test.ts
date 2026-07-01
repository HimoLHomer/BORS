import { describe, expect, it } from 'vitest';
import { computeBlendedYieldSummary } from './blendedYieldSummary';
import type { Asset } from './types';

describe('computeBlendedYieldSummary', () => {
  const assets: Asset[] = [
    {
      id: '1',
      symbol: 'TEST.EUR',
      name: 'Test',
      type: 'stock',
      quantity: 100,
      averagePrice: 10,
      currency: 'EUR',
      updatedAt: '2026-01-01',
    },
  ];

  it('computes yield and capital base from dividend income and holding value', () => {
    const summary = computeBlendedYieldSummary(
      assets,
      [{ symbol: 'TEST.EUR', estimatedAnnualIncomeEur: 50, error: false }],
      [],
      { 'TEST.EUR': 10 },
      { EUR: 1 }
    );
    expect(summary.totalAnnualEur).toBe(50);
    expect(summary.capitalBaseEur).toBe(1000);
    expect(summary.avgYieldPercent).toBe(5);
  });
});
