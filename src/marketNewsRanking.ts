/** Heuristic ranking for market news headlines (no AI). */

import { isoDateFromTimestampHelsinki, parseIsoDateOnly } from "./formatDate";
import { displayCompanyLabel } from "./marketTopStories";
import type { MarketHeatmapMover, MarketSectorBreadth } from "./marketHeatmapUtils";
import { TOP_STORIES_TARGET } from "./marketTopStories";
import type { MarketVariant } from "./marketTopStories";
import {
  articleUrlQuality,
  publisherHostname,
  sourceTier,
  sourceTierScoreBonus,
} from "./marketNewsSources";

export type RawNewsArticle = {
  title: string;
  url?: string;
  publisher?: string;
  publishedAt?: number;
};

export type MarketNewsRankingContext = {
  variant: MarketVariant;
  changePercent: number;
  topMovers?: {
    gainers: MarketHeatmapMover[];
    losers: MarketHeatmapMover[];
  };
  sectorBreadth?: MarketSectorBreadth;
};

const MACRO_KEYWORDS = [
  "fed",
  "federal reserve",
  "ecb",
  "interest rate",
  "rates",
  "inflation",
  "cpi",
  "ppi",
  "gdp",
  "earnings",
  "tariff",
  "oil",
  "jobs",
  "unemployment",
  "recession",
  "stimulus",
  "treasury",
  "bond",
  "yield",
];

const US_INDEX_TERMS = [
  "s&p",
  "s&p 500",
  "sp500",
  "wall street",
  "nasdaq",
  "dow",
  "us stocks",
  "stock market",
  "equities",
];

const FI_INDEX_TERMS = [
  "omx",
  "omxh",
  "helsinki",
  "finland",
  "finnish",
  "suomi",
  "nordic",
  "nordea",
  "nokia",
  "kauppalehti",
  "arvopaperi",
  "pörssi",
  "porssi",
  "euronext",
];

const FI_US_HEADLINE_TERMS = [
  "wall street",
  "s&p 500",
  "s&p500",
  "sp500",
  "s&p",
  "nasdaq",
  "dow jones",
  "dow futures",
  "us stock market",
  "u.s. stock market",
  "american stocks",
];

const FI_PUBLISHER_TERMS = [
  "kauppalehti",
  "arvopaperi",
  "yle",
  "talouselama",
  "talouselämä",
  "helsingin sanomat",
  "nordnet",
  "inderes",
];

const FI_MACRO_TERMS = ["ecb", "eurozone", "euro area", "european central bank"];

const BULLISH_TERMS = ["rally", "gains", "surge", "beat", "rise", "rises", "jump", "soar", "record high"];
const BEARISH_TERMS = ["selloff", "sell-off", "fall", "falls", "drop", "plunge", "miss", "cut", "fears", "slump"];

const TOPIC_STOPWORDS = new Set([
  "stock",
  "stocks",
  "market",
  "today",
  "futures",
  "amid",
  "after",
  "before",
  "wall",
  "street",
  "dow",
  "nasdaq",
  "rise",
  "rises",
  "rose",
  "climb",
  "slide",
  "slides",
  "slid",
  "drop",
  "drops",
  "gain",
  "gains",
  "fall",
  "falls",
  "fell",
  "higher",
  "lower",
  "focus",
  "traders",
  "investors",
  "index",
  "points",
  "percent",
  "week",
  "this",
  "that",
  "with",
  "from",
  "into",
  "over",
  "under",
  "amid",
  "here",
  "what",
  "why",
  "kept",
  "edge",
  "edges",
]);

const RARE_TOPIC_TOKENS = new Set([
  "iran",
  "israel",
  "opec",
  "tariff",
  "tariffs",
  "fed",
  "federal",
  "ecb",
  "inflation",
  "earnings",
  "nvidia",
  "apple",
  "microsoft",
  "nokia",
  "nordea",
  "kauppalehti",
  "arvopaperi",
  "helsinki",
  "omx",
  "oil",
  "crude",
  "jobs",
  "recession",
  "gdp",
]);

const TOPIC_PREFIX_RE =
  /^(?:stock market today|us stock market today|dow,?\s*nasdaq,?\s*s&p\s*500\s*futures)\s*:?\s*/i;
const TICKER_TAIL_RE =
  /:\s*[A-Z]{1,5}(?:,\s*[A-Z]{1,5})+(?:\s+(?:stocks?|in focus|kept traders|on watch).*)?$/i;

function normalizeText(text: string): string {
  return text.trim().toLowerCase();
}

/** Strip publisher suffix and punctuation for cross-source headline matching. */
export function normalizeHeadlineForDedupe(title: string): string {
  let t = title.trim();
  for (let i = 0; i < 3; i++) {
    const stripped = t.replace(/\s+[-–|]\s+[^-|–]+$/u, "").trim();
    if (stripped === t) break;
    t = stripped;
  }
  return t
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip syndication boilerplate before topic clustering. */
export function normalizeHeadlineForTopic(title: string): string {
  let t = title.trim();
  for (let i = 0; i < 3; i++) {
    const stripped = t.replace(/\s+[-–|]\s+[^-|–]+$/u, "").trim();
    if (stripped === t) break;
    t = stripped;
  }
  t = t.replace(TOPIC_PREFIX_RE, "").trim();
  t = t.replace(TICKER_TAIL_RE, "").trim();
  return normalizeHeadlineForDedupe(t);
}

export function extractTopicTokens(title: string): Set<string> {
  const normalized = normalizeHeadlineForTopic(title);
  const tokens = normalized.split(" ").filter((w) => w.length > 3 && !TOPIC_STOPWORDS.has(w));
  return new Set(tokens);
}

export function headlinesShareTopic(a: string, b: string): boolean {
  if (headlinesAreDuplicates(a, b)) return true;

  const tokensA = extractTopicTokens(a);
  const tokensB = extractTopicTokens(b);
  if (tokensA.size === 0 || tokensB.size === 0) return false;

  let shared = 0;
  let sharedRare = 0;
  for (const token of tokensA) {
    if (!tokensB.has(token)) continue;
    shared++;
    if (RARE_TOPIC_TOKENS.has(token)) sharedRare++;
  }

  if (sharedRare >= 1) return true;
  return shared >= 2;
}

function significantWords(text: string): string[] {
  return normalizeHeadlineForDedupe(text)
    .split(" ")
    .filter((w) => w.length > 3);
}

/** True when two headlines likely report the same story (Yahoo vs Google RSS, etc.). */
export function headlinesAreDuplicates(a: string, b: string): boolean {
  const na = normalizeHeadlineForDedupe(a);
  const nb = normalizeHeadlineForDedupe(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  if (shorter.length >= 36 && longer.startsWith(shorter)) return true;

  const wordsA = significantWords(a);
  const wordsB = significantWords(b);
  if (wordsA.length === 0 || wordsB.length === 0) return false;
  const setA = new Set(wordsA);
  let shared = 0;
  for (const w of wordsB) {
    if (setA.has(w)) shared++;
  }
  const minLen = Math.min(wordsA.length, wordsB.length);
  return shared >= 5 && shared / minLen >= 0.72;
}

function normalizeDedupeKey(article: RawNewsArticle): string {
  const url = article.url?.trim();
  if (url) {
    try {
      const u = new URL(url);
      u.hash = "";
      return u.toString().toLowerCase();
    } catch {
      return normalizeText(url);
    }
  }
  return normalizeText(article.title);
}

/** Drop articles older than this (still must match market calendar day). */
export const NEWS_MAX_AGE_HOURS = 36;
/** Stricter cap for secondary backfill slots. */
export const NEWS_SECONDARY_MAX_AGE_HOURS = 24;

const HEADLINE_MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const HEADLINE_MONTH_FIRST_RE =
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i;
const HEADLINE_DAY_FIRST_RE =
  /\b(\d{1,2})(?:st|nd|rd|th)?\.?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;

function impliedIsoDateFromHeadline(headline: string, referenceYear: number): string | null {
  const monthFirst = headline.match(HEADLINE_MONTH_FIRST_RE);
  if (monthFirst) {
    const month = HEADLINE_MONTHS[monthFirst[1]!.toLowerCase()];
    const day = Number(monthFirst[2]);
    if (month && day >= 1 && day <= 31) {
      return `${referenceYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const dayFirst = headline.match(HEADLINE_DAY_FIRST_RE);
  if (dayFirst) {
    const day = Number(dayFirst[1]);
    const month = HEADLINE_MONTHS[dayFirst[2]!.toLowerCase()];
    if (month && day >= 1 && day <= 31) {
      return `${referenceYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  return null;
}

/** Headlines like "Stock Market Today, July 8: …" when marketDate is July 9. */
export function headlineImpliesBeforeMarketDate(headline: string, marketDate: string): boolean {
  const market = parseIsoDateOnly(marketDate);
  if (!market) return false;

  const year = market.getUTCFullYear();
  const implied = impliedIsoDateFromHeadline(headline, year);
  if (!implied || implied === marketDate) return false;

  const impliedDate = parseIsoDateOnly(implied);
  if (!impliedDate) return false;

  return impliedDate.getTime() < market.getTime();
}

export function filterArticlesByMaxAge(
  articles: RawNewsArticle[],
  maxAgeHours: number,
  nowMs: number = Date.now()
): RawNewsArticle[] {
  const cutoff = nowMs - maxAgeHours * 60 * 60 * 1000;
  return articles.filter((article) => {
    if (article.publishedAt == null || !Number.isFinite(article.publishedAt)) return false;
    return article.publishedAt >= cutoff;
  });
}

/** Reuters/Google RSS sometimes surface ticker quote pages as news items. */
const QUOTE_PAGE_PHRASE_RE = /stock\s+price\s*(?:&|and)\s*latest\s+news/i;
/** Standalone listing ticker (e.g. JCDX.MU, EMUS.PK, SAP.DE) — not a real headline. */
const TICKER_ONLY_HEADLINE_RE =
  /^[A-Z0-9][A-Z0-9-]{0,11}(?:\.[A-Z]{1,4})+(?:\s*[-–|]\s*)?$/i;
/** Bare ticker with no sentence (e.g. AAPL, NVDA). */
const BARE_TICKER_HEADLINE_RE = /^[A-Z]{1,5}(?:\s*[-–|]\s*)?$/i;
/** Syndication spam: long comma-separated ticker tail or "Why … Are Trending". */
const TICKER_TAIL_SPAM_RE =
  /:\s*[A-Z]{1,5}(?:,\s*[A-Z]{1,5})+(?:\s+(?:stocks?|in focus|kept traders|on watch|are trending).*)?$/i;
const TICKER_LIST_TRENDING_RE =
  /:\s*why\s+(?:[A-Z]{1,5}(?:,\s*)?){2,}[A-Z]{1,5}\s+are\s+trending/i;

const TICKER_TOKEN_STOPWORDS = new Set([
  "S&P",
  "US",
  "UK",
  "EU",
  "GDP",
  "CPI",
  "PPI",
  "ECB",
  "FED",
  "THE",
  "AND",
  "FOR",
  "ARE",
  "WHY",
  "DOW",
  "OMX",
  "YTD",
  "IPO",
  "ETF",
  "USD",
  "EUR",
]);

function stripTrailingPublisherSegments(title: string): string {
  let t = title.trim();
  for (let i = 0; i < 4; i++) {
    const next = t.replace(/\s+[-–|]\s+[^-|–]+$/u, "").trim();
    if (next === t) break;
    t = next;
  }
  return t;
}

export function isQuotePageNewsHeadline(title: string): boolean {
  const raw = title.trim();
  if (!raw) return true;
  if (QUOTE_PAGE_PHRASE_RE.test(raw)) return true;

  const stripped = stripTrailingPublisherSegments(raw);
  if (TICKER_ONLY_HEADLINE_RE.test(stripped)) return true;
  if (BARE_TICKER_HEADLINE_RE.test(stripped)) return true;
  return false;
}

/** Quote-page URLs from Yahoo Finance and similar syndication. */
export function isQuotePageNewsUrl(url: string | undefined): boolean {
  if (!url?.trim()) return false;
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    const path = parsed.pathname.toLowerCase();
    if (host === "finance.yahoo.com" && path.includes("/quote")) return true;
    if (host.endsWith("finance.yahoo.com") && path.includes("/quote")) return true;
    if (/\/quote\/[a-z0-9.-]+/i.test(path)) return true;
    if (path.includes("/stock-price")) return true;
    return false;
  } catch {
    return false;
  }
}

function countTickerLikeTokens(title: string): number {
  const tokens = title.match(/\b[A-Z]{2,5}\b/g) ?? [];
  return tokens.filter((token) => !TICKER_TOKEN_STOPWORDS.has(token)).length;
}

export function isTickerListSpamHeadline(title: string): boolean {
  const raw = title.trim();
  if (!raw) return false;
  if (TICKER_TAIL_SPAM_RE.test(raw)) return true;
  if (TICKER_LIST_TRENDING_RE.test(raw)) return true;

  const stripped = stripTrailingPublisherSegments(raw);
  const words = stripped.split(/\s+/).filter((w) => w.length > 0);
  const meaningfulWords = words.filter((w) => !/^[A-Z]{1,5}$/.test(w) && w.length > 2);
  const tickerTokens = countTickerLikeTokens(stripped);
  return tickerTokens >= 4 && meaningfulWords.length < 6;
}

/** Combined quality gate for ingest, ranking, and display. */
export function isLowQualityNewsArticle(
  article: RawNewsArticle,
  headlineOverride?: string
): boolean {
  const title = (headlineOverride ?? article.title).trim();
  if (!title) return true;
  if (isQuotePageNewsHeadline(title)) return true;
  if (isQuotePageNewsUrl(article.url)) return true;
  if (isTickerListSpamHeadline(title)) return true;
  return false;
}

export function filterLowQualityNewsArticles(articles: RawNewsArticle[]): RawNewsArticle[] {
  return articles.filter((article) => !isLowQualityNewsArticle(article));
}

/** @deprecated Use filterLowQualityNewsArticles */
export function filterQuotePageNewsArticles(articles: RawNewsArticle[]): RawNewsArticle[] {
  return filterLowQualityNewsArticles(articles);
}

export function filterArticlesForMarketDate(
  articles: RawNewsArticle[],
  marketDate: string
): RawNewsArticle[] {
  return articles.filter((article) => {
    if (article.publishedAt == null || !Number.isFinite(article.publishedAt)) return false;
    if (isoDateFromTimestampHelsinki(article.publishedAt) !== marketDate) return false;
    if (headlineImpliesBeforeMarketDate(article.title, marketDate)) return false;
    return true;
  });
}

export function filterFreshMarketArticles(
  articles: RawNewsArticle[],
  marketDate: string,
  maxAgeHours: number = NEWS_MAX_AGE_HOURS,
  nowMs: number = Date.now()
): RawNewsArticle[] {
  return filterLowQualityNewsArticles(
    filterArticlesByMaxAge(
      filterArticlesForMarketDate(articles, marketDate),
      maxAgeHours,
      nowMs
    )
  );
}

function articleSearchText(article: RawNewsArticle): string {
  const title = normalizeText(article.title);
  const publisher = normalizeText(article.publisher ?? "");
  const host = publisherHostname(article);
  return `${title} ${publisher} ${host}`;
}

export function filterArticlesForFiMarket(articles: RawNewsArticle[]): RawNewsArticle[] {
  return articles.filter((article) => {
    const text = articleSearchText(article);
    const hasLocal =
      countKeywordHits(text, FI_INDEX_TERMS) > 0 ||
      countKeywordHits(text, FI_PUBLISHER_TERMS) > 0;
    const hasUsMarket = countKeywordHits(text, FI_US_HEADLINE_TERMS) > 0;
    const hasEuroMacro = countKeywordHits(text, FI_MACRO_TERMS) > 0;

    if (hasUsMarket && !hasLocal && !hasEuroMacro) return false;
    return hasLocal || hasEuroMacro || !hasUsMarket;
  });
}

/** Broader FI pool for secondary fill when strict local relevance yields too few stories. */
export function filterArticlesForFiMarketSecondary(articles: RawNewsArticle[]): RawNewsArticle[] {
  const strictKeys = new Set(
    filterArticlesForFiMarket(articles).map((article) => normalizeDedupeKey(article))
  );

  return articles.filter((article) => {
    if (strictKeys.has(normalizeDedupeKey(article))) return false;

    const text = articleSearchText(article);
    const marketHits =
      countKeywordHits(text, MACRO_KEYWORDS) +
      countKeywordHits(text, US_INDEX_TERMS) +
      countKeywordHits(text, FI_INDEX_TERMS) +
      countKeywordHits(text, FI_MACRO_TERMS);
    return marketHits > 0;
  });
}

function compareArticleQuality(a: RawNewsArticle, b: RawNewsArticle): number {
  const tierDiff = sourceTier(b) - sourceTier(a);
  if (tierDiff !== 0) return tierDiff;

  const urlDiff = articleUrlQuality(b) - articleUrlQuality(a);
  if (urlDiff !== 0) return urlDiff;

  const ta = a.publishedAt ?? 0;
  const tb = b.publishedAt ?? 0;
  return tb - ta;
}

export function pickBestInCluster(articles: RawNewsArticle[]): RawNewsArticle {
  return [...articles].sort(compareArticleQuality)[0]!;
}

/** Collapse same-event clusters; keep the best source per cluster. */
export function clusterDedupeNewsArticles(articles: RawNewsArticle[]): RawNewsArticle[] {
  const clusters: RawNewsArticle[][] = [];

  for (const article of articles) {
    const title = article.title?.trim();
    if (!title) continue;

    let placed = false;
    for (const cluster of clusters) {
      if (cluster.some((existing) => headlinesShareTopic(existing.title, title))) {
        cluster.push({ ...article, title });
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([{ ...article, title }]);
  }

  return clusters.map(pickBestInCluster);
}

export function dedupeNewsArticles(articles: RawNewsArticle[]): RawNewsArticle[] {
  const seenUrls = new Set<string>();
  const urlUnique: RawNewsArticle[] = [];

  for (const article of articles) {
    const title = article.title?.trim();
    if (!title) continue;
    const urlKey = normalizeDedupeKey({ ...article, title });
    if (seenUrls.has(urlKey)) continue;
    seenUrls.add(urlKey);
    urlUnique.push({ ...article, title });
  }

  return clusterDedupeNewsArticles(urlUnique);
}

function countKeywordHits(text: string, keywords: string[]): number {
  let hits = 0;
  for (const kw of keywords) {
    if (text.includes(kw)) hits++;
  }
  return hits;
}

function moverTerms(movers: MarketHeatmapMover[]): string[] {
  const terms: string[] = [];
  for (const m of movers) {
    const label = displayCompanyLabel(m.name, m.symbol);
    if (label.length >= 2) terms.push(label.toLowerCase());
    const sym = m.symbol.split(".")[0]?.toLowerCase();
    if (sym && sym.length >= 2) terms.push(sym);
  }
  return terms;
}

function titleMentionsAny(text: string, terms: string[]): boolean {
  for (const term of terms) {
    if (term.length >= 2 && text.includes(term)) return true;
  }
  return false;
}

export function scoreNewsArticle(
  article: RawNewsArticle,
  ctx: MarketNewsRankingContext
): number {
  const text = articleSearchText(article);
  let score = 0;

  score += countKeywordHits(text, MACRO_KEYWORDS) * 4;
  score += sourceTierScoreBonus(article);

  if (ctx.variant === "fi") {
    score += countKeywordHits(text, FI_INDEX_TERMS) * 5;
    score += countKeywordHits(text, FI_PUBLISHER_TERMS) * 6;
    score += countKeywordHits(text, FI_MACRO_TERMS) * 3;
    score -= countKeywordHits(text, FI_US_HEADLINE_TERMS) * 8;
  } else {
    score += countKeywordHits(text, US_INDEX_TERMS) * 3;
  }

  const movers = [...(ctx.topMovers?.gainers ?? []), ...(ctx.topMovers?.losers ?? [])];
  if (movers.length > 0 && titleMentionsAny(text, moverTerms(movers))) {
    score += 5;
  }

  const breadth = ctx.sectorBreadth;
  if (breadth) {
    const sectors = [breadth.leadingSector, breadth.laggingSector]
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length >= 3);
    if (titleMentionsAny(text, sectors)) score += 4;
  }

  const directional = ctx.changePercent >= 0 ? BULLISH_TERMS : BEARISH_TERMS;
  score += countKeywordHits(text, directional);

  if (isTickerListSpamHeadline(article.title)) score -= 20;

  if (article.publishedAt != null && Number.isFinite(article.publishedAt)) {
    const ageHours = (Date.now() - article.publishedAt) / (1000 * 60 * 60);
    if (ageHours <= 6) score += 3;
    else if (ageHours <= 18) score += 2;
    else score += 1;
  }

  return score;
}

function pickDiverseArticles(
  scored: { article: RawNewsArticle; score: number }[],
  limit: number
): RawNewsArticle[] {
  const picked: RawNewsArticle[] = [];
  const usedPublishers = new Set<string>();
  const hasTier2Plus = scored.some(({ article }) => sourceTier(article) >= 2);

  for (const candidate of scored) {
    if (picked.length >= limit) break;

    if (hasTier2Plus && sourceTier(candidate.article) === 1) continue;

    const host = publisherHostname(candidate.article);
    if (host && usedPublishers.has(host)) continue;

    const overlapsTopic = picked.some((existing) =>
      headlinesShareTopic(existing.title, candidate.article.title)
    );
    if (overlapsTopic) continue;

    picked.push(candidate.article);
    if (host) usedPublishers.add(host);
  }

  return picked;
}

function scoreAndSortArticles(
  articles: RawNewsArticle[],
  ctx: MarketNewsRankingContext
): { article: RawNewsArticle; score: number }[] {
  return articles
    .map((article) => ({ article, score: scoreNewsArticle(article, ctx) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return compareArticleQuality(a.article, b.article);
    });
}

function pickSecondaryArticles(
  scored: { article: RawNewsArticle; score: number }[],
  alreadyPicked: RawNewsArticle[],
  limit: number
): RawNewsArticle[] {
  const picked: RawNewsArticle[] = [];
  const usedKeys = new Set(alreadyPicked.map((article) => normalizeDedupeKey(article)));

  for (const candidate of scored) {
    if (picked.length >= limit) break;

    const key = normalizeDedupeKey(candidate.article);
    if (usedKeys.has(key)) continue;

    const overlapsHeadline = [...alreadyPicked, ...picked].some((existing) =>
      headlinesAreDuplicates(existing.title, candidate.article.title)
    );
    if (overlapsHeadline) continue;

    picked.push(candidate.article);
    usedKeys.add(key);
  }

  return picked;
}

export type RankedNewsArticle = {
  article: RawNewsArticle;
  secondary: boolean;
};

export function rankNewsArticles(
  articles: RawNewsArticle[],
  ctx: MarketNewsRankingContext,
  target = TOP_STORIES_TARGET,
  marketDate?: string
): RankedNewsArticle[] {
  const cleaned = filterLowQualityNewsArticles(articles);
  const primaryPool = ctx.variant === "fi" ? filterArticlesForFiMarket(cleaned) : cleaned;
  const primaryDeduped = dedupeNewsArticles(primaryPool);
  const primaryScored = scoreAndSortArticles(primaryDeduped, ctx);
  const primaryPicked = pickDiverseArticles(primaryScored, target);

  const result: RankedNewsArticle[] = primaryPicked.map((article) => ({
    article,
    secondary: false,
  }));

  const need = target - result.length;
  if (need <= 0) return result;

  const secondaryFresh =
    marketDate != null
      ? filterFreshMarketArticles(cleaned, marketDate, NEWS_SECONDARY_MAX_AGE_HOURS)
      : filterArticlesByMaxAge(cleaned, NEWS_SECONDARY_MAX_AGE_HOURS);

  const secondarySource =
    ctx.variant === "fi"
      ? dedupeNewsArticles([
          ...primaryDeduped,
          ...filterArticlesForFiMarketSecondary(secondaryFresh),
        ])
      : dedupeNewsArticles(secondaryFresh);
  const secondaryScored = scoreAndSortArticles(secondarySource, ctx);
  const secondaryPicked = pickSecondaryArticles(secondaryScored, primaryPicked, need);

  for (const article of secondaryPicked) {
    result.push({ article, secondary: true });
  }

  return result;
}
