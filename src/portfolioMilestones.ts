/** Round EUR portfolio totals — whisper banner once per threshold (localStorage). */

const MILESTONE_STEP_EUR = 10_000;
const MILESTONE_MAX_EUR = 1_000_000;

export const PORTFOLIO_MILESTONE_THRESHOLDS_EUR = Array.from(
  { length: MILESTONE_MAX_EUR / MILESTONE_STEP_EUR },
  (_, i) => (i + 1) * MILESTONE_STEP_EUR,
);

const STORAGE_KEY = 'bors_portfolio_milestones_shown';

function readShown(): Set<number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((n): n is number => typeof n === 'number' && Number.isFinite(n)));
  } catch {
    return new Set();
  }
}

export function isPortfolioMilestoneShown(thresholdEur: number): boolean {
  return readShown().has(thresholdEur);
}

export function markPortfolioMilestoneShown(thresholdEur: number): void {
  try {
    const shown = readShown();
    shown.add(thresholdEur);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...shown].sort((a, b) => a - b)));
  } catch {
    /* ignore */
  }
}

/** Highest threshold newly crossed upward (prev → next) that has not been shown yet. */
export function findNewPortfolioMilestone(prevEur: number, nextEur: number): number | null {
  if (!Number.isFinite(prevEur) || !Number.isFinite(nextEur) || nextEur <= prevEur) return null;
  let crossed: number | null = null;
  for (const t of PORTFOLIO_MILESTONE_THRESHOLDS_EUR) {
    if (prevEur < t && nextEur >= t && !isPortfolioMilestoneShown(t)) {
      crossed = t;
    }
  }
  return crossed;
}

export function formatMilestoneLabel(thresholdEur: number): string {
  if (thresholdEur >= 1_000_000) return `€${thresholdEur / 1_000_000}M`;
  if (thresholdEur >= 1_000) return `€${Math.round(thresholdEur / 1_000)}k`;
  return `€${thresholdEur}`;
}
