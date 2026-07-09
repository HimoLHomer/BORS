import { formatCurrency } from './formatCurrency';
import { APP_LOCALE } from './formatNumber';
import {
  formatShortMonthDayEn,
  formatDateEn,
  isoDateFromTimestampHelsinki,
  parseIsoDateOnly,
  todayIsoDateHelsinki,
} from './formatDate';

export type PortfolioChartRangeId = '1D' | '5D' | '1M' | '6M' | 'YTD' | '1Y' | '5Y' | 'Max';

export type PortfolioChartPoint = {
  date: string;
  name: string;
  value: number;
  chartTime: number;
};

const MS_PER_DAY = 86_400_000;

/** UTC midnight ms for a stored `YYYY-MM-DD` row (for time-proportional chart X). */
export function portfolioChartTimeFromIso(isoDate: string): number {
  return parseIsoDateOnly(isoDate)?.getTime() ?? 0;
}

export function portfolioChartPoint(
  date: string,
  value: number,
  name?: string
): PortfolioChartPoint {
  return {
    date,
    name: name ?? formatShortMonthDayEn(date),
    value,
    chartTime: portfolioChartTimeFromIso(date),
  };
}

function chartTimeForPoint(point: PortfolioChartPoint): number {
  return point.chartTime > 0 ? point.chartTime : portfolioChartTimeFromIso(point.date);
}

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

/** Use live portfolio total for today's chart point (stored history can lag after edits). */
export function applyLiveTodayPortfolioPoint(
  data: PortfolioChartPoint[],
  liveTotal: number,
  referenceIso: string = todayIsoDateHelsinki()
): PortfolioChartPoint[] {
  if (!(liveTotal > 0) || !Number.isFinite(liveTotal)) return data;
  const withoutToday = data.filter((point) => point.date !== referenceIso);
  return [
    ...withoutToday,
    portfolioChartPoint(referenceIso, liveTotal, 'Today'),
  ].sort((a, b) => a.date.localeCompare(b.date));
}

export type PortfolioHistoryValue = {
  date: string;
  value: number;
};

export function priorPortfolioHistoryPoint(
  historyPoints: PortfolioHistoryValue[],
  referenceIso: string = todayIsoDateHelsinki()
): PortfolioHistoryValue | undefined {
  return [...historyPoints]
    .filter((point) => point.date < referenceIso)
    .sort((a, b) => a.date.localeCompare(b.date))
    .pop();
}

/** 1D chart: prior calendar close vs live total (two points). */
export function buildPortfolio1DaySeries(
  historyPoints: PortfolioHistoryValue[],
  liveTotal: number,
  referenceIso: string = todayIsoDateHelsinki()
): PortfolioChartPoint[] | null {
  const prior = priorPortfolioHistoryPoint(historyPoints, referenceIso);
  if (!prior || !(liveTotal > 0)) return null;
  return [
    portfolioChartPoint(prior.date, prior.value),
    portfolioChartPoint(referenceIso, liveTotal, 'Today'),
  ];
}

/** 1D chart aligned with summed holdings today gain: implied prior close vs live total. */
export function buildPortfolio1DaySeriesFromTodayGain(
  liveTotal: number,
  todayGainEur: number,
  referenceIso: string = todayIsoDateHelsinki()
): PortfolioChartPoint[] | null {
  if (!(liveTotal > 0)) return null;
  const priorDate = subtractCalendarDays(referenceIso, 1);
  const priorValue = liveTotal - todayGainEur;
  return [
    portfolioChartPoint(priorDate, priorValue),
    portfolioChartPoint(referenceIso, liveTotal, 'Today'),
  ];
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

/** Prefer 1D when enough history exists; otherwise the widest range that still charts. */
export function pickDefaultPortfolioChartRange(
  data: PortfolioChartPoint[],
  referenceIso: string = todayIsoDateHelsinki()
): PortfolioChartRangeId {
  if (data.length < 2) return 'Max';
  const preference: PortfolioChartRangeId[] = ['1D', '5D', '1M', '6M', 'YTD', '1Y', '5Y', 'Max'];
  for (const range of preference) {
    if (isPortfolioChartRangeAvailable(data, range, referenceIso)) return range;
  }
  return 'Max';
}

/** Label for the range gain under Portfolio Capital (Google Finance–style). */
export function portfolioChartRangeGainLabel(range: PortfolioChartRangeId): string {
  switch (range) {
    case '1D':
      return 'Today';
    case '5D':
      return 'Past 5 days';
    case '1M':
      return 'Past month';
    case '6M':
      return 'Past 6 months';
    case 'YTD':
      return 'Year to date';
    case '1Y':
      return 'Past year';
    case '5Y':
      return 'Past 5 years';
    case 'Max':
      return 'All time';
    default:
      return 'Today';
  }
}

/** Gain from first to last point in the visible chart range. */
export function computePortfolioRangeGain(visibleData: PortfolioChartPoint[]): {
  gainEur: number;
  gainPercent: number;
} {
  if (visibleData.length < 2) {
    return { gainEur: 0, gainPercent: 0 };
  }
  const first = visibleData[0]!.value;
  const last = visibleData[visibleData.length - 1]!.value;
  const gainEur = last - first;
  const gainPercent = first > 0 ? (gainEur / first) * 100 : 0;
  return { gainEur, gainPercent };
}

export type PortfolioFlowLike = {
  date: string;
  amountEur: number;
  assetSymbol?: string;
  kind?: 'cash' | 'buy' | 'sell';
};

/** Net external flows; buy+sell on same day for same symbol cancel (round-trip). */
export function netPerformanceFlows(flows: PortfolioFlowLike[]): number {
  const byAssetDay = new Map<string, { buy: number; sell: number }>();
  let cashNet = 0;

  for (const flow of flows) {
    if (!flow.assetSymbol || flow.kind === 'cash') {
      cashNet += flow.amountEur;
      continue;
    }
    const key = `${flow.date}|${flow.assetSymbol.toUpperCase()}`;
    const bucket = byAssetDay.get(key) ?? { buy: 0, sell: 0 };
    if (flow.amountEur > 0) bucket.buy += flow.amountEur;
    else bucket.sell += flow.amountEur;
    byAssetDay.set(key, bucket);
  }

  let assetNet = 0;
  for (const { buy, sell } of byAssetDay.values()) {
    const net = buy + sell;
    // Holding removal without a matching buy records a sell only; value is already in EMV.
    if (buy === 0 && sell < 0) continue;
    assetNet += net;
  }
  return cashNet + assetNet;
}

export function netPositiveContributions(flows: PortfolioFlowLike[]): number {
  const byAssetDay = new Map<string, number>();
  let cashPositive = 0;

  for (const flow of flows) {
    if (!flow.assetSymbol || flow.kind === 'cash') {
      if (flow.amountEur > 0) cashPositive += flow.amountEur;
      continue;
    }
    const key = `${flow.date}|${flow.assetSymbol.toUpperCase()}`;
    byAssetDay.set(key, (byAssetDay.get(key) ?? 0) + flow.amountEur);
  }

  let total = cashPositive;
  for (const net of byAssetDay.values()) {
    if (net > 0) total += net;
  }
  return total;
}

export function sumFlowsInRange(
  flows: PortfolioFlowLike[],
  startDate: string,
  endDate: string
): number {
  return flows
    .filter((flow) => flow.date >= startDate && flow.date <= endDate)
    .reduce((sum, flow) => sum + flow.amountEur, 0);
}

export function sumPositiveFlowsInRange(
  flows: PortfolioFlowLike[],
  startDate: string,
  endDate: string
): number {
  return flows
    .filter((flow) => flow.date >= startDate && flow.date <= endDate && flow.amountEur > 0)
    .reduce((sum, flow) => sum + flow.amountEur, 0);
}

/** Modified Dietz market return for the visible chart range (excludes external flows). */
export function computePortfolioMarketReturn(
  visibleData: PortfolioChartPoint[],
  flows: PortfolioFlowLike[]
): {
  gainEur: number;
  gainPercent: number;
  netContributionsEur: number;
  flowAdjusted: boolean;
} {
  const raw = computePortfolioRangeGain(visibleData);
  if (visibleData.length < 2) {
    return { gainEur: 0, gainPercent: 0, netContributionsEur: 0, flowAdjusted: false };
  }

  const startDate = visibleData[0]!.date;
  const endDate = visibleData[visibleData.length - 1]!.date;
  const rangeFlows = flows.filter((flow) => flow.date >= startDate && flow.date <= endDate);
  if (rangeFlows.length === 0) {
    return {
      gainEur: raw.gainEur,
      gainPercent: raw.gainPercent,
      netContributionsEur: 0,
      flowAdjusted: false,
    };
  }

  const cf = netPerformanceFlows(rangeFlows);
  const netContributionsEur = netPositiveContributions(rangeFlows);
  const bmv = visibleData[0]!.value;
  const emv = visibleData[visibleData.length - 1]!.value;
  const gainEur = emv - bmv - cf;
  const denominator = bmv + 0.5 * cf;
  const gainPercent = denominator > 0 ? (gainEur / denominator) * 100 : 0;

  return { gainEur, gainPercent, netContributionsEur, flowAdjusted: true };
}

/**
 * 1D return: prior calendar day close (history) vs live total today, flow-adjusted for today only.
 * Avoids mixing live quote % moves with history-based chart deltas.
 */
export function computePortfolio1DayMarketReturn(
  chartData: PortfolioChartPoint[],
  flows: PortfolioFlowLike[],
  liveTotal: number,
  referenceIso: string = todayIsoDateHelsinki()
): {
  gainEur: number;
  gainPercent: number;
  netContributionsEur: number;
  flowAdjusted: boolean;
  useLiveQuoteFallback: boolean;
} {
  const priorPoint = priorPortfolioHistoryPoint(chartData, referenceIso);
  return computePortfolio1DayReturnFromPrior(priorPoint, flows, liveTotal, referenceIso);
}

export function computePortfolio1DayReturnFromHistory(
  historyPoints: PortfolioHistoryValue[],
  flows: PortfolioFlowLike[],
  liveTotal: number,
  referenceIso: string = todayIsoDateHelsinki()
): {
  gainEur: number;
  gainPercent: number;
  netContributionsEur: number;
  flowAdjusted: boolean;
  useLiveQuoteFallback: boolean;
} {
  const priorPoint = priorPortfolioHistoryPoint(historyPoints, referenceIso);
  return computePortfolio1DayReturnFromPrior(priorPoint, flows, liveTotal, referenceIso);
}

function computePortfolio1DayReturnFromPrior(
  priorPoint: PortfolioHistoryValue | undefined,
  flows: PortfolioFlowLike[],
  liveTotal: number,
  referenceIso: string
): {
  gainEur: number;
  gainPercent: number;
  netContributionsEur: number;
  flowAdjusted: boolean;
  useLiveQuoteFallback: boolean;
} {
  if (!priorPoint || !(liveTotal > 0)) {
    return {
      gainEur: 0,
      gainPercent: 0,
      netContributionsEur: 0,
      flowAdjusted: false,
      useLiveQuoteFallback: true,
    };
  }

  const todayFlows = flows.filter((flow) => flow.date === referenceIso);
  const cf = netPerformanceFlows(todayFlows);
  const netContributionsEur = netPositiveContributions(todayFlows);
  const bmv = priorPoint.value;
  const emv = liveTotal;
  const gainEur = emv - bmv - cf;
  const denominator = bmv + 0.5 * cf;
  const gainPercent = denominator > 0 ? (gainEur / denominator) * 100 : 0;

  return {
    gainEur,
    gainPercent,
    netContributionsEur,
    flowAdjusted: todayFlows.length > 0,
    useLiveQuoteFallback: false,
  };
}

export function historyPointsInRange(
  historyPoints: PortfolioHistoryValue[],
  range: PortfolioChartRangeId,
  referenceIso: string = todayIsoDateHelsinki()
): PortfolioHistoryValue[] {
  const cutoff = portfolioChartRangeCutoff(range, referenceIso);
  const filtered = cutoff
    ? historyPoints.filter((point) => point.date >= cutoff)
    : [...historyPoints];
  return filtered.sort((a, b) => a.date.localeCompare(b.date));
}

/** History-based market return for any chart range (uses live total for today). */
export function computePortfolioRangeReturnFromHistory(
  historyPoints: PortfolioHistoryValue[],
  flows: PortfolioFlowLike[],
  liveTotal: number,
  range: PortfolioChartRangeId,
  referenceIso: string = todayIsoDateHelsinki()
): {
  gainEur: number;
  gainPercent: number;
  netContributionsEur: number;
  flowAdjusted: boolean;
  useLiveQuoteFallback: boolean;
} {
  if (range === '1D') {
    return computePortfolio1DayReturnFromHistory(historyPoints, flows, liveTotal, referenceIso);
  }

  const inRange = historyPointsInRange(historyPoints, range, referenceIso);
  if (inRange.length < 2 || !(liveTotal > 0)) {
    return {
      gainEur: 0,
      gainPercent: 0,
      netContributionsEur: 0,
      flowAdjusted: false,
      useLiveQuoteFallback: true,
    };
  }

  const bmv = inRange[0]!.value;
  const emv = liveTotal;
  const startDate = inRange[0]!.date;
  const rangeFlows = flows.filter(
    (flow) => flow.date >= startDate && flow.date <= referenceIso
  );
  const cf = netPerformanceFlows(rangeFlows);
  const netContributionsEur = netPositiveContributions(rangeFlows);
  const gainEur = emv - bmv - cf;
  const denominator = bmv + 0.5 * cf;
  const gainPercent = denominator > 0 ? (gainEur / denominator) * 100 : 0;

  return {
    gainEur,
    gainPercent,
    netContributionsEur,
    flowAdjusted: rangeFlows.length > 0,
    useLiveQuoteFallback: false,
  };
}

export function portfolioRangeShowsNetContributions(range: PortfolioChartRangeId): boolean {
  return range === 'Max' || range === '1Y' || range === '5Y';
}

function portfolioChartTickCount(range: PortfolioChartRangeId, pointCount: number): number {
  switch (range) {
    case '1D':
      return Math.min(2, pointCount);
    case '5D':
      return Math.min(5, pointCount);
    case '1M':
      return Math.min(5, pointCount);
    case '6M':
    case 'YTD':
    case '1Y':
      return Math.min(6, pointCount);
    case '5Y':
    case 'Max':
      return Math.min(6, pointCount);
    default:
      return Math.min(5, pointCount);
  }
}

function snapChartTimeToNearestDay(targetMs: number, dayTimes: number[]): number {
  let best = dayTimes[0]!;
  let bestDistance = Math.abs(targetMs - best);
  for (const dayTime of dayTimes) {
    const distance = Math.abs(targetMs - dayTime);
    if (distance < bestDistance) {
      best = dayTime;
      bestDistance = distance;
    }
  }
  return best;
}

/** Format one X-axis tick from chart time and visible span. */
export function formatPortfolioChartXTickMs(
  chartTime: number,
  range: PortfolioChartRangeId,
  spanMs: number
): string {
  const iso = isoDateFromTimestampHelsinki(chartTime);
  if (!iso) return '';
  const d = parseIsoDateOnly(iso);
  if (!d) return iso;

  const spanDays = spanMs / MS_PER_DAY;
  if (range === '1D' || spanDays <= 8) {
    return formatShortMonthDayEn(iso);
  }
  if (spanDays <= 120) {
    return formatShortMonthDayEn(iso);
  }
  if (spanDays <= 400) {
    return new Intl.DateTimeFormat(APP_LOCALE, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(d);
  }
  return new Intl.DateTimeFormat(APP_LOCALE, { month: 'short', year: 'numeric' }).format(d);
}

export type PortfolioChartXAxisConfig = {
  ticks: number[];
  formatTick: (chartTime: number) => string;
};

/** Time-proportional X ticks with unique, span-aware labels. */
export function computePortfolioChartXAxis(
  points: PortfolioChartPoint[],
  range: PortfolioChartRangeId
): PortfolioChartXAxisConfig {
  const dayTimes = [...new Set(points.map(chartTimeForPoint).filter((t) => t > 0))].sort(
    (a, b) => a - b
  );
  if (dayTimes.length === 0) {
    return { ticks: [], formatTick: () => '' };
  }

  const min = dayTimes[0]!;
  const max = dayTimes[dayTimes.length - 1]!;
  const spanMs = Math.max(max - min, 0);
  const tickCount = portfolioChartTickCount(range, dayTimes.length);

  let ticks: number[];
  if (dayTimes.length <= tickCount || tickCount < 2) {
    ticks = dayTimes;
  } else {
    const rawTicks: number[] = [min];
    const middleSlots = tickCount - 2;
    for (let i = 1; i <= middleSlots; i++) {
      const target = min + (spanMs * i) / (tickCount - 1);
      rawTicks.push(snapChartTimeToNearestDay(target, dayTimes));
    }
    rawTicks.push(max);
    ticks = [...new Set(rawTicks)].sort((a, b) => a - b);
  }

  const baseFormat = (chartTime: number) =>
    formatPortfolioChartXTickMs(chartTime, range, spanMs);
  const labelByTick = new Map<number, string>();
  const usedLabels = new Set<string>();
  for (const tick of ticks) {
    let label = baseFormat(tick);
    if (usedLabels.has(label)) {
      const iso = isoDateFromTimestampHelsinki(tick);
      const d = iso ? parseIsoDateOnly(iso) : null;
      if (d) {
        label = new Intl.DateTimeFormat(APP_LOCALE, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }).format(d);
      }
    }
    usedLabels.add(label);
    labelByTick.set(tick, label);
  }

  const formatTick = (chartTime: number) => labelByTick.get(chartTime) ?? baseFormat(chartTime);
  return { ticks, formatTick };
}

/** Tooltip heading from a chart row (never show raw chartTime). */
export function portfolioChartTooltipLabel(
  point: Pick<PortfolioChartPoint, 'date' | 'chartTime'>
): string {
  if (point.date?.trim()) return formatDateEn(point.date);
  const iso = isoDateFromTimestampHelsinki(point.chartTime);
  return iso ? formatDateEn(iso) : '—';
}

/** @deprecated Use formatPortfolioChartXTickMs via computePortfolioChartXAxis */
export function formatPortfolioChartXTick(isoDate: string, range: PortfolioChartRangeId): string {
  const chartTime = portfolioChartTimeFromIso(isoDate);
  return formatPortfolioChartXTickMs(chartTime, range, 0);
}

/** Y-axis currency labels for the portfolio capital chart. */
export function formatPortfolioChartYTick(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(APP_LOCALE, {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value);
}

/** Tooltip value for the portfolio capital chart. */
export function formatPortfolioChartTooltipValue(value: number): string {
  return formatCurrency(value, 'EUR');
}

const Y_DOMAIN_TICK_COUNT = 5;
const Y_DOMAIN_PADDING_RATIO = 0.08;
const Y_DOMAIN_FLAT_PADDING_RATIO = 0.01;

function niceStep(span: number, tickCount: number): number {
  if (!Number.isFinite(span) || span <= 0) return 1;
  const rough = span / Math.max(1, tickCount);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalized = rough / magnitude;
  let niceNormalized = 10;
  if (normalized <= 1) niceNormalized = 1;
  else if (normalized <= 2) niceNormalized = 2;
  else if (normalized <= 5) niceNormalized = 5;
  return niceNormalized * magnitude;
}

function niceFloor(value: number, step: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return value;
  return Math.floor(value / step) * step;
}

function niceCeil(value: number, step: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return value;
  return Math.ceil(value / step) * step;
}

function portfolioChartRangeIncludesZero(range: PortfolioChartRangeId): boolean {
  return range === '5Y' || range === 'Max';
}

/**
 * Google Finance–style Y domain for the portfolio capital chart.
 * Short ranges zoom to visible min/max; 5Y and Max include zero.
 */
export function computePortfolioChartYDomain(
  visibleData: PortfolioChartPoint[],
  range: PortfolioChartRangeId
): [number, number] {
  const values = visibleData.map((p) => p.value).filter((v) => Number.isFinite(v));
  if (values.length === 0) return [0, 1];

  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const span = dataMax - dataMin;
  const average = values.reduce((sum, v) => sum + v, 0) / values.length;

  if (portfolioChartRangeIncludesZero(range)) {
    const paddedMax = dataMax + (span > 0 ? span * Y_DOMAIN_PADDING_RATIO : average * Y_DOMAIN_FLAT_PADDING_RATIO);
    const step = niceStep(Math.max(paddedMax, 1), Y_DOMAIN_TICK_COUNT);
    return [0, Math.max(niceCeil(paddedMax, step), step)];
  }

  const padding =
    span > 0 ? span * Y_DOMAIN_PADDING_RATIO : Math.max(average * Y_DOMAIN_FLAT_PADDING_RATIO, 1);
  const rawMin = Math.max(0, dataMin - padding);
  const rawMax = dataMax + padding;
  const paddedSpan = Math.max(rawMax - rawMin, padding * 2, 1);
  const step = niceStep(paddedSpan, Y_DOMAIN_TICK_COUNT);
  let niceMin = Math.max(0, niceFloor(rawMin, step));
  let niceMax = niceCeil(rawMax, step);

  if (niceMax <= niceMin) {
    niceMax = niceMin + step;
  }

  return [niceMin, niceMax];
}
