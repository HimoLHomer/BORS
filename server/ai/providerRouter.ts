import { getGeminiApiKey, isGeminiConfigured } from "../aiSettings";
import { generateGeminiMarketSummary, geminiModelsToTry } from "./geminiProvider";
import type { GenerateResult, MarketSummaryRequest } from "./types";

export type AiStatusResponse = {
  configured: boolean;
  modelsToTry?: string[];
};

export function getAiStatus(): AiStatusResponse {
  return {
    configured: isGeminiConfigured(),
  };
}

export async function getAiStatusDetail(): Promise<AiStatusResponse> {
  const base = getAiStatus();
  const key = getGeminiApiKey();
  if (!key) return base;

  try {
    const modelsToTry = await geminiModelsToTry(key);
    return { ...base, modelsToTry };
  } catch {
    return base;
  }
}

export async function generateMarketSummary(
  request: MarketSummaryRequest
): Promise<GenerateResult> {
  if (!isGeminiConfigured()) {
    return {
      ok: false,
      error: {
        httpStatus: 503,
        message: "Gemini API key not configured. Add one under Options → Market AI.",
      },
    };
  }

  return generateGeminiMarketSummary(request);
}
