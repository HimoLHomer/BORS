import React, { useCallback, useEffect, useRef, useState } from "react";
import { KeyRound, ExternalLink, Check, Loader2 } from "lucide-react";

type AiProviderId = "gemini" | "openai";

type ModelOption = { id: string; label: string };

type AiSettings = {
  provider: AiProviderId;
  configured: boolean;
  gemini: { configured: boolean; maskedKey: string | null; model: string | null };
  openai: {
    configured: boolean;
    maskedKey: string | null;
    model: string | null;
    modelChatSupported: boolean;
  };
  modelOptions: { openai: ModelOption[]; gemini: ModelOption[] };
  envFile: string;
};

type AiRuntimeStatus = {
  provider: AiProviderId;
  configured: boolean;
  modelsToTry?: string[];
  modelOverride?: string | null;
  modelOverrideSupported?: boolean;
};

function formatModelStatus(status: AiRuntimeStatus | null): string | null {
  if (!status?.configured) return null;

  const override = status.modelOverride?.trim();
  if (override) {
    if (status.modelOverrideSupported === false) {
      return `Model "${override}" is not supported. Choose Automatic or a listed model, then Save.`;
    }
    return `Using ${override} (selected)`;
  }

  const models = status.modelsToTry ?? [];
  if (models.length === 0) return null;

  const primary = models[0];
  if (models.length === 1) {
    return `Using ${primary} (automatic)`;
  }
  const rest = models.slice(1, 3).join(", ");
  const suffix = models.length > 3 ? ", …" : "";
  return `Will try ${primary}, then ${rest}${suffix} (automatic)`;
}

function ModelSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: ModelOption[];
  onChange: (value: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="mt-1.5 w-full rounded-lg border border-border/60 bg-bg/60 px-3 py-2.5 text-sm text-text-p focus:outline-none focus:ring-1 focus:ring-accent/50"
    >
      <option value="">Automatic (recommended)</option>
      {options.map((opt) => (
        <option key={opt.id} value={opt.id}>
          {opt.id} — {opt.label}
        </option>
      ))}
    </select>
  );
}

export function AiSettingsPanel() {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<AiRuntimeStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [provider, setProvider] = useState<AiProviderId>("gemini");
  const [geminiKey, setGeminiKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [geminiModel, setGeminiModel] = useState("");
  const [openaiModel, setOpenaiModel] = useState("");
  const savedGeminiModelRef = useRef("");
  const savedOpenaiModelRef = useRef("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchRuntimeStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const res = await fetch("/api/settings/ai/status", { cache: "no-store" });
      const json = (await res.json()) as AiRuntimeStatus & { error?: string };
      if (res.ok) setRuntimeStatus(json);
      else setRuntimeStatus(null);
    } catch {
      setRuntimeStatus(null);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/ai", { cache: "no-store" });
      const json = (await res.json()) as AiSettings & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setSettings(json);
      setProvider(json.provider);
      const gModel = json.gemini.model ?? "";
      const oModel = json.openai.model ?? "";
      setGeminiModel(gModel);
      setOpenaiModel(oModel);
      savedGeminiModelRef.current = gModel;
      savedOpenaiModelRef.current = oModel;
      if (json.configured) {
        void fetchRuntimeStatus();
      } else {
        setRuntimeStatus(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load settings");
    } finally {
      setLoading(false);
    }
  }, [fetchRuntimeStatus]);

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
        geminiModel?: string;
        openaiModel?: string;
      } = { provider };

      if (opts?.clearGemini) body.geminiApiKey = "";
      else if (geminiKey.trim()) body.geminiApiKey = geminiKey.trim();

      if (opts?.clearOpenai) body.openaiApiKey = "";
      else if (openaiKey.trim()) body.openaiApiKey = openaiKey.trim();

      if (geminiModel !== savedGeminiModelRef.current) {
        body.geminiModel = geminiModel.trim();
      }
      if (openaiModel !== savedOpenaiModelRef.current) {
        body.openaiModel = openaiModel.trim();
      }

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
      const gModel = json.gemini.model ?? "";
      const oModel = json.openai.model ?? "";
      setGeminiModel(gModel);
      setOpenaiModel(oModel);
      savedGeminiModelRef.current = gModel;
      savedOpenaiModelRef.current = oModel;
      setMessage(json.message ?? "AI settings saved.");
      window.dispatchEvent(new CustomEvent("bors-ai-settings-changed"));
      if (json.configured) {
        void fetchRuntimeStatus();
      } else {
        setRuntimeStatus(null);
      }
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

  const baseModelOptions =
    provider === "openai"
      ? (settings?.modelOptions.openai ?? [])
      : (settings?.modelOptions.gemini ?? []);

  const modelValue = provider === "openai" ? openaiModel : geminiModel;
  const modelOptions =
    modelValue && !baseModelOptions.some((o) => o.id === modelValue)
      ? [{ id: modelValue, label: "Custom" }, ...baseModelOptions]
      : baseModelOptions;
  const setModelValue = provider === "openai" ? setOpenaiModel : setGeminiModel;

  const statusLine = formatModelStatus(runtimeStatus);
  const statusIsWarning =
    Boolean(runtimeStatus?.modelOverride) && runtimeStatus?.modelOverrideSupported === false;

  return (
    <div className="p-5 rounded-xl border border-border/60 bg-white/[0.02] md:col-span-2">
      <div className="flex items-start gap-3 mb-3">
        <KeyRound className="w-4 h-4 text-accent shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <h3 className="text-[10px] font-bold text-text-s uppercase tracking-widest mb-1">
            Market AI
          </h3>
          <p className="text-xs text-text-s leading-relaxed">
            Optional. Powers Market Top Stories (Gemini + web search). Keys are stored locally in{" "}
            <span className="font-mono text-accent/90">{shortEnv ?? ".env.local"}</span> on this
            device and are never sent to GitHub.
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
            <p className="mt-1.5 text-[11px] text-text-s leading-relaxed">
              {provider === "gemini" ? (
                <>
                  <strong className="text-text-p font-semibold">Required for Top Stories.</strong>{" "}
                  Fetches up to five market headlines via Google Search.
                </>
              ) : (
                <>
                  Top Stories need Gemini (web search). OpenAI cannot fetch live headlines.
                </>
              )}
            </p>
          </label>

          {activeConfigured && activeMasked && (
            <p className="text-[11px] text-text-s">
              Current {provider === "openai" ? "OpenAI" : "Gemini"} key:{" "}
              <span className="font-mono text-accent/90">{activeMasked}</span>
            </p>
          )}

          {activeConfigured && (
            <p
              className={`text-[11px] leading-relaxed ${
                statusIsWarning ? "text-amber-400/90" : "text-emerald-400/90"
              }`}
            >
              {statusLoading ? (
                <span className="text-text-s inline-flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" /> Checking model…
                </span>
              ) : statusLine ? (
                <>Configured · {statusLine}</>
              ) : (
                <>Configured</>
              )}
            </p>
          )}

          <label className="block">
            <span className="text-[10px] font-bold text-text-s uppercase tracking-widest">
              {provider === "openai"
                ? settings?.openai.configured
                  ? "Replace OpenAI API key"
                  : "OpenAI API key"
                : settings?.gemini.configured
                  ? "Replace Gemini API key"
                  : "Gemini API key"}
            </span>
            <input
              type="password"
              value={provider === "openai" ? openaiKey : geminiKey}
              onChange={(e) =>
                provider === "openai"
                  ? setOpenaiKey(e.target.value)
                  : setGeminiKey(e.target.value)
              }
              placeholder={`Paste ${provider === "openai" ? "OpenAI" : "Gemini"} API key`}
              autoComplete="off"
              spellCheck={false}
              className="mt-1.5 w-full rounded-lg border border-border/60 bg-bg/60 px-3 py-2.5 text-sm font-mono text-text-p placeholder:text-text-s/60 focus:outline-none focus:ring-1 focus:ring-accent/50"
            />
          </label>

          <label className="block">
            <span className="text-[10px] font-bold text-text-s uppercase tracking-widest">
              Model
            </span>
            <ModelSelect value={modelValue} options={modelOptions} onChange={setModelValue} />
            {provider === "openai" && (
              <details className="mt-2 text-[11px] text-text-s">
                <summary className="cursor-pointer text-accent/90 hover:underline">
                  Why not gpt-5?
                </summary>
                <p className="mt-1.5 leading-relaxed">
                  BÖRS uses OpenAI Chat Completions. Newer gpt-5 and o-series models require the
                  Responses API and are not available here. Use Automatic or pick a model from the
                  list above.
                </p>
              </details>
            )}
          </label>

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
