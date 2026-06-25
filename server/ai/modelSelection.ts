const MODEL_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

let cachedModels: { models: string[]; expiresAt: number } | null = null;

export const GEMINI_FALLBACK_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
] as const;

const RETIRED_GEMINI = new Set([
  "gemini-1.5-flash",
  "gemini-1.5-flash-8b",
  "gemini-1.5-pro",
  "gemini-pro",
]);

export function normalizeModelId(name: string): string {
  return name.replace(/^models\//, "");
}

export function isRetiredGeminiModel(modelId: string): boolean {
  return RETIRED_GEMINI.has(modelId);
}

export function getCachedModels(): string[] | null {
  if (!cachedModels || Date.now() > cachedModels.expiresAt) return null;
  return cachedModels.models;
}

export function setCachedModels(models: string[]): void {
  cachedModels = { models, expiresAt: Date.now() + MODEL_CACHE_TTL_MS };
}

export function clearCachedModels(): void {
  cachedModels = null;
}

export function mergeModelLists(
  discovered: string[],
  fallback: readonly string[]
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [...discovered, ...fallback]) {
    const m = normalizeModelId(id);
    if (!m || seen.has(m) || isRetiredGeminiModel(m)) continue;
    seen.add(m);
    out.push(m);
  }
  return out;
}

/** Higher score = try earlier. */
export function scoreGeminiModel(id: string): number {
  const m = id.toLowerCase();
  if (/embedding|aqa|tts|imagen|veo|gemma/.test(m)) return -100;
  if (/flash-lite/.test(m)) return 90;
  if (/flash/.test(m)) return 80;
  if (/pro/.test(m)) return 50;
  if (/gemini/.test(m)) return 40;
  return 0;
}

export function sortGeminiModels(ids: string[]): string[] {
  return [...ids].sort((a, b) => scoreGeminiModel(b) - scoreGeminiModel(a));
}

export function geminiSupportsGenerate(model: {
  name?: string;
  supportedGenerationMethods?: string[];
}): boolean {
  const methods = model.supportedGenerationMethods ?? [];
  if (methods.some((m) => m.toLowerCase().includes("generatecontent"))) return true;
  const id = normalizeModelId(model.name ?? "");
  return id.startsWith("gemini-") && scoreGeminiModel(id) > 0;
}

export type ParsedAiError = { httpStatus: number; message: string; code?: number };

export const GEMINI_ALL_MODELS_BUSY_MESSAGE =
  "All Gemini models are busy. Try again in a few minutes.";

/** True when Gemini returned a retryable capacity/overload message (not auth/key errors). */
export function isTransientGeminiFailure(text: string): boolean {
  const lower = text.toLowerCase();
  if (
    lower.includes("api key") ||
    lower.includes("invalid_api_key") ||
    lower.includes("incorrect api key") ||
    lower.includes("permission denied")
  ) {
    return false;
  }
  return (
    lower.includes("high demand") ||
    lower.includes("temporarily unavailable") ||
    lower.includes("overloaded") ||
    lower.includes("try again later") ||
    lower.includes("resource_exhausted") ||
    lower.includes("service unavailable") ||
    /\b503\b/.test(lower) ||
    lower.includes("unavailable")
  );
}

export function parseAiError(e: unknown): ParsedAiError {
  const raw = e instanceof Error ? e.message : String(e);
  let code: number | undefined;
  let apiMessage = raw;

  const jsonStart = raw.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart)) as {
        error?: { code?: number; message?: string };
      };
      if (parsed.error) {
        code = typeof parsed.error.code === "number" ? parsed.error.code : undefined;
        apiMessage = parsed.error.message ?? raw;
      }
    } catch {
      /* keep raw */
    }
  }

  const lower = `${apiMessage} ${raw}`.toLowerCase();
  const keyHint = "Update it under Options → Market AI.";

  if (code === 429 || lower.includes("quota") || lower.includes("rate limit")) {
    return {
      httpStatus: 429,
      code: 429,
      message: `Gemini quota or rate limit reached. Wait a few minutes and try again.`,
    };
  }
  if (
    code === 403 ||
    code === 401 ||
    lower.includes("permission") ||
    lower.includes("api key") ||
    lower.includes("incorrect api key") ||
    lower.includes("invalid_api_key")
  ) {
    return {
      httpStatus: 403,
      code: code ?? 403,
      message: `Gemini API key was rejected. ${keyHint}`,
    };
  }

  if (code === 503 || isTransientGeminiFailure(apiMessage)) {
    return {
      httpStatus: 503,
      code: code ?? 503,
      message: GEMINI_ALL_MODELS_BUSY_MESSAGE,
    };
  }

  const short = apiMessage.split("\n")[0]?.trim() || "AI request failed";
  return {
    httpStatus: code && code >= 400 && code < 600 ? code : 502,
    code,
    message: short.length > 220 ? `${short.slice(0, 220)}…` : short,
  };
}

export function isRetryableQuotaError(e: unknown): boolean {
  const { httpStatus, message } = parseAiError(e);
  return httpStatus === 429 || message.toLowerCase().includes("quota");
}

export function shouldTryNextModel(e: unknown): boolean {
  if (isRetryableQuotaError(e)) return true;
  const raw = e instanceof Error ? e.message : String(e);
  if (isTransientGeminiFailure(raw)) return true;
  const { httpStatus, message } = parseAiError(e);
  if (httpStatus === 503) return true;
  const lower = message.toLowerCase();
  return (
    httpStatus === 404 ||
    lower.includes("not found") ||
    lower.includes("is not supported") ||
    lower.includes("no longer available") ||
    lower.includes("does not exist")
  );
}
