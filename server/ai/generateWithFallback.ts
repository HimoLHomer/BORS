import {
  buildMarketSummaryRetrySuffix,
  validateMarketSummary,
  type MarketSummaryValidationContext,
} from "../../src/marketAiValidation";
import {
  countBullets,
  parseAiError,
  shouldTryNextModel,
} from "./modelSelection";
import type {
  AiProviderId,
  GenerateResult,
  MarketSummaryResult,
} from "./types";

const STRICT_SUFFIX =
  '\n\nOutput ONLY three lines, each starting with "- " (hyphen space). No other text.';

export async function generateWithFallback(
  provider: AiProviderId,
  models: string[],
  generate: (
    model: string,
    prompt: string
  ) => Promise<{ summary: string; finishReason?: string }>,
  prompt: string,
  validation?: MarketSummaryValidationContext
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
      let { summary, finishReason } = await generate(model, prompt);

      if (countBullets(summary) < 2) {
        const retry = await generate(model, prompt + STRICT_SUFFIX);
        if (retry.summary.length > summary.length) {
          summary = retry.summary;
          finishReason = retry.finishReason;
        }
      }

      if (validation) {
        const check = validateMarketSummary(summary, validation);
        if (!check.ok) {
          const suffix = buildMarketSummaryRetrySuffix(check.reasons, validation);
          const retry = await generate(model, prompt + suffix);
          if (retry.summary.trim()) {
            summary = retry.summary;
            finishReason = retry.finishReason;
          }
        }
      }

      if (!summary) summary = "Summary unavailable.";

      const result: MarketSummaryResult = {
        summary,
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
  console.error(`Market AI summary failed (${provider}):`, lastError);
  return {
    ok: false,
    error: { ...err, provider },
  };
}
