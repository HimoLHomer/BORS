import type { GenerateResult, MarketSummaryRequest } from "./types";

export async function openAiModelsToTry(_apiKey: string): Promise<string[]> {
  return [];
}

export async function generateOpenAiMarketSummary(
  _request: MarketSummaryRequest
): Promise<GenerateResult> {
  return {
    ok: false,
    error: {
      provider: "openai",
      httpStatus: 503,
      message:
        "Top Stories require Google Gemini with web search. Switch provider under Options → Market AI.",
    },
  };
}
