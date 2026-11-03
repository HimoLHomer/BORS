import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { Asset } from "../src/types";
import {
  ensurePortfolioFlowsTable,
  insertPortfolioFlow,
  listPortfolioFlows,
  recordAssetUpdateFlows,
} from "./portfolioFlows";
import { NEW_HOLDING_NOTE } from "../src/flowNotes";

function makeDb() {
  const db = new Database(":memory:");
  ensurePortfolioFlowsTable(db);
  return db;
}

const asset = (quantity: number): Asset =>
  ({ id: "a", symbol: "SPY", name: "SPY", type: "etf", quantity, averagePrice: 100, currency: "EUR" }) as Asset;

const net = (db: Database.Database) => listPortfolioFlows(db).reduce((s, f) => s + f.amountEur, 0);

describe("recordAssetUpdateFlows share reductions", () => {
  it("corrects a mistyped quantity bought today at the cost it was logged at", () => {
    const db = makeDb();
    // Typed 2000 shares instead of 200: logged at cost.
    insertPortfolioFlow(db, { amountEur: 200_000, kind: "buy", assetSymbol: "SPY", note: NEW_HOLDING_NOTE });
    // Fixed to 200; the 1800 removed shares are worth 270,000 at market.
    recordAssetUpdateFlows(db, asset(2000), asset(200), {}, { EUR: 1 }, 270_000);
    expect(net(db)).toBeCloseTo(20_000);
    expect(listPortfolioFlows(db).every((f) => f.kind === "buy")).toBe(true);
  });

  it("logs shares held from before today as a sale at market value", () => {
    const db = makeDb();
    recordAssetUpdateFlows(db, asset(300), asset(200), {}, { EUR: 1 }, 15_000);
    expect(listPortfolioFlows(db).map((f) => f.amountEur)).toEqual([-15_000]);
  });

  it("splits a reduction larger than today's purchase", () => {
    const db = makeDb();
    // Held 200, bought 100 more today, then sold 200.
    insertPortfolioFlow(db, { amountEur: 10_000, kind: "buy", assetSymbol: "SPY", note: "Purchase" });
    recordAssetUpdateFlows(db, asset(300), asset(100), {}, { EUR: 1 }, 30_000);
    const flows = listPortfolioFlows(db);
    expect(flows.map((f) => f.kind)).toEqual(["sell"]);
    expect(flows[0]!.amountEur).toBeCloseTo(-15_000);
  });
});
