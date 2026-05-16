import type { Express, Request, Response } from "express";
import {
  buildFiMarketAiPrompt,
  buildUsMarketAiPrompt,
  type MarketAiQuoteContext,
} from "../src/marketAiPrompt";
import { generateMarketSummary, getAiStatus } from "./ai/providerRouter";

export function registerMarketAiRoutes(app: Express): void {
  app.get("/api/market/ai-status", (_req: Request, res: Response) => {
    res.json(getAiStatus());
  });

  app.post("/api/market/ai-summary", (req: Request, res: Response) => {
    void (async () => {
      const body = req.body as Partial<MarketAiQuoteContext> & { variant?: string };
      const variant = body.variant === "fi" ? "fi" : "us";
      const label = typeof body.label === "string" ? body.label : "";
      const price = typeof body.price === "number" ? body.price : null;
      const changePercent =
        typeof body.changePercent === "number" ? body.changePercent : 0;
      const currency = typeof body.currency === "string" ? body.currency : "USD";

      if (price == null || !label) {
        res.status(400).json({ error: "label and price are required" });
        return;
      }

      const ctx: MarketAiQuoteContext = { label, price, changePercent, currency };
      const prompt =
        variant === "fi" ? buildFiMarketAiPrompt(ctx) : buildUsMarketAiPrompt(ctx);

      const outcome = await generateMarketSummary({ prompt });
      if (outcome.ok === false) {
        const { error } = outcome;
        res.status(error.httpStatus).json({
          error: error.message,
          code: error.code,
          provider: error.provider,
        });
        return;
      }

      res.json(outcome.result);
    })();
  });
}
