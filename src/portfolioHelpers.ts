import { parseDecimalInput, formatDecimalEn } from './formatNumber';
import type { HistoryPoint } from './types';

export enum View {
  DASHBOARD = 'DASHBOARD',
  DIVIDENDS = 'DIVIDENDS',
  FIRE = 'FIRE',
  MARKET_RECAP = 'MARKET_RECAP',
  OPTIONS = 'OPTIONS'
}

export function dedupeHistoryByDate(points: HistoryPoint[]): HistoryPoint[] {
  const seen = new Set<string>();
  return [...points]
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter((p) => {
      if (seen.has(p.date)) return false;
      seen.add(p.date);
      return true;
    });
}

export function normalizeCashAmountEur(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, raw);
  if (typeof raw === 'string') {
    const n = parseDecimalInput(raw, NaN);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

/** Parses the cash text field (comma or dot decimals). */
export function parseCashInputEur(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = parseDecimalInput(raw, NaN);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function formatCashEurTwoDecimals(n: number): string {
  return formatDecimalEn(n, 2);
}

export function isAbortError(e: unknown): boolean {
  return (
    (e instanceof DOMException && e.name === 'AbortError') ||
    (e instanceof Error && e.name === 'AbortError')
  );
}
