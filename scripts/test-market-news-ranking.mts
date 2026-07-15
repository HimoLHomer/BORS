/**
 * Unit tests for market news ranking heuristics.
 * Run: npm run test:market-news
 */
import assert from "node:assert/strict";
import { publisherHostname } from "../src/marketNewsSources.ts";
import { todayIsoDateHelsinki } from "../src/formatDate.ts";
import {
  clusterDedupeNewsArticles,
  dedupeNewsArticles,
  filterArticlesForFiMarket,
  filterArticlesForFiMarketSecondary,
  filterArticlesForMarketDate,
  filterFreshMarketArticles,
  filterLowQualityNewsArticles,
  filterQuotePageNewsArticles,
  headlineImpliesBeforeMarketDate,
  headlinesAreDuplicates,
  headlinesShareTopic,
  isLowQualityNewsArticle,
  isQuotePageNewsHeadline,
  isQuotePageNewsUrl,
  isTickerListSpamHeadline,
  rankNewsArticles,
  scoreNewsArticle,
  type RawNewsArticle,
} from "../src/marketNewsRanking.ts";
import { parseGoogleNewsRss } from "../server/marketNews.ts";

const baseCtx = {
  variant: "us" as const,
  changePercent: 1.2,
};

function article(title: string, extra: Partial<RawNewsArticle> = {}): RawNewsArticle {
  return { title, url: `https://example.com/${encodeURIComponent(title)}`, ...extra };
}

const todayMs = Date.UTC(2026, 6, 6, 12, 0, 0);
const oldMs = Date.UTC(2026, 3, 23, 12, 0, 0);

assert.equal(dedupeNewsArticles([
  article("Fed holds rates steady"),
  article("Fed holds rates steady"),
  { title: "Different story", url: "https://reuters.com/a" },
]).length, 2);

assert.ok(
  headlinesAreDuplicates(
    "US Stock Market Today: S&P 500 Futures Rise As Inflation Jitters Temporarily Ease",
    "US Stock Market Today: S&P 500 Futures Rise As Inflation Jitters Temporarily Ease - Yahoo Finance"
  ),
  "Yahoo vs Google RSS headline should match"
);

const crossSource = dedupeNewsArticles([
  article("US Stock Market Today: S&P 500 Futures Rise As Inflation Jitters Temporarily Ease", {
    url: "https://finance.yahoo.com/article/1",
    publishedAt: todayMs,
  }),
  article(
    "US Stock Market Today: S&P 500 Futures Rise As Inflation Jitters Temporarily Ease - Yahoo Finance",
    { url: "https://news.google.com/rss/articles/abc", publishedAt: todayMs }
  ),
  article("Distinct macro headline about Federal Reserve policy", { publishedAt: todayMs }),
]);
assert.equal(crossSource.length, 2, "cross-source duplicate should collapse to one");

const iranHeadlines = [
  "Dow, Nasdaq, S&P 500 Futures Climb Amid US-Iran Tensions, Fed Inflation Worries: WULF, CMPS",
  "Dow, S&P 500, Nasdaq Futures Slide As US-Iran War Shock Sends Oil Soaring",
  "Stock market today: Dow, S&P 500, Nasdaq futures rose after US strikes Iran for second day",
];
assert.ok(headlinesShareTopic(iranHeadlines[0]!, iranHeadlines[1]!), "Iran futures headlines share topic");
assert.equal(
  clusterDedupeNewsArticles(iranHeadlines.map((h) => article(h))).length,
  1,
  "Iran cluster should collapse to one"
);

const diversePool = [
  article(iranHeadlines[0]!, { publisher: "Stocktwits", url: "https://stocktwits.com/iran1", publishedAt: todayMs }),
  article(iranHeadlines[1]!, { publisher: "Yahoo Finance", url: "https://finance.yahoo.com/iran2", publishedAt: todayMs }),
  article("Federal Reserve officials signal patience on rate cuts", {
    publisher: "Reuters",
    url: "https://www.reuters.com/fed",
    publishedAt: todayMs,
  }),
  article("Mega-cap tech earnings beat lifts sector outlook", {
    publisher: "Bloomberg",
    url: "https://www.bloomberg.com/earnings",
    publishedAt: todayMs,
  }),
  article("Oil prices jump as Middle East tensions escalate", {
    publisher: "AP",
    url: "https://apnews.com/oil",
    publishedAt: todayMs,
  }),
];
const diverseRanked = rankNewsArticles(diversePool, baseCtx);
assert.equal(
  diverseRanked.filter((r) => headlinesShareTopic(r.article.title, iranHeadlines[0]!)).length,
  1,
  "final list should include at most one Iran/futures narrative"
);
assert.ok(
  diverseRanked.some((r) => r.article.title.toLowerCase().includes("fed")),
  "diverse pick should keep separate macro stories"
);
assert.equal(diverseRanked.length, 3, "US panel should target three stories");

const publisherCapPool = [
  article("Iran tensions lift oil prices", {
    publisher: "Stocktwits",
    url: "https://stocktwits.com/a",
    publishedAt: todayMs,
  }),
  article("Fed inflation data in focus for traders", {
    publisher: "Stocktwits",
    url: "https://stocktwits.com/b",
    publishedAt: todayMs,
  }),
  article("Tech earnings beat expectations", {
    publisher: "Reuters",
    url: "https://www.reuters.com/tech",
    publishedAt: todayMs,
  }),
  article("Tariff talks resume between US and China", {
    publisher: "Bloomberg",
    url: "https://www.bloomberg.com/tariff",
    publishedAt: todayMs,
  }),
  article("Jobs report shows resilient labor market", {
    publisher: "CNBC",
    url: "https://www.cnbc.com/jobs",
    publishedAt: todayMs,
  }),
];
const publisherCapped = rankNewsArticles(publisherCapPool, baseCtx);
assert.equal(publisherCapped.length, 3, "should return three stories");
assert.ok(
  publisherCapped.filter((r) => publisherHostname(r.article).includes("stocktwits")).length === 0,
  "tier-1 syndication should not fill primary slots when tier-2+ alternatives exist"
);

const reutersScore = scoreNewsArticle(
  article("Oil rises on Iran tensions", {
    publisher: "Reuters",
    url: "https://www.reuters.com/oil",
  }),
  baseCtx
);
const stocktwitsScore = scoreNewsArticle(
  article("Oil rises on Iran tensions", {
    publisher: "Stocktwits",
    url: "https://stocktwits.com/oil",
  }),
  baseCtx
);
assert.ok(reutersScore > stocktwitsScore, "Reuters should outrank Stocktwits");

const fiFiltered = filterArticlesForFiMarket([
  article("US Stock Market: Fed minutes, corporate earnings to set the tone for Wall Street this week"),
  article("IQM:n osake jatkaa rymynousussa, Nokian lasku painaa pörssiä - Arvopaperi"),
  article("ECB holds rates steady as euro area inflation cools"),
]);
assert.equal(fiFiltered.length, 2);
assert.ok(fiFiltered.some((a) => a.title.includes("Arvopaperi")));
assert.ok(!fiFiltered.some((a) => a.title.includes("Wall Street")));

const fiRanked = rankNewsArticles(
  [
    article("US Stock Market Today: S&P 500 Futures Rise", { publishedAt: todayMs }),
    article("OMX Helsinki slips as Nokia weighs on index - Kauppalehti", { publishedAt: todayMs }),
    article("Nordea earnings beat lifts Finnish banking shares", { publishedAt: todayMs }),
  ],
  { variant: "fi", changePercent: -1 }
);
assert.ok(!fiRanked[0]!.article.title.includes("S&P 500"), "FI feed should not lead with US headline");
assert.ok(
  fiRanked.some((r) => /kauppalehti|nordea|omx|nokia/i.test(r.article.title)),
  "FI feed should include local stories"
);

const fedScore = scoreNewsArticle(article("Fed signals rate cut amid inflation data"), baseCtx);
const fluffScore = scoreNewsArticle(article("Celebrity wedding photos"), baseCtx);
assert.ok(fedScore > fluffScore, "macro headline should outrank fluff");

const moverCtx = {
  ...baseCtx,
  topMovers: {
    gainers: [{ symbol: "NVDA", name: "NVIDIA Corporation", changePercent: 3.5 }],
    losers: [],
  },
};
const moverScore = scoreNewsArticle(article("NVIDIA earnings beat lifts tech stocks"), moverCtx);
const genericScore = scoreNewsArticle(article("Tech stocks mixed in afternoon trade"), moverCtx);
assert.ok(moverScore > genericScore, "mover mention should boost score");

const todayOnly = filterArticlesForMarketDate(
  [
    article("Martela profit warning", { publishedAt: oldMs }),
    article("S&P 500 rises as Federal Reserve hints at cuts", { publishedAt: todayMs }),
    article("Undated macro headline"),
  ],
  "2026-07-06"
);
assert.equal(todayOnly.length, 1);
assert.ok(todayOnly[0]!.title.includes("Federal Reserve"));

const ranked = rankNewsArticles(
  [
    article("Random lifestyle piece", { publishedAt: todayMs }),
    article("S&P 500 rises as Federal Reserve hints at cuts", { publishedAt: todayMs }),
    article("Stock market gains on strong earnings season", { publishedAt: todayMs }),
  ],
  { ...baseCtx, changePercent: 0.8 }
);
assert.ok(
  ranked[0]!.article.title.includes("Federal Reserve") || ranked[0]!.article.title.includes("earnings")
);

const recentMs = Date.now() - 2 * 60 * 60 * 1000;

const thinRanked = rankNewsArticles(
  [
    article("Dow, Nasdaq, S&P 500 Futures Climb Amid US-Iran Tensions", {
      publisher: "Reuters",
      publishedAt: recentMs,
    }),
    article("Dow, S&P 500, Nasdaq Futures Slide As US-Iran War Shock Sends Oil Soaring", {
      publisher: "Bloomberg",
      publishedAt: recentMs,
    }),
    article("Federal Reserve officials signal patience on rate cuts", {
      publisher: "CNBC",
      publishedAt: recentMs,
    }),
    article("Mega-cap tech earnings beat lifts sector outlook", {
      publisher: "AP",
      publishedAt: recentMs,
    }),
    article("Tariff talks resume between US and China", {
      publisher: "Wall Street Journal",
      url: "https://www.wsj.com/tariff",
      publishedAt: recentMs,
    }),
  ],
  baseCtx,
  3,
  todayIsoDateHelsinki()
);
assert.equal(thinRanked.length, 3, "should fill to three stories when primary diverse pick is thin");
assert.ok(
  thinRanked.some((r) => r.secondary),
  "secondary tier should backfill when topic diversity leaves gaps"
);

const fiSecondaryPool = filterArticlesForFiMarketSecondary([
  article("US Stock Market Today: S&P 500 Futures Rise As Inflation Jitters Ease"),
  article("Celebrity wedding photos dominate social media"),
]);
assert.equal(fiSecondaryPool.length, 1, "secondary FI pool should include broad US market headlines");
assert.ok(fiSecondaryPool[0]!.title.includes("S&P 500"));

assert.ok(
  headlineImpliesBeforeMarketDate("Stock Market Today, July 8: Stocks Slide", "2026-07-09"),
  "headline with older calendar date should be treated as stale"
);
assert.ok(
  !headlineImpliesBeforeMarketDate("Stock Market Today, July 9: Stocks rise", "2026-07-09"),
  "headline matching market date should be allowed"
);

const july9Ms = Date.UTC(2026, 6, 9, 6, 0, 0);

const staleHeadlineFiltered = filterArticlesForMarketDate(
  [
    article("Stock Market Today, July 8: Stocks Slide", { publishedAt: july9Ms }),
    article("S&P 500 rises as Federal Reserve hints at cuts", { publishedAt: july9Ms }),
  ],
  "2026-07-09"
);
assert.equal(staleHeadlineFiltered.length, 1);
assert.ok(staleHeadlineFiltered[0]!.title.includes("Federal Reserve"));

const nowMs = Date.UTC(2026, 6, 9, 9, 0, 0);
const freshFiltered = filterFreshMarketArticles(
  [
    article("Fresh macro headline", { publishedAt: Date.UTC(2026, 6, 9, 6, 0, 0) }),
    article("Two-day-old headline", { publishedAt: Date.UTC(2026, 6, 7, 6, 0, 0) }),
  ],
  "2026-07-09",
  36,
  nowMs
);
assert.equal(freshFiltered.length, 1);
assert.ok(freshFiltered[0]!.title.includes("Fresh"));

const rssXml = `<?xml version="1.0"?>
<rss><channel>
<item>
  <title>OMX Helsinki edges higher</title>
  <link>https://news.example/omx</link>
  <pubDate>Mon, 06 Jul 2026 10:00:00 GMT</pubDate>
  <source>Example</source>
</item>
</channel></rss>`;
const parsed = parseGoogleNewsRss(rssXml);
assert.equal(parsed.length, 1);
assert.equal(parsed[0]!.title, "OMX Helsinki edges higher");
assert.equal(parsed[0]!.publisher, "Example");

assert.ok(
  isQuotePageNewsHeadline("EMUS.PK - Reuters"),
  "ticker-only PK headline should be rejected"
);
assert.ok(
  isQuotePageNewsHeadline("EMUS.PK - | Stock Price & Latest News - Reuters"),
  "Reuters quote page title should be rejected"
);
assert.ok(
  isQuotePageNewsHeadline("AXOCF.PK -"),
  "ticker with trailing dash should be rejected"
);
assert.ok(
  isQuotePageNewsHeadline("JCDX.MU"),
  "ticker-only MU headline should be rejected"
);
assert.ok(
  isQuotePageNewsHeadline("JCDX.MU - Reuters"),
  "ticker-only MU headline with publisher suffix should be rejected"
);
assert.ok(
  isQuotePageNewsHeadline("SAP.DE"),
  "ticker-only DE headline should be rejected"
);
assert.ok(
  !isQuotePageNewsHeadline("S&P 500, Nasdaq rise after cooler-than-expected CPI report"),
  "real market headline should pass"
);

const quoteFiltered = filterQuotePageNewsArticles([
  article("EMUS.PK - Reuters", { publisher: "Reuters", publishedAt: todayMs }),
  article("Federal Reserve officials signal patience on rate cuts", {
    publisher: "Reuters",
    publishedAt: todayMs,
  }),
]);
assert.equal(quoteFiltered.length, 1);
assert.ok(quoteFiltered[0]!.title.includes("Federal Reserve"));

const rankedWithoutQuotes = rankNewsArticles(
  [
    article("EMUS.PK - Reuters", { publisher: "Reuters", publishedAt: todayMs }),
    article("Warsh Says Fed Has No Tolerance for Elevated Inflation", {
      publisher: "Bloomberg",
      publishedAt: todayMs,
    }),
    article("S&P 500, Nasdaq rise after cooler-than-expected CPI report", {
      publisher: "Yahoo Finance",
      publishedAt: todayMs,
    }),
  ],
  baseCtx
);
assert.ok(
  rankedWithoutQuotes.every(({ article: a }) => !isQuotePageNewsHeadline(a.title)),
  "ranked stories should not include quote pages"
);

assert.ok(isQuotePageNewsHeadline("AAPL"), "bare ticker headline should be rejected");
assert.ok(
  isQuotePageNewsUrl("https://finance.yahoo.com/quote/JCDX.MU/"),
  "Yahoo quote URL should be rejected"
);
assert.ok(
  !isQuotePageNewsUrl("https://www.reuters.com/markets/stocks/inflation-2026-07-15/"),
  "Reuters article URL should pass"
);
assert.ok(
  isTickerListSpamHeadline(
    "Dow, S&P 500, Nasdaq Futures Rise After Chip Stock Selloff: Why CBRS, PLTR, BLZE, MU, FDX Are Trending"
  ),
  "Stocktwits-style ticker list headline should be rejected"
);
assert.ok(
  filterLowQualityNewsArticles([
    article("JCDX.MU", { url: "https://www.reuters.com/markets/quote/JCDX.MU" }),
    article("Stocks gain on drop in US inflation rate; ASML tops forecasts", {
      url: "https://www.reuters.com/markets/stocks/inflation-2026-07-15/",
    }),
  ]).length === 1,
  "low-quality filter should drop quote pages by title and URL"
);

const spamRanked = rankNewsArticles(
  [
    article(
      "Dow, S&P 500, Nasdaq Futures Rise After Chip Stock Selloff: Why CBRS, PLTR, BLZE, MU, FDX Are Trending",
      { publisher: "Stocktwits", url: "https://stocktwits.com/trending", publishedAt: todayMs }
    ),
    article("Stocks gain on drop in US inflation rate; ASML tops forecasts", {
      publisher: "Reuters",
      url: "https://www.reuters.com/markets/stocks/inflation-2026-07-15/",
      publishedAt: todayMs,
    }),
    article("S&P 500 futures climb as traders parse latest inflation data", {
      publisher: "Bloomberg",
      url: "https://www.bloomberg.com/inflation",
      publishedAt: todayMs,
    }),
  ],
  baseCtx
);
assert.ok(
  spamRanked[0]!.article.title.includes("inflation") ||
    spamRanked[0]!.article.title.includes("S&P 500 futures"),
  "legitimate macro headline should rank above ticker-list spam"
);
assert.ok(
  spamRanked.every(({ article: a }) => !isTickerListSpamHeadline(a.title)),
  "ranked list should exclude ticker-list spam"
);

console.log("OK: market news ranking tests passed.");
