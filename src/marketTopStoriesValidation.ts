/** Validation and deduplication for Market Top Stories. */

import {
  BANNED_VAGUE_PHRASES,
  TOP_STORIES_HEADLINE_MAX,
  TOP_STORIES_MAX,
  type MarketTopStory,
  type MarketVariant,
} from "./marketTopStories";

export type MarketTopStoriesValidationContext = {
  variant: MarketVariant;
  marketDate: string;
  indexLabel: string;
};

const FUTURE_TENSE =
  /\b(is due|will release|will be released|will report|upcoming|expected on|scheduled for|due on|due tomorrow|expecting|expected to|soon)\b/i;

const COMMENTARY =
  /\b(analysts say|analysts expect|could weigh|may weigh|might push|likely to|outlook|forecast suggests|in focus)\b/i;

const MULTI_SENTENCE = /[.!?].+\S/;

function normalizeForDedupe(headline: string): string {
  return headline
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(normalizeForDedupe(a).split(" ").filter((w) => w.length > 3));
  const tb = new Set(normalizeForDedupe(b).split(" ").filter((w) => w.length > 3));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const w of ta) if (tb.has(w)) shared++;
  return shared / Math.min(ta.size, tb.size);
}

export function dedupeTopStories(stories: MarketTopStory[]): MarketTopStory[] {
  const out: MarketTopStory[] = [];
  for (const story of stories) {
    const dup = out.find((s) => {
      const na = normalizeForDedupe(s.headline);
      const nb = normalizeForDedupe(story.headline);
      if (na === nb) return true;
      if (na.length > 12 && nb.length > 12 && (na.includes(nb) || nb.includes(na))) return true;
      return tokenOverlap(s.headline, story.headline) >= 0.65;
    });
    if (!dup) out.push(story);
  }
  return out.slice(0, TOP_STORIES_MAX);
}

function hasBannedPhrase(text: string): boolean {
  const lower = text.toLowerCase();
  return BANNED_VAGUE_PHRASES.split(",").some((p) => lower.includes(p.trim().toLowerCase()));
}

function isOffRegion(headline: string, variant: MarketVariant): boolean {
  const lower = headline.toLowerCase();
  if (variant === "us") {
    return /\bomx helsinki\b|\bomxh\b|\bhelsinki stock\b|\bnasdaq helsinki\b/i.test(lower);
  }
  return false;
}

function validateStory(story: MarketTopStory, ctx: MarketTopStoriesValidationContext): string[] {
  const reasons: string[] = [];
  const h = story.headline.trim();
  if (!h) reasons.push("empty headline");
  if (h.length > TOP_STORIES_HEADLINE_MAX) reasons.push(`headline too long: ${h.slice(0, 40)}…`);
  if (MULTI_SENTENCE.test(h)) reasons.push("headline must be one sentence");
  if (FUTURE_TENSE.test(h)) reasons.push(`future tense: ${h.slice(0, 50)}`);
  if (COMMENTARY.test(h)) reasons.push(`commentary: ${h.slice(0, 50)}`);
  if (hasBannedPhrase(h)) reasons.push(`vague phrasing: ${h.slice(0, 50)}`);
  if (isOffRegion(h, ctx.variant)) reasons.push(`wrong region: ${h.slice(0, 50)}`);
  return reasons;
}

export function validateTopStories(
  stories: MarketTopStory[],
  ctx: MarketTopStoriesValidationContext
): { ok: true; stories: MarketTopStory[] } | { ok: false; reasons: string[] } {
  if (stories.length === 0) {
    return { ok: false, reasons: ["no stories in JSON"] };
  }
  if (stories.length > TOP_STORIES_MAX) {
    return { ok: false, reasons: [`too many stories (${stories.length})`] };
  }

  const reasons: string[] = [];
  const cleaned: MarketTopStory[] = [];

  for (const story of stories) {
    const itemReasons = validateStory(story, ctx);
    if (itemReasons.length > 0) {
      reasons.push(...itemReasons);
      continue;
    }
    cleaned.push({
      headline: story.headline.trim().slice(0, TOP_STORIES_HEADLINE_MAX),
      source: story.source.trim() || "News",
      ...(story.url ? { url: story.url } : {}),
    });
  }

  const deduped = dedupeTopStories(cleaned);
  if (deduped.length === 0) {
    return { ok: false, reasons: reasons.length ? reasons : ["all stories rejected"] };
  }

  if (reasons.length > 0 && deduped.length < Math.min(stories.length, 2)) {
    return { ok: false, reasons };
  }

  return { ok: true, stories: deduped };
}

export function buildTopStoriesRetrySuffix(reasons: string[]): string {
  return `

REJECTED — fix and output JSON only:
${reasons.slice(0, 8).map((r) => `- ${r}`).join("\n")}

Return {"stories":[{"headline":"...","source":"..."}]} with 1-5 factual English headlines. No commentary. No future events.`;
}

export const TOP_STORIES_STRICT_SUFFIX = `

Output ONLY valid JSON: {"stories":[{"headline":"...","source":"..."}]}. Max 5 items. Factual headlines only.`;
