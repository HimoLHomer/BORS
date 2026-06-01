import OpenAI from "openai";
import {
  MARKET_INDEX_AI_CONFIG,
  OPENAI_MARKET_SYSTEM_INSTRUCTION,
} from "../../src/marketAiPrompt";
import { getOpenAiApiKey } from "../aiSettings";
import { generateWithFallback } from "./generateWithFallback";
import {
  OPENAI_FALLBACK_MODELS,
  getCachedModels,
  mergeModelLists,
  openAiSupportsChat,
  setCachedModels,
  sortOpenAiModels,
} from "./modelSelection";
import type { GenerateResult, MarketSummaryRequest } from "./types";

const SYSTEM_INSTRUCTION = OPENAI_MARKET_SYSTEM_INSTRUCTION;

async function discoverOpenAiModels(apiKey: string): Promise<string[]> {
  const cached = getCachedModels("openai");
  if (cached) return cached;

  try {
    const client = new OpenAI({ apiKey });
    const page = await client.models.list();
    const ids: string[] = [];
    for await (const model of page) {
      if (model.id && openAiSupportsChat(model.id)) ids.push(model.id);
    }
    const sorted = sortOpenAiModels(ids);
    if (sorted.length > 0) {
      setCachedModels("openai", sorted);
      return sorted;
    }
  } catch (e) {
    console.warn("OpenAI models.list failed, using fallback list:", e);
  }

  return [...OPENAI_FALLBACK_MODELS];
}

export async function openAiModelsToTry(apiKey: string): Promise<string[]> {
  const discovered = await discoverOpenAiModels(apiKey);
  return mergeModelLists(
    "openai",
    discovered,
    OPENAI_FALLBACK_MODELS,
    process.env.OPENAI_MODEL
  );
}

export async function generateOpenAiMarketSummary(
  request: MarketSummaryRequest
): Promise<GenerateResult> {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    return {
      ok: false,
      error: {
        provider: "openai",
        httpStatus: 503,
        message: "OpenAI API key not configured. Add one under Options → Market AI.",
      },
    };
  }

  const client = new OpenAI({ apiKey });
  const models = await openAiModelsToTry(apiKey);

  return generateWithFallback(
    "openai",
    models,
    async (model, prompt) => {
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: SYSTEM_INSTRUCTION },
          { role: "user", content: prompt },
        ],
        max_tokens: MARKET_INDEX_AI_CONFIG.maxOutputTokens ?? 1024,
        temperature: MARKET_INDEX_AI_CONFIG.temperature ?? 0.2,
      });
      const summary = response.choices[0]?.message?.content?.trim() ?? "";
      return {
        summary,
        finishReason: response.choices[0]?.finish_reason ?? undefined,
      };
    },
    request.prompt,
    request.validation
  );
}
