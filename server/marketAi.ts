import type { Express, Request, Response } from "express";
import {
  buildFiMarketAiPrompt,
  buildUsMarketAiPrompt,
  type MarketAiQuoteContext,
  type MarketHeatmapMover,
  type MarketSectorBreadth,
} from "../src/marketAiPrompt";
import {
  sanitizeMarketSummary,
  type MarketSummaryValidationContext,
  type MoverQuote,
} from "../src/marketAiValidation";
import { generateMarketSummary, getAiStatusDetail } from "./ai/providerRouter";
import type { MarketSummaryResult } from "./ai/types";
import { getActiveProvider } from "./aiSettings";
import {
  getCachedMarketSummary,
  marketAiCacheKey,
  moversFingerprint,
  setCachedMarketSummary,
} from "./marketAiCache";
import { todayIsoDateHelsinki } from "./marketAiDate";
import { getMarketSessionStatus } from "../src/marketSession";

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
  ctx: MarketAiQuoteContext
): MarketSummaryValidationContext {
  const symbols: string[] = [];
  const names: string[] = [];
  for (const m of [...(ctx.topMovers?.gainers ?? []), ...(ctx.topMovers?.losers ?? [])]) {
    if (m.symbol) symbols.push(m.symbol);
    if (m.name?.trim()) names.push(m.name.trim());
  }
  return {
    indexLabel: ctx.label,
    changePercent: ctx.changePercent,
    marketDate: ctx.marketDate,
    moverNames: names,
    moverSymbols: symbols,
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

      const session = getMarketSessionStatus(variant);
      if (!session.showSummary) {
        res.json({
          summary: session.closedMessage,
          marketDate,
          model: "session",
          provider: getActiveProvider(),
        });
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
        variant === "fi" ? buildFiMarketAiPrompt(ctx) : buildUsMarketAiPrompt(ctx);
      const validation = buildValidationContext(ctx);

      const moverQuotes: MoverQuote[] = [
        ...(ctx.topMovers?.gainers ?? []),
        ...(ctx.topMovers?.losers ?? []),
      ].map((m) => ({
        symbol: m.symbol,
        name: m.name,
        changePercent: m.changePercent,
      }));

      const alignSummary = (summary: string) =>
        sanitizeMarketSummary(summary, {
          indexLabel: ctx.label,
          changePercent: ctx.changePercent,
          movers: moverQuotes,
          topGainer: ctx.topMovers?.gainers[0]
            ? {
                symbol: ctx.topMovers.gainers[0].symbol,
                name: ctx.topMovers.gainers[0].name,
                changePercent: ctx.topMovers.gainers[0].changePercent,
              }
            : undefined,
          topLoser: ctx.topMovers?.losers[0]
            ? {
                symbol: ctx.topMovers.losers[0].symbol,
                name: ctx.topMovers.losers[0].name,
                changePercent: ctx.topMovers.losers[0].changePercent,
              }
            : undefined,
        });

      const provider = getActiveProvider();
      const fp = moversFingerprint(
        topMovers?.gainers ?? [],
        topMovers?.losers ?? []
      );
      const cacheKey = marketAiCacheKey({
        provider,
        variant,
        marketDate,
        changePercent,
        label,
        moversFingerprint: fp,
      });

      const withDate = (r: MarketSummaryResult): MarketSummaryResult => ({
        ...r,
        marketDate,
      });

      if (!refresh) {
        const cached = getCachedMarketSummary(cacheKey);
        if (cached) {
          res.json(
            withDate({ ...cached, summary: alignSummary(cached.summary) })
          );
          return;
        }
      }

      const outcome = await generateMarketSummary({ prompt, validation });
      if (outcome.ok === true) {
        outcome.result.summary = alignSummary(outcome.result.summary);
      }
      if (outcome.ok === false) {
        const { error } = outcome;
        res.status(error.httpStatus).json({
          error: error.message,
          code: error.code,
          provider: error.provider,
        });
        return;
      }

      const result = withDate(outcome.result);
      setCachedMarketSummary(cacheKey, result);
      res.json(result);
    })();
  });
}
