import YahooFinance from "yahoo-finance2";
import { todayIsoDateHelsinki, isoDateFromTimestampHelsinki } from "../src/formatDate.ts";
import { filterArticlesForMarketDate } from "../src/marketNewsRanking.ts";
import { parseGoogleNewsRss } from "../server/marketNews.ts";

const yf = new YahooFinance();
const marketDate = todayIsoDateHelsinki();
console.log("marketDate", marketDate);

for (const q of ["S&P 500", "stock market today", "OMX Helsinki"]) {
  const r = (await yf.search(q, { newsCount: 8, quotesCount: 0 }, { validateResult: false })) as {
    news?: { title?: string }[];
  };
  console.log("\n=== Yahoo:", q, "count", r.news?.length ?? 0);
  for (const n of (r.news ?? []).slice(0, 5)) {
    const raw = n as Record<string, unknown>;
    const ts = raw.providerPublishTime ?? raw.publishTime ?? raw.publishedAt;
    const ms = typeof ts === "number" ? (ts > 1e12 ? ts : ts * 1000) : Date.parse(String(ts ?? ""));
    console.log({
      title: String(n.title ?? "").slice(0, 55),
      ts,
      helsinki: Number.isFinite(ms) ? isoDateFromTimestampHelsinki(ms) : null,
    });
  }
}

for (const [label, url] of [
  ["US RSS", "https://news.google.com/rss/search?q=S%26P+500+stock+market+when:1d&hl=en-US&gl=US&ceid=US:en"],
  ["FI RSS", "https://news.google.com/rss/search?q=Finland+stock+market+when:1d&hl=en&gl=FI&ceid=FI:en"],
] as const) {
  const res = await fetch(url, { headers: { "User-Agent": "BORS/1.0" } });
  const xml = await res.text();
  const articles = parseGoogleNewsRss(xml);
  const today = filterArticlesForMarketDate(articles, marketDate);
  console.log(`\n=== ${label} total=${articles.length} today=${today.length}`);
  for (const a of articles.slice(0, 3)) {
    console.log({
      title: a.title.slice(0, 55),
      helsinki: a.publishedAt ? isoDateFromTimestampHelsinki(a.publishedAt) : null,
    });
  }
}
