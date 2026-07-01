import fs from "fs";

const src = fs.readFileSync("server/dividends.ts", "utf8");
const idx = src.indexOf("export function registerDividendRoutes");
if (idx < 0) throw new Error("registerDividendRoutes not found");

let math = src.slice(0, idx);
math = math
  .replace("type CalendarPayoutSource", "export type CalendarPayoutSource")
  .replace("function dividendBundleScore", "export function dividendBundleScore")
  .replace("function toIsoDate", "export function toIsoDate")
  .replace("function buildCalendarPayoutSchedule", "export function buildCalendarPayoutSchedule");

fs.writeFileSync("server/dividendMath.ts", math);

const routes = `import type { Express, Request, Response } from "express";
import {
  type DividendHoldingIn,
  type InferredDividendPayoutFrequency,
  type CalendarPayoutSource,
  yahooDividendSymbolFallbacks,
  trailingAnnualDividendPerShareFromChart,
  dividendBundleScore,
  chartDividendsToList,
  inferPayoutFrequencyFromChartDividends,
  dividendYieldPercentFromQuoteSummary,
  toIsoDate,
  buildCalendarPayoutSchedule,
} from "./dividendMath";

export * from "./dividendMath";

${src.slice(idx)}`;

fs.writeFileSync("server/dividends.ts", routes);
console.log("split-dividend-math: ok");
