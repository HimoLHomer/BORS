import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, RefreshCcw, Trash2 } from 'lucide-react';
import type { Asset } from './types';
import { formatCurrency } from './formatCurrency';
import { formatNumberFi, formatPercentFi } from './formatNumber';
import { useFiDecimalDraft } from './useFiDecimalDraft';
import {
  FIRE_HORIZON_YEARS,
  findFinancialIndependenceYearIndex,
  independenceGoalFromProjection,
  monthlyExpensesTotal,
  projectFireYears,
  type FireCapitalInputs,
  type FireExpenseLine,
} from './fireProjectionEngine';
import {
  BLENDED_YIELD_UPDATED_EVENT,
  loadBlendedYieldCache,
} from './blendedYieldCache';
import {
  currentMonthKey,
  formatMonthDisplay,
  loadFireInputs,
  parseMonthKey,
  saveFireInputs,
  type FireMonthlySaving,
} from './fireStorage';
import { fetchBlendedDividendYieldPercent } from './portfolioDividendYield';
import { EurAmountField, EUR_AMOUNT_INPUT_PAD } from './EurAmountField';
import { DataListTable } from './DataListTable';

const PANEL = 'glass-panel p-8 bg-[#0e0e10]/80';
const INPUT =
  'w-full bg-bg/50 border border-border rounded-xl px-3 py-2 text-text-p font-mono text-sm focus:outline-none focus:border-accent/50 tabular-nums';
const LABEL = 'text-[9px] font-bold text-text-s uppercase tracking-widest opacity-60 block mb-1';
const INLINE_INPUT =
  'bg-bg/50 border border-border rounded-md px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-accent/40';
const ENTRY_ROW_GRID = 'grid grid-cols-[minmax(0,1fr)_5.5rem_1.75rem] gap-2 items-center';
const ENTRY_GROUP = 'rounded-lg border border-border/40 bg-bg/25 px-3 py-2.5';

function FireNumInput({
  label,
  value,
  onChange,
  suffix,
  step = '0.1',
  decimals = 2,
  readOnly,
  groupThousands = true,
}: {
  label: string;
  value: number;
  onChange?: (n: number) => void;
  suffix?: string;
  step?: string;
  decimals?: number;
  readOnly?: boolean;
  groupThousands?: boolean;
}) {
  const { inputProps } = useFiDecimalDraft(value, readOnly ? undefined : onChange, {
    fractionDigits: decimals,
    readOnly,
    groupThousands,
    trailingSuffix: suffix === '%' ? '%' : undefined,
  });

  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      <div className="relative">
        {suffix === '€' ? (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-s/55 text-xs font-mono font-bold pointer-events-none select-none">
            €
          </span>
        ) : null}
        <input
          type="text"
          inputMode="decimal"
          step={step}
          readOnly={readOnly}
          className={
            INPUT +
            (suffix === '€' ? ` ${EUR_AMOUNT_INPUT_PAD}` : '') +
            (readOnly ? ' opacity-70 cursor-default' : '')
          }
          {...inputProps}
        />
      </div>
    </label>
  );
}

function MonthYearInput({
  value,
  onChange,
  className = '',
}: {
  value: string;
  onChange: (monthKey: string) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(() => formatMonthDisplay(value));
  const editingRef = useRef(false);

  useEffect(() => {
    if (!editingRef.current) {
      setDraft(formatMonthDisplay(value));
    }
  }, [value]);

  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder="5.2026"
      className={`${INLINE_INPUT} tabular-nums text-text-p ${className || 'w-[5.5rem]'}`}
      value={draft}
      onFocus={() => {
        editingRef.current = true;
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        editingRef.current = false;
        const parsed = parseMonthKey(draft);
        if (parsed) {
          onChange(parsed);
          setDraft(formatMonthDisplay(parsed));
        } else {
          setDraft(formatMonthDisplay(value));
        }
      }}
    />
  );
}

function ExpenseAmountInput({
  value,
  onChange,
  className = '',
}: {
  value: number;
  onChange: (n: number) => void;
  className?: string;
}) {
  const { inputProps } = useFiDecimalDraft(value, onChange, { fractionDigits: 2, min: 0 });

  return (
    <EurAmountField className={className || 'w-[5.5rem] shrink-0'}>
      <input
        type="text"
        inputMode="decimal"
        className={`${INLINE_INPUT} w-full text-right tabular-nums text-text-p`}
        {...inputProps}
      />
    </EurAmountField>
  );
}

export function FireProjection({
  currentPortfolioEur,
  assets,
  marketPrices,
  exchangeRates,
  quoteCurrencies = {},
}: {
  currentPortfolioEur: number;
  assets: Asset[];
  marketPrices: Record<string, number>;
  exchangeRates: Record<string, number>;
  quoteCurrencies?: Record<string, string>;
}) {
  const [blendedYield, setBlendedYield] = useState<number | null>(() => {
    const c = loadBlendedYieldCache();
    return c != null ? c.avgYieldPercent : null;
  });
  const [yieldLoading, setYieldLoading] = useState(false);
  const [stored, setStored] = useState(() => loadFireInputs());

  const applyYieldResult = useCallback((avgYieldPercent: number) => {
    if (avgYieldPercent > 0) {
      setBlendedYield(avgYieldPercent);
      return;
    }
    const cached = loadBlendedYieldCache();
    if (cached != null && cached.avgYieldPercent > 0) {
      setBlendedYield(cached.avgYieldPercent);
    }
  }, []);

  const refreshBlendedYield = useCallback(async () => {
    setYieldLoading(true);
    try {
      const r = await fetchBlendedDividendYieldPercent(assets, marketPrices, exchangeRates);
      applyYieldResult(r.avgYieldPercent);
    } finally {
      setYieldLoading(false);
    }
  }, [assets, marketPrices, exchangeRates, applyYieldResult]);

  const quotesReady = assets.length === 0 || Object.keys(marketPrices).length > 0;

  useEffect(() => {
    if (!quotesReady) return;
    void refreshBlendedYield();
  }, [refreshBlendedYield, quotesReady]);

  useEffect(() => {
    const syncFromCache = () => {
      const c = loadBlendedYieldCache();
      if (c != null && c.avgYieldPercent > 0) setBlendedYield(c.avgYieldPercent);
    };
    window.addEventListener(BLENDED_YIELD_UPDATED_EVENT, syncFromCache);
    return () => window.removeEventListener(BLENDED_YIELD_UPDATED_EVENT, syncFromCache);
  }, []);

  useEffect(() => {
    saveFireInputs(stored);
  }, [stored]);

  const setCapital = (patch: Partial<FireCapitalInputs>) => {
    setStored((s) => ({ ...s, capital: { ...s.capital, ...patch } }));
  };

  const monthlyTotal = monthlyExpensesTotal(stored.expenses);
  const annualExpenses = monthlyTotal * 12;
  const cachedYieldNow = loadBlendedYieldCache();
  const effectiveYield =
    blendedYield != null && blendedYield > 0
      ? blendedYield
      : cachedYieldNow != null && cachedYieldNow.avgYieldPercent > 0
        ? cachedYieldNow.avgYieldPercent
        : blendedYield ?? 0;

  const projection = useMemo(
    () =>
      projectFireYears(
        Math.max(0, currentPortfolioEur),
        stored.capital,
        monthlyTotal,
        effectiveYield,
        FIRE_HORIZON_YEARS
      ),
    [currentPortfolioEur, stored.capital, monthlyTotal, effectiveYield]
  );

  const fiYearIndex = findFinancialIndependenceYearIndex(projection);
  const independenceCapital = independenceGoalFromProjection(projection);
  const fiRow = fiYearIndex >= 0 ? projection[fiYearIndex] : null;

  const capitalRows = projection.map((r) => ({
    age: r.age,
    year: r.calendarYear,
    portfolio: formatCurrency(r.portfolioValueEur, 'EUR'),
    dividend: formatCurrency(r.annualDividendNetEur, 'EUR'),
    labour: formatCurrency(r.annualNeededFromLabourEur, 'EUR'),
    months: formatNumberFi(r.monthsNotCoveredByDividends, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }),
  }));

  const updateExpense = (id: string, patch: Partial<FireExpenseLine>) => {
    setStored((s) => ({
      ...s,
      expenses: s.expenses.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));
  };

  const addExpense = () => {
    setStored((s) => ({
      ...s,
      expenses: [...s.expenses, { id: `custom-${Date.now()}`, label: 'New item', monthlyEur: 0 }],
    }));
  };

  const removeExpense = (id: string) => {
    setStored((s) => ({ ...s, expenses: s.expenses.filter((e) => e.id !== id) }));
  };

  const annualSavingsGoalEur = Math.max(0, stored.capital.investedMonthlyEur) * 12;

  const savingsByYear = useMemo(() => {
    const groups = new Map<string, FireMonthlySaving[]>();
    for (const row of stored.monthlySavings) {
      const year = row.month.slice(0, 4);
      if (!/^\d{4}$/.test(year)) continue;
      const list = groups.get(year) ?? [];
      list.push(row);
      groups.set(year, list);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => Number(b) - Number(a))
      .map(([year, rows]) => {
        const sorted = [...rows].sort((a, b) => b.month.localeCompare(a.month));
        const total = sorted.reduce(
          (s, r) => s + (Number.isFinite(r.savedEur) ? Math.max(0, r.savedEur) : 0),
          0
        );
        const goalMet = annualSavingsGoalEur > 0 && total >= annualSavingsGoalEur;
        const goalPct =
          annualSavingsGoalEur > 0
            ? Math.min(100, (total / annualSavingsGoalEur) * 100)
            : 0;
        return { year, rows: sorted, total, goalMet, goalPct };
      });
  }, [stored.monthlySavings, annualSavingsGoalEur]);

  const updateSaving = (id: string, patch: Partial<FireMonthlySaving>) => {
    setStored((s) => ({
      ...s,
      monthlySavings: s.monthlySavings.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    }));
  };

  const addSaving = () => {
    setStored((s) => ({
      ...s,
      monthlySavings: [
        ...s.monthlySavings,
        { id: `save-${Date.now()}`, month: currentMonthKey(), savedEur: 0 },
      ],
    }));
  };

  const removeSaving = (id: string) => {
    setStored((s) => ({
      ...s,
      monthlySavings: s.monthlySavings.filter((row) => row.id !== id),
    }));
  };

  const progressPct =
    independenceCapital > 0 ? Math.min(100, (currentPortfolioEur / independenceCapital) * 100) : 0;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-black tracking-tight text-white uppercase">FIRE projection</h2>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={`${PANEL} lg:col-span-1 flex flex-col min-h-[200px]`}>
          <h3 className="card-title mb-3">Independence goal</h3>

          <p className="font-mono text-2xl font-black tabular-nums tracking-tighter leading-snug">
            <span className="text-text-p">{formatCurrency(currentPortfolioEur, 'EUR')}</span>
            {fiRow && independenceCapital > 0 ? (
              <>
                <span className="text-text-s/25 font-bold"> / </span>
                <span className="text-text-s/55">{formatCurrency(independenceCapital, 'EUR')}</span>
              </>
            ) : null}
          </p>

          {fiRow && independenceCapital > 0 ? (
            <div className="mt-4 flex items-center gap-2.5">
              <div className="flex-1 h-1.5 bg-border/60 rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent shadow-[0_0_10px_rgba(59,130,246,0.45)] transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <span className="text-xs font-mono font-bold tabular-nums text-accent shrink-0">
                {formatPercentFi(progressPct, 1)}
              </span>
            </div>
          ) : null}

          <div className="mt-auto pt-4 border-t border-border/40">
            {fiRow ? (
              <p className="text-[11px] text-green font-bold uppercase tracking-widest">
                Estimated time to FIRE:{' '}
                {fiYearIndex === 0
                  ? 'now'
                  : `${fiYearIndex} ${fiYearIndex === 1 ? 'year' : 'years'}`}
              </p>
            ) : (
              <p className="text-[11px] text-text-s/50 uppercase tracking-widest leading-relaxed">
                Not reached within {FIRE_HORIZON_YEARS} years at current inputs
              </p>
            )}
          </div>
        </div>

        <div className={`${PANEL} lg:col-span-2`}>
          <div className="flex items-center justify-between gap-2 mb-3">
            <h3 className="card-title mb-0">Capital variables</h3>
            <button
              type="button"
              onClick={() => void refreshBlendedYield()}
              disabled={yieldLoading}
              className="px-2 py-1.5 rounded-lg border border-border/60 text-[9px] font-black uppercase tracking-widest text-text-s hover:text-accent hover:border-accent/40 flex items-center gap-1"
              title="Refresh blended yield from holdings"
            >
              <RefreshCcw className={`w-3 h-3 ${yieldLoading ? 'animate-spin' : ''}`} />
              Refresh yield
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <FireNumInput
              label="Avg market return"
              value={stored.capital.marketReturnPercent}
              onChange={(n) => setCapital({ marketReturnPercent: n })}
              suffix="%"
            />
            <div className="block">
              <span className={LABEL}>Average yield (blended)</span>
              <div
                className="bg-bg/50 border border-border rounded-xl px-3 py-2 min-h-[42px] flex items-center"
                title="From Dividends Engine holdings (auto-refreshed)"
              >
                {effectiveYield > 0 ? (
                  <span className="text-sm font-mono text-accent tabular-nums">
                    {formatPercentFi(effectiveYield, 2)}
                  </span>
                ) : (
                  <span className="text-text-s text-sm font-mono">—</span>
                )}
              </div>
            </div>
            <FireNumInput
              label="Dividend tax / withholding"
              value={stored.capital.dividendTaxRatePercent}
              onChange={(n) => setCapital({ dividendTaxRatePercent: n })}
              suffix="%"
            />
            <FireNumInput
              label="Invested monthly"
              value={stored.capital.investedMonthlyEur}
              onChange={(n) => setCapital({ investedMonthlyEur: n })}
              suffix="€"
            />
            <FireNumInput
              label="Start age"
              value={stored.capital.startAge}
              onChange={(n) => setCapital({ startAge: Math.round(n) })}
              step="1"
              decimals={0}
            />
            <FireNumInput
              label="Start year"
              value={stored.capital.startYear}
              onChange={(n) => setCapital({ startYear: Math.round(n) })}
              step="1"
              decimals={0}
              groupThousands={false}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={PANEL}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="card-title mb-0">Expenses (monthly)</h3>
            <button
              type="button"
              onClick={addExpense}
              className="px-2 py-1.5 bg-accent text-white rounded-lg font-black uppercase tracking-widest text-[8px] flex items-center gap-1 shadow-lg shadow-accent/20"
            >
              <Plus className="w-3 h-3" /> Add
            </button>
          </div>
          <div className="space-y-3 max-h-[320px] overflow-y-auto scrollbar-hidden">
            {stored.expenses.length === 0 ? (
              <p className="text-text-s/50 text-xs font-mono py-4 text-center">No entries yet</p>
            ) : (
              <section className={ENTRY_GROUP}>
                <div className="space-y-1.5">
                  {stored.expenses.map((e) => (
                    <div key={e.id} className={ENTRY_ROW_GRID}>
                      <input
                        type="text"
                        className={`w-full min-w-0 ${INLINE_INPUT} text-text-p font-sans`}
                        value={e.label}
                        onChange={(ev) => updateExpense(e.id, { label: ev.target.value })}
                      />
                      <ExpenseAmountInput
                        value={e.monthlyEur}
                        onChange={(n) => updateExpense(e.id, { monthlyEur: n })}
                        className="w-full"
                      />
                      <button
                        type="button"
                        onClick={() => removeExpense(e.id)}
                        className="p-1 text-text-s hover:text-red rounded-md justify-self-end"
                        aria-label="Remove expense"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
          <div className="mt-4 pt-3 border-t border-border/50 flex justify-between text-sm font-mono font-bold tabular-nums">
            <span className="text-text-s uppercase text-[10px] tracking-widest">Total monthly</span>
            <span className="text-text-p">{formatCurrency(monthlyTotal, 'EUR')}</span>
          </div>
          <div className="flex justify-between text-xs font-mono text-text-s/60 tabular-nums mt-1">
            <span>Annual expenses</span>
            <span>{formatCurrency(annualExpenses, 'EUR')}</span>
          </div>
        </div>

        <div className={PANEL}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="card-title mb-0">Capital saved (monthly)</h3>
            <button
              type="button"
              onClick={addSaving}
              className="px-2 py-1.5 bg-accent text-white rounded-lg font-black uppercase tracking-widest text-[8px] flex items-center gap-1 shadow-lg shadow-accent/20"
            >
              <Plus className="w-3 h-3" /> Add
            </button>
          </div>
          <div className="space-y-3 max-h-[320px] overflow-y-auto scrollbar-hidden">
            {savingsByYear.length === 0 ? (
              <p className="text-text-s/50 text-xs font-mono py-4 text-center">No entries yet</p>
            ) : (
              savingsByYear.map(({ year, rows, total, goalMet, goalPct }) => (
                <section key={year} className={ENTRY_GROUP}>
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <span className="text-[10px] font-black text-text-p uppercase tracking-widest">
                      {year}
                    </span>
                    {annualSavingsGoalEur > 0 ? (
                      <span
                        className={`text-[9px] font-mono font-bold tabular-nums shrink-0 ${
                          goalMet ? 'text-green' : 'text-text-s/70'
                        }`}
                      >
                        {formatCurrency(total, 'EUR')} / {formatCurrency(annualSavingsGoalEur, 'EUR')}
                      </span>
                    ) : (
                      <span className="text-[9px] font-mono font-bold tabular-nums text-text-p shrink-0">
                        {formatCurrency(total, 'EUR')}
                      </span>
                    )}
                  </div>
                  {annualSavingsGoalEur > 0 ? (
                    <div className="h-1 bg-border/60 rounded-full overflow-hidden mb-2.5">
                      <div
                        className={`h-full transition-all duration-500 ${
                          goalMet ? 'bg-green shadow-[0_0_8px_rgba(34,197,94,0.45)]' : 'bg-accent/70'
                        }`}
                        style={{ width: `${goalPct}%` }}
                      />
                    </div>
                  ) : null}
                  <div className="space-y-1.5">
                    {rows.map((row) => (
                      <div
                        key={row.id}
                        className="grid grid-cols-[5.5rem_minmax(0,1fr)_1.75rem] gap-2 items-center w-full"
                      >
                        <MonthYearInput
                          value={row.month}
                          onChange={(month) => updateSaving(row.id, { month })}
                          className="w-full"
                        />
                        <ExpenseAmountInput
                          value={row.savedEur}
                          onChange={(n) => updateSaving(row.id, { savedEur: n })}
                          className="w-full min-w-0"
                        />
                        <button
                          type="button"
                          onClick={() => removeSaving(row.id)}
                          className="p-1 text-text-s hover:text-red rounded-md justify-self-end"
                          aria-label="Remove saving"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              ))
            )}
          </div>
        </div>
      </div>

      <div className={PANEL}>
        <h3 className="card-title mb-2">FIRE projection</h3>
        <DataListTable
        highlightWhen={(i) => i === fiYearIndex}
        minWidth={720}
        columns={[
          { key: 'age', label: 'Age' },
          { key: 'year', label: 'Year' },
          { key: 'portfolio', label: 'Portfolio value', align: 'right' },
          { key: 'dividend', label: 'Annual dividend (net)', align: 'right' },
          { key: 'labour', label: 'Needed from labour', align: 'right' },
          { key: 'months', label: 'Months not covered', align: 'right' },
        ]}
        rows={capitalRows.map((r) => ({
          age: r.age,
          year: r.year,
          portfolio: r.portfolio,
          dividend: r.dividend,
          labour: r.labour,
          months: r.months,
        }))}
        />
      </div>
    </div>
  );
}
