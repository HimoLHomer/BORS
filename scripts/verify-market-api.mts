/**
 * Verifies market-related API routes with a mock Yahoo client (no network).
 * Run: npm run verify:market
 */
import express from "express";
import { registerDividendRoutes } from "../server/dividends.ts";
import { registerMarketHeatmapRoutes } from "../server/marketHeatmap.ts";

const mockYahoo = {
  quote: async (sym: string) => ({
    symbol: sym,
    regularMarketPrice: 100,
    currency: sym.includes(".HE") ? "EUR" : "USD",
    marketCap: 1_000_000_000,
    sharesOutstanding: 10_000_000,
  }),
  quoteSummary: async () => ({
    summaryDetail: { dividendYield: 0.02, trailingAnnualDividendRate: 2 },
    price: { regularMarketPrice: 100, currency: "USD" },
    calendarEvents: {},
  }),
  chart: async () => ({ quotes: [{ date: new Date(), close: 100 }], events: { dividends: {} } }),
};

const app = express();
app.use(express.json());
registerDividendRoutes(app, mockYahoo);
registerMarketHeatmapRoutes(app, mockYahoo as never);

let exitCode = 0;
const server = app.listen(0, "127.0.0.1", () => {
  void (async () => {
    const addr = server.address();
    const port = typeof addr === "object" && addr && "port" in addr ? addr.port : 0;
    const base = `http://127.0.0.1:${port}`;

    try {
      const divRes = await fetch(`${base}/api/portfolio/dividends`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holdings: [], baseCurrency: "EUR" }),
      });
      if (!divRes.ok) throw new Error(`dividends empty holdings: HTTP ${divRes.status}`);
      const div = (await divRes.json()) as { rows?: unknown[] };
      if (!Array.isArray(div.rows) || div.rows.length !== 0) {
        throw new Error("Expected empty dividends rows");
      }

      const heatRes = await fetch(`${base}/api/market/heatmap?universe=sp500`);
      if (!heatRes.ok) throw new Error(`heatmap: HTTP ${heatRes.status}`);
      const heat = (await heatRes.json()) as { sectors?: unknown[] };
      if (!Array.isArray(heat.sectors) || heat.sectors.length === 0) {
        throw new Error("Expected heatmap sectors");
      }

      console.log("OK: market API routes respond with mock Yahoo.");
    } catch (e) {
      console.error("Market API verification failed:", e instanceof Error ? e.message : e);
      exitCode = 1;
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      process.exitCode = exitCode;
    }
  })();
});

server.on("error", (e) => {
  console.error("Server listen failed:", e);
  process.exit(1);
});
