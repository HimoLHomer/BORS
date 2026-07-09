/** Top Stories types and display helpers for Market index panels. */

function normalizeSymbol(symbol: string): string {
  return symbol.split(".")[0]?.toUpperCase() ?? symbol.toUpperCase();
}

/** Short label for text (e.g. "Nokia Oyj" → "Nokia"). */
export function displayCompanyLabel(name: string, symbol: string): string {
  const n = name.trim();
  if (!n) return normalizeSymbol(symbol);
  const first = n.split(/\s+/)[0];
  return first && first.length >= 2 ? first : n;
}

export type MarketStoryReference = {
  title: string;
  url?: string;
};

export function formatStoryReferenceLabel(ref: MarketStoryReference): string {
  if (ref.url) {
    try {
      return new URL(ref.url).hostname.replace(/^www\./i, "");
    } catch {
      return ref.url;
    }
  }
  return ref.title.trim() || "Source";
}

export type MarketTopStory = {
  headline: string;
  source: string;
  url?: string;
  references?: MarketStoryReference[];
  /** Filled with relaxed ranking when primary diverse pick yields fewer than target. */
  secondary?: boolean;
};

export type MarketVariant = "us" | "fi";

/** Stories shown per market panel (primary + secondary fill). */
export const TOP_STORIES_TARGET = 3;
export const TOP_STORIES_MAX = TOP_STORIES_TARGET;
export const TOP_STORIES_HEADLINE_MAX = 120;

export const EMPTY_TOP_STORIES_USER_MESSAGE =
  "No top stories found for today. Try refresh in a few minutes.";

/** True when a parsed story field looks like JSON syntax, not human text. */
export function isInvalidStoryField(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/^[\{\}\[\],:]+$/.test(t)) return true;
  if (/^"?(stories|headline|source|url)"?\s*:/i.test(t)) return true;
  if (/^[\{\[]/.test(t) && /["\}\],:]/.test(t)) return true;
  return false;
}

function normalizeStoryUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (!trimmed || isInvalidStoryField(trimmed)) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return trimmed;
  } catch {
    return undefined;
  }
}

export function cleanStoryField(text: string, fallback = ""): string {
  let t = text.trim();
  const tailIdx = t.search(/\s*[\{\[]\s*"?$/);
  if (tailIdx > 12) t = t.slice(0, tailIdx).trim();
  if (isInvalidStoryField(t)) return fallback;
  return t;
}

export function sanitizeTopStory(story: MarketTopStory): MarketTopStory | null {
  const headline = cleanStoryField(story.headline, "");
  if (!headline) return null;

  const source = cleanStoryField(story.source, "News") || "News";
  const url = normalizeStoryUrl(story.url);
  const references = (story.references ?? [])
    .map((ref) => {
      const title = cleanStoryField(ref.title, "Source") || "Source";
      const refUrl = normalizeStoryUrl(ref.url);
      return { title, ...(refUrl ? { url: refUrl } : {}) };
    })
    .filter((ref) => !isInvalidStoryField(ref.title));

  return {
    headline: headline.slice(0, TOP_STORIES_HEADLINE_MAX),
    source,
    ...(url ? { url } : {}),
    ...(references.length > 0 ? { references } : {}),
    ...(story.secondary ? { secondary: true } : {}),
  };
}

export function sanitizeTopStories(stories: MarketTopStory[]): MarketTopStory[] {
  return stories
    .map(sanitizeTopStory)
    .filter((story): story is MarketTopStory => story != null);
}

export function storyReferencesForDisplay(story: MarketTopStory): MarketStoryReference[] {
  const cleaned = sanitizeTopStory(story);
  if (!cleaned) return [];
  const fromRefs = (cleaned.references ?? []).filter((ref) => !isInvalidStoryField(ref.title));
  if (fromRefs.length > 0) return fromRefs;
  const source = cleanStoryField(cleaned.source, "");
  if (!source) return [];
  const url = normalizeStoryUrl(cleaned.url);
  return [{ title: source, ...(url ? { url } : {}) }];
}
