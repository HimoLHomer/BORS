import { describe, expect, it } from 'vitest';
import {
  normalizeChartResult,
  normalizeHoldingCurrency,
  normalizeQuoteResult,
  normalizeQuoteSummaryResult,
} from './minorCurrency';

describe('normalizeQuoteResult', () => {
  it('converts a pence quote to pounds and fixes the trailing yield', () => {
    const q = normalizeQuoteResult({
      symbol: 'VOD.L',
      currency: 'GBp',
      regularMarketPrice: 117.55,
      regularMarketPreviousClose: 116.85,
      regularMarketChangePercent: 0.6,
      trailingAnnualDividendRate: 0.046,
      trailingAnnualDividendYield: 0.00039,
    });
    expect(q.currency).toBe('GBP');
    expect(q.regularMarketPrice).toBeCloseTo(1.1755);
    expect(q.regularMarketPreviousClose).toBeCloseTo(1.1685);
    expect(q.regularMarketChangePercent).toBe(0.6);
    // Already in the major unit on Yahoo's side.
    expect(q.trailingAnnualDividendRate).toBe(0.046);
    expect(q.trailingAnnualDividendYield).toBeCloseTo(0.039);
  });

  it('leaves pound and other quotes alone', () => {
    const gbp = { symbol: 'JEPG.L', currency: 'GBP', regularMarketPrice: 24 };
    expect(normalizeQuoteResult(gbp)).toBe(gbp);
    const usd = { symbol: 'SPY', currency: 'USD', regularMarketPrice: 600 };
    expect(normalizeQuoteResult(usd)).toBe(usd);
  });

  it('handles a batch (array) result', () => {
    const [a, b] = normalizeQuoteResult([
      { symbol: 'VOD.L', currency: 'GBp', regularMarketPrice: 100 },
      { symbol: 'SPY', currency: 'USD', regularMarketPrice: 600 },
    ]);
    expect(a).toMatchObject({ currency: 'GBP', regularMarketPrice: 1 });
    expect(b).toMatchObject({ currency: 'USD', regularMarketPrice: 600 });
  });
});

describe('normalizeQuoteSummaryResult', () => {
  it('rescales price and summaryDetail but not dividend rates', () => {
    const s = normalizeQuoteSummaryResult({
      price: { currency: 'GBp', regularMarketPrice: 4837.5 },
      summaryDetail: { currency: 'GBp', previousClose: 4901, dividendRate: 1.56, dividendYield: 0.0319 },
    });
    expect(s.price).toMatchObject({ currency: 'GBP', regularMarketPrice: 48.375 });
    expect(s.summaryDetail).toMatchObject({ currency: 'GBP', previousClose: 49.01, dividendRate: 1.56, dividendYield: 0.0319 });
  });
});

describe('normalizeChartResult', () => {
  it('rescales bars, meta prices and dividend amounts', () => {
    const c = normalizeChartResult({
      meta: { currency: 'GBp', regularMarketPrice: 117.55, chartPreviousClose: 116 },
      quotes: [{ date: new Date(), open: 117, high: 118, low: 116, close: 117.5 }],
      events: { dividends: [{ date: new Date(), amount: 1.95 }] },
    });
    expect(c.meta).toMatchObject({ currency: 'GBP', regularMarketPrice: 1.1755, chartPreviousClose: 1.16 });
    expect(c.quotes[0]!.close).toBeCloseTo(1.175);
    expect(c.events.dividends[0]!.amount).toBeCloseTo(0.0195);
  });
});

describe('normalizeHoldingCurrency', () => {
  it('stores a pence holding in pounds', () => {
    expect(normalizeHoldingCurrency({ currency: 'GBp', averagePrice: 110 })).toEqual({ currency: 'GBP', averagePrice: 1.1 });
  });
  it('returns other holdings unchanged', () => {
    const a = { currency: 'USD', averagePrice: 70 };
    expect(normalizeHoldingCurrency(a)).toBe(a);
  });
});
