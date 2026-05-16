export type FireCapitalInputs = {
  marketReturnPercent: number;
  investedMonthlyEur: number;
  startAge: number;
  startYear: number;
  /** Withholding from gross dividend (0–100). */
  dividendTaxRatePercent: number;
};

export type FireExpenseLine = {
  id: string;
  label: string;
  monthlyEur: number;
};

export type FireYearRow = {
  yearIndex: number;
  age: number;
  calendarYear: number;
  portfolioValueEur: number;
  annualDividendEur: number;
  annualDividendNetEur: number;
  monthlyDividendEur: number;
  annualExpensesEur: number;
  annualNeededFromLabourEur: number;
  /** Months of expenses not covered by net dividends (0 when fully covered). */
  monthsNotCoveredByDividends: number;
};

export const FIRE_HORIZON_YEARS = 30;

export const DEFAULT_FIRE_EXPENSES: FireExpenseLine[] = [];

export function monthlyExpensesTotal(lines: FireExpenseLine[]): number {
  return lines.reduce((s, l) => s + (Number.isFinite(l.monthlyEur) ? Math.max(0, l.monthlyEur) : 0), 0);
}

/** Compound one year: monthly contributions + monthly compounding at annual market return. */
export function compoundPortfolioOneYear(
  startPortfolioEur: number,
  marketReturnPercent: number,
  investedMonthlyEur: number
): number {
  const annualRate = marketReturnPercent / 100;
  if (!Number.isFinite(annualRate)) return startPortfolioEur;
  const monthlyRate = annualRate === 0 ? 0 : Math.pow(1 + annualRate, 1 / 12) - 1;
  let portfolio = Math.max(0, startPortfolioEur);
  const monthlyInvest = Math.max(0, investedMonthlyEur);
  for (let m = 0; m < 12; m++) {
    portfolio = portfolio * (1 + monthlyRate) + monthlyInvest;
  }
  return portfolio;
}

export function dividendMetricsForYear(
  portfolioValueEur: number,
  blendedYieldPercent: number,
  dividendTaxRatePercent: number,
  monthlyExpenses: number
): Pick<
  FireYearRow,
  | 'annualDividendEur'
  | 'annualDividendNetEur'
  | 'monthlyDividendEur'
  | 'annualExpensesEur'
  | 'annualNeededFromLabourEur'
  | 'monthsNotCoveredByDividends'
> {
  const yieldRate = Math.max(0, blendedYieldPercent) / 100;
  const tax = Math.min(100, Math.max(0, dividendTaxRatePercent)) / 100;
  const annualExpensesEur = monthlyExpenses * 12;
  const annualDividendEur = portfolioValueEur * yieldRate;
  const annualDividendNetEur = annualDividendEur * (1 - tax);
  const monthlyDividendEur = annualDividendNetEur / 12;
  const annualNeededFromLabourEur = Math.max(0, annualExpensesEur - annualDividendNetEur);
  const monthsNotCoveredByDividends =
    monthlyExpenses > 0
      ? Math.max(0, (annualExpensesEur - annualDividendNetEur) / monthlyExpenses)
      : 0;

  return {
    annualDividendEur,
    annualDividendNetEur,
    monthlyDividendEur,
    annualExpensesEur,
    annualNeededFromLabourEur,
    monthsNotCoveredByDividends,
  };
}

export function findFinancialIndependenceYearIndex(rows: FireYearRow[]): number {
  return rows.findIndex((r) => r.monthsNotCoveredByDividends <= 0);
}

export function independenceGoalFromProjection(rows: FireYearRow[]): number {
  const i = findFinancialIndependenceYearIndex(rows);
  return i >= 0 ? rows[i]!.portfolioValueEur : 0;
}

export function projectFireYears(
  startPortfolioEur: number,
  capital: FireCapitalInputs,
  monthlyExpenses: number,
  blendedYieldPercent: number,
  horizonYears: number = FIRE_HORIZON_YEARS
): FireYearRow[] {
  let portfolio = Math.max(0, startPortfolioEur);
  const rows: FireYearRow[] = [];

  for (let i = 0; i < horizonYears; i++) {
    if (i > 0) {
      portfolio = compoundPortfolioOneYear(
        portfolio,
        capital.marketReturnPercent,
        capital.investedMonthlyEur
      );
    }

    const dividend = dividendMetricsForYear(
      portfolio,
      blendedYieldPercent,
      capital.dividendTaxRatePercent,
      monthlyExpenses
    );

    rows.push({
      yearIndex: i,
      age: capital.startAge + i,
      calendarYear: capital.startYear + i,
      portfolioValueEur: portfolio,
      ...dividend,
    });
  }

  return rows;
}
