export type AiProviderId = "gemini" | "openai";

export type MarketSummaryRequest = {
  prompt: string;
};

export type MarketSummaryResult = {
  summary: string;
  model: string;
  provider: AiProviderId;
  finishReason?: string;
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
