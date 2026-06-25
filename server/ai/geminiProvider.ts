import { GoogleGenAI } from "@google/genai";
import { MARKET_TOP_STORIES_AI_CONFIG } from "../../src/marketAiPrompt";
import {
  enrichStoriesWithGrounding,
  extractGroundingChunks,
  extractSearchEntryPointHtml,
  parseTopStoriesJson,
} from "../../src/marketTopStories";
import { getGeminiApiKey } from "../aiSettings";
import { generateWithFallback } from "./generateWithFallback";
import {
  GEMINI_FALLBACK_MODELS,
  geminiSupportsGenerate,
  getCachedModels,
  mergeModelLists,
  normalizeModelId,
  setCachedModels,
  sortGeminiModels,
} from "./modelSelection";
import type { GenerateResult, MarketSummaryRequest } from "./types";

const GEMINI_MARKET_CONFIG = {
  ...MARKET_TOP_STORIES_AI_CONFIG,
  tools: [{ googleSearch: {} }],
};

function extractFromResponse(response: {
  text?: string;
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
    groundingMetadata?: unknown;
  }>;
}): {
  summary: string;
  stories?: ReturnType<typeof parseTopStoriesJson>;
  searchEntryPointHtml?: string;
  finishReason?: string;
} {
  const candidate = response.candidates?.[0];
  const parts =
    candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  const summary = response.text?.trim() || parts.trim() || "";
  const metadata = candidate?.groundingMetadata;
  const chunks = extractGroundingChunks(metadata);
  const parsed = parseTopStoriesJson(summary);
  const stories = parsed ? enrichStoriesWithGrounding(parsed, chunks) : undefined;
  return {
    summary,
    stories: stories ?? undefined,
    searchEntryPointHtml: extractSearchEntryPointHtml(metadata),
    finishReason: candidate?.finishReason,
  };
}

async function discoverGeminiModels(apiKey: string): Promise<string[]> {
  const cached = getCachedModels("gemini");
  if (cached) return cached;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const ids: string[] = [];
    const pager = await ai.models.list();
    for await (const model of pager) {
      if (!geminiSupportsGenerate(model)) continue;
      const id = normalizeModelId(model.name ?? "");
      if (id) ids.push(id);
    }
    const sorted = sortGeminiModels(ids);
    if (sorted.length > 0) {
      setCachedModels("gemini", sorted);
      return sorted;
    }
  } catch (e) {
    console.warn("Gemini models.list failed, using fallback list:", e);
  }

  return [...GEMINI_FALLBACK_MODELS];
}

export async function geminiModelsToTry(apiKey: string): Promise<string[]> {
  const discovered = await discoverGeminiModels(apiKey);
  return mergeModelLists(
    "gemini",
    discovered,
    GEMINI_FALLBACK_MODELS,
    process.env.GEMINI_MODEL
  );
}

export async function generateGeminiMarketSummary(
  request: MarketSummaryRequest
): Promise<GenerateResult> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return {
      ok: false,
      error: {
        provider: "gemini",
        httpStatus: 503,
        message: "Gemini API key not configured. Add one under Options → Market AI.",
      },
    };
  }

  const ai = new GoogleGenAI({ apiKey });
  const models = await geminiModelsToTry(apiKey);

  return generateWithFallback(
    "gemini",
    models,
    async (model, prompt) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: GEMINI_MARKET_CONFIG,
      });
      return extractFromResponse(response);
    },
    request.prompt,
    request.validation
  );
}
