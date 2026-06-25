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
    return 'Gemini quota or rate limit reached. Wait a few minutes and try again.';
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
    return 'Gemini model unavailable. The app will try other models automatically on the next refresh. If this persists, check your key under **Options → Market AI**.';
  }
  if (lower.includes('not configured') || lower.includes('no api key')) {
    return 'Add a Gemini API key under **Options → Market AI**.';
  }
  if (
    lower.includes('high demand') ||
    lower.includes('temporarily unavailable') ||
    lower.includes('overloaded') ||
    lower.includes('all gemini models are busy') ||
    (lower.includes('try again later') &&
      !lower.includes('api key') &&
      !lower.includes('invalid_api_key'))
  ) {
    return 'All Gemini models are busy. Try again in a few minutes.';
  }

  if (text.startsWith('{') && /"stories"\s*:/i.test(text)) {
    return 'No top stories found for this market date. Try refresh in a few minutes.';
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
