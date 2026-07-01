import { describe, expect, it } from 'vitest';
import {
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
