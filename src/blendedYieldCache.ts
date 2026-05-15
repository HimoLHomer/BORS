export const BLENDED_YIELD_KEY = 'bors_blended_yield_v1';
export const BLENDED_YIELD_UPDATED_EVENT = 'bors-blended-yield-updated';

export type BlendedYieldSnapshot = {
  avgYieldPercent: number;
  totalAnnualEur: number;
  updatedAt: number;
};

export function loadBlendedYieldCache(): BlendedYieldSnapshot | null {
  try {
    const raw = localStorage.getItem(BLENDED_YIELD_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<BlendedYieldSnapshot>;
    const avg = typeof o.avgYieldPercent === 'number' ? o.avgYieldPercent : NaN;
    if (!Number.isFinite(avg) || avg < 0) return null;
    return {
      avgYieldPercent: avg,
      totalAnnualEur: typeof o.totalAnnualEur === 'number' && Number.isFinite(o.totalAnnualEur) ? o.totalAnnualEur : 0,
      updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

export function saveBlendedYieldCache(snapshot: Omit<BlendedYieldSnapshot, 'updatedAt'>): void {
  try {
    const payload: BlendedYieldSnapshot = { ...snapshot, updatedAt: Date.now() };
    localStorage.setItem(BLENDED_YIELD_KEY, JSON.stringify(payload));
    window.dispatchEvent(new CustomEvent(BLENDED_YIELD_UPDATED_EVENT));
  } catch {
    /* ignore */
  }
}
