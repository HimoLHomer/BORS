import {
  EMPTY_TOP_STORIES_USER_MESSAGE,
  coalesceTopStoriesFromText,
  isRawTopStoriesPayload,
  isTopStoriesJsonEnvelope,
  parseTopStoriesJsonLenient,
  sanitizeTopStoriesFallback,
  type MarketTopStory,
} from "../../src/marketTopStories";
import {
  TOP_STORIES_STRICT_SUFFIX,
  buildTopStoriesRetrySuffix,
  validateTopStories,
  type MarketTopStoriesValidationContext,
} from "../../src/marketTopStoriesValidation";
import { GEMINI_ALL_MODELS_BUSY_MESSAGE, isTransientGeminiFailure, parseAiError, shouldTryNextModel } from "./modelSelection";
import type { GenerateResult, MarketSummaryResult } from "./types";

export type GenerateContentResult = {
  summary: string;
  stories?: MarketTopStory[];
  finishReason?: string;
};

export async function generateWithFallback(
  models: string[],
  generate: (model: string, prompt: string) => Promise<GenerateContentResult>,
  prompt: string,
  validation?: MarketTopStoriesValidationContext
): Promise<GenerateResult> {
  if (models.length === 0) {
    return {
      ok: false,
      error: {
        httpStatus: 503,
        message: "No Gemini models available to try.",
      },
    };
  }

  let lastError: unknown = null;

  for (let i = 0; i < models.length; i++) {
    const model = models[i]!;
    try {
      let { summary, stories, finishReason } = await generate(
        model,
        prompt
      );

      let parsed = coalesceTopStoriesFromText(stories, summary);

      if (parsed.length === 0) {
        const retry = await generate(model, prompt + TOP_STORIES_STRICT_SUFFIX);
        summary = retry.summary;
        finishReason = retry.finishReason ?? finishReason;
        parsed = coalesceTopStoriesFromText(retry.stories, summary);
      }

      if (validation && parsed.length > 0) {
        let check = validateTopStories(parsed, validation);
        if (check.ok === false) {
          const suffix = buildTopStoriesRetrySuffix(check.reasons);
          const retry = await generate(model, prompt + suffix);
          const retryParsed = coalesceTopStoriesFromText(retry.stories, retry.summary);
          if (retryParsed.length > 0) {
            check = validateTopStories(retryParsed, validation);
            if (check.ok) {
              parsed = check.stories;
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
        const lenient = parseTopStoriesJsonLenient(summary);
        if (lenient.length > 0) {
          if (validation) {
            const lenientCheck = validateTopStories(lenient, validation);
            if (lenientCheck.ok) parsed = lenientCheck.stories;
          } else {
            parsed = lenient;
          }
        }
      }

      if (parsed.length === 0) {
        summary = summary.trim() || "Top stories unavailable.";
        if (isTransientGeminiFailure(summary)) {
          lastError = new Error(summary);
          console.warn(`Market AI (Gemini): ${model} busy, trying next model…`);
          continue;
        }
        if (
          (isTopStoriesJsonEnvelope(summary) || isRawTopStoriesPayload(summary)) &&
          i < models.length - 1
        ) {
          console.warn(`Market AI (Gemini): ${model} returned unusable top-stories JSON, trying next model…`);
          continue;
        }
        if (isTopStoriesJsonEnvelope(summary) || isRawTopStoriesPayload(summary)) {
          summary = EMPTY_TOP_STORIES_USER_MESSAGE;
        }
      } else {
        summary = "";
      }

      const result: MarketSummaryResult = {
        summary: sanitizeTopStoriesFallback(summary),
        stories: parsed.length > 0 ? parsed : undefined,
        model,
        finishReason,
      };
      return { ok: true, result };
    } catch (e) {
      lastError = e;
      if (!shouldTryNextModel(e)) break;
      console.warn(`Market AI (Gemini): ${model} unavailable, trying next model…`);
    }
  }

  const err = lastError
    ? parseAiError(lastError)
    : { httpStatus: 503, message: GEMINI_ALL_MODELS_BUSY_MESSAGE };
  console.error("Market AI top stories failed (Gemini):", lastError);
  return {
    ok: false,
    error: err,
  };
}
