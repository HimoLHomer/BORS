import { parseIsoDateOnly } from './formatDate';
import { todayIsoDateHelsinki } from './formatDate';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDateString(s: string): boolean {
  return ISO_DATE.test(s.trim());
}

/** Add calendar days to an ISO date string (UTC date math). */
export function addCalendarDaysIso(iso: string, deltaDays: number): string | null {
  const d = parseIsoDateOnly(iso);
  if (!d) return null;
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/** Yesterday's calendar date in Europe/Helsinki. */
export function yesterdayIsoDateHelsinki(): string {
  const today = todayIsoDateHelsinki();
  return addCalendarDaysIso(today, -1) ?? today;
}

/**
 * Calendar dates in [start, end] inclusive (ISO strings), ascending.
 */
export function eachCalendarDayIso(startIso: string, endIso: string): string[] {
  const start = parseIsoDateOnly(startIso);
  const end = parseIsoDateOnly(endIso);
  if (!start || !end || start.getTime() > end.getTime()) return [];

  const out: string[] = [];
  const cur = new Date(start.getTime());
  while (cur.getTime() <= end.getTime()) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export const DEFAULT_HISTORY_BACKFILL_MAX_DAYS = 90;

/**
 * Dates missing from `existingDates` within the `maxDays` calendar days ending at `untilDate`
 * (inclusive), from the first stored point on. Gaps before a later stored day count too, so a
 * day saved since (e.g. today's live value) does not hide the days missed before it.
 */
export function listMissingHistoryDates(
  existingDates: string[],
  untilDate: string,
  maxDays: number = DEFAULT_HISTORY_BACKFILL_MAX_DAYS
): string[] {
  if (!isIsoDateString(untilDate) || maxDays < 1) return [];

  const existing = new Set(existingDates.filter(isIsoDateString));
  const windowStart =
    addCalendarDaysIso(untilDate, -(maxDays - 1)) ?? untilDate;

  let rangeStart = windowStart;
  const earliest = [...existing].sort()[0];
  // History is not invented before the portfolio's first stored day.
  if (earliest && earliest > rangeStart) rangeStart = earliest;

  if (rangeStart > untilDate) return [];

  return eachCalendarDayIso(rangeStart, untilDate).filter((d) => !existing.has(d));
}
