/** Finnish number formatting (comma decimals, space thousands). */



export const FI_LOCALE = 'fi-FI';



const FI_DECIMAL_SEP = ',';

const FI_GROUP_SEP = '\u00a0';



function formatDecimalFiManual(value: number, fractionDigits: number): string {

  const neg = value < 0;

  const abs = Math.abs(value);

  const fixed = abs.toFixed(fractionDigits);

  const [intPart, decPart] = fixed.split('.');

  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, FI_GROUP_SEP);

  const body = decPart != null ? `${grouped}${FI_DECIMAL_SEP}${decPart}` : grouped;

  return neg ? `−${body}` : body;

}



function formatWithFiLocale(

  value: number,

  fractionDigits: number,

  style?: 'decimal' | 'percent'

): string {

  try {

    const formatted = new Intl.NumberFormat(FI_LOCALE, {

      style: style ?? 'decimal',

      minimumFractionDigits: fractionDigits,

      maximumFractionDigits: fractionDigits,

    }).format(value);

    if (formatted.includes(FI_DECIMAL_SEP)) return formatted;

  } catch {

    /* fall through */

  }

  return formatDecimalFiManual(value, fractionDigits);

}



/** Parse user input: accepts Finnish comma or ASCII dot, ignores spaces. */

export function parseDecimalInput(raw: string, fallback = 0): number {

  const cleaned = raw.trim().replace(/\s/g, '').replace(',', '.');

  if (cleaned === '' || cleaned === '-' || cleaned === '+') return fallback;

  const n = parseFloat(cleaned);

  return Number.isFinite(n) ? n : fallback;

}



export function formatNumberFi(

  value: number,

  options: {

    minimumFractionDigits?: number;

    maximumFractionDigits?: number;

  } = {}

): string {

  if (!Number.isFinite(value)) return '—';

  return new Intl.NumberFormat(FI_LOCALE, {

    minimumFractionDigits: options.minimumFractionDigits,

    maximumFractionDigits: options.maximumFractionDigits,

  }).format(value);

}



/** Fixed decimal places (e.g. inputs on blur, cash field). */

export function formatDecimalFi(value: number, fractionDigits = 2): string {

  if (!Number.isFinite(value)) return '';

  return formatWithFiLocale(value, fractionDigits);

}

/** Fixed decimal places in English locale (e.g. portfolio cash field). */
export function formatDecimalEn(value: number, fractionDigits = 2): string {
  if (!Number.isFinite(value)) return '';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

/** Whole number without thousands grouping (e.g. calendar year). */
export function formatWholeNumber(value: number): string {
  if (!Number.isFinite(value)) return '';
  return String(Math.round(value));
}

/** Reformat a raw display string (e.g. from `Number.toString()`) to Finnish decimals. */

export function formatDecimalInputFi(raw: string, fractionDigits = 2): string {

  const t = raw.trim();

  if (t === '') return '';

  const n = parseDecimalInput(t, NaN);

  if (!Number.isFinite(n)) return raw;

  return formatDecimalFi(n, fractionDigits);

}

/** Reformat a raw display string to English decimals. */
export function formatDecimalInputEn(raw: string, fractionDigits = 2): string {
  const t = raw.trim();
  if (t === '') return '';
  const n = parseDecimalInput(t, NaN);
  if (!Number.isFinite(n)) return raw;
  return formatDecimalEn(n, fractionDigits);
}



/** Percent with Finnish grouping; optional leading + for positive values. */

export function formatPercentFi(

  value: number,

  fractionDigits = 2,

  options: { showPlus?: boolean } = {}

): string {

  if (!Number.isFinite(value)) return '—';

  const formatted = formatWithFiLocale(value, fractionDigits);

  const prefix = options.showPlus && value > 0 ? '+' : '';

  return `${prefix}${formatted}\u00a0%`;

}

/** Percent in English locale; optional leading + for positive values. */
export function formatPercentEn(
  value: number,
  fractionDigits = 2,
  options: { showPlus?: boolean } = {}
): string {
  if (!Number.isFinite(value)) return '—';
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
  const prefix = options.showPlus && value > 0 ? '+' : '';
  return `${prefix}${formatted}%`;
}


