import type { AiProviderId } from "./types";

const MODEL_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const modelCache = new Map<AiProviderId, { models: string[]; expiresAt: number }>();

export const GEMINI_FALLBACK_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
] as const;

export const OPENAI_FALLBACK_MODELS = [
  "gpt-4o-mini",
  "gpt-4o",
  "gpt-3.5-turbo",
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

export function isRetiredModel(provider: AiProviderId, modelId: string): boolean {
  if (provider === "gemini") return RETIRED_GEMINI.has(modelId);
  return false;
}

export function getCachedModels(provider: AiProviderId): string[] | null {
  const entry = modelCache.get(provider);
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.models;
}

export function setCachedModels(provider: AiProviderId, models: string[]): void {
  modelCache.set(provider, { models, expiresAt: Date.now() + MODEL_CACHE_TTL_MS });
}

export function mergeModelLists(
  provider: AiProviderId,
  discovered: string[],
  fallback: readonly string[],
  envOverride?: string
): string[] {
  const preferred =
    envOverride?.trim() && !isRetiredModel(provider, envOverride.trim())
      ? [envOverride.trim()]
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [...preferred, ...discovered, ...fallback]) {
    const m = normalizeModelId(id);
    if (!m || seen.has(m) || isRetiredModel(provider, m)) continue;
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

export function scoreOpenAiModel(id: string): number {
  const m = id.toLowerCase();
  if (/embedding|whisper|tts|dall-e|moderation|realtime|audio/.test(m)) return -100;
  if (/gpt-4o-mini/.test(m)) return 95;
  if (/gpt-4o/.test(m)) return 85;
  if (/gpt-4/.test(m)) return 70;
  if (/gpt-3\.5/.test(m)) return 60;
  if (/o1|o3/.test(m)) return 30;
  return 10;
}

export function sortGeminiModels(ids: string[]): string[] {
  return [...ids].sort((a, b) => scoreGeminiModel(b) - scoreGeminiModel(a));
}

export function sortOpenAiModels(ids: string[]): string[] {
  return [...ids].sort((a, b) => scoreOpenAiModel(b) - scoreOpenAiModel(a));
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

export function openAiSupportsChat(id: string): boolean {
  const m = id.toLowerCase();
  if (/embedding|whisper|tts|dall-e|moderation|realtime/.test(m)) return false;
  return /^gpt-|^o\d/.test(m) || m.includes("chat");
}

export type ParsedAiError = { httpStatus: number; message: string; code?: number };

export function parseAiError(e: unknown, provider: AiProviderId): ParsedAiError {
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
  const providerLabel = provider === "openai" ? "OpenAI" : "Gemini";
  const keyHint = "Update it under Options → Market AI.";

  if (code === 429 || lower.includes("quota") || lower.includes("rate limit")) {
    return {
      httpStatus: 429,
      code: 429,
      message: `${providerLabel} quota or rate limit reached. Wait a few minutes and try again.`,
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
      message: `${providerLabel} API key was rejected. ${keyHint}`,
    };
  }

  const short = apiMessage.split("\n")[0]?.trim() || "AI request failed";
  return {
    httpStatus: code && code >= 400 && code < 600 ? code : 502,
    code,
    message: short.length > 220 ? `${short.slice(0, 220)}…` : short,
  };
}

export function isRetryableQuotaError(e: unknown, provider: AiProviderId): boolean {
  const { httpStatus, message } = parseAiError(e, provider);
  return httpStatus === 429 || message.toLowerCase().includes("quota");
}

export function shouldTryNextModel(e: unknown, provider: AiProviderId): boolean {
  if (isRetryableQuotaError(e, provider)) return true;
  const { httpStatus, message } = parseAiError(e, provider);
  const lower = message.toLowerCase();
  return (
    httpStatus === 404 ||
    lower.includes("not found") ||
    lower.includes("is not supported") ||
    lower.includes("no longer available") ||
    lower.includes("does not exist")
  );
}

export function countBullets(text: string): number {
  return text.split("\n").filter((line) => /^\s*[-*•]\s/.test(line.trim())).length;
}
