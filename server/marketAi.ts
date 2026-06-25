import type { Express, Request, Response } from "express";
import {
  buildFiTopStoriesPrompt,
  buildUsTopStoriesPrompt,
  type MarketAiQuoteContext,
  type MarketHeatmapMover,
  type MarketSectorBreadth,
} from "../src/marketAiPrompt";
import type { MarketTopStoriesValidationContext } from "../src/marketTopStoriesValidation";
import { generateMarketSummary, getAiStatusDetail } from "./ai/providerRouter";
import type { MarketSummaryResult } from "./ai/types";
import {
  getCachedMarketSummary,
  marketAiCacheKey,
  setCachedMarketSummary,
} from "./marketAiCache";
import { todayIsoDateHelsinki } from "./marketAiDate";

function parseTopMovers(
  raw: unknown
): MarketAiQuoteContext["topMovers"] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as { gainers?: unknown; losers?: unknown };
  const parseList = (list: unknown): MarketHeatmapMover[] => {
    if (!Array.isArray(list)) return [];
    return list
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const t = item as Record<string, unknown>;
        const symbol = typeof t.symbol === "string" ? t.symbol : "";
        const name = typeof t.name === "string" ? t.name : symbol;
        const changePercent =
          typeof t.changePercent === "number" ? t.changePercent : NaN;
        if (!symbol || !Number.isFinite(changePercent)) return null;
        return { symbol, name, changePercent };
      })
      .filter((x): x is MarketHeatmapMover => x != null);
  };
  const gainers = parseList(o.gainers);
  const losers = parseList(o.losers);
  if (gainers.length === 0 && losers.length === 0) return undefined;
  return { gainers, losers };
}

function parseSectorBreadth(raw: unknown): MarketSectorBreadth | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const leadingSector = typeof o.leadingSector === "string" ? o.leadingSector : "";
  const laggingSector = typeof o.laggingSector === "string" ? o.laggingSector : "";
  const leadingAvgPct =
    typeof o.leadingAvgPct === "number" ? o.leadingAvgPct : NaN;
  const laggingAvgPct =
    typeof o.laggingAvgPct === "number" ? o.laggingAvgPct : NaN;
  if (
    !leadingSector ||
    !laggingSector ||
    !Number.isFinite(leadingAvgPct) ||
    !Number.isFinite(laggingAvgPct)
  ) {
    return undefined;
  }
  return { leadingSector, leadingAvgPct, laggingSector, laggingAvgPct };
}

function buildValidationContext(
  ctx: MarketAiQuoteContext,
  variant: "us" | "fi"
): MarketTopStoriesValidationContext {
  return {
    variant,
    marketDate: ctx.marketDate,
    indexLabel: ctx.label,
  };
}

export function registerMarketAiRoutes(app: Express): void {
  app.get("/api/market/ai-status", (_req: Request, res: Response) => {
    void (async () => {
      try {
        res.json(await getAiStatusDetail());
      } catch {
        res.status(500).json({ error: "Could not load AI status" });
      }
    })();
  });

  app.post("/api/market/ai-summary", (req: Request, res: Response) => {
    void (async () => {
      const body = req.body as Partial<MarketAiQuoteContext> & {
        variant?: string;
        refresh?: boolean;
      };
      const variant = body.variant === "fi" ? "fi" : "us";
      const label = typeof body.label === "string" ? body.label : "";
      const price = typeof body.price === "number" ? body.price : null;
      const changePercent =
        typeof body.changePercent === "number" ? body.changePercent : 0;
      const currency = typeof body.currency === "string" ? body.currency : "USD";
      const marketDate =
        typeof body.marketDate === "string" && body.marketDate.trim()
          ? body.marketDate.trim()
          : todayIsoDateHelsinki();
      const asOf =
        typeof body.asOf === "string" && body.asOf.trim() ? body.asOf.trim() : null;
      const topMovers = parseTopMovers(body.topMovers);
      const sectorBreadth = parseSectorBreadth(body.sectorBreadth);
      const refresh = body.refresh === true;

      if (price == null || !label) {
        res.status(400).json({ error: "label and price are required" });
        return;
      }

      const ctx: MarketAiQuoteContext = {
        label,
        price,
        changePercent,
        currency,
        marketDate,
        asOf,
        topMovers,
        sectorBreadth,
      };
      const prompt =
        variant === "fi" ? buildFiTopStoriesPrompt(ctx) : buildUsTopStoriesPrompt(ctx);
      const validation = buildValidationContext(ctx, variant);

      const cacheKey = marketAiCacheKey({
        variant,
        marketDate,
      });

      const withDate = (r: MarketSummaryResult): MarketSummaryResult => ({
        ...r,
        marketDate,
      });

      if (!refresh) {
        const cached = getCachedMarketSummary(cacheKey);
        if (cached) {
          res.json(withDate(cached));
          return;
        }
      }

      const outcome = await generateMarketSummary({ prompt, validation });
      if (outcome.ok === false) {
        const { error } = outcome;
        res.status(error.httpStatus).json({
          error: error.message,
          code: error.code,
        });
        return;
      }

      const result = withDate(outcome.result);
      setCachedMarketSummary(cacheKey, result);
      res.json(result);
    })();
  });
}
