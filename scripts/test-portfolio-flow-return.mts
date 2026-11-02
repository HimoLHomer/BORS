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
import { gainPercentOf, holdingTodayGainEur, todaysPurchasesBySymbol } from "../src/todayGain.ts";

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

assert.equal(
  netPerformanceFlows([{ date: "2026-07-09", amountEur: -11_740, assetSymbol: "X", kind: "sell" }]),
  -11_740,
  "a sale (holding removed) is money leaving the holdings"
);

// Selling must not show up as a market loss. Flat market, €1,000 holding sold on 1 Nov.
{
  const hist = [
    { date: "2026-10-20", value: 10_000 },
    { date: "2026-10-30", value: 10_000 },
  ];
  const gain = (flows: Parameters<typeof netPerformanceFlows>[0], live: number) =>
    computePortfolioRangeReturnFromHistory(hist, flows, live, "1M", "2026-11-02").gainEur;
  const sold = { date: "2026-11-01", amountEur: -1_000, assetSymbol: "X", kind: "sell" as const };

  assert.equal(
    gain([sold, { date: "2026-11-01", amountEur: 1_000, kind: "cash" }], 10_000),
    0,
    "sell and move the money to cash: no gain or loss"
  );
  assert.equal(gain([sold], 9_000), 0, "sell and take the money out: no gain or loss");
  assert.equal(
    gain(
      [
        { date: "2026-11-01", amountEur: 1_000, assetSymbol: "Y", kind: "buy" },
        { date: "2026-11-01", amountEur: -1_000, kind: "cash" },
      ],
      10_000
    ),
    0,
    "buy paid from cash: no gain or loss"
  );
  assert.equal(
    gain([{ date: "2026-11-01", amountEur: -1_200, assetSymbol: "X", kind: "sell" }], 9_000),
    200,
    "sold for €1,200 after the holding rose €200 since the start: €200 gain"
  );
}

const fiveDayHistory = [
  { date: "2026-07-05", value: 105_485.11 },
  { date: "2026-07-06", value: 105_987.28 },
  { date: "2026-07-07", value: 105_490.46 },
  { date: "2026-07-08", value: 104_965.47 },
  { date: "2026-07-09", value: 104_427.19 },
];
const fiveDayDown = computePortfolioRangeReturnFromHistory(fiveDayHistory, [], 104_427.19, "5D", "2026-07-09");
assert.ok(
  Math.abs(fiveDayDown.gainEur - (104_427.19 - 105_485.11)) < 1,
  "5D gain should match first history point vs live total"
);

// Buys on the first saved day are already in that day's total: not money put in during the range.
{
  const hist = [
    { date: "2026-09-20", value: 7_000 },
    { date: "2026-10-30", value: 7_200 },
  ];
  const flows = [
    { date: "2026-09-20", amountEur: 5_000, assetSymbol: "X", kind: "buy" as const },
    { date: "2026-10-15", amountEur: 100, kind: "cash" as const },
  ];
  const g = computePortfolioRangeReturnFromHistory(hist, flows, 7_400, "1Y", "2026-11-02");
  assert.equal(g.gainEur, 7_400 - 7_000 - 100, "first-day buy excluded, later deposit counted");
}

// Today gain: shares bought today only count their move since purchase.
{
  const today = "2026-11-02";
  const purchases = todaysPurchasesBySymbol(
    [
      { date: today, kind: "buy", assetSymbol: "NEW", amountEur: 1_000, note: "New holding" },
      { date: today, kind: "buy", assetSymbol: "TOP", amountEur: 500, note: "Purchase" },
      { date: today, kind: "buy", assetSymbol: "OWN", amountEur: 2_000, note: "Transferred in" },
      { date: "2026-11-01", kind: "buy", assetSymbol: "OLD", amountEur: 700, note: "New holding" },
    ],
    today
  );
  assert.deepEqual([...purchases.keys()].sort(), ["NEW", "TOP"], "transfers in and older buys aren't today's purchases");

  // Bought today for €1,000, worth €1,010 now, stock is -4% on the day: gain is +€10, not -€42.
  assert.equal(holdingTodayGainEur(1_010, -4, purchases.get("NEW")), 10);
  // Held €2,000 + bought €500 today; -4% day: only the €2,000 part moved.
  const topUp = holdingTodayGainEur(2_500, -4, purchases.get("TOP"));
  assert.ok(Math.abs(topUp - (2_000 - 2_000 / 0.96)) < 0.01, "top-up: day's move on the shares held before");
  // Already owned (transferred in today): the full day's move counts.
  assert.ok(Math.abs(holdingTodayGainEur(2_000, -4, purchases.get("OWN")) - (2_000 - 2_000 / 0.96)) < 0.01);
  assert.ok(Math.abs(gainPercentOf(1_010, 10) - 1) < 1e-9, "percent relative to value before the gain");
}

console.log("OK: portfolio flow return tests passed.");
