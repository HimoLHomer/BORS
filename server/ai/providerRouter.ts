import {
  getActiveProvider,
  getGeminiApiKey,
  getOpenAiApiKey,
  isProviderConfigured,
} from "../aiSettings";
import type { AiProviderId } from "./types";
import { generateGeminiMarketSummary } from "./geminiProvider";
import { openAiModelsToTry, generateOpenAiMarketSummary } from "./openaiProvider";
import { geminiModelsToTry } from "./geminiProvider";
import { openAiSupportsChat } from "./modelSelection";
import type { GenerateResult, MarketSummaryRequest } from "./types";

export type AiStatusResponse = {
  provider: AiProviderId;
  configured: boolean;
  gemini: { configured: boolean };
  openai: { configured: boolean };
  modelsToTry?: string[];
  modelOverride?: string | null;
  modelOverrideSupported?: boolean;
};

export function getAiStatus(): AiStatusResponse {
  const provider = getActiveProvider();
  const openaiModel = process.env.OPENAI_MODEL?.trim() || null;
  const geminiModel = process.env.GEMINI_MODEL?.trim() || null;
  return {
    provider,
    configured: isProviderConfigured(provider),
    gemini: { configured: Boolean(getGeminiApiKey()) },
    openai: { configured: Boolean(getOpenAiApiKey()) },
    modelOverride: provider === "openai" ? openaiModel : geminiModel,
    modelOverrideSupported:
      provider === "openai" && openaiModel ? openAiSupportsChat(openaiModel) : true,
  };
}

export async function getAiStatusDetail(): Promise<AiStatusResponse> {
  const base = getAiStatus();
  const provider = base.provider;
  if (!isProviderConfigured(provider)) return base;

  try {
    if (provider === "openai") {
      const key = getOpenAiApiKey();
      if (!key) return base;
      const modelsToTry = await openAiModelsToTry(key);
      return { ...base, modelsToTry };
    }
    const key = getGeminiApiKey();
    if (!key) return base;
    const modelsToTry = await geminiModelsToTry(key);
    return { ...base, modelsToTry };
  } catch {
    return base;
  }
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
