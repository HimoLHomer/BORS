import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Add middleware to parse JSON
  app.use(express.json());

  // Health check for Yahoo Finance connectivity
  app.get("/api/health/yahoo", async (req, res) => {
    try {
      const btc: any = await yahooFinance.quote('BTC-USD');
      if (btc && btc.regularMarketPrice) {
        res.json({ status: "connected", symbol: "BTC-USD", price: btc.regularMarketPrice });
      } else {
        res.json({ status: "degraded", message: "Unexpected response format" });
      }
    } catch (error) {
      console.error("Yahoo Finance health check failed:", error);
      res.status(500).json({ status: "disconnected", error: error instanceof Error ? error.message : String(error) });
    }
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
      const quotes = results.quotes;

      // Enrich top 8 results with price and currency
      const enrichedQuotes = await Promise.all(
        quotes.slice(0, 8).map(async (quote: any) => {
          try {
            // Some results like news don't have symbols or prices
            if (!quote.symbol) return quote;
            
            const detail: any = await yahooFinance.quote(quote.symbol);
            return {
              ...quote,
              shortName: detail.shortName || quote.shortName,
              longName: detail.longName || quote.longName,
              price: detail.regularMarketPrice,
              currency: detail.currency
            };
          } catch (e) {
            return quote; // Fallback to basic info
          }
        })
      );

      res.json(enrichedQuotes);
    } catch (error) {
      console.error(`Yahoo Finance search error for ${q}:`, error);
      res.status(500).json({ error: "Failed to search for assets" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`ALPHA-OS Server running on http://localhost:${PORT}`);
  });
}

startServer();
