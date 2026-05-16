import {
  getActiveProvider,
  getGeminiApiKey,
  getOpenAiApiKey,
  isProviderConfigured,
} from "../aiSettings";
import type { AiProviderId } from "./types";
import { generateGeminiMarketSummary } from "./geminiProvider";
import { generateOpenAiMarketSummary } from "./openaiProvider";
import type { GenerateResult, MarketSummaryRequest } from "./types";

export type AiStatusResponse = {
  provider: AiProviderId;
  configured: boolean;
  gemini: { configured: boolean };
  openai: { configured: boolean };
};

export function getAiStatus(): AiStatusResponse {
  const provider = getActiveProvider();
  return {
    provider,
    configured: isProviderConfigured(provider),
    gemini: { configured: Boolean(getGeminiApiKey()) },
    openai: { configured: Boolean(getOpenAiApiKey()) },
  };
}

export async function generateMarketSummary(
  request: MarketSummaryRequest
): Promise<GenerateResult> {
  const provider = getActiveProvider();
  if (!isProviderConfigured(provider)) {
    const label = provider === "openai" ? "OpenAI" : "Gemini";
    return {
      ok: false,
      error: {
        provider,
        httpStatus: 503,
        message: `${label} is selected but no API key is configured. Add one under Options → Market AI.`,
      },
    };
  }

  if (provider === "openai") {
    return generateOpenAiMarketSummary(request);
  }
  return generateGeminiMarketSummary(request);
}
