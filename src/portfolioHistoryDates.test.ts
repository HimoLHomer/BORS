import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HISTORY_BACKFILL_MAX_DAYS,
  listMissingHistoryDates,
} from './portfolioHistoryDates';

describe('listMissingHistoryDates', () => {
  it('fills capped window when no existing dates', () => {
    expect(listMissingHistoryDates([], '2026-05-10', 5)).toEqual([
      '2026-05-06',
      '2026-05-07',
      '2026-05-08',
      '2026-05-09',
      '2026-05-10',
    ]);
  });

  it('fills gap after latest stored date', () => {
    expect(listMissingHistoryDates(['2026-05-01', '2026-05-03'], '2026-05-06', 90)).toEqual([
      '2026-05-04',
      '2026-05-05',
      '2026-05-06',
    ]);
  });

  it('respects maxDays cap', () => {
    expect(listMissingHistoryDates([], '2026-05-20', 3)).toEqual([
      '2026-05-18',
      '2026-05-19',
      '2026-05-20',
    ]);
  });

  it('returns empty when up to date', () => {
    expect(listMissingHistoryDates(['2026-05-10'], '2026-05-10', 90)).toEqual([]);
  });

  it('uses default 90-day window', () => {
    expect(DEFAULT_HISTORY_BACKFILL_MAX_DAYS).toBe(90);
  });
});
