/** FIRE annual savings goal hit — celebrate once per year per browser session. */

const SESSION_KEY = 'bors_fire_goal_celebrated_years';

function readCelebratedYears(): Set<string> {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((y): y is string => typeof y === 'string' && y.length > 0));
  } catch {
    return new Set();
  }
}

export function isFireGoalCelebratedThisSession(year: string): boolean {
  return readCelebratedYears().has(year);
}

export function markFireGoalCelebratedThisSession(year: string): void {
  try {
    const set = readCelebratedYears();
    set.add(year);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}
