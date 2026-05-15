import { createRequire } from "node:module";
import type YahooFinance from "yahoo-finance2";
import { appPath } from "./appRoot";

/** Resolve yahoo-finance2 from project root (tsx dev and node dist/server.cjs). */
const require = createRequire(appPath("package.json"));
type YahooFinanceCtor = new (opts?: { suppressNotices?: string[] }) => InstanceType<typeof YahooFinance>;
const mod = require("yahoo-finance2") as YahooFinanceCtor | { default: YahooFinanceCtor };
const YahooFinanceClass = typeof mod === "function" ? mod : mod.default;

export const yahooFinance: InstanceType<typeof YahooFinance> = new YahooFinanceClass({
  suppressNotices: ["yahooSurvey"],
});
