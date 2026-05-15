import type { Express, Request, Response } from "express";
import { GoogleGenAI } from "@google/genai";
import {
  MARKET_INDEX_AI_CONFIG,
  buildFiMarketAiPrompt,
  buildUsMarketAiPrompt,
  type MarketAiQuoteContext,
} from "../src/marketAiPrompt";

const DEFAULT_MODELS = [
  "gemini-2.0-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
];

function modelsToTry(): string[] {
  const fromEnv = process.env.GEMINI_MODEL?.trim();
  if (fromEnv) return [fromEnv, ...DEFAULT_MODELS.filter((m) => m !== fromEnv)];
  return DEFAULT_MODELS;
}

function parseGeminiError(e: unknown): { httpStatus: number; message: string; code?: number } {
  const raw = e instanceof Error ? e.message : String(e);
  let code: number | undefined;
  let apiMessage = raw;

  const jsonStart = raw.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart)) as {
        error?: { code?: number; message?: string; status?: string };
      };
      if (parsed.error) {
        code = parsed.error.code;
        apiMessage = parsed.error.message ?? raw;
      }
    } catch {
      /* keep raw */
    }
  }

  const lower = `${apiMessage} ${raw}`.toLowerCase();
  if (code === 429 || lower.includes("quota") || lower.includes("rate limit")) {
    return {
      httpStatus: 429,
      code: 429,
      message:
        "Gemini API free-tier quota is used up for now. Wait a few minutes, try again later, or check usage in Google AI Studio.",
    };
  }
  if (code === 403 || lower.includes("permission") || lower.includes("api key")) {
    return {
      httpStatus: 403,
      code: 403,
      message: "Gemini API key was rejected. Check GEMINI_API_KEY in .env.local.",
    };
  }

  const short = apiMessage.split("\n")[0]?.trim() || "AI request failed";
  return {
    httpStatus: code && code >= 400 && code < 600 ? code : 502,
    code,
    message: short.length > 220 ? `${short.slice(0, 220)}…` : short,
  };
}

function isRetryableQuotaError(e: unknown): boolean {
  const { httpStatus, message } = parseGeminiError(e);
  return httpStatus === 429 || message.toLowerCase().includes("quota");
}

function countBullets(text: string): number {
  return text.split("\n").filter((line) => /^\s*[-*•]\s/.test(line.trim())).length;
}

function extractSummaryText(response: {
  text?: string;
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
}): { summary: string; finishReason?: string } {
  const candidate = response.candidates?.[0];
  const parts =
    candidate?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("") ?? "";
  const summary = response.text?.trim() || parts.trim() || "";
  return { summary, finishReason: candidate?.finishReason };
}

export function registerMarketAiRoutes(app: Express): void {
  app.get("/api/market/ai-status", (_req: Request, res: Response) => {
    res.json({ configured: Boolean(process.env.GEMINI_API_KEY?.trim()) });
  });

  app.post("/api/market/ai-summary", (req: Request, res: Response) => {
    void (async () => {
      const key = process.env.GEMINI_API_KEY?.trim();
      if (!key) {
        res.status(503).json({ error: "GEMINI_API_KEY not configured in .env.local" });
        return;
      }

      const body = req.body as Partial<MarketAiQuoteContext> & { variant?: string };
      const variant = body.variant === "fi" ? "fi" : "us";
      const label = typeof body.label === "string" ? body.label : "";
      const price = typeof body.price === "number" ? body.price : null;
      const changePercent =
        typeof body.changePercent === "number" ? body.changePercent : 0;
      const currency = typeof body.currency === "string" ? body.currency : "USD";

      if (price == null || !label) {
        res.status(400).json({ error: "label and price are required" });
        return;
      }

      const ctx: MarketAiQuoteContext = { label, price, changePercent, currency };
      const prompt = variant === "fi" ? buildFiMarketAiPrompt(ctx) : buildUsMarketAiPrompt(ctx);
      const ai = new GoogleGenAI({ apiKey: key });
      const models = modelsToTry();
      let lastError: unknown = null;

      const strictSuffix =
        "\n\nOutput ONLY three lines, each starting with \"- \" (hyphen space). No other text.";

      for (const model of models) {
        try {
          let { summary, finishReason } = extractSummaryText(
            await ai.models.generateContent({
              model,
              contents: prompt,
              config: MARKET_INDEX_AI_CONFIG,
            })
          );

          if (countBullets(summary) < 2) {
            const retry = extractSummaryText(
              await ai.models.generateContent({
                model,
                contents: prompt + strictSuffix,
                config: MARKET_INDEX_AI_CONFIG,
              })
            );
            if (retry.summary.length > summary.length) {
              summary = retry.summary;
              finishReason = retry.finishReason;
            }
          }

          if (!summary) summary = "Summary unavailable.";
          res.json({ summary, model, finishReason });
          return;
        } catch (e) {
          lastError = e;
          if (!isRetryableQuotaError(e)) break;
          console.warn(`Market AI: quota/limit on ${model}, trying next model…`);
        }
      }

      const err = parseGeminiError(lastError);
      console.error("Market AI summary failed:", lastError);
      res.status(err.httpStatus).json({ error: err.message, code: err.code });
    })();
  });
}
