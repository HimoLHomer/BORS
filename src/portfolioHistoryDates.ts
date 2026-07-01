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
 * Dates missing from `existingDates` between the last stored point and `untilDate` (inclusive),
 * capped to at most `maxDays` calendar days ending at `untilDate`.
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
  if (existingDates.length > 0) {
    const latest = [...existingDates].sort().at(-1)!;
    if (latest >= untilDate) return [];
    const dayAfterLatest = addCalendarDaysIso(latest, 1);
    if (dayAfterLatest && dayAfterLatest > rangeStart) {
      rangeStart = dayAfterLatest;
    }
  }

  if (rangeStart > untilDate) return [];

  return eachCalendarDayIso(rangeStart, untilDate).filter((d) => !existing.has(d));
}
