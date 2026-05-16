import React, { useCallback, useEffect, useState } from "react";
import { KeyRound, ExternalLink, Check, Loader2 } from "lucide-react";

type GeminiSettings = {
  configured: boolean;
  maskedKey: string | null;
  envFile: string;
};

export function GeminiSettingsPanel() {
  const [settings, setSettings] = useState<GeminiSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/gemini", { cache: "no-store" });
      const json = (await res.json()) as GeminiSettings & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setSettings(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (clear = false) => {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/settings/gemini", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: clear ? "" : apiKey }),
      });
      const json = (await res.json()) as GeminiSettings & { message?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setSettings({
        configured: json.configured,
        maskedKey: json.maskedKey ?? null,
        envFile: json.envFile ?? settings?.envFile ?? "",
      });
      setApiKey("");
      setMessage(json.message ?? (clear ? "API key removed." : "API key saved."));
      window.dispatchEvent(new CustomEvent("bors-gemini-settings-changed"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save API key");
    } finally {
      setSaving(false);
    }
  };

  const shortEnv = settings?.envFile
    ? settings.envFile.replace(/\\/g, "/").split("/").slice(-2).join("/")
    : null;

  return (
    <div className="p-5 rounded-xl border border-border/60 bg-white/[0.02] md:col-span-2">
      <div className="flex items-start gap-3 mb-3">
        <KeyRound className="w-4 h-4 text-accent shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <h3 className="text-[10px] font-bold text-text-s uppercase tracking-widest mb-1">
            Market AI (Gemini)
          </h3>
          <p className="text-xs text-text-s leading-relaxed">
            Optional. Powers AI summaries on the Market screen. Your key is stored locally in{" "}
            <span className="font-mono text-accent/90">{shortEnv ?? ".env.local"}</span> and never
            sent to GitHub.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-text-s flex items-center gap-2 mt-4">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {settings?.configured && settings.maskedKey && (
            <p className="text-[11px] text-text-s">
              Current key: <span className="font-mono text-accent/90">{settings.maskedKey}</span>
            </p>
          )}

          <label className="block">
            <span className="text-[10px] font-bold text-text-s uppercase tracking-widest">
              {settings?.configured ? "Replace API key" : "API key"}
            </span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste Gemini API key"
              autoComplete="off"
              spellCheck={false}
              className="mt-1.5 w-full rounded-lg border border-border/60 bg-bg/60 px-3 py-2.5 text-sm font-mono text-text-p placeholder:text-text-s/60 focus:outline-none focus:ring-1 focus:ring-accent/50"
            />
          </label>

          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              disabled={saving || !apiKey.trim()}
              onClick={() => void save(false)}
              className="btn-primary flex-1 justify-center py-2.5"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              Save key
            </button>
            {settings?.configured && (
              <button
                type="button"
                disabled={saving}
                onClick={() => void save(true)}
                className="btn-secondary flex-1 justify-center py-2.5"
              >
                Remove key
              </button>
            )}
          </div>

          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[11px] text-accent hover:underline"
          >
            Get a free key from Google AI Studio
            <ExternalLink className="w-3 h-3" />
          </a>

          {message && <p className="text-[11px] text-emerald-400/90">{message}</p>}
          {error && <p className="text-[11px] text-red-400/90">{error}</p>}
        </div>
      )}
    </div>
  );
}
