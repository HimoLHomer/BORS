import type { Express, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { appRoot } from "./appRoot";
import type YahooFinance from "yahoo-finance2";

export type HeatmapConstituent = {
  symbol: string;
  name: string;
  sector: string;
};

export type HeatmapTile = {
  symbol: string;
  name: string;
  size: number;
  change: number;
  price: number | null;
  currency: string;
};

export type HeatmapSector = {
  name: string;
  children: HeatmapTile[];
};

export type HeatmapResponse = {
  universe: string;
  asOf: string;
  cached: boolean;
  sectors: HeatmapSector[];
};

const CACHE_TTL_MS = 15 * 60 * 1000;
const BATCH_SIZE = 50;

type Universe = "sp500" | "omxh25";

type CacheEntry = {
  expiresAt: number;
  payload: HeatmapResponse;
};

const cache = new Map<Universe, CacheEntry>();
const refreshInFlight: Partial<Record<Universe, Promise<HeatmapResponse>>> = {};

/** US share classes use dashes (BRK-B); exchange suffixes (.HE, .OL) stay dotted. */
function toYahooSymbol(symbol: string): string {
  return symbol.replace(/\.([A-Z])$/, "-$1");
}

function constituentFilePath(file: string): string {
  const candidates = [
    path.join(appRoot(), "assets", "market", file),
    path.join(appRoot(), "data", "market", file),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(`Missing constituent file: ${candidates.join(" or ")}`);
  }
  return found;
}

function loadConstituents(universe: Universe): HeatmapConstituent[] {
  const file = universe === "sp500" ? "sp500.json" : "omxh25.json";
  const p = constituentFilePath(file);
  const raw = fs.readFileSync(p, "utf8");
  const parsed = JSON.parse(raw) as HeatmapConstituent[];
  if (!Array.isArray(parsed)) throw new Error(`Invalid ${file}`);
  return parsed;
}

function pickMarketCap(q: Record<string, unknown>): number | null {
  const cap = q.marketCap;
  if (typeof cap === "number" && Number.isFinite(cap) && cap > 0) return cap;
  const price = q.regularMarketPrice;
  const shares = q.sharesOutstanding;
  if (
    typeof price === "number" &&
    typeof shares === "number" &&
    Number.isFinite(price) &&
    Number.isFinite(shares) &&
    price > 0 &&
    shares > 0
  ) {
    return price * shares;
  }
  return null;
}

function pickChangePercent(q: Record<string, unknown>): number {
  const c = q.regularMarketChangePercent;
  return typeof c === "number" && Number.isFinite(c) ? c : 0;
}

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

function cacheHasPriceField(payload: HeatmapResponse): boolean {
  for (const s of payload.sectors) {
    for (const c of s.children) {
      if (!("price" in c)) return false;
    }
  }
  return payload.sectors.length > 0;
}

function pickCurrency(q: Record<string, unknown>, universe: Universe): string {
  const c = q.currency;
  if (typeof c === "string" && c.trim()) return c.trim().toUpperCase();
  return universe === "omxh25" ? "EUR" : "USD";
}

function pickName(q: Record<string, unknown>, fallback: string): string {
  const s = q.shortName ?? q.longName;
  return typeof s === "string" && s.trim() ? s.trim() : fallback;
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

async function fetchQuoteBatch(
  yahooFinance: InstanceType<typeof YahooFinance>,
  bookSymbols: string[],
  universe: Universe
): Promise<
  Map<string, { marketCap: number | null; change: number; name: string; price: number | null; currency: string }>
> {
  const out = new Map<
    string,
    { marketCap: number | null; change: number; name: string; price: number | null; currency: string }
  >();
  const yahooSyms = bookSymbols.map(toYahooSymbol);
  const yahooToBook = new Map<string, string>();
  for (let i = 0; i < bookSymbols.length; i++) {
    yahooToBook.set(yahooSyms[i]!, bookSymbols[i]!);
  }

  try {
    const raw = await yahooFinance.quote(yahooSyms);
    for (const row of quoteRows(raw)) {
      const ySym = typeof row.symbol === "string" ? row.symbol : "";
      const bookSym = yahooToBook.get(ySym) ?? yahooToBook.get(toYahooSymbol(ySym)) ?? ySym;
      if (!bookSym) continue;
      out.set(bookSym, {
        marketCap: pickMarketCap(row),
        change: pickChangePercent(row),
        name: pickName(row, bookSym),
        price: pickPrice(row),
        currency: pickCurrency(row, universe),
      });
    }
  } catch (e) {
    console.warn("Heatmap batch quote failed, falling back per symbol:", e);
    await Promise.all(
      bookSymbols.map(async (bookSym) => {
        try {
          const q = (await yahooFinance.quote(toYahooSymbol(bookSym))) as Record<string, unknown>;
          out.set(bookSym, {
            marketCap: pickMarketCap(q),
            change: pickChangePercent(q),
            name: pickName(q, bookSym),
            price: pickPrice(q),
            currency: pickCurrency(q, universe),
          });
        } catch {
          out.set(bookSym, {
            marketCap: null,
            change: 0,
            name: bookSym,
            price: null,
            currency: universe === "omxh25" ? "EUR" : "USD",
          });
        }
      })
    );
  }

  for (const sym of bookSymbols) {
    if (!out.has(sym)) {
      out.set(sym, {
        marketCap: null,
        change: 0,
        name: sym,
        price: null,
        currency: universe === "omxh25" ? "EUR" : "USD",
      });
    }
  }

  return out;
}

async function buildHeatmap(
  yahooFinance: InstanceType<typeof YahooFinance>,
  universe: Universe
): Promise<HeatmapResponse> {
  const constituents = loadConstituents(universe);
  const symbols = constituents.map((c) => c.symbol);
  const quotes = new Map<
    string,
    { marketCap: number | null; change: number; name: string; price: number | null; currency: string }
  >();

  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);
    const batchQuotes = await fetchQuoteBatch(yahooFinance, batch, universe);
    for (const [sym, data] of batchQuotes) quotes.set(sym, data);
  }

  const sectorMap = new Map<string, HeatmapTile[]>();
  for (const c of constituents) {
    const q = quotes.get(c.symbol);
    const change = q?.change ?? 0;
    const size = q?.marketCap ?? 1;
    const name = q?.name ?? c.name;
    const sector = c.sector || "Other";
    const tile: HeatmapTile = {
      symbol: c.symbol,
      name,
      size,
      change,
      price: q?.price ?? null,
      currency: q?.currency ?? (universe === "omxh25" ? "EUR" : "USD"),
    };
    const list = sectorMap.get(sector) ?? [];
    list.push(tile);
    sectorMap.set(sector, list);
  }

  const sectors: HeatmapSector[] = [...sectorMap.entries()]
    .map(([name, children]) => ({
      name,
      children: children.sort((a, b) => b.size - a.size),
    }))
    .sort((a, b) => {
      const sa = a.children.reduce((s, t) => s + t.size, 0);
      const sb = b.children.reduce((s, t) => s + t.size, 0);
      return sb - sa;
    });

  return {
    universe,
    asOf: new Date().toISOString(),
    cached: false,
    sectors,
  };
}

async function getHeatmap(
  yahooFinance: InstanceType<typeof YahooFinance>,
  universe: Universe,
  force = false
): Promise<HeatmapResponse> {
  const now = Date.now();
  const hit = cache.get(universe);
  if (!force && hit && hit.expiresAt > now && cacheHasPriceField(hit.payload)) {
    return { ...hit.payload, cached: true };
  }

  if (!force && refreshInFlight[universe]) {
    return refreshInFlight[universe]!;
  }

  const work = (async () => {
    try {
      const payload = await buildHeatmap(yahooFinance, universe);
      cache.set(universe, { expiresAt: now + CACHE_TTL_MS, payload });
      return payload;
    } catch (e) {
      if (hit) return { ...hit.payload, cached: true };
      throw e;
    } finally {
      delete refreshInFlight[universe];
    }
  })();

  refreshInFlight[universe] = work;
  return work;
}

export function registerMarketHeatmapRoutes(
  app: Express,
  yahooFinance: InstanceType<typeof YahooFinance>
): void {
  app.get("/api/market/heatmap", (req: Request, res: Response) => {
    void (async () => {
      const u = String(req.query.universe ?? "").toLowerCase();
      if (u !== "sp500" && u !== "omxh25") {
        res.status(400).json({ error: "universe must be sp500 or omxh25" });
        return;
      }
      const force = req.query.refresh === "1" || req.query.refresh === "true";
      try {
        const payload = await getHeatmap(yahooFinance, u as Universe, force);
        res.json(payload);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Failed to build heatmap";
        console.error("Heatmap fetch failed:", e);
        if (!res.headersSent) res.status(500).json({ error: message });
      }
    })().catch((e) => {
      console.error("Heatmap route error:", e);
      if (!res.headersSent) {
        res.status(500).json({
          error: e instanceof Error ? e.message : "Failed to build heatmap",
        });
      }
    });
  });
}
