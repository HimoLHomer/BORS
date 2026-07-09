/** Publisher tiers and headline cleanup for market news. */

type ArticleLike = {
  title: string;
  url?: string;
  publisher?: string;
  publishedAt?: number;
};

const TIER3_HOSTS = [
  "reuters.com",
  "bloomberg.com",
  "apnews.com",
  "wsj.com",
  "cnbc.com",
  "ft.com",
  "kauppalehti.fi",
  "arvopaperi.fi",
  "yle.fi",
  "hs.fi",
  "talouselama.fi",
];

const TIER3_NAMES = [
  "reuters",
  "bloomberg",
  "associated press",
  "wall street journal",
  "cnbc",
  "financial times",
  "kauppalehti",
  "arvopaperi",
  "yle",
];

const TIER1_HOSTS = ["stocktwits.com", "investing.com"];
const TIER1_NAMES = ["stocktwits", "investing.com"];

export function publisherHostname(article: ArticleLike): string {
  if (article.url) {
    try {
      return new URL(article.url).hostname.replace(/^www\./i, "").toLowerCase();
    } catch {
      /* fall through */
    }
  }
  return (article.publisher ?? "").trim().toLowerCase();
}

export function isGoogleNewsRedirect(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
    return host === "news.google.com";
  } catch {
    return false;
  }
}

/** 1 = syndication/low quality, 2 = neutral, 3 = preferred wire/local. */
export function sourceTier(article: ArticleLike): number {
  const host = publisherHostname(article);
  const name = (article.publisher ?? host).toLowerCase();

  if (TIER3_HOSTS.some((h) => host.endsWith(h)) || TIER3_NAMES.some((n) => name.includes(n))) {
    return 3;
  }
  if (TIER1_HOSTS.some((h) => host.endsWith(h)) || TIER1_NAMES.some((n) => name.includes(n))) {
    return 1;
  }
  if (isGoogleNewsRedirect(article.url)) return 1;
  return 2;
}

export function sourceTierScoreBonus(article: ArticleLike): number {
  const tier = sourceTier(article);
  if (tier === 3) return 8;
  if (tier === 1) return -6;
  return 0;
}

/** Prefer direct publisher URLs when picking cluster winners. */
export function articleUrlQuality(article: ArticleLike): number {
  if (!article.url) return 0;
  if (isGoogleNewsRedirect(article.url)) return 0;
  if (article.url.includes("finance.yahoo.com")) return 1;
  return sourceTier(article) >= 3 ? 3 : 2;
}

const TICKER_TAIL_RE =
  /:\s*[A-Z]{1,5}(?:,\s*[A-Z]{1,5})+(?:\s+(?:stocks?|in focus|kept traders|on watch).*)?$/i;
const BOILERPLATE_PREFIX_RE =
  /^(?:stock market today|us stock market today|dow,?\s*nasdaq,?\s*s&p\s*500\s*futures)\s*:?\s*/i;

/** Shorter headline for UI; keeps core story text. */
export function cleanDisplayHeadline(title: string, publisher?: string): string {
  let t = title.trim();
  for (let i = 0; i < 3; i++) {
    const stripped = t.replace(/\s+[-–|]\s+[^-|–]+$/u, "").trim();
    if (stripped === t) break;
    t = stripped;
  }
  t = t.replace(BOILERPLATE_PREFIX_RE, "").trim();
  t = t.replace(TICKER_TAIL_RE, "").trim();
  if (publisher) {
    const pub = publisher.trim();
    if (pub && t.endsWith(` - ${pub}`)) t = t.slice(0, -(pub.length + 3)).trim();
  }
  return t || title.trim();
}
