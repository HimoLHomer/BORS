export const DIVIDEND_INFO_LINKS_STORAGE_KEY = 'bors_dividend_info_links';

export const DIVIDEND_INFO_LINKS_CHANGED_EVENT = 'bors-dividend-info-links-changed';

export function notifyDividendInfoLinksChanged(): void {
  window.dispatchEvent(new Event(DIVIDEND_INFO_LINKS_CHANGED_EVENT));
}

export function loadDividendInfoLinks(): Record<string, string> {
  try {
    const raw = localStorage.getItem(DIVIDEND_INFO_LINKS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof k === 'string' && typeof v === 'string' && v.trim()) {
        out[k.trim().toUpperCase()] = v.trim();
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function saveDividendInfoLinks(links: Record<string, string>): void {
  localStorage.setItem(DIVIDEND_INFO_LINKS_STORAGE_KEY, JSON.stringify(links));
  notifyDividendInfoLinksChanged();
}

export function dividendInfoLinkKeyForSymbol(symbol: string | null | undefined): string | null {
  const s = symbol?.trim();
  return s ? s.toUpperCase() : null;
}

export function dividendInfoLinkKeyForManual(
  linkedSymbol: string | null | undefined,
  manualId: string
): string {
  const sym = dividendInfoLinkKeyForSymbol(linkedSymbol);
  return sym ?? `manual:${manualId}`;
}

/** Accept bare domains; persist with https:// */
export function normalizeDividendInfoUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

export function dividendInfoLinkLabel(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./i, '');
    const path = u.pathname.replace(/\/$/, '');
    if (path && path !== '/') return `${host}${path.length > 18 ? `${path.slice(0, 16)}…` : path}`;
    return host;
  } catch {
    return 'Open link';
  }
}
