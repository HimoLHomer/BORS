import { describe, expect, it } from 'vitest';
import {
  cashOnDate,
  computePortfolioTotalEurOnDate,
  holdingsOnDate,
  type PortfolioValuationInputs,
} from './portfolioValuation';
import type { Asset } from '../src/types';

const asset = (symbol: string, quantity: number, averagePrice = 10, currency = 'EUR'): Asset =>
  ({ id: symbol, symbol, name: symbol, type: 'stock', quantity, averagePrice, currency }) as Asset;

function inputs(over: Partial<PortfolioValuationInputs> = {}): PortfolioValuationInputs {
  return {
    assets: [asset('AAA', 10)],
    cashEur: 1000,
    assetFlows: [],
    cashFlows: [],
    symbolCloses: new Map([['AAA', new Map([['2026-10-01', 100], ['2026-10-05', 110]])]]),
    failedSymbols: new Set(),
    quoteCurrencies: { AAA: 'EUR' },
    fxSeriesByCurrency: new Map(),
    ...over,
  };
}

describe('backfill valuation', () => {
  it("undoes later cash deposits instead of applying today's cash to past days", () => {
    const i = inputs({ cashFlows: [{ date: '2026-10-06', amountEur: 900 }] });
    expect(cashOnDate('2026-10-05', i)).toBe(100);
    expect(computePortfolioTotalEurOnDate('2026-10-05', i)).toBe(10 * 110 + 100);
    // A flow on the day itself is part of that day's closing value.
    expect(cashOnDate('2026-10-06', i)).toBe(1000);
  });

  it('removes a holding bought after the day, and restores one sold after it', () => {
    const i = inputs({
      assets: [asset('AAA', 10)],
      symbolCloses: new Map([
        ['AAA', new Map([['2026-10-01', 100]])],
        ['BBB', new Map([['2026-10-01', 50], ['2026-10-04', 40]])],
      ]),
      quoteCurrencies: { AAA: 'EUR', BBB: 'EUR' },
      assetFlows: [
        { date: '2026-10-04', amountEur: -400, symbol: 'BBB', note: 'Sold (holding removed)' },
        { date: '2026-10-03', amountEur: 1000, symbol: 'AAA', note: 'New holding' },
      ],
    });
    const before = holdingsOnDate('2026-10-02', i)!;
    expect(before.get('AAA')!.shares).toBe(0);
    expect(before.get('BBB')!.shares).toBeCloseTo(10);
    expect(computePortfolioTotalEurOnDate('2026-10-02', i)).toBe(10 * 50 + 1000);
  });

  it('turns a later partial purchase into shares at that day’s close', () => {
    const i = inputs({ assetFlows: [{ date: '2026-10-05', amountEur: 220, symbol: 'AAA', note: 'Purchase' }] });
    expect(holdingsOnDate('2026-10-02', i)!.get('AAA')!.shares).toBeCloseTo(8);
  });

  it('skips the day when a price fetch failed instead of using the purchase price', () => {
    const i = inputs({ failedSymbols: new Set(['AAA']) });
    expect(computePortfolioTotalEurOnDate('2026-10-05', i)).toBeNull();
  });

  it('skips the day when an FX rate is missing instead of guessing one', () => {
    const i = inputs({ quoteCurrencies: { AAA: 'USD' } });
    expect(computePortfolioTotalEurOnDate('2026-10-05', i)).toBeNull();
    const withFx = inputs({
      quoteCurrencies: { AAA: 'USD' },
      fxSeriesByCurrency: new Map([['USD', new Map([['2026-10-05', 0.9]])]]),
    });
    expect(computePortfolioTotalEurOnDate('2026-10-05', withFx)).toBe(10 * 110 * 0.9 + 1000);
  });

  it('values a holding without any Yahoo closes at its purchase price', () => {
    const i = inputs({ symbolCloses: new Map([['AAA', new Map()]]) });
    expect(computePortfolioTotalEurOnDate('2026-10-05', i)).toBe(10 * 10 + 1000);
  });
});
