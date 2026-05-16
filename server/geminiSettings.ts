import type { Express, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { appRoot } from "./appRoot";

const GEMINI_KEY = "GEMINI_API_KEY";

export function geminiEnvFilePath(): string {
  const userData = process.env.BORS_USER_DATA?.trim();
  if (userData) return path.join(userData, ".env.local");
  return path.join(appRoot(), ".env.local");
}

export function getGeminiApiKey(): string | undefined {
  const k = process.env.GEMINI_API_KEY?.trim();
  return k || undefined;
}

export function maskGeminiApiKey(key: string): string {
  if (key.length <= 4) return "••••";
  return `••••••••${key.slice(-4)}`;
}

function parseEnvLines(text: string): string[] {
  return text.split(/\r?\n/);
}

function formatEnvValue(val: string): string {
  if (/[\s#"'=]/.test(val)) return `"${val.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return val;
}

/** Update GEMINI_API_KEY in .env.local and apply to process.env immediately. */
export function saveGeminiApiKey(apiKey: string): { configured: boolean; maskedKey: string | null } {
  const trimmed = apiKey.trim();
  const envPath = geminiEnvFilePath();
  const dir = path.dirname(envPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let lines: string[] = [];
  if (fs.existsSync(envPath)) {
    lines = parseEnvLines(fs.readFileSync(envPath, "utf8"));
  } else {
    lines = ["# Optional: Gemini market AI", "# Get a key: https://aistudio.google.com/apikey", ""];
  }

  let found = false;
  const next: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith(`${GEMINI_KEY}=`) || t === `# ${GEMINI_KEY}=`) {
      found = true;
      if (trimmed) next.push(`${GEMINI_KEY}=${formatEnvValue(trimmed)}`);
      continue;
    }
    next.push(line);
  }
  if (!found && trimmed) next.push(`${GEMINI_KEY}=${formatEnvValue(trimmed)}`);

  while (next.length > 0 && next[next.length - 1] === "") next.pop();
  fs.writeFileSync(envPath, `${next.join("\n")}\n`, "utf8");

  if (trimmed) {
    process.env.GEMINI_API_KEY = trimmed;
    return { configured: true, maskedKey: maskGeminiApiKey(trimmed) };
  }
  delete process.env.GEMINI_API_KEY;
  return { configured: false, maskedKey: null };
}

export function registerGeminiSettingsRoutes(app: Express): void {
  app.get("/api/settings/gemini", (_req: Request, res: Response) => {
    const key = getGeminiApiKey();
    res.json({
      configured: Boolean(key),
      maskedKey: key ? maskGeminiApiKey(key) : null,
      envFile: geminiEnvFilePath(),
    });
  });

  app.put("/api/settings/gemini", (req: Request, res: Response) => {
    const body = req.body as { apiKey?: unknown };
    if (typeof body.apiKey !== "string") {
      res.status(400).json({ error: "apiKey must be a string" });
      return;
    }
    try {
      const result = saveGeminiApiKey(body.apiKey);
      res.json({
        ...result,
        envFile: geminiEnvFilePath(),
        message: result.configured ? "Gemini API key saved." : "Gemini API key removed.",
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not save API key";
      res.status(500).json({ error: message });
    }
  });
}
