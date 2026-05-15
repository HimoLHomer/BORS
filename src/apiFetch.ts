/** Parse a fetch Response as JSON; fail clearly when the server returned HTML (e.g. wrong dev port). */
export async function fetchJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  const trimmed = text.trimStart();
  if (!trimmed) {
    throw new Error(
      `Empty response from server (HTTP ${res.status}). Restart with npm run dev on port 3000 and try again.`
    );
  }
  if (trimmed.startsWith('<!') || trimmed.startsWith('<html')) {
    throw new Error(
      'Server returned HTML instead of JSON. Use npm run dev (port 3000), not Vite alone, and restart the server after pulling changes.'
    );
  }
  try {
    const data = JSON.parse(text) as T;
    if (
      res.status === 404 &&
      data &&
      typeof data === "object" &&
      "error" in data &&
      typeof (data as { error: unknown }).error === "string"
    ) {
      throw new Error((data as { error: string }).error);
    }
    return data;
  } catch (e) {
    if (e instanceof Error && e.message.includes("API route not found")) throw e;
    throw new Error(
      `Invalid JSON response (HTTP ${res.status}): ${trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed}`
    );
  }
}