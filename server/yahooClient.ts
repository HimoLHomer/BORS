import { createRequire } from "node:module";
import path from "node:path";
import type YahooFinance from "yahoo-finance2";

/** Resolve yahoo-finance2 from project root (tsx dev and node dist/server.cjs). */
const require = createRequire(path.join(process.cwd(), "package.json"));
type YahooFinanceCtor = new (opts?: { suppressNotices?: string[] }) => InstanceType<typeof YahooFinance>;
const mod = require("yahoo-finance2") as YahooFinanceCtor | { default: YahooFinanceCtor };
const YahooFinanceClass = typeof mod === "function" ? mod : mod.default;

export const yahooFinance: InstanceType<typeof YahooFinance> = new YahooFinanceClass({
  suppressNotices: ["yahooSurvey"],
});
