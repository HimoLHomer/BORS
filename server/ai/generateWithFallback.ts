import {
  parseTopStoriesJson,
  type MarketTopStory,
} from "../../src/marketTopStories";
import {
  TOP_STORIES_STRICT_SUFFIX,
  buildTopStoriesRetrySuffix,
  validateTopStories,
  type MarketTopStoriesValidationContext,
} from "../../src/marketTopStoriesValidation";
import { parseAiError, shouldTryNextModel } from "./modelSelection";
import type { AiProviderId, GenerateResult, MarketSummaryResult } from "./types";

export type GenerateContentResult = {
  summary: string;
  stories?: MarketTopStory[];
  searchEntryPointHtml?: string;
  finishReason?: string;
};

export async function generateWithFallback(
  provider: AiProviderId,
  models: string[],
  generate: (model: string, prompt: string) => Promise<GenerateContentResult>,
  prompt: string,
  validation?: MarketTopStoriesValidationContext
): Promise<GenerateResult> {
  if (models.length === 0) {
    return {
      ok: false,
      error: {
        provider,
        httpStatus: 503,
        message: `No ${provider === "openai" ? "OpenAI" : "Gemini"} models available to try.`,
      },
    };
  }

  let lastError: unknown = null;

  for (const model of models) {
    try {
      let { summary, stories, searchEntryPointHtml, finishReason } = await generate(
        model,
        prompt
      );

      let parsed = stories ?? parseTopStoriesJson(summary) ?? [];

      if (parsed.length === 0) {
        const retry = await generate(model, prompt + TOP_STORIES_STRICT_SUFFIX);
        summary = retry.summary;
        searchEntryPointHtml = retry.searchEntryPointHtml ?? searchEntryPointHtml;
        finishReason = retry.finishReason ?? finishReason;
        parsed = retry.stories ?? parseTopStoriesJson(summary) ?? [];
      }

      if (validation && parsed.length > 0) {
        let check = validateTopStories(parsed, validation);
        if (check.ok === false) {
          const suffix = buildTopStoriesRetrySuffix(check.reasons);
          const retry = await generate(model, prompt + suffix);
          const retryParsed = retry.stories ?? parseTopStoriesJson(retry.summary) ?? [];
          if (retryParsed.length > 0) {
            check = validateTopStories(retryParsed, validation);
            if (check.ok) {
              parsed = check.stories;
              searchEntryPointHtml = retry.searchEntryPointHtml ?? searchEntryPointHtml;
              finishReason = retry.finishReason ?? finishReason;
            }
          }
        } else {
          parsed = check.stories;
        }
      }

      if (validation && parsed.length > 0) {
        const finalCheck = validateTopStories(parsed, validation);
        parsed = finalCheck.ok ? finalCheck.stories : [];
      }

      if (parsed.length === 0) {
        summary = summary.trim() || "Top stories unavailable.";
      } else {
        summary = "";
      }

      const result: MarketSummaryResult = {
        summary,
        stories: parsed.length > 0 ? parsed : undefined,
        searchEntryPointHtml,
        model,
        provider,
        finishReason,
      };
      return { ok: true, result };
    } catch (e) {
      lastError = e;
      if (!shouldTryNextModel(e, provider)) break;
      console.warn(`Market AI (${provider}): ${model} unavailable, trying next model…`);
    }
  }

  const err = parseAiError(lastError, provider);
  console.error(`Market AI top stories failed (${provider}):`, lastError);
  return {
    ok: false,
    error: { ...err, provider },
  };
}
