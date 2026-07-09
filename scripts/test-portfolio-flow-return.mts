/**
 * Unit tests for flow-adjusted portfolio return.
 * Run: npm run test:portfolio-flow-return
 */
import assert from "node:assert/strict";
import {
  buildPortfolio1DaySeries,
  buildPortfolio1DaySeriesFromTodayGain,
  computePortfolio1DayMarketReturn,
  computePortfolio1DayReturnFromHistory,
  computePortfolioMarketReturn,
  computePortfolioRangeGain,
  computePortfolioRangeReturnFromHistory,
  netPerformanceFlows,
  portfolioChartPoint,
  type PortfolioChartPoint,
} from "../src/portfolioChartRange.ts";

function point(date: string, value: number): PortfolioChartPoint {
  return portfolioChartPoint(date, value);
}

const history = [point("2026-07-08", 100_000), point("2026-07-09", 118_740)];
const purchaseFlow = [{ date: "2026-07-09", amountEur: 18_740 }];

const raw = computePortfolioRangeGain(history);
assert.equal(raw.gainEur, 18_740, "raw range gain includes purchase");

const adjusted = computePortfolioMarketReturn(history, purchaseFlow);
assert.ok(Math.abs(adjusted.gainEur) < 1, "purchase flow should zero out flat-market return");
assert.ok(adjusted.flowAdjusted, "should mark flow-adjusted result");
assert.equal(adjusted.netContributionsEur, 18_740);

const cashDeposit = computePortfolioMarketReturn(
  [point("2026-07-08", 50_000), point("2026-07-09", 55_000)],
  [{ date: "2026-07-09", amountEur: 5_000 }]
);
assert.ok(Math.abs(cashDeposit.gainEur) < 1, "cash deposit should not count as market return");

const dietz = computePortfolioMarketReturn(
  [point("2026-01-01", 10_000), point("2026-07-01", 15_000)],
  [{ date: "2026-03-01", amountEur: 2_000 }]
);
const expectedGain = 15_000 - 10_000 - 2_000;
const expectedPct = (expectedGain / (10_000 + 0.5 * 2_000)) * 100;
assert.equal(dietz.gainEur, expectedGain);
assert.ok(Math.abs(dietz.gainPercent - expectedPct) < 0.001);

const noFlows = computePortfolioMarketReturn(history, []);
assert.equal(noFlows.gainEur, raw.gainEur, "falls back to raw change without flows");
assert.equal(noFlows.flowAdjusted, false);

const historyRows = [
  { date: "2026-07-08", value: 104_965.47 },
  { date: "2026-07-09", value: 104_384.88 },
];

const oneDayFromHistory = computePortfolio1DayReturnFromHistory(
  historyRows,
  [],
  104_384.88,
  "2026-07-09"
);
assert.ok(
  Math.abs(oneDayFromHistory.gainEur - (104_384.88 - 104_965.47)) < 0.02,
  "1D from SQLite history should match prior close vs live total"
);
assert.equal(oneDayFromHistory.useLiveQuoteFallback, false);

const oneDaySeries = buildPortfolio1DaySeries(historyRows, 104_384.88, "2026-07-09");
assert.equal(oneDaySeries?.length, 2);
assert.equal(oneDaySeries?.[0]?.date, "2026-07-08");
assert.equal(oneDaySeries?.[1]?.value, 104_384.88);

const oneDayFromTodayGain = buildPortfolio1DaySeriesFromTodayGain(104_417.93, 515.4, "2026-07-09");
assert.equal(oneDayFromTodayGain?.[0]?.date, "2026-07-08");
assert.ok(
  Math.abs((oneDayFromTodayGain![1]!.value - oneDayFromTodayGain![0]!.value) - 515.4) < 0.01,
  "1D chart from today gain should match header delta"
);

const oneDay = computePortfolio1DayMarketReturn(
  [point("2026-07-08", 104_950), point("2026-07-09", 104_401)],
  [],
  104_401,
  "2026-07-09"
);
assert.ok(
  Math.abs(oneDay.gainEur - (104_401 - 104_950)) < 1,
  "1D should use prior close vs live total"
);
assert.equal(oneDay.useLiveQuoteFallback, false);

const oneDayFlatAfterRoundTrip = computePortfolio1DayMarketReturn(
  [point("2026-07-08", 104_950), point("2026-07-09", 104_401)],
  [
    { date: "2026-07-09", amountEur: 18_740, assetSymbol: "TEST", kind: "buy" },
    { date: "2026-07-09", amountEur: -18_740, assetSymbol: "TEST", kind: "sell" },
  ],
  104_401,
  "2026-07-09"
);
assert.ok(
  Math.abs(oneDayFlatAfterRoundTrip.gainEur - (104_401 - 104_950)) < 1,
  "same-day add/delete flows should net to zero adjustment"
);

const orphanSellIgnored = netPerformanceFlows([
  { date: "2026-07-09", amountEur: -11_740, assetSymbol: "X", kind: "sell" },
]);
assert.equal(orphanSellIgnored, 0, "orphan sell from delete should not adjust return");

const fiveDayHistory = [
  { date: "2026-07-05", value: 105_485.11 },
  { date: "2026-07-06", value: 105_987.28 },
  { date: "2026-07-07", value: 105_490.46 },
  { date: "2026-07-08", value: 104_965.47 },
  { date: "2026-07-09", value: 104_427.19 },
];
const fiveDayDown = computePortfolioRangeReturnFromHistory(
  fiveDayHistory,
  [{ date: "2026-07-09", amountEur: -11_740, assetSymbol: "X", kind: "sell" }],
  104_427.19,
  "5D",
  "2026-07-09"
);
assert.ok(
  fiveDayDown.gainEur < 0,
  "5D should show loss when history declines, even with orphan sell flow"
);
assert.ok(
  Math.abs(fiveDayDown.gainEur - (104_427.19 - 105_485.11)) < 1,
  "5D gain should match first history point vs live total"
);

console.log("OK: portfolio flow return tests passed.");
