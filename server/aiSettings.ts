import type { Express, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { appRoot } from "./appRoot";
import type { AiProviderId } from "./ai/types";

export type { AiProviderId };

const GEMINI_KEY = "GEMINI_API_KEY";
const OPENAI_KEY = "OPENAI_API_KEY";
const PROVIDER_KEY = "AI_PROVIDER";

export function aiEnvFilePath(): string {
  const userData = process.env.BORS_USER_DATA?.trim();
  if (userData) return path.join(userData, ".env.local");
  return path.join(appRoot(), ".env.local");
}

export function maskApiKey(key: string): string {
  if (key.length <= 4) return "••••";
  return `••••••••${key.slice(-4)}`;
}

export function getGeminiApiKey(): string | undefined {
  const k = process.env.GEMINI_API_KEY?.trim();
  return k || undefined;
}

export function getOpenAiApiKey(): string | undefined {
  const k = process.env.OPENAI_API_KEY?.trim();
  return k || undefined;
}

export function getActiveProvider(): AiProviderId {
  const raw = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (raw === "openai") return "openai";
  if (raw === "gemini") return "gemini";
  if (getGeminiApiKey()) return "gemini";
  if (getOpenAiApiKey()) return "openai";
  return "gemini";
}

export function isProviderConfigured(provider: AiProviderId): boolean {
  return provider === "openai" ? Boolean(getOpenAiApiKey()) : Boolean(getGeminiApiKey());
}

function parseEnvLines(text: string): string[] {
  return text.split(/\r?\n/);
}

function formatEnvValue(val: string): string {
  if (/[\s#"'=]/.test(val)) return `"${val.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return val;
}

function upsertEnvLine(lines: string[], key: string, value: string | null): string[] {
  let found = false;
  const next: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith(`${key}=`) || t === `# ${key}=`) {
      found = true;
      if (value != null && value !== "") next.push(`${key}=${formatEnvValue(value)}`);
      continue;
    }
    next.push(line);
  }
  if (!found && value != null && value !== "") next.push(`${key}=${formatEnvValue(value)}`);
  return next;
}

export type SaveAiSettingsInput = {
  provider?: AiProviderId;
  geminiApiKey?: string;
  openaiApiKey?: string;
};

export type AiSettingsSnapshot = {
  provider: AiProviderId;
  configured: boolean;
  gemini: { configured: boolean; maskedKey: string | null };
  openai: { configured: boolean; maskedKey: string | null };
  envFile: string;
};

function readEnvFileLines(envPath: string): string[] {
  if (fs.existsSync(envPath)) return parseEnvLines(fs.readFileSync(envPath, "utf8"));
  return [
    "# Market AI — keys stored locally (never sent to GitHub)",
    "# Gemini: https://aistudio.google.com/apikey",
    "# OpenAI: https://platform.openai.com/api-keys",
    "",
  ];
}

export function loadAiSettingsSnapshot(): AiSettingsSnapshot {
  const provider = getActiveProvider();
  const geminiKey = getGeminiApiKey();
  const openaiKey = getOpenAiApiKey();
  return {
    provider,
    configured: isProviderConfigured(provider),
    gemini: {
      configured: Boolean(geminiKey),
      maskedKey: geminiKey ? maskApiKey(geminiKey) : null,
    },
    openai: {
      configured: Boolean(openaiKey),
      maskedKey: openaiKey ? maskApiKey(openaiKey) : null,
    },
    envFile: aiEnvFilePath(),
  };
}

export function saveAiSettings(input: SaveAiSettingsInput): AiSettingsSnapshot {
  const envPath = aiEnvFilePath();
  const dir = path.dirname(envPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let lines = readEnvFileLines(envPath);

  if (input.provider === "gemini" || input.provider === "openai") {
    lines = upsertEnvLine(lines, PROVIDER_KEY, input.provider);
    process.env.AI_PROVIDER = input.provider;
  }

  if (typeof input.geminiApiKey === "string") {
    const trimmed = input.geminiApiKey.trim();
    lines = upsertEnvLine(lines, GEMINI_KEY, trimmed || null);
    if (trimmed) process.env.GEMINI_API_KEY = trimmed;
    else delete process.env.GEMINI_API_KEY;
  }

  if (typeof input.openaiApiKey === "string") {
    const trimmed = input.openaiApiKey.trim();
    lines = upsertEnvLine(lines, OPENAI_KEY, trimmed || null);
    if (trimmed) process.env.OPENAI_API_KEY = trimmed;
    else delete process.env.OPENAI_API_KEY;
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  fs.writeFileSync(envPath, `${lines.join("\n")}\n`, "utf8");

  return loadAiSettingsSnapshot();
}

export function registerAiSettingsRoutes(app: Express): void {
  app.get("/api/settings/ai", (_req: Request, res: Response) => {
    res.json(loadAiSettingsSnapshot());
  });

  app.put("/api/settings/ai", (req: Request, res: Response) => {
    const body = req.body as {
      provider?: unknown;
      geminiApiKey?: unknown;
      openaiApiKey?: unknown;
    };

    const input: SaveAiSettingsInput = {};

    if (body.provider !== undefined) {
      if (body.provider !== "gemini" && body.provider !== "openai") {
        res.status(400).json({ error: "provider must be gemini or openai" });
        return;
      }
      input.provider = body.provider;
    }

    if (body.geminiApiKey !== undefined) {
      if (typeof body.geminiApiKey !== "string") {
        res.status(400).json({ error: "geminiApiKey must be a string" });
        return;
      }
      input.geminiApiKey = body.geminiApiKey;
    }

    if (body.openaiApiKey !== undefined) {
      if (typeof body.openaiApiKey !== "string") {
        res.status(400).json({ error: "openaiApiKey must be a string" });
        return;
      }
      input.openaiApiKey = body.openaiApiKey;
    }

    try {
      const snapshot = saveAiSettings(input);
      res.json({
        ...snapshot,
        message: "AI settings saved.",
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not save AI settings";
      res.status(500).json({ error: message });
    }
  });

  /** @deprecated Use GET /api/settings/ai */
  app.get("/api/settings/gemini", (_req: Request, res: Response) => {
    const s = loadAiSettingsSnapshot();
    res.json({
      configured: s.gemini.configured,
      maskedKey: s.gemini.maskedKey,
      envFile: s.envFile,
    });
  });

  /** @deprecated Use PUT /api/settings/ai */
  app.put("/api/settings/gemini", (req: Request, res: Response) => {
    const body = req.body as { apiKey?: unknown };
    if (typeof body.apiKey !== "string") {
      res.status(400).json({ error: "apiKey must be a string" });
      return;
    }
    try {
      const snapshot = saveAiSettings({ geminiApiKey: body.apiKey });
      res.json({
        configured: snapshot.gemini.configured,
        maskedKey: snapshot.gemini.maskedKey,
        envFile: snapshot.envFile,
        message: snapshot.gemini.configured ? "Gemini API key saved." : "Gemini API key removed.",
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not save API key";
      res.status(500).json({ error: message });
    }
  });
}

/** @deprecated Use aiEnvFilePath */
export const geminiEnvFilePath = aiEnvFilePath;

/** @deprecated Use maskApiKey */
export const maskGeminiApiKey = maskApiKey;
