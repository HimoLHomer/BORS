import type { MarketTopStory } from "../../src/marketTopStories";
import type { MarketTopStoriesValidationContext } from "../../src/marketTopStoriesValidation";

export type MarketSummaryRequest = {
  prompt: string;
  validation?: MarketTopStoriesValidationContext;
};

export type MarketSummaryResult = {
  /** Error text when stories are absent. */
  summary: string;
  stories?: MarketTopStory[];
  /** Google Search suggestions HTML (grounding compliance). */
  searchEntryPointHtml?: string;
  model: string;
  finishReason?: string;
  cached?: boolean;
  /** Calendar date the stories were grounded for (YYYY-MM-DD, Helsinki). */
  marketDate?: string;
};

export type MarketSummaryError = {
  httpStatus: number;
  message: string;
  code?: number;
};

export type GenerateResult =
  | { ok: true; result: MarketSummaryResult }
  | { ok: false; error: MarketSummaryError };
