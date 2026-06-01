export type AiProviderId = "gemini" | "openai";

import type { MarketSummaryValidationContext } from "../../src/marketAiValidation";

export type MarketSummaryRequest = {
  prompt: string;
  validation?: MarketSummaryValidationContext;
};

export type MarketSummaryResult = {
  summary: string;
  model: string;
  provider: AiProviderId;
  finishReason?: string;
  cached?: boolean;
  /** Calendar date the summary was grounded for (YYYY-MM-DD, Helsinki). */
  marketDate?: string;
};

export type MarketSummaryError = {
  httpStatus: number;
  message: string;
  code?: number;
  provider: AiProviderId;
};

export type GenerateResult =
  | { ok: true; result: MarketSummaryResult }
  | { ok: false; error: MarketSummaryError };
