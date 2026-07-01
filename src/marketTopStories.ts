/** Top Stories prompts and JSON parsing for Market index panels. */

import { formatPercentFi } from "./formatNumber";

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

export type MarketHeatmapMover = {
  symbol: string;
  name: string;
  changePercent: number;
};

export type MarketSectorBreadth = {
  leadingSector: string;
  leadingAvgPct: number;
  laggingSector: string;
  laggingAvgPct: number;
};

export type MarketAiQuoteContext = {
  label: string;
  price: number | null;
  changePercent: number;
  currency: string;
  marketDate: string;
  asOf?: string | null;
  topMovers?: {
    gainers: MarketHeatmapMover[];
    losers: MarketHeatmapMover[];
  };
  sectorBreadth?: MarketSectorBreadth;
};

export type MarketStoryReference = {
  title: string;
  url?: string;
};

export function formatStoryReferenceLabel(ref: MarketStoryReference): string {
  if (ref.url) {
    try {
      return new URL(ref.url).hostname.replace(/^www\./i, '');
    } catch {
      return ref.url;
    }
  }
  return ref.title.trim() || 'Source';
}

export function formatStoryReferenceHint(ref: MarketStoryReference): string | null {
  if (!ref.url || !ref.title) return null;
  const title = ref.title.trim();
  if (!title || title === 'Source' || title === 'News') return null;
  try {
    const host = new URL(ref.url).hostname.replace(/^www\./i, '');
    if (title.toLowerCase() === host.toLowerCase()) return null;
  } catch {
    /* keep title hint */
  }
  return title;
}

export type MarketTopStory = {
  headline: string;
  source: string;
  url?: string;
  references?: MarketStoryReference[];
};

export type MarketVariant = "us" | "fi";

export const TOP_STORIES_MAX = 5;
export const TOP_STORIES_HEADLINE_MAX = 120;

export const BANNED_VAGUE_PHRASES =
  "investors are reacting, investors reacted, bolstered sentiment, positive sentiment, risk appetite, easing pressures, broader market, institutional investors, markets rose on, markets fell on, sentiment improved, risk-on, risk-off";

export const MARKET_TOP_STORIES_SYSTEM_INSTRUCTION = `You are a financial news editor. Output ONLY valid JSON — no markdown, no prose outside JSON.

Schema:
{"stories":[{"headline":"...","source":"...","url":"..."}, ...]}

Rules:
- 1 to 5 stories, ranked by index-moving impact (macro/rates/geopolitics/mega-cap earnings first).
- Each story = ONE factual headline of a REAL event from the market date. English only.
- headline: short, neutral, ≤120 characters, no analysis or predictions.
- source: publisher name (e.g. Reuters, Bloomberg, Kauppalehti).
- url: article URL from search results when available; omit only if no URL was found.
- Merge duplicate reporting of the same event into one story.
- No commentary ("investors reacted", "markets buoyed by sentiment").
- No future events ("will report", "is due", "expected to").
- No investment advice.
- Never use: ${BANNED_VAGUE_PHRASES}.`;

export const MARKET_TOP_STORIES_AI_CONFIG = {
  maxOutputTokens: 1024,
  temperature: 0.15,
  systemInstruction: MARKET_TOP_STORIES_SYSTEM_INSTRUCTION,
} as const;

function fmtPct(pct: number): string {
  if (!Number.isFinite(pct)) return "0 %";
  return formatPercentFi(pct, 2, { showPlus: true });
}

function fmtLevel(price: number | null, currency: string): string {
  if (price == null || !Number.isFinite(price)) return "level unavailable";
  return `${price.toFixed(2)} ${currency}`;
}

function formatMoversContext(ctx: MarketAiQuoteContext): string {
  const g = ctx.topMovers?.gainers ?? [];
  const l = ctx.topMovers?.losers ?? [];
  if (g.length === 0 && l.length === 0) return "";
  const lines = ["Notable heatmap movers (prioritize related headlines):"];
  if (g.length) {
    lines.push(
      "Gainers: " +
        g
          .map((m) => `${displayCompanyLabel(m.name, m.symbol)} ${fmtPct(m.changePercent)}`)
          .join("; ")
    );
  }
  if (l.length) {
    lines.push(
      "Losers: " +
        l
          .map((m) => `${displayCompanyLabel(m.name, m.symbol)} ${fmtPct(m.changePercent)}`)
          .join("; ")
    );
  }
  return lines.join("\n") + "\n\n";
}

function formatSectorContext(ctx: MarketAiQuoteContext): string {
  const b = ctx.sectorBreadth;
  if (!b) return "";
  return `Sector breadth: ${b.leadingSector} ${fmtPct(b.leadingAvgPct)} (strongest), ${b.laggingSector} ${fmtPct(b.laggingAvgPct)} (weakest).\n\n`;
}

function usSearchGuidance(marketDate: string): string {
  return `Search ${marketDate} using US/global financial sources (Reuters, Bloomberg, CNBC, WSJ, AP, major earnings wires).

Include ONLY US/global market-moving events (Fed, CPI, tariffs, megacap earnings, oil/geopolitics when S&P-relevant).
Exclude OMX/Nordic-only stories and generic non-market news.`;
}

function fiSearchGuidance(marketDate: string): string {
  return `Search ${marketDate} using Finnish/Nordic sources (Kauppalehti, Helsingin Sanomat business, Nordnet, Yle, Nordic exchange news).

Include ONLY Finland/Nordic market-moving events (OMX Helsinki, OMX25 constituents, ECB/rates when Helsinki-relevant, Nordic earnings).
Exclude US-only stories unless they clearly moved European/Nordic markets that day.
Write headlines in English even when sources are Finnish.`;
}

function buildTopStoriesPrompt(ctx: MarketAiQuoteContext, variant: MarketVariant): string {
  const asOfLine = ctx.asOf ? `Quote snapshot: ${ctx.asOf}.\n` : "";
  const search = variant === "us" ? usSearchGuidance(ctx.marketDate) : fiSearchGuidance(ctx.marketDate);

  return `Market date (Europe/Helsinki): ${ctx.marketDate}
${asOfLine}Index: ${ctx.label}
Level: ${fmtLevel(ctx.price, ctx.currency)}
Session move: ${fmtPct(ctx.changePercent)}

${formatSectorContext(ctx)}${formatMoversContext(ctx)}${search}

Return JSON with up to 5 top stories for ${ctx.label} on ${ctx.marketDate}.
Rank by market impact. Factual headlines only — no summaries or commentary.`;
}

export function buildUsTopStoriesPrompt(ctx: MarketAiQuoteContext): string {
  return buildTopStoriesPrompt(ctx, "us");
}

export function buildFiTopStoriesPrompt(ctx: MarketAiQuoteContext): string {
  return buildTopStoriesPrompt(ctx, "fi");
}

export function buildTopStoriesPromptForVariant(
  ctx: MarketAiQuoteContext,
  variant: MarketVariant
): string {
  return variant === "fi" ? buildFiTopStoriesPrompt(ctx) : buildUsTopStoriesPrompt(ctx);
}

export type GroundingChunkRef = { uri?: string; title?: string };

export const EMPTY_TOP_STORIES_USER_MESSAGE =
  "No top stories found for this market date. Try refresh in a few minutes.";

function extractTopStoriesJsonString(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  let jsonStr = trimmed;
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) jsonStr = fence[1].trim();
  else {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    jsonStr = trimmed.slice(start, end + 1);
  }
  return jsonStr;
}

/** True when text is a top-stories JSON object (including `{"stories":[]}`). */
export function isTopStoriesJsonEnvelope(text: string): boolean {
  const jsonStr = extractTopStoriesJsonString(text);
  if (!jsonStr) return false;
  try {
    const parsed = JSON.parse(jsonStr) as { stories?: unknown };
    return Array.isArray(parsed.stories);
  } catch {
    return false;
  }
}

function unescapeJsonString(s: string): string {
  return s
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

/** True when a parsed story field looks like JSON syntax, not human text. */
export function isInvalidStoryField(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/^[\{\}\[\],:]+$/.test(t)) return true;
  if (/^"?(stories|headline|source|url)"?\s*:/i.test(t)) return true;
  if (/^[\{\[]/.test(t) && /["\}\],:]/.test(t)) return true;
  if (isRawTopStoriesPayload(t)) return true;
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
  };
}

export function sanitizeTopStories(stories: MarketTopStory[]): MarketTopStory[] {
  return stories
    .map(sanitizeTopStory)
    .filter((story): story is MarketTopStory => story != null);
}

function pushParsedTopStory(
  out: MarketTopStory[],
  seen: Set<string>,
  headline: string,
  source: string,
  url?: string
): void {
  const cleaned = sanitizeTopStory({
    headline,
    source,
    ...(url ? { url } : {}),
  });
  if (!cleaned) return;
  const key = cleaned.headline.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  out.push(cleaned);
  if (out.length >= TOP_STORIES_MAX) return;
}

export function parseTopStoriesJson(text: string): MarketTopStory[] | null {
  const jsonStr = extractTopStoriesJsonString(text);
  if (!jsonStr) return null;

  try {
    const parsed = JSON.parse(jsonStr) as { stories?: unknown };
    if (!Array.isArray(parsed.stories)) return null;
    const out: MarketTopStory[] = [];
    const seen = new Set<string>();
    for (const item of parsed.stories) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const headline = typeof o.headline === "string" ? o.headline : "";
      const source = typeof o.source === "string" ? o.source : "";
      const url = typeof o.url === "string" ? o.url.trim() : undefined;
      pushParsedTopStory(out, seen, headline, source, url);
      if (out.length >= TOP_STORIES_MAX) break;
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/** Recover stories from truncated or malformed top-stories JSON (e.g. MAX_TOKENS). */
export function parseTopStoriesJsonLenient(text: string): MarketTopStory[] {
  const out: MarketTopStory[] = [];
  const seen = new Set<string>();

  const withUrlRe =
    /"headline"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"source"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"url"\s*:\s*"((?:\\.|[^"\\])*)"/gi;
  let match: RegExpExecArray | null;
  while ((match = withUrlRe.exec(text)) !== null) {
    pushParsedTopStory(
      out,
      seen,
      unescapeJsonString(match[1] ?? ""),
      unescapeJsonString(match[2] ?? ""),
      unescapeJsonString(match[3] ?? "")
    );
    if (out.length >= TOP_STORIES_MAX) break;
  }
  if (out.length > 0) return out;

  const completePairRe =
    /"headline"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"source"\s*:\s*"((?:\\.|[^"\\])*)"/gi;
  while ((match = completePairRe.exec(text)) !== null) {
    pushParsedTopStory(
      out,
      seen,
      unescapeJsonString(match[1] ?? ""),
      unescapeJsonString(match[2] ?? "")
    );
    if (out.length >= TOP_STORIES_MAX) break;
  }
  if (out.length > 0) return out;

  const objectRe =
    /\{\s*"headline"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"source"\s*:\s*"((?:\\.|[^"\\])*)"\s*\}/gi;
  while ((match = objectRe.exec(text)) !== null) {
    pushParsedTopStory(
      out,
      seen,
      unescapeJsonString(match[1] ?? ""),
      unescapeJsonString(match[2] ?? "")
    );
    if (out.length >= TOP_STORIES_MAX) break;
  }
  return out;
}

export function coalesceTopStoriesFromText(
  stories: MarketTopStory[] | null | undefined,
  summary: string
): MarketTopStory[] {
  if (stories && stories.length > 0) return sanitizeTopStories(stories);
  const strict = parseTopStoriesJson(summary);
  if (strict && strict.length > 0) return strict;
  return sanitizeTopStories(parseTopStoriesJsonLenient(summary));
}

/** True when text looks like a top-stories JSON payload that must not be shown raw. */
export function isRawTopStoriesPayload(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (isTopStoriesJsonEnvelope(t)) return true;

  const unfenced = t
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (unfenced !== t && isTopStoriesJsonEnvelope(unfenced)) return true;

  const probe = unfenced || t;
  if (!/"stories"\s*:/i.test(probe)) return false;
  if (/"headline"\s*:/.test(probe)) return true;
  return probe.startsWith("{") || probe.includes("[");
}

export function sanitizeTopStoriesFallback(summary: string): string {
  const trimmed = summary.trim();
  if (!trimmed) return "";
  if (isRawTopStoriesPayload(trimmed)) return EMPTY_TOP_STORIES_USER_MESSAGE;
  return trimmed;
}

export function enrichStoriesWithGrounding(
  stories: MarketTopStory[],
  chunks: GroundingChunkRef[]
): MarketTopStory[] {
  if (chunks.length === 0) return stories;
  return stories.map((story, i) => {
    if (story.url) return story;
    const chunk = chunks[i % chunks.length];
    if (!chunk?.uri) return story;
    return sanitizeTopStory({
      ...story,
      url: chunk.uri,
      source: story.source === "News" && chunk.title ? chunk.title : story.source,
    }) ?? story;
  });
}

type GroundingSupportRef = {
  segmentText: string;
  chunkIndices: number[];
};

function headlineOverlapsSegment(headline: string, segmentText: string): boolean {
  const h = headline.trim().toLowerCase();
  const s = segmentText.trim().toLowerCase();
  if (!h || !s) return false;
  if (s.includes(h.slice(0, Math.min(48, h.length))) || h.includes(s.slice(0, 48))) {
    return true;
  }
  const hw = new Set(h.split(/\s+/).filter((w) => w.length > 4));
  if (hw.size === 0) return false;
  let shared = 0;
  for (const w of s.split(/\s+/)) {
    if (w.length > 4 && hw.has(w)) shared++;
  }
  return shared >= 2;
}

export function extractGroundingSupports(metadata: unknown): GroundingSupportRef[] {
  if (!metadata || typeof metadata !== "object") return [];
  const m = metadata as Record<string, unknown>;
  const raw = m.groundingSupports ?? m.grounding_supports;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((support) => {
      if (!support || typeof support !== "object") {
        return { segmentText: "", chunkIndices: [] as number[] };
      }
      const item = support as Record<string, unknown>;
      const segment = item.segment as { text?: string } | undefined;
      const indices =
        (item.groundingChunkIndices as number[] | undefined) ??
        (item.grounding_chunk_indices as number[] | undefined) ??
        [];
      return {
        segmentText: segment?.text?.trim() ?? "",
        chunkIndices: indices.filter((index) => Number.isInteger(index) && index >= 0),
      };
    })
    .filter((support) => support.segmentText.length > 0 || support.chunkIndices.length > 0);
}

export function attachStoryReferences(
  stories: MarketTopStory[],
  metadata: unknown
): MarketTopStory[] {
  const chunks = extractGroundingChunks(metadata);
  const chunksWithUri = chunks.filter((chunk) => chunk.uri);
  const supports = extractGroundingSupports(metadata);

  return sanitizeTopStories(
    stories.map((story, storyIndex) => {
      const refMap = new Map<string, MarketStoryReference>();

      const addRef = (title: string | undefined, url: string | undefined) => {
        const label = cleanStoryField(title ?? "", "");
        const href = normalizeStoryUrl(url);
        if (!label && !href) return;
        const displayTitle = label || href || "Source";
        const key = href ?? displayTitle.toLowerCase();
        if (refMap.has(key)) return;
        refMap.set(key, { title: displayTitle, ...(href ? { url: href } : {}) });
      };

      for (const support of supports) {
        if (!headlineOverlapsSegment(story.headline, support.segmentText)) continue;
        for (const index of support.chunkIndices) {
          const chunk = chunks[index];
          if (chunk) addRef(chunk.title || story.source, chunk.uri);
        }
      }

      if (chunksWithUri.length > 0) {
        const indexChunk = chunksWithUri[storyIndex % chunksWithUri.length];
        if (indexChunk) addRef(indexChunk.title || story.source, indexChunk.uri);
      } else if (chunks[storyIndex]) {
        const chunk = chunks[storyIndex];
        addRef(chunk.title || story.source, chunk.uri);
      }

      for (const chunk of chunksWithUri) {
        const source = story.source.trim().toLowerCase();
        const title = chunk.title?.trim().toLowerCase() ?? "";
        if (source && title && (title.includes(source) || source.includes(title))) {
          addRef(chunk.title || story.source, chunk.uri);
        }
      }

      if (story.url) addRef(story.source, story.url);

      const source = cleanStoryField(story.source, "");
      if (source) addRef(source, story.url);

      const references = [...refMap.values()].filter((ref) => !isInvalidStoryField(ref.title));
      const primaryUrl = references.find((ref) => ref.url)?.url ?? normalizeStoryUrl(story.url);

      return {
        ...story,
        ...(references.length > 0 ? { references } : {}),
        url: primaryUrl,
      };
    })
  );
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

function findGroundingMetadata(value: unknown, depth = 0): unknown {
  if (!value || typeof value !== "object" || depth > 5) return undefined;
  const record = value as Record<string, unknown>;
  if (record.groundingMetadata != null) return record.groundingMetadata;
  if (record.grounding_metadata != null) return record.grounding_metadata;
  for (const child of Object.values(record)) {
    const found = findGroundingMetadata(child, depth + 1);
    if (found != null) return found;
  }
  return undefined;
}

export function extractGroundingMetadataFromResponse(response: unknown): unknown {
  if (!response || typeof response !== "object") return undefined;
  const root = response as Record<string, unknown>;
  const candidate = (root.candidates as unknown[] | undefined)?.[0];
  return (
    (candidate as { groundingMetadata?: unknown } | undefined)?.groundingMetadata ??
    (candidate as { grounding_metadata?: unknown } | undefined)?.grounding_metadata ??
    root.groundingMetadata ??
    root.grounding_metadata ??
    findGroundingMetadata(response)
  );
}

export function extractGroundingChunks(metadata: unknown): GroundingChunkRef[] {
  if (!metadata || typeof metadata !== "object") return [];
  const m = metadata as Record<string, unknown>;
  const raw = m.groundingChunks ?? m.grounding_chunks;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return { uri: undefined, title: undefined };
      const chunk = item as Record<string, unknown>;
      const web = chunk.web as Record<string, unknown> | undefined;
      const retrieved = chunk.retrievedContext as Record<string, unknown> | undefined;
      const uri =
        (typeof web?.uri === "string" && web.uri) ||
        (typeof web?.url === "string" && web.url) ||
        (typeof retrieved?.uri === "string" && retrieved.uri) ||
        (typeof chunk.uri === "string" && chunk.uri) ||
        undefined;
      const title =
        (typeof web?.title === "string" && web.title) ||
        (typeof retrieved?.title === "string" && retrieved.title) ||
        (typeof chunk.title === "string" && chunk.title) ||
        undefined;
      return { uri, title };
    })
    .filter((c) => c.uri || c.title);
}
