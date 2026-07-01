/** App number formatting (en-US). */

export const APP_LOCALE = 'en-US';

/** Parse user input: en-US decimals and optional thousand commas. */
export function parseDecimalInput(raw: string, fallback = 0): number {
  let t = raw.trim().replace(/\s/g, '');
  if (t === '' || t === '-' || t === '+') return fallback;

  const lastComma = t.lastIndexOf(',');
  const lastDot = t.lastIndexOf('.');

  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    if (lastDot > lastComma) {
      normalized = t.replace(/,/g, '');
    } else {
      normalized = t.replace(/\./g, '').replace(',', '.');
    }
  } else if (lastComma >= 0) {
    const after = t.length - lastComma - 1;
    if (after > 0 && after <= 2 && !t.slice(0, lastComma).includes(',')) {
      normalized = t.replace(',', '.');
    } else {
      normalized = t.replace(/,/g, '');
    }
  } else {
    normalized = t;
  }

  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : fallback;
}

/** Whole shares only (no fractional units). */
export function parseShareInput(raw: string, fallback = 0): number {
  const n = parseDecimalInput(raw, NaN);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n + 1e-9));
}

/** Keep digits and thousand commas while typing share counts. */
export function sanitizeShareDraft(raw: string): string {
  return raw.replace(/[^\d,]/g, '');
}

/** Format a share count for display (no decimals). */
export function formatShares(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '';
  return new Intl.NumberFormat(APP_LOCALE, { maximumFractionDigits: 0 }).format(Math.round(value));
}

/** Normalize share input on blur. */
export function formatShareInput(raw: string): string {
  const t = raw.trim();
  if (t === '') return '';
  const n = parseShareInput(t, NaN);
  if (!Number.isFinite(n)) return sanitizeShareDraft(t);
  return formatShares(n);
}

export function formatNumberFi(
  value: number,
  options: {
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
  } = {}
): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(APP_LOCALE, {
    minimumFractionDigits: options.minimumFractionDigits,
    maximumFractionDigits: options.maximumFractionDigits,
  }).format(value);
}

export function formatDecimalEn(value: number, fractionDigits = 2): string {
  if (!Number.isFinite(value)) return '';
  return new Intl.NumberFormat(APP_LOCALE, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

/** Fixed decimal places (e.g. inputs on blur, cash field). */
export function formatDecimalFi(value: number, fractionDigits = 2): string {
  return formatDecimalEn(value, fractionDigits);
}

/** Whole number without thousands grouping (e.g. calendar year). */
export function formatWholeNumber(value: number): string {
  if (!Number.isFinite(value)) return '';
  return String(Math.round(value));
}

/** Reformat a raw display string (e.g. from `Number.toString()`). */
export function formatDecimalInputFi(raw: string, fractionDigits = 2): string {
  return formatDecimalInputEn(raw, fractionDigits);
}

export function formatDecimalInputEn(raw: string, fractionDigits = 2): string {
  const t = raw.trim();
  if (t === '') return '';
  const n = parseDecimalInput(t, NaN);
  if (!Number.isFinite(n)) return raw;
  return formatDecimalEn(n, fractionDigits);
}

export function formatPercentFi(
  value: number,
  fractionDigits = 2,
  options: { showPlus?: boolean } = {}
): string {
  return formatPercentEn(value, fractionDigits, options);
}

export function formatPercentEn(
  value: number,
  fractionDigits = 2,
  options: { showPlus?: boolean } = {}
): string {
  if (!Number.isFinite(value)) return '—';
  const formatted = new Intl.NumberFormat(APP_LOCALE, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
  const prefix = options.showPlus && value > 0 ? '+' : '';
  return `${prefix}${formatted}%`;
}
