/** Top Stories prompts and JSON parsing for Market index panels. */

import { formatPercentFi } from "./formatNumber";
import { displayCompanyLabel } from "./marketAiValidation";

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

export type MarketTopStory = {
  headline: string;
  source: string;
  url?: string;
};

export type MarketVariant = "us" | "fi";

export const TOP_STORIES_MAX = 5;
export const TOP_STORIES_HEADLINE_MAX = 120;

export const BANNED_VAGUE_PHRASES =
  "investors are reacting, investors reacted, bolstered sentiment, positive sentiment, risk appetite, easing pressures, broader market, institutional investors, markets rose on, markets fell on, sentiment improved, risk-on, risk-off";

export const MARKET_TOP_STORIES_SYSTEM_INSTRUCTION = `You are a financial news editor. Output ONLY valid JSON — no markdown, no prose outside JSON.

Schema:
{"stories":[{"headline":"...","source":"..."}, ...]}

Rules:
- 1 to 5 stories, ranked by index-moving impact (macro/rates/geopolitics/mega-cap earnings first).
- Each story = ONE factual headline of a REAL event from the market date. English only.
- headline: short, neutral, ≤120 characters, no analysis or predictions.
- source: publisher name (e.g. Reuters, Bloomberg, Kauppalehti).
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

function pushParsedTopStory(
  out: MarketTopStory[],
  seen: Set<string>,
  headline: string,
  source: string,
  url?: string
): void {
  const h = headline.trim();
  if (!h) return;
  const key = h.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  out.push({
    headline: h.slice(0, TOP_STORIES_HEADLINE_MAX),
    source: source.trim() || "News",
    ...(url ? { url } : {}),
  });
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
  const completePairRe =
    /"headline"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"source"\s*:\s*"((?:\\.|[^"\\])*)"/gi;
  let match: RegExpExecArray | null;
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
  if (stories && stories.length > 0) return stories;
  const strict = parseTopStoriesJson(summary);
  if (strict && strict.length > 0) return strict;
  return parseTopStoriesJsonLenient(summary);
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
    return {
      ...story,
      url: chunk.uri,
      source: story.source === "News" && chunk.title ? chunk.title : story.source,
    };
  });
}

export function extractGroundingChunks(metadata: unknown): GroundingChunkRef[] {
  if (!metadata || typeof metadata !== "object") return [];
  const m = metadata as {
    groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
  };
  const chunks = m.groundingChunks ?? [];
  return chunks
    .map((c) => ({
      uri: c.web?.uri,
      title: c.web?.title,
    }))
    .filter((c) => c.uri || c.title);
}

export function extractSearchEntryPointHtml(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const m = metadata as {
    searchEntryPoint?: { renderedContent?: string };
  };
  const html = m.searchEntryPoint?.renderedContent?.trim();
  return html || undefined;
}
