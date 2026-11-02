/**
 * Unit tests for portfolio chart range helpers.
 * Run: npm run test:portfolio-chart
 */
import assert from "node:assert/strict";
import {
  buildPortfolioIntradaySeries,
  computePortfolioIntradayXAxis,
  computePortfolioMultiDayXAxis,
  computePortfolioChartYDomain,
  computePortfolioChartXAxis,
  filterPortfolioChartByRange,
  formatPortfolioChartXTickMs,
  portfolioChartPoint,
  portfolioChartTimeFromIso,
  portfolioChartTooltipLabel,
  type PortfolioChartPoint,
} from "../src/portfolioChartRange.ts";

function point(date: string, value: number): PortfolioChartPoint {
  return portfolioChartPoint(date, value);
}

function isNiceNumber(n: number): boolean {
  if (!Number.isFinite(n)) return false;
  const s = String(Math.round(n));
  return /0$/.test(s) || n < 1000;
}

const oneDayData = [point("2026-07-08", 50_000), point("2026-07-09", 50_200)];
const oneDayDomain = computePortfolioChartYDomain(oneDayData, "1D");

assert.ok(oneDayDomain[0]! > 0, "1D domain min should be above zero for tight zoom");
assert.ok(
  oneDayDomain[1]! - oneDayDomain[0]! < 50_000,
  "1D domain span should be much smaller than portfolio value"
);

const fiveYearData = [point("2021-07-09", 10_000), point("2026-07-09", 50_000)];
const fiveYearDomain = computePortfolioChartYDomain(fiveYearData, "5Y");

assert.equal(fiveYearDomain[0], 0, "5Y domain should include zero");
assert.ok(fiveYearDomain[1]! >= 50_000, "5Y domain max should cover data");

const maxDomain = computePortfolioChartYDomain(fiveYearData, "Max");
assert.equal(maxDomain[0], 0, "Max domain should include zero");

const flatData = [point("2026-07-08", 50_000), point("2026-07-09", 50_000)];
const flatDomain = computePortfolioChartYDomain(flatData, "1D");

assert.ok(flatDomain[1]! > flatDomain[0]!, "flat data should still produce a non-zero span");
assert.ok(flatDomain[0]! < 50_000 && flatDomain[1]! > 50_000, "flat data padding should bracket value");

assert.ok(
  isNiceNumber(oneDayDomain[0]!) && isNiceNumber(oneDayDomain[1]!),
  "domain bounds should be round numbers"
);

const filtered = filterPortfolioChartByRange(
  [
    point("2026-01-01", 10_000),
    point("2026-06-15", 40_000),
    point("2026-07-09", 50_000),
  ],
  "1M",
  "2026-07-09"
);
assert.equal(filtered.length, 2);
assert.equal(filtered[0]!.date, "2026-06-15");

const emptyDomain = computePortfolioChartYDomain([], "1D");
assert.deepEqual(emptyDomain, [0, 1]);

const smallPortfolioDomain = computePortfolioChartYDomain(
  [point("2026-07-08", 12), point("2026-07-09", 95)],
  "1M"
);
assert.ok(smallPortfolioDomain[0]! >= 0, "Y domain min must never be negative");
assert.ok(smallPortfolioDomain[1]! > smallPortfolioDomain[0]!, "domain should have positive span");

const denseSummer = Array.from({ length: 70 }, (_, index) => {
  const d = new Date(Date.UTC(2026, 4, 1 + index));
  const iso = d.toISOString().slice(0, 10);
  return portfolioChartPoint(iso, 100_000 + index * 100);
});
denseSummer.unshift(portfolioChartPoint("2026-01-20", 40_000));

const maxAxis = computePortfolioChartXAxis(denseSummer, "Max");
const maxLabels = maxAxis.ticks.map((t) => maxAxis.formatTick(t));
assert.equal(
  new Set(maxLabels).size,
  maxLabels.length,
  "Max range tick labels should be unique"
);
assert.ok(maxLabels[0]!.includes("Jan"), "first tick should show January start date");
assert.ok(
  maxAxis.ticks[0]! < maxAxis.ticks[maxAxis.ticks.length - 1]!,
  "ticks should be chronological"
);

const shortRangeLabels = computePortfolioChartXAxis(
  [point("2026-07-05", 100_000), point("2026-07-09", 101_000)],
  "5D"
).ticks.map((t) => formatPortfolioChartXTickMs(t, "5D", 4 * 86_400_000));
assert.ok(shortRangeLabels.every((l) => /Jul/.test(l)), "5D ticks should show month and day");

const pinnedAxis = computePortfolioChartXAxis(denseSummer, "Max");
assert.equal(pinnedAxis.ticks[0], portfolioChartTimeFromIso("2026-01-20"));
assert.equal(
  pinnedAxis.ticks[pinnedAxis.ticks.length - 1],
  portfolioChartTimeFromIso(denseSummer[denseSummer.length - 1]!.date)
);

assert.equal(
  portfolioChartTooltipLabel(portfolioChartPoint("2026-07-08", 100_000)),
  "Jul 8, 2026"
);

{
  // 2 Nov 2026 is EET (UTC+2): 07:00Z = 09:00 Helsinki.
  const t0 = Date.UTC(2026, 10, 2, 7, 0);
  const intraday = {
    date: "2026-11-02",
    baselineEur: 1000,
    points: [0, 1, 2, 3].map((h) => ({ t: t0 + h * 3_600_000, value: 1000 + h * 10 })),
  };
  const now = t0 + 3.5 * 3_600_000;
  const rows = buildPortfolioIntradaySeries(intraday, 1050, now, "2026-11-02")!;
  assert.equal(rows.length, 5, "intraday: live total appended when the session is today");
  assert.equal(rows[4]!.value, 1050);
  assert.equal(rows[4]!.chartTime, now);
  assert.equal(
    buildPortfolioIntradaySeries(intraday, 1050, now, "2026-11-03")!.length,
    4,
    "intraday: no live point when showing a previous session"
  );
  assert.equal(buildPortfolioIntradaySeries(null, 1050, now), null);

  const axis = computePortfolioIntradayXAxis(rows);
  // Separator is locale-dependent ("09.00" in fi-FI browsers, "09:00" in some Node builds).
  assert.deepEqual(
    axis.ticks.map((t) => axis.formatTick(t).replace(":", ".")),
    ["09.00", "10.00", "11.00", "12.00"],
    "intraday ticks: hourly Helsinki time for a short session"
  );
  assert.match(portfolioChartTooltipLabel(rows[1]!), /10[.:]00$/);
}

{
  // 5D: Fri 30 Oct (EET from 25 Oct) and Mon 2 Nov, two bars each; weekend skipped.
  const fri = Date.UTC(2026, 9, 30, 7, 0);
  const mon = Date.UTC(2026, 10, 2, 7, 0);
  const intraday = {
    date: "2026-11-02",
    days: ["2026-10-30", "2026-11-02"],
    baselineEur: 1000,
    points: [
      { t: fri, value: 1000 },
      { t: fri + 1_800_000, value: 1010 },
      { t: mon, value: 1020 },
      { t: mon + 1_800_000, value: 1030 },
    ],
  };
  const rows = buildPortfolioIntradaySeries(intraday, 1040, mon + 7_200_000, "2026-11-02", {
    compressTime: true,
  })!;
  assert.deepEqual(
    rows.map((r) => r.chartTime),
    [0, 1, 2, 3, 4],
    "5D: bar index as chart time, so nights and weekends take no space"
  );
  assert.deepEqual(rows.map((r) => r.date), ["2026-10-30", "2026-10-30", "2026-11-02", "2026-11-02", "2026-11-02"]);

  const axis = computePortfolioMultiDayXAxis(rows);
  assert.deepEqual(axis.ticks, [0, 2], "5D ticks: first bar of each day");
  assert.match(axis.formatTick(0), /Fri/);
  assert.match(axis.formatTick(2), /Mon/);
}

console.log("OK: portfolio chart range tests passed.");
