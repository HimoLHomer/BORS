/** User-facing text for Gemini / market AI failures (never show raw JSON). */
export function friendlyAiErrorMessage(raw: string): string {
  const text = raw.trim();
  if (!text) return "AI summary unavailable. Try again in a few minutes.";

  const lower = text.toLowerCase();
  if (lower.includes("quota") || lower.includes("429") || lower.includes("rate limit")) {
    return "Gemini free-tier quota is used up for now. Wait a few minutes or check usage in [Google AI Studio](https://aistudio.google.com/).";
  }
  if (lower.includes("api key") || lower.includes("403")) {
    return "Gemini API key was rejected. Check `GEMINI_API_KEY` in `.env.local` and restart `npm run dev`.";
  }

  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } | string };
      if (typeof parsed.error === "string") return friendlyAiErrorMessage(parsed.error);
      if (parsed.error?.message) return friendlyAiErrorMessage(parsed.error.message);
    } catch {
      return "AI summary unavailable. Try again in a few minutes.";
    }
  }

  if (text.length > 200) return `${text.slice(0, 200)}…`;
  return text;
}
