import type { Express, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { clearCachedModels } from "./ai/modelSelection";
import { appRoot } from "./appRoot";

const GEMINI_KEY = "GEMINI_API_KEY";

/** Legacy keys stripped when saving settings. */
const LEGACY_ENV_KEYS = [
  "AI_PROVIDER",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "GEMINI_MODEL",
] as const;

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

export function isGeminiConfigured(): boolean {
  return Boolean(getGeminiApiKey());
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

function stripLegacyEnvKeys(lines: string[]): string[] {
  return lines.filter((line) => {
    const t = line.trim();
    return !LEGACY_ENV_KEYS.some((key) => t.startsWith(`${key}=`) || t === `# ${key}=`);
  });
}

function clearLegacyEnvFromProcess(): void {
  for (const key of LEGACY_ENV_KEYS) {
    delete process.env[key];
  }
}

export type SaveAiSettingsInput = {
  geminiApiKey?: string;
};

export type AiSettingsSnapshot = {
  configured: boolean;
  gemini: {
    configured: boolean;
    maskedKey: string | null;
  };
  envFile: string;
};

function readEnvFileLines(envPath: string): string[] {
  if (fs.existsSync(envPath)) return parseEnvLines(fs.readFileSync(envPath, "utf8"));
  return [
    "# Market AI — Gemini key stored locally (never sent to GitHub)",
    "# Gemini: https://aistudio.google.com/apikey",
    "",
  ];
}

export function loadAiSettingsSnapshot(): AiSettingsSnapshot {
  clearLegacyEnvFromProcess();
  const geminiKey = getGeminiApiKey();
  return {
    configured: Boolean(geminiKey),
    gemini: {
      configured: Boolean(geminiKey),
      maskedKey: geminiKey ? maskApiKey(geminiKey) : null,
    },
    envFile: aiEnvFilePath(),
  };
}

export function saveAiSettings(input: SaveAiSettingsInput): AiSettingsSnapshot {
  const envPath = aiEnvFilePath();
  const dir = path.dirname(envPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let lines = stripLegacyEnvKeys(readEnvFileLines(envPath));

  if (typeof input.geminiApiKey === "string") {
    const trimmed = input.geminiApiKey.trim();
    lines = upsertEnvLine(lines, GEMINI_KEY, trimmed || null);
    if (trimmed) process.env.GEMINI_API_KEY = trimmed;
    else delete process.env.GEMINI_API_KEY;
  }

  clearLegacyEnvFromProcess();

  clearCachedModels();

  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  fs.writeFileSync(envPath, `${lines.join("\n")}\n`, "utf8");

  return loadAiSettingsSnapshot();
}

export function registerAiSettingsRoutes(app: Express): void {
  app.get("/api/settings/ai", (_req: Request, res: Response) => {
    res.json(loadAiSettingsSnapshot());
  });

  app.get("/api/settings/ai/status", (_req: Request, res: Response) => {
    void (async () => {
      try {
        const { getAiStatusDetail } = await import("./ai/providerRouter.js");
        res.json(await getAiStatusDetail());
      } catch {
        res.status(500).json({ error: "Could not load AI status" });
      }
    })();
  });

  app.put("/api/settings/ai", (req: Request, res: Response) => {
    const body = req.body as {
      geminiApiKey?: unknown;
    };

    const input: SaveAiSettingsInput = {};

    if (body.geminiApiKey !== undefined) {
      if (typeof body.geminiApiKey !== "string") {
        res.status(400).json({ error: "geminiApiKey must be a string" });
        return;
      }
      input.geminiApiKey = body.geminiApiKey;
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
}
