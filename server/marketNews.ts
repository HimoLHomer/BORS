import type { Express, Request, Response } from "express";
import type YahooFinance from "yahoo-finance2";
import { todayIsoDateHelsinki } from "../src/formatDate";
import {
  filterFreshMarketArticles,
  rankNewsArticles,
  type RawNewsArticle,
  type MarketNewsRankingContext,
} from "../src/marketNewsRanking";
import {
  sanitizeTopStories,
  type MarketTopStory,
  type MarketVariant,
} from "../src/marketTopStories";
import type { MarketHeatmapMover, MarketSectorBreadth } from "../src/marketHeatmapUtils";
import {
  cleanDisplayHeadline,
} from "../src/marketNewsSources";
import {
  getCachedMarketNews,
  marketNewsCacheKey,
  setCachedMarketNews,
  type MarketNewsResult,
} from "./marketNewsCache";

const YAHOO_NEWS_COUNT = 40;

const US_SEARCH_QUERIES = ["S&P 500", "stock market today", "Federal Reserve"];
const FI_SEARCH_QUERIES = ["OMX Helsinki", "Kauppalehti pörssi", "Nokia Nordea"];

const RSS_URLS: Record<MarketVariant, string[]> = {
  us: [
    "https://news.google.com/rss/search?q=S%26P+500+stock+market+when:1d&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=site:reuters.com+S%26P+500+when:1d&hl=en-US&gl=US&ceid=US:en",
  ],
  fi: [
    "https://news.google.com/rss/search?q=OMX+Helsinki+OR+Helsinki+p%C3%B6rssi+when:1d&hl=fi&gl=FI&ceid=FI:fi",
    "https://news.google.com/rss/search?q=Kauppalehti+OR+Arvopaperi+p%C3%B6rssi+when:1d&hl=fi&gl=FI&ceid=FI:fi",
    "https://news.google.com/rss/search?q=Suomi+osakemarkkinat+when:1d&hl=fi&gl=FI&ceid=FI:fi",
  ],
};

type YahooNewsItem = {
  title?: string;
  link?: string;
  url?: string;
  publisher?: string;
  providerPublishTime?: number | string;
};

type YahooFinanceSearch = {
  search: (
    query: string,
    queryOptions?: { newsCount?: number; quotesCount?: number },
    moduleOptions?: { validateResult?: boolean }
  ) => Promise<{ news?: YahooNewsItem[] }>;
};

function parseTopMovers(
  raw: unknown
): MarketNewsRankingContext["topMovers"] | undefined {
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

function publisherFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return undefined;
  }
}

function parsePublishedAt(raw: unknown): number | undefined {
  if (raw instanceof Date && Number.isFinite(raw.getTime())) {
    return raw.getTime();
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw > 1e12 ? raw : raw * 1000;
  }
  if (typeof raw === "string" && raw.trim()) {
    const ms = Date.parse(raw);
    if (Number.isFinite(ms)) return ms;
  }
  return undefined;
}

function yahooItemToArticle(item: YahooNewsItem): RawNewsArticle | null {
  const title = typeof item.title === "string" ? item.title.trim() : "";
  if (!title) return null;
  const url =
    (typeof item.link === "string" && item.link.trim()) ||
    (typeof item.url === "string" && item.url.trim()) ||
    undefined;
  const publisher =
    (typeof item.publisher === "string" && item.publisher.trim()) ||
    publisherFromUrl(url) ||
    undefined;
  const raw = item as Record<string, unknown>;
  const publishedAt =
    parsePublishedAt(item.providerPublishTime) ??
    parsePublishedAt(raw.publishTime) ??
    parsePublishedAt(raw.publishedAt) ??
    parsePublishedAt(raw.pubDate);
  return {
    title,
    url,
    publisher,
    publishedAt,
  };
}

async function fetchYahooNews(
  yahooFinance: YahooFinanceSearch,
  variant: MarketVariant
): Promise<RawNewsArticle[]> {
  const queries = variant === "fi" ? FI_SEARCH_QUERIES : US_SEARCH_QUERIES;
  const articles: RawNewsArticle[] = [];

  for (const query of queries) {
    try {
      const result = await yahooFinance.search(
        query,
        { newsCount: YAHOO_NEWS_COUNT, quotesCount: 0 },
        { validateResult: false }
      );
      const news = Array.isArray(result.news) ? result.news : [];
      for (const item of news) {
        const article = yahooItemToArticle(item);
        if (article) articles.push(article);
      }
    } catch {
      /* try next query */
    }
  }

  return articles;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .trim();
}

export function parseGoogleNewsRss(xml: string): RawNewsArticle[] {
  const articles: RawNewsArticle[] = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRe.exec(xml)) !== null) {
    const block = match[1] ?? "";
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/i);
    const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/i);
    const pubMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
    const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/i);

    const title = decodeXmlEntities(titleMatch?.[1] ?? "");
    if (!title) continue;

    const url = decodeXmlEntities(linkMatch?.[1] ?? "").trim() || undefined;
    const publisher =
      decodeXmlEntities(sourceMatch?.[1] ?? "").trim() ||
      publisherFromUrl(url) ||
      "Google News";
    const publishedAt = pubMatch?.[1] ? Date.parse(pubMatch[1].trim()) : undefined;

    articles.push({
      title,
      url,
      publisher,
      publishedAt: Number.isFinite(publishedAt) ? publishedAt : undefined,
    });
  }

  return articles;
}

async function fetchGoogleNewsRss(variant: MarketVariant): Promise<RawNewsArticle[]> {
  const urls = RSS_URLS[variant];
  const articles: RawNewsArticle[] = [];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "BORS/1.0 (market news)" },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) continue;
      const xml = await res.text();
      articles.push(...parseGoogleNewsRss(xml));
    } catch {
      /* try next feed */
    }
  }

  return articles;
}

function articleToStory(article: RawNewsArticle, secondary = false): MarketTopStory {
  const source = article.publisher?.trim() || publisherFromUrl(article.url) || "News";
  const url = article.url?.trim();
  const headline = cleanDisplayHeadline(article.title, source);
  return {
    headline,
    source,
    ...(url ? { url } : {}),
    ...(url ? { references: [{ title: source, url }] } : {}),
    ...(secondary ? { secondary: true } : {}),
  };
}

export async function buildMarketNews(
  yahooFinance: YahooFinanceSearch,
  ctx: MarketNewsRankingContext,
  marketDate: string
): Promise<Omit<MarketNewsResult, "cached">> {
  const [yahooArticles, rssArticles] = await Promise.all([
    fetchYahooNews(yahooFinance, ctx.variant),
    fetchGoogleNewsRss(ctx.variant),
  ]);
  const articles = [...yahooArticles, ...rssArticles];

  const todayArticles = filterFreshMarketArticles(articles, marketDate);
  const ranked = rankNewsArticles(todayArticles, ctx, undefined, marketDate);
  const stories = sanitizeTopStories(
    ranked.map(({ article, secondary }) => articleToStory(article, secondary))
  );

  return {
    stories,
    marketDate,
    asOf: new Date().toISOString(),
  };
}

export function registerMarketNewsRoutes(
  app: Express,
  yahooFinance: InstanceType<typeof YahooFinance>
): void {
  const searchClient = yahooFinance as unknown as YahooFinanceSearch;

  app.post("/api/market/news", (req: Request, res: Response) => {
    void (async () => {
      const body = req.body as {
        variant?: string;
        marketDate?: string;
        changePercent?: number;
        refresh?: boolean;
        topMovers?: unknown;
        sectorBreadth?: unknown;
      };

      const variant: MarketVariant = body.variant === "fi" ? "fi" : "us";
      const marketDate =
        typeof body.marketDate === "string" && body.marketDate.trim()
          ? body.marketDate.trim()
          : todayIsoDateHelsinki();
      const changePercent =
        typeof body.changePercent === "number" && Number.isFinite(body.changePercent)
          ? body.changePercent
          : 0;
      const refresh = body.refresh === true;
      const topMovers = parseTopMovers(body.topMovers);
      const sectorBreadth = parseSectorBreadth(body.sectorBreadth);

      const rankingCtx: MarketNewsRankingContext = {
        variant,
        changePercent,
        topMovers,
        sectorBreadth,
      };

      const cacheKey = marketNewsCacheKey({ variant, marketDate });

      if (!refresh) {
        const cached = getCachedMarketNews(cacheKey, marketDate);
        if (cached) {
          res.json(cached);
          return;
        }
      }

      try {
        const result = await buildMarketNews(searchClient, rankingCtx, marketDate);
        setCachedMarketNews(cacheKey, marketDate, result);
        res.json({ ...result, cached: false });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Could not load news";
        res.status(502).json({ error: message });
      }
    })();
  });
}
