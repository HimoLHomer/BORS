import React, { useCallback, useEffect, useState } from "react";
import { KeyRound, ExternalLink, Check, Loader2 } from "lucide-react";

type AiProviderId = "gemini" | "openai";

type AiSettings = {
  provider: AiProviderId;
  configured: boolean;
  gemini: { configured: boolean; maskedKey: string | null };
  openai: { configured: boolean; maskedKey: string | null };
  envFile: string;
};

export function AiSettingsPanel() {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [provider, setProvider] = useState<AiProviderId>("gemini");
  const [geminiKey, setGeminiKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/ai", { cache: "no-store" });
      const json = (await res.json()) as AiSettings & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setSettings(json);
      setProvider(json.provider);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (opts?: { clearGemini?: boolean; clearOpenai?: boolean }) => {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const body: {
        provider: AiProviderId;
        geminiApiKey?: string;
        openaiApiKey?: string;
      } = { provider };

      if (opts?.clearGemini) body.geminiApiKey = "";
      else if (geminiKey.trim()) body.geminiApiKey = geminiKey.trim();

      if (opts?.clearOpenai) body.openaiApiKey = "";
      else if (openaiKey.trim()) body.openaiApiKey = openaiKey.trim();

      const res = await fetch("/api/settings/ai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as AiSettings & { message?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setSettings(json);
      setProvider(json.provider);
      setGeminiKey("");
      setOpenaiKey("");
      setMessage(json.message ?? "AI settings saved.");
      window.dispatchEvent(new CustomEvent("bors-ai-settings-changed"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save settings");
    } finally {
      setSaving(false);
    }
  };

  const shortEnv = settings?.envFile
    ? settings.envFile.replace(/\\/g, "/").split("/").slice(-2).join("/")
    : null;

  const activeMasked =
    provider === "openai" ? settings?.openai.maskedKey : settings?.gemini.maskedKey;
  const activeConfigured =
    provider === "openai" ? settings?.openai.configured : settings?.gemini.configured;

  return (
    <div className="p-5 rounded-xl border border-border/60 bg-white/[0.02] md:col-span-2">
      <div className="flex items-start gap-3 mb-3">
        <KeyRound className="w-4 h-4 text-accent shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <h3 className="text-[10px] font-bold text-text-s uppercase tracking-widest mb-1">
            Market AI
          </h3>
          <p className="text-xs text-text-s leading-relaxed">
            Optional. Powers AI summaries on the Market screen. Keys are stored locally in{" "}
            <span className="font-mono text-accent/90">{shortEnv ?? ".env.local"}</span> and never
            sent to GitHub. The app tries several models automatically if one is unavailable.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-text-s flex items-center gap-2 mt-4">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="text-[10px] font-bold text-text-s uppercase tracking-widest">
              Provider
            </span>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as AiProviderId)}
              className="mt-1.5 w-full rounded-lg border border-border/60 bg-bg/60 px-3 py-2.5 text-sm text-text-p focus:outline-none focus:ring-1 focus:ring-accent/50"
            >
              <option value="gemini">Google Gemini</option>
              <option value="openai">OpenAI</option>
            </select>
          </label>

          {activeConfigured && activeMasked && (
            <p className="text-[11px] text-text-s">
              Current {provider === "openai" ? "OpenAI" : "Gemini"} key:{" "}
              <span className="font-mono text-accent/90">{activeMasked}</span>
            </p>
          )}

          {provider === "gemini" ? (
            <label className="block">
              <span className="text-[10px] font-bold text-text-s uppercase tracking-widest">
                {settings?.gemini.configured ? "Replace Gemini API key" : "Gemini API key"}
              </span>
              <input
                type="password"
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                placeholder="Paste Gemini API key"
                autoComplete="off"
                spellCheck={false}
                className="mt-1.5 w-full rounded-lg border border-border/60 bg-bg/60 px-3 py-2.5 text-sm font-mono text-text-p placeholder:text-text-s/60 focus:outline-none focus:ring-1 focus:ring-accent/50"
              />
            </label>
          ) : (
            <label className="block">
              <span className="text-[10px] font-bold text-text-s uppercase tracking-widest">
                {settings?.openai.configured ? "Replace OpenAI API key" : "OpenAI API key"}
              </span>
              <input
                type="password"
                value={openaiKey}
                onChange={(e) => setOpenaiKey(e.target.value)}
                placeholder="Paste OpenAI API key"
                autoComplete="off"
                spellCheck={false}
                className="mt-1.5 w-full rounded-lg border border-border/60 bg-bg/60 px-3 py-2.5 text-sm font-mono text-text-p placeholder:text-text-s/60 focus:outline-none focus:ring-1 focus:ring-accent/50"
              />
            </label>
          )}

          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className="btn-primary flex-1 justify-center py-2.5"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              Save
            </button>
            {activeConfigured && (
              <button
                type="button"
                disabled={saving}
                onClick={() =>
                  void save(
                    provider === "openai" ? { clearOpenai: true } : { clearGemini: true }
                  )
                }
                className="btn-secondary flex-1 justify-center py-2.5"
              >
                Remove key
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[11px] text-accent hover:underline"
            >
              Gemini API keys
              <ExternalLink className="w-3 h-3" />
            </a>
            <a
              href="https://platform.openai.com/api-keys"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[11px] text-accent hover:underline"
            >
              OpenAI API keys
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {message && <p className="text-[11px] text-emerald-400/90">{message}</p>}
          {error && <p className="text-[11px] text-red-400/90">{error}</p>}
        </div>
      )}
    </div>
  );
}
