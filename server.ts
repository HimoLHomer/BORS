import dotenv from "dotenv";
import express from "express";
import path from "path";
import { appPath, appRoot } from "./server/appRoot";

const projectRoot = appRoot();
dotenv.config({ path: path.join(projectRoot, ".env") });
dotenv.config({ path: path.join(projectRoot, ".env.local"), override: true });
const userDataDir = process.env.BORS_USER_DATA?.trim();
if (userDataDir) {
  dotenv.config({ path: path.join(userDataDir, ".env.local"), override: true });
}
import { createServer as createViteServer } from "vite";
import { registerPortfolioRoutes } from "./server/portfolio";
import { yahooFinance } from "./server/yahooClient";
import { registerMarketHeatmapRoutes } from "./server/marketHeatmap";
import { registerMarketOverviewRoutes } from "./server/marketOverview";
import { registerMarketAiRoutes } from "./server/marketAi";
import {
  dividendYieldPercentFromQuote,
  dividendYieldPercentFromQuoteSummary,
} from "./server/dividends";
async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const electronApiOnly = process.env.BORS_ELECTRON === "1";

  if (electronApiOnly) {
    app.use((req, res, next) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      if (req.method === "OPTIONS") {
        res.sendStatus(204);
        return;
      }
      next();
    });
  }

  // Add middleware to parse JSON
  app.use(express.json());

  registerPortfolioRoutes(app, yahooFinance);
  registerMarketHeatmapRoutes(app, yahooFinance);
  registerMarketOverviewRoutes(app, yahooFinance);
  registerMarketAiRoutes(app);

  const marketApiRoutes = [
    "GET /api/market/heatmap",
    "GET /api/market/overview",
    "GET /api/market/ai-status",
    "POST /api/market/ai-summary",
  ];

  function pickQuotePrice(q: unknown): number | null {
    if (!q || typeof q !== "object") return null;
    const o = q as Record<string, unknown>;
    const candidates = [
      o.regularMarketPrice,
      o.postMarketPrice,
      o.preMarketPrice,
      o.bid,
      o.ask,
    ];
    for (const c of candidates) {
      if (typeof c === "number" && Number.isFinite(c) && c > 0) return c;
    }
    return null;
  }

  // Health check for Yahoo Finance connectivity (used by dashboard header).
  app.get("/api/health/yahoo", async (req, res) => {
    const probes = ["BTC-USD", "AAPL", "MSFT", "EURUSD=X"];
    let lastErr = "Unknown error";
    for (const symbol of probes) {
      try {
        const q: unknown = await yahooFinance.quote(symbol);
        const price = pickQuotePrice(q);
        if (price != null) {
          res.json({ status: "connected", symbol, price });
          return;
        }
        lastErr = `Yahoo returned no usable price for ${symbol}`;
      } catch (error) {
        lastErr = error instanceof Error ? error.message : String(error);
        console.error(`Yahoo Finance health probe failed (${symbol}):`, error);
      }
    }
    res.status(503).json({ status: "disconnected", error: lastErr });
  });

  // API route for Yahoo Finance quotes
  app.get("/api/quote/:symbol", async (req, res) => {
    const { symbol } = req.params;
    try {
      const quote: any = await yahooFinance.quote(symbol);
      res.json({
        symbol: quote.symbol,
        price: quote.regularMarketPrice,
        currency: quote.currency,
        change: quote.regularMarketChange,
        changePercent: quote.regularMarketChangePercent,
        name: quote.shortName || quote.longName
      });
    } catch (error) {
      console.error(`Yahoo Finance error for ${symbol}:`, error);
      res.status(500).json({ error: "Failed to fetch quote" });
    }
  });

  // Batch quote fetch for multiple symbols
  app.post("/api/quotes", async (req, res) => {
    const { symbols, baseCurrency = 'EUR' } = req.body;
    if (!Array.isArray(symbols)) {
      return res.status(400).json({ error: "Symbols must be an array" });
    }
    try {
      // Fetch quotes and exchange rates
      const results = await Promise.all(
        symbols.map(async (s) => {
          try {
            const q: any = await yahooFinance.quote(s);
            return {
              symbol: s,
              price: q.regularMarketPrice,
              currency: q.currency,
              changePercent: q.regularMarketChangePercent,
              name: q.shortName || q.longName
            };
          } catch (e) {
            return { symbol: s, error: true };
          }
        })
      );

      // Fetch exchange rates for non-base currencies
      const neededRates = [...new Set(results.filter(r => !r.error && r.currency !== baseCurrency).map(r => r.currency))];
      const rates: Record<string, number> = { [baseCurrency]: 1 };
      
      await Promise.all(neededRates.map(async (curr) => {
        try {
          const rateQuote: any = await yahooFinance.quote(`${curr}${baseCurrency}=X`);
          if (rateQuote.regularMarketPrice) rates[curr] = rateQuote.regularMarketPrice;
        } catch (e) {
          // Fallback approximate rates if Yahoo fails
          if (curr === 'USD') rates['USD'] = 0.92;
          if (curr === 'GBP') rates['GBP'] = 1.17;
        }
      }));

      res.json({ quotes: results, rates });
    } catch (error) {
      res.status(500).json({ error: "Batch fetch failed" });
    }
  });

  // Search for assets
  app.get("/api/search", async (req, res) => {
    const { q } = req.query;
    if (!q || typeof q !== 'string') {
      return res.status(400).json({ error: "Search query required" });
    }
    try {
      const results = await yahooFinance.search(q);
      const rawQuotes = Array.isArray(results.quotes) ? results.quotes : [];
      const quotes = rawQuotes.filter((quote) => {
        const s = (quote as { symbol?: string }).symbol;
        return typeof s === "string" && s.trim().length > 0;
      });

      // Enrich top 8 results with price and currency
      const enrichedQuotes = await Promise.all(
        quotes.slice(0, 8).map(async (quote: any) => {
          try {
            // Defensive: skip rows with no ticker (Yahoo sometimes returns sparse entries)
            if (!quote.symbol || !String(quote.symbol).trim()) return null;
            
            const [detail, sumSnap] = await Promise.all([
              yahooFinance.quote(quote.symbol).catch(() => ({})),
              yahooFinance
                .quoteSummary(quote.symbol, { modules: ["summaryDetail", "price"] }, { validateResult: false })
                .catch(() => null),
            ]);
            const d: Record<string, unknown> =
              detail && typeof detail === "object" ? (detail as Record<string, unknown>) : {};
            const sum = sumSnap as {
              summaryDetail?: object;
              price?: {
                regularMarketPrice?: number;
                currency?: string;
                shortName?: string;
                longName?: string;
              };
            } | null;
            const p = sum?.price;
            const fromSummary = sum ? dividendYieldPercentFromQuoteSummary(sum) : null;
            const fromQuote = dividendYieldPercentFromQuote({
              trailingAnnualDividendYield: d.trailingAnnualDividendYield as number | undefined,
              dividendYield: d.dividendYield as number | undefined,
              trailingAnnualDividendRate: d.trailingAnnualDividendRate as number | undefined,
              regularMarketPrice: d.regularMarketPrice as number | undefined,
            });
            const dividendYieldPercent = fromSummary ?? fromQuote;
            const priceVal =
              typeof p?.regularMarketPrice === "number" && Number.isFinite(p.regularMarketPrice)
                ? p.regularMarketPrice
                : typeof d.regularMarketPrice === "number" && Number.isFinite(d.regularMarketPrice)
                  ? d.regularMarketPrice
                  : undefined;
            return {
              ...quote,
              shortName: p?.shortName || (d.shortName as string) || quote.shortName,
              longName: p?.longName || (d.longName as string) || quote.longName,
              price: priceVal,
              currency: p?.currency || (d.currency as string) || quote.currency,
              dividendYieldPercent,
            };
          } catch (e) {
            return quote; // Fallback to basic info
          }
        })
      );

      res.json(enrichedQuotes.filter((row): row is NonNullable<typeof row> => row != null));
    } catch (error) {
      console.error(`Yahoo Finance search error for ${q}:`, error);
      res.status(500).json({ error: "Failed to search for assets" });
    }
  });

  // Unmatched /api → JSON (never SPA index.html)
  app.use("/api", (req, res) => {
    const hint =
      req.path.startsWith("/market/") ?
        " Restart the dev server (npm run dev on port 3000) after pulling changes."
      : "";
    res.status(404).json({
      error: `API route not found: ${req.method} ${req.originalUrl}.${hint}`,
    });
  });

  // Always return JSON for /api errors (never Vite text/plain)
  app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!req.path.startsWith("/api")) {
      next(err);
      return;
    }
    console.error("API error:", err);
    if (!res.headersSent) {
      const message = err instanceof Error ? err.message : "Internal server error";
      res.status(500).json({ error: message });
    }
  });

  // Vite middleware for development (skip /api so JSON routes are never HTML)
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use((req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      vite.middlewares(req, res, next);
    });
  } else if (!electronApiOnly) {
    const distPath = appPath("dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const listenHost = process.env.BORS_LISTEN_HOST?.trim() || "0.0.0.0";
  app.listen(PORT, listenHost, () => {
    const hostLabel = listenHost === "0.0.0.0" ? "localhost" : listenHost;
    console.log(`ALPHA-OS Server running on http://${hostLabel}:${PORT}`);
    for (const r of marketApiRoutes) console.log(`  ${r}`);
  });
}

startServer();
