/**
 * Verifies market-related API routes with a mock Yahoo client (no network).
 * Run: npm run verify:market
 */
import express from "express";
import { registerDividendRoutes } from "../server/dividends.ts";
import { registerMarketHeatmapRoutes } from "../server/marketHeatmap.ts";
import { registerMarketNewsRoutes } from "../server/marketNews.ts";
import { clearMarketNewsCache } from "../server/marketNewsCache.ts";

const mockNews = [
  {
    title: "S&P 500 rises on Fed outlook",
    link: "https://news.example/sp500",
    publisher: "Reuters",
    providerPublishTime: Date.now(),
  },
  {
    title: "Stock market gains as earnings beat",
    link: "https://news.example/earnings",
    publisher: "Bloomberg",
    providerPublishTime: Date.now() - 60_000,
  },
];

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
  search: async () => ({ news: mockNews }),
};

const app = express();
app.use(express.json());
registerDividendRoutes(app, mockYahoo);
registerMarketHeatmapRoutes(app, mockYahoo as never);
registerMarketNewsRoutes(app, mockYahoo as never);

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

      clearMarketNewsCache();

      const newsBody = {
        variant: "us",
        marketDate: new Date().toISOString().slice(0, 10),
        changePercent: 0.5,
        refresh: false,
      };

      const newsRes1 = await fetch(`${base}/api/market/news`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newsBody),
      });
      if (!newsRes1.ok) throw new Error(`market news: HTTP ${newsRes1.status}`);
      const news1 = (await newsRes1.json()) as { stories?: unknown[]; cached?: boolean };
      if (!Array.isArray(news1.stories) || news1.stories.length === 0) {
        throw new Error("Expected market news stories");
      }
      if (news1.cached === true) throw new Error("First news fetch should not be cached");

      const newsRes2 = await fetch(`${base}/api/market/news`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newsBody),
      });
      const news2 = (await newsRes2.json()) as { cached?: boolean };
      if (news2.cached !== true) throw new Error("Second news fetch should be cached");

      const newsRes3 = await fetch(`${base}/api/market/news`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newsBody, refresh: true }),
      });
      const news3 = (await newsRes3.json()) as { cached?: boolean };
      if (news3.cached === true) throw new Error("Refresh should bypass cache");

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
