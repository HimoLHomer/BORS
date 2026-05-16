/** User-facing text for market AI failures (never show raw JSON). */
export function friendlyAiErrorMessage(raw: string): string {
  let text = raw.trim();
  if (!text) return 'AI summary unavailable. Try again in a few minutes.';

  const fetchJsonPrefix = /^Invalid JSON response \(HTTP \d+\):\s*/i;
  if (fetchJsonPrefix.test(text)) {
    text = text.replace(fetchJsonPrefix, '').trim();
  }

  const embeddedJson = text.match(/\{[\s\S]*\}/);
  if (embeddedJson && !text.startsWith('{')) {
    try {
      const parsed = JSON.parse(embeddedJson[0]) as {
        error?: { message?: string } | string;
      };
      if (typeof parsed.error === 'string') return friendlyAiErrorMessage(parsed.error);
      if (parsed.error?.message) return friendlyAiErrorMessage(parsed.error.message);
    } catch {
      /* fall through */
    }
  }

  const lower = text.toLowerCase();
  if (lower.includes('quota') || lower.includes('429') || lower.includes('rate limit')) {
    return 'AI provider quota or rate limit reached. Wait a few minutes and try again.';
  }
  if (lower.includes('api key') || lower.includes('403') || lower.includes('401')) {
    return 'API key was rejected. Update it under **Options → Market AI**.';
  }
  if (
    lower.includes('is not found for api version') ||
    lower.includes('is not found') ||
    lower.includes('no longer available') ||
    lower.includes('model unavailable') ||
    (lower.includes('no ') && lower.includes('models available'))
  ) {
    return 'AI model unavailable. The app will try other models automatically on the next refresh. If this persists, check your provider and key under **Options → Market AI**.';
  }
  if (lower.includes('not configured') || lower.includes('no api key')) {
    return 'Add an API key under **Options → Market AI** for the provider you selected.';
  }

  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } | string };
      if (typeof parsed.error === 'string') return friendlyAiErrorMessage(parsed.error);
      if (parsed.error?.message) return friendlyAiErrorMessage(parsed.error.message);
    } catch {
      return 'AI summary unavailable. Try again in a few minutes.';
    }
  }

  if (text.length > 200) return `${text.slice(0, 200)}…`;
  return text;
}
