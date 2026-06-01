/** Regular cash-session hours (weekdays only; holidays not included). */

import { useEffect, useState } from "react";

export type MarketVariant = "us" | "fi";

type SessionConfig = {
  marketName: string;
  timeZone: string;
  openMinutes: number;
  closeMinutes: number;
  /** Show opening clock in this zone (Helsinki for the app). */
  displayTimeZone: string;
};

const SESSIONS: Record<MarketVariant, SessionConfig> = {
  us: {
    marketName: "US markets",
    timeZone: "America/New_York",
    openMinutes: 9 * 60 + 30,
    closeMinutes: 16 * 60,
    displayTimeZone: "Europe/Helsinki",
  },
  fi: {
    marketName: "OMX Helsinki",
    timeZone: "Europe/Helsinki",
    openMinutes: 10 * 60,
    closeMinutes: 18 * 60 + 30,
    displayTimeZone: "Europe/Helsinki",
  },
};

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  weekday: number;
  minutes: number;
};

const WEEKDAY: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = Number(pick("hour"));
  const minute = Number(pick("minute"));
  return {
    year: Number(pick("year")),
    month: Number(pick("month")),
    day: Number(pick("day")),
    weekday: WEEKDAY[pick("weekday")] ?? 0,
    minutes: hour * 60 + minute,
  };
}

function formatTimeInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("fi-FI", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** UTC instant for a wall-clock time on a calendar day in `timeZone`. */
function zonedLocalToUtc(
  year: number,
  month: number,
  day: number,
  minutes: number,
  timeZone: string
): Date {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  let guess = Date.UTC(year, month - 1, day, hour, minute);
  for (let offsetH = -16; offsetH <= 16; offsetH++) {
    const d = new Date(guess + offsetH * 3_600_000);
    const p = getZonedParts(d, timeZone);
    if (
      p.year === year &&
      p.month === month &&
      p.day === day &&
      p.minutes === minutes
    ) {
      return d;
    }
  }
  return new Date(guess);
}

function addCalendarDays(
  year: number,
  month: number,
  day: number,
  delta: number
): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(year, month - 1, day + delta));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

function nextWeekdayParts(
  from: ZonedParts,
  timeZone: string,
  forwardDays: number
): ZonedParts {
  let { year, month, day } = from;
  for (let i = 0; i < forwardDays; i++) {
    const next = addCalendarDays(year, month, day, 1);
    year = next.year;
    month = next.month;
    day = next.day;
  }
  const noon = zonedLocalToUtc(year, month, day, 12 * 60, timeZone);
  return getZonedParts(noon, timeZone);
}

function openTimeLabel(cfg: SessionConfig, on: ZonedParts): string {
  const openUtc = zonedLocalToUtc(on.year, on.month, on.day, cfg.openMinutes, cfg.timeZone);
  return formatTimeInZone(openUtc, cfg.displayTimeZone);
}

export type MarketSessionStatus = {
  isOpen: boolean;
  /**
   * Keep showing the day's AI summary after the cash session ends until local
   * midnight in the market timezone; then show {@link closedMessage} until open.
   */
  showSummary: boolean;
  /** Markdown-friendly message when {@link showSummary} is false. */
  closedMessage: string;
};

function closedStatus(
  closedMessage: string,
  showSummary: boolean
): MarketSessionStatus {
  return { isOpen: false, showSummary, closedMessage };
}

/** Weekday after official close, still same calendar day (until 00:00). */
function isPostCloseSameDay(z: ZonedParts, cfg: SessionConfig): boolean {
  const isWeekday = z.weekday >= 1 && z.weekday <= 5;
  return isWeekday && z.minutes >= cfg.closeMinutes;
}

export function getMarketSessionStatus(
  variant: MarketVariant,
  now: Date = new Date()
): MarketSessionStatus {
  const cfg = SESSIONS[variant];
  const z = getZonedParts(now, cfg.timeZone);
  const isWeekday = z.weekday >= 1 && z.weekday <= 5;
  const isOpen =
    isWeekday && z.minutes >= cfg.openMinutes && z.minutes < cfg.closeMinutes;

  if (isOpen) {
    return { isOpen: true, showSummary: true, closedMessage: "" };
  }

  if (isPostCloseSameDay(z, cfg)) {
    return { isOpen: false, showSummary: true, closedMessage: "" };
  }

  const helsinkiNote =
    cfg.displayTimeZone === cfg.timeZone ? "" : " (Helsinki time)";

  if (!isWeekday) {
    let cursor = z;
    let hops = 0;
    while (cursor.weekday === 0 || cursor.weekday === 6) {
      cursor = nextWeekdayParts(cursor, cfg.timeZone, 1);
      hops++;
      if (hops > 7) break;
    }
    const mondayOpen = openTimeLabel(cfg, cursor);
    return closedStatus(
      `Market is closed. **${cfg.marketName}** opens Monday at **${mondayOpen}**${helsinkiNote}.`,
      false
    );
  }

  if (z.minutes < cfg.openMinutes) {
    const openLabel = openTimeLabel(cfg, z);
    return closedStatus(
      `Market is closed. **${cfg.marketName}** opens at **${openLabel}**${helsinkiNote}.`,
      false
    );
  }

  const tomorrow = nextWeekdayParts(z, cfg.timeZone, 1);
  const nextOpen = openTimeLabel(cfg, tomorrow);
  return closedStatus(
    `Market is closed. **${cfg.marketName}** opens tomorrow at **${nextOpen}**${helsinkiNote}.`,
    false
  );
}

/** Re-render when session may change (open/close, midnight). */
export function useMarketSessionClock(intervalMs = 60_000): number {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return tick;
}
