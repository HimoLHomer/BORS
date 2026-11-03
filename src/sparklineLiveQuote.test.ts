import { describe, expect, it } from 'vitest';
import { sparklineWithLiveQuote } from './Sparkline';

const start = Date.UTC(2026, 10, 3, 14, 30);
const end = Date.UTC(2026, 10, 3, 21, 0);
const min = 60_000;

describe('sparklineWithLiveQuote', () => {
  it('ends on the live price and measures against the quote previous close', () => {
    // Bars lag the quote: last bar 3303 below the bar-based close 3310, quote 3312.15 is +0.065%.
    const out = sparklineWithLiveQuote(
      { points: [3290, 3303], times: [start, start + 5 * min], sessionStart: start, sessionEnd: end, previousClose: 3310 },
      3312.15,
      0.06495173,
      start + 10 * min
    );
    expect(out.points).toEqual([3290, 3303, 3312.15]);
    expect(out.times).toEqual([start, start + 5 * min, start + 10 * min]);
    expect(out.previousClose).toBeCloseTo(3310, 1);
    expect(out.points.at(-1)! >= out.previousClose!).toBe(true);
    expect(out.domain).toEqual([start, end]);
  });

  it('places the live price at the session end once the market has closed', () => {
    const out = sparklineWithLiveQuote(
      { points: [10, 11], times: [start, end - 5 * min], sessionStart: start, sessionEnd: end, previousClose: 10 },
      11.5,
      2,
      end + 3 * 60 * min
    );
    expect(out.times!.at(-1)).toBe(end);
  });

  it('replaces the last point when the live price is not newer than the last bar', () => {
    const out = sparklineWithLiveQuote(
      { points: [10, 11], times: [start, end], sessionStart: start, sessionEnd: end, previousClose: 10 },
      11.2,
      undefined,
      end + min
    );
    expect(out.points).toEqual([10, 11.2]);
    expect(out.previousClose).toBe(10);
  });

  it('keeps the served line without a live price or timing data', () => {
    const data = { points: [1, 2, 3], previousClose: 2 };
    expect(sparklineWithLiveQuote(data, null, undefined)).toEqual({
      points: [1, 2, 3],
      previousClose: 2,
      times: undefined,
      domain: undefined,
    });
  });
});
