import { describe, expect, it } from 'vitest';
import {
  inferPayoutFrequencyFromChartDividends,
  normalizeYieldToPercent,
  yahooDividendSymbol,
  yahooDividendSymbolFallbacks,
} from './dividendMath';

describe('yahooDividendSymbol', () => {
  it('uses listing symbol for UCITS .HE holdings', () => {
    expect(yahooDividendSymbol('NOKIA.HE', 'NOK')).toBe('NOKIA.HE');
  });

  it('uses US display symbol for thin foreign listing', () => {
    expect(yahooDividendSymbol('RY6.F', 'O')).toBe('O');
  });
});

describe('yahooDividendSymbolFallbacks', () => {
  it('includes .MI fallback for Nordic listings', () => {
    const f = yahooDividendSymbolFallbacks('VUCP.HE', 'VUCP');
    expect(f.some((s) => s.endsWith('.MI'))).toBe(true);
  });
});

describe('normalizeYieldToPercent', () => {
  it('converts fractional yield to percent', () => {
    expect(normalizeYieldToPercent(0.035)).toBeCloseTo(3.5);
  });

  it('keeps percent-scale values', () => {
    expect(normalizeYieldToPercent(4.2)).toBe(4.2);
  });
});

describe('inferPayoutFrequencyFromChartDividends', () => {
  it('treats a single payment in over a year of history as annual', () => {
    expect(inferPayoutFrequencyFromChartDividends([{ date: '2026-04-10', amount: 3.1 }], 420)).toBe('annual');
  });

  it('leaves a single payment unclassified without a long enough window', () => {
    expect(inferPayoutFrequencyFromChartDividends([{ date: '2026-04-10', amount: 3.1 }])).toBeNull();
    expect(inferPayoutFrequencyFromChartDividends([{ date: '2026-04-10', amount: 3.1 }], 200)).toBeNull();
  });

  it('still reads quarterly payers', () => {
    const divs = ['2025-11-14', '2026-02-13', '2026-05-15', '2026-08-14'].map((date) => ({ date, amount: 1 }));
    expect(inferPayoutFrequencyFromChartDividends(divs, 420)).toBe('quarterly');
  });
});
