import { formatShortMonthDayEn, parseIsoDateOnly, todayIsoDateHelsinki } from './formatDate';

export type PortfolioChartRangeId = '1D' | '5D' | '1M' | '6M' | 'YTD' | '1Y' | '5Y' | 'Max';

export type PortfolioChartPoint = {
  date: string;
  name: string;
  value: number;
};

export const PORTFOLIO_CHART_RANGE_OPTIONS: { id: PortfolioChartRangeId; label: string }[] = [
  { id: '1D', label: '1D' },
  { id: '5D', label: '5D' },
  { id: '1M', label: '1M' },
  { id: '6M', label: '6M' },
  { id: 'YTD', label: 'YTD' },
  { id: '1Y', label: '1Y' },
  { id: '5Y', label: '5Y' },
  { id: 'Max', label: 'Max' },
];

function isoDateFromUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function subtractCalendarDays(isoDate: string, days: number): string {
  const d = parseIsoDateOnly(isoDate);
  if (!d) return isoDate;
  const next = new Date(d.getTime());
  next.setUTCDate(next.getUTCDate() - days);
  return isoDateFromUtc(next);
}

function ytdStartIso(referenceIso: string): string {
  const y = referenceIso.slice(0, 4);
  return `${y}-01-01`;
}

/** Inclusive calendar-day cutoff for the selected range (points with date >= cutoff). */
export function portfolioChartRangeCutoff(
  range: PortfolioChartRangeId,
  referenceIso: string = todayIsoDateHelsinki()
): string | null {
  switch (range) {
    case '1D':
      return subtractCalendarDays(referenceIso, 1);
    case '5D':
      return subtractCalendarDays(referenceIso, 4);
    case '1M':
      return subtractCalendarDays(referenceIso, 29);
    case '6M':
      return subtractCalendarDays(referenceIso, 179);
    case 'YTD':
      return ytdStartIso(referenceIso);
    case '1Y':
      return subtractCalendarDays(referenceIso, 364);
    case '5Y':
      return subtractCalendarDays(referenceIso, 5 * 365);
    case 'Max':
      return null;
    default:
      return null;
  }
}

export function filterPortfolioChartByRange(
  data: PortfolioChartPoint[],
  range: PortfolioChartRangeId,
  referenceIso: string = todayIsoDateHelsinki()
): PortfolioChartPoint[] {
  if (data.length === 0) return [];
  const cutoff = portfolioChartRangeCutoff(range, referenceIso);
  if (!cutoff) return data;
  return data.filter((p) => p.date >= cutoff);
}

export function portfolioChartRangePointCount(
  data: PortfolioChartPoint[],
  range: PortfolioChartRangeId,
  referenceIso: string = todayIsoDateHelsinki()
): number {
  return filterPortfolioChartByRange(data, range, referenceIso).length;
}

/** A range is selectable when it yields at least two points (or Max with any history). */
export function isPortfolioChartRangeAvailable(
  data: PortfolioChartPoint[],
  range: PortfolioChartRangeId,
  referenceIso: string = todayIsoDateHelsinki()
): boolean {
  if (data.length < 2) return false;
  if (range === 'Max') return true;
  return portfolioChartRangePointCount(data, range, referenceIso) >= 2;
}

/** Prefer 1Y when enough history exists; otherwise the widest range that still charts. */
export function pickDefaultPortfolioChartRange(
  data: PortfolioChartPoint[],
  referenceIso: string = todayIsoDateHelsinki()
): PortfolioChartRangeId {
  if (data.length < 2) return 'Max';
  const preference: PortfolioChartRangeId[] = ['1Y', '6M', '1M', '5D', '1D', 'YTD', '5Y', 'Max'];
  for (const range of preference) {
    if (isPortfolioChartRangeAvailable(data, range, referenceIso)) return range;
  }
  return 'Max';
}

export function formatPortfolioChartXTick(isoDate: string, range: PortfolioChartRangeId): string {
  const d = parseIsoDateOnly(isoDate);
  if (!d) return isoDate;
  if (range === '5Y' || range === 'Max') {
    return new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit' }).format(d);
  }
  return formatShortMonthDayEn(isoDate);
}

/** Y-axis currency labels for the portfolio capital chart. */
export function formatPortfolioChartYTick(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value);
}

/** Tooltip value for the portfolio capital chart. */
export function formatPortfolioChartTooltipValue(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
