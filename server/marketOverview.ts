import type { Express, Request, Response } from "express";
import type YahooFinance from "yahoo-finance2";

export type MarketQuoteSnapshot = {
  id: string;
  label: string;
  symbol: string;
  price: number | null;
  change: number | null;
  changePercent: number;
  currency: string;
  kind: "index" | "alternative";
};

export type MarketOverviewResponse = {
  asOf: string;
  cached: boolean;
  sp500: MarketQuoteSnapshot;
  omxhpi: MarketQuoteSnapshot;
  alternatives: MarketQuoteSnapshot[];
};

const CACHE_TTL_MS = 5 * 60 * 1000;

type InstrumentDef = {
  id: string;
  label: string;
  symbol: string;
  currency: string;
  kind: "index" | "alternative";
  /** If primary symbol fails, try these (first hit wins). */
  fallbacks?: string[];
};

const SP500: InstrumentDef = {
  id: "sp500",
  label: "S&P 500",
  symbol: "^GSPC",
  currency: "USD",
  kind: "index",
};

const OMXHPI: InstrumentDef = {
  id: "omxhpi",
  label: "OMX Helsinki PI",
  symbol: "^OMXHPI",
  currency: "EUR",
  kind: "index",
  fallbacks: ["^OMX", "OMXHPI.HE"],
};

const ALTERNATIVES: InstrumentDef[] = [
  { id: "btc", label: "Bitcoin", symbol: "BTC-USD", currency: "USD", kind: "alternative" },
  { id: "gold", label: "Gold", symbol: "GC=F", currency: "USD", kind: "alternative" },
  { id: "silver", label: "Silver", symbol: "SI=F", currency: "USD", kind: "alternative" },
  { id: "oil", label: "Oil (WTI)", symbol: "CL=F", currency: "USD", kind: "alternative" },
  {
    id: "usdeur",
    label: "USD/EUR",
    symbol: "USDEUR=X",
    currency: "EUR",
    kind: "alternative",
    fallbacks: ["EURUSD=X"],
  },
];

let cache: { expiresAt: number; payload: MarketOverviewResponse } | null = null;
let refreshInFlight: Promise<MarketOverviewResponse> | null = null;

function pickPrice(q: Record<string, unknown>): number | null {
  for (const key of [
    "regularMarketPrice",
    "postMarketPrice",
    "preMarketPrice",
    "bid",
    "ask",
  ] as const) {
    const p = q[key];
    if (typeof p === "number" && Number.isFinite(p) && p > 0) return p;
  }
  return null;
}

function pickChange(q: Record<string, unknown>): number | null {
  const c = q.regularMarketChange;
  return typeof c === "number" && Number.isFinite(c) ? c : null;
}

function pickChangePercent(q: Record<string, unknown>): number {
  const c = q.regularMarketChangePercent;
  return typeof c === "number" && Number.isFinite(c) ? c : 0;
}

function pickCurrency(q: Record<string, unknown>, fallback: string): string {
  const c = q.currency;
  if (typeof c === "string" && c.trim()) return c.trim().toUpperCase();
  return fallback;
}

function quoteRows(
  result: unknown
): Array<Record<string, unknown> & { symbol?: string }> {
  if (result == null) return [];
  if (Array.isArray(result)) {
    return result.filter((r) => r && typeof r === "object") as Array<
      Record<string, unknown> & { symbol?: string }
    >;
  }
  if (typeof result === "object") {
    return Object.values(result as Record<string, unknown>).filter(
      (r) => r && typeof r === "object"
    ) as Array<Record<string, unknown> & { symbol?: string }>;
  }
  return [];
}

async function quoteOne(
  yahooFinance: InstanceType<typeof YahooFinance>,
  def: InstrumentDef
): Promise<MarketQuoteSnapshot> {
  const symbols = [def.symbol, ...(def.fallbacks ?? [])];
  for (const sym of symbols) {
    try {
      const raw = await yahooFinance.quote(sym);
      const row = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | undefined;
      if (!row || typeof row !== "object") continue;
      const price = pickPrice(row);
      if (price == null) continue;
      let changePercent = pickChangePercent(row);
      let change = pickChange(row);
      let currency = pickCurrency(row, def.currency);
      // EURUSD=X is EUR priced in USD; USDEUR=X is USD per EUR when available
      if (def.id === "usdeur" && sym === "EURUSD=X" && price > 0) {
        const inverted = 1 / price;
        change =
          change != null && Number.isFinite(change) && price > 0
            ? (-change / (price * price))
            : null;
        changePercent = -changePercent;
        return {
          id: def.id,
          label: def.label,
          symbol: sym,
          price: inverted,
          change,
          changePercent,
          currency: "EUR",
          kind: def.kind,
        };
      }
      return {
        id: def.id,
        label: def.label,
        symbol: sym,
        price,
        change,
        changePercent,
        currency,
        kind: def.kind,
      };
    } catch {
      /* try next symbol */
    }
  }
  return {
    id: def.id,
    label: def.label,
    symbol: def.symbol,
    price: null,
    change: null,
    changePercent: 0,
    currency: def.currency,
    kind: def.kind,
  };
}

async function quoteBatch(
  yahooFinance: InstanceType<typeof YahooFinance>,
  defs: InstrumentDef[]
): Promise<Map<string, MarketQuoteSnapshot>> {
  const out = new Map<string, MarketQuoteSnapshot>();
  const symbols = defs.map((d) => d.symbol);
  const symToDef = new Map<string, InstrumentDef>();
  for (const d of defs) symToDef.set(d.symbol, d);

  try {
    const raw = await yahooFinance.quote(symbols);
    const matched = new Set<string>();
    for (const row of quoteRows(raw)) {
      const ySym = typeof row.symbol === "string" ? row.symbol : "";
      const def = symToDef.get(ySym);
      if (!def) continue;
      const price = pickPrice(row);
      if (price == null) continue;
      out.set(def.id, {
        id: def.id,
        label: def.label,
        symbol: ySym,
        price,
        change: pickChange(row),
        changePercent: pickChangePercent(row),
        currency: pickCurrency(row, def.currency),
        kind: def.kind,
      });
      matched.add(def.id);
    }
    for (const def of defs) {
      if (!matched.has(def.id)) {
        const snap = await quoteOne(yahooFinance, def);
        out.set(def.id, snap);
      }
    }
  } catch (e) {
    console.warn("Market overview batch quote failed, per-symbol fallback:", e);
    await Promise.all(
      defs.map(async (def) => {
        out.set(def.id, await quoteOne(yahooFinance, def));
      })
    );
  }
  return out;
}

async function buildOverview(
  yahooFinance: InstanceType<typeof YahooFinance>
): Promise<MarketOverviewResponse> {
  const indexDefs = [SP500, OMXHPI];
  const allDefs = [...indexDefs, ...ALTERNATIVES];
  const quotes = await quoteBatch(yahooFinance, allDefs);

  const sp500 = quotes.get("sp500") ?? (await quoteOne(yahooFinance, SP500));
  const omxhpi = quotes.get("omxhpi") ?? (await quoteOne(yahooFinance, OMXHPI));
  const alternatives = await Promise.all(
    ALTERNATIVES.map(async (d) => quotes.get(d.id) ?? quoteOne(yahooFinance, d))
  );

  return {
    asOf: new Date().toISOString(),
    cached: false,
    sp500,
    omxhpi,
    alternatives,
  };
}

async function getOverview(
  yahooFinance: InstanceType<typeof YahooFinance>,
  force = false
): Promise<MarketOverviewResponse> {
  const now = Date.now();
  if (!force && cache && cache.expiresAt > now) {
    return { ...cache.payload, cached: true };
  }
  if (!force && refreshInFlight) return refreshInFlight;

  const work = (async () => {
    try {
      const payload = await buildOverview(yahooFinance);
      cache = { expiresAt: now + CACHE_TTL_MS, payload };
      return payload;
    } finally {
      refreshInFlight = null;
    }
  })();

  refreshInFlight = work;
  return work;
}

export function registerMarketOverviewRoutes(
  app: Express,
  yahooFinance: InstanceType<typeof YahooFinance>
): void {
  app.get("/api/market/overview", (req: Request, res: Response) => {
    void (async () => {
      const force = req.query.refresh === "1" || req.query.refresh === "true";
      try {
        const payload = await getOverview(yahooFinance, force);
        res.json(payload);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Failed to fetch market overview";
        console.error("Market overview failed:", e);
        res.status(500).json({ error: message });
      }
    })();
  });
}
