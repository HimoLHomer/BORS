import {
  DEFAULT_FIRE_EXPENSES,
  type FireCapitalInputs,
  type FireExpenseLine,
} from './fireProjectionEngine';
import { formatMonthYearFi } from './formatDate';

export const FIRE_STORAGE_KEY = 'bors_fire_inputs_v1';

export type FireMonthlySaving = {
  id: string;
  /** YYYY-MM for sorting */
  month: string;
  savedEur: number;
};

export type FireStoredInputs = {
  capital: FireCapitalInputs;
  expenses: FireExpenseLine[];
  monthlySavings: FireMonthlySaving[];
};

const currentYear = () => new Date().getFullYear();

export function defaultFireCapital(): FireCapitalInputs {
  return {
    marketReturnPercent: 7,
    blendedYieldPercent: 5,
    investedMonthlyEur: 1000,
    startAge: 0,
    startYear: currentYear(),
    dividendTaxRatePercent: 25,
  };
}

export function defaultFireStored(): FireStoredInputs {
  return {
    capital: defaultFireCapital(),
    expenses: DEFAULT_FIRE_EXPENSES.map((e) => ({ ...e })),
    monthlySavings: [],
  };
}

export function parseMonthKey(raw: string): string | null {
  const t = raw.trim();
  const iso = /^(\d{4})-(\d{1,2})$/.exec(t);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    if (m >= 1 && m <= 12) return `${y}-${String(m).padStart(2, '0')}`;
  }
  const slash = /^(\d{1,2})\s*[./]\s*(\d{4})$/.exec(t);
  if (slash) {
    const m = Number(slash[1]);
    const y = Number(slash[2]);
    if (m >= 1 && m <= 12) return `${y}-${String(m).padStart(2, '0')}`;
  }
  const named = /^([a-zA-Z]+)\s+(\d{4})$/.exec(t);
  if (named) {
    const d = new Date(`${named[1]} 1, ${named[2]}`);
    if (!Number.isNaN(d.getTime())) {
      const y = d.getFullYear();
      const mo = d.getMonth() + 1;
      if (mo >= 1 && mo <= 12) return `${y}-${String(mo).padStart(2, '0')}`;
    }
  }
  return null;
}

export function formatMonthDisplay(monthKey: string): string {
  return formatMonthYearFi(monthKey);
}

export function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Row is complete enough to group and sort by month (valid month + amount entered). */
export function isMonthlySavingComplete(row: FireMonthlySaving): boolean {
  if (parseMonthKey(row.month) == null) return false;
  return Number.isFinite(row.savedEur) && row.savedEur > 0;
}


export function loadFireInputs(): FireStoredInputs {
  try {
    const raw = localStorage.getItem(FIRE_STORAGE_KEY);
    if (!raw) return defaultFireStored();
    const o = JSON.parse(raw) as Partial<FireStoredInputs> & {
      capital?: Partial<FireCapitalInputs> & { portfolioYieldPercent?: number };
    };
    const d = defaultFireStored();
    const c = (o.capital ?? {}) as Partial<FireCapitalInputs> & { portfolioYieldPercent?: number };
    return {
      capital: {
        marketReturnPercent: num(c.marketReturnPercent, d.capital.marketReturnPercent),
        blendedYieldPercent: num(c.blendedYieldPercent, d.capital.blendedYieldPercent),
        investedMonthlyEur: num(c.investedMonthlyEur, d.capital.investedMonthlyEur),
        startAge: num(c.startAge, d.capital.startAge),
        startYear: num(c.startYear, d.capital.startYear),
        dividendTaxRatePercent: num(c.dividendTaxRatePercent, d.capital.dividendTaxRatePercent),
      },
      expenses: Array.isArray(o.expenses)
        ? o.expenses.map((e, i) => ({
            id: String(e?.id ?? `exp-${i}`),
            label: String(e?.label ?? 'Expense'),
            monthlyEur: num(e?.monthlyEur, 0),
          }))
        : d.expenses,
      monthlySavings: Array.isArray(o.monthlySavings)
        ? o.monthlySavings
            .map((s, i) => {
              const month =
                typeof s?.month === 'string'
                  ? parseMonthKey(s.month) ?? parseMonthKey(String(s.month))
                  : null;
              return {
                id: String(s?.id ?? `save-${i}`),
                month: month ?? '',
                savedEur: num(s?.savedEur, 0),
              };
            })
        : d.monthlySavings,
    };
  } catch {
    return defaultFireStored();
  }
}

export const FIRE_INPUTS_CHANGED_EVENT = 'bors-fire-inputs-changed';

export function saveFireInputs(data: FireStoredInputs): void {
  try {
    localStorage.setItem(FIRE_STORAGE_KEY, JSON.stringify(data));
    window.dispatchEvent(new Event(FIRE_INPUTS_CHANGED_EVENT));
  } catch {
    /* ignore */
  }
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}
