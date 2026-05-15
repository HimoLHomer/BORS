import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { AnimatePresence, motion } from 'motion/react';
import { MoreVertical, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { Asset } from './types';
import { formatCurrency } from './formatCurrency';
import { formatDateFi, todayIsoDateHelsinki } from './formatDate';
import {
  type ManualDividendPosition,
  type DividendPayoutFrequency,
  loadManualDividendPositions,
  saveManualDividendPositions,
  frequencyLabel,
  perPaymentAmountEur,
  averageMonthlyIncomeEur,
  manualPositionPayoutEvents,
} from './manualDividends';

export type { ManualDividendPosition, DividendPayoutFrequency } from './manualDividends';

export type DividendRow = {
  symbol: string;
  name: string;
  quantity: number;
  quoteCurrency: string;
  /** Yahoo trading vs dividend currency (server only; optional on older responses). */
  tradingCurrency?: string;
  dividendCurrency?: string;
  yahooReferencePrice?: number | null;
  dividendYieldPercent: number | null;
  annualDividendPerShare: number | null;
  annualDividendPerShareEur: number | null;
  estimatedAnnualIncomeEur: number;
  exDividendDate: string | null;
  dividendDate: string | null;
  calendarPayoutDates?: string[];
  calendarPayoutSource?: 'yahoo' | 'estimated' | 'none';
  /** Inferred from Yahoo chart dividend spacing when available. */
  payoutFrequency?: DividendPayoutFrequency | null;
  error: boolean;
};

type DividendsPayload = {
  rows: DividendRow[];
  totalAnnualIncomeEur: number;
  totalHoldingsValueEur: number;
  averagePortfolioYieldPercent: number;
};

const BAR_COLOR = '#3b82f6';

/** Same idea as the Dashboard holdings table: display symbol, else short Yahoo symbol. */
function displayTickerForAsset(a: Asset | undefined): string {
  if (!a) return '—';
  const d = a.displaySymbol?.trim();
  if (d) return d.toUpperCase();
  const s = a.symbol;
  return (s.includes('.') ? s.split('.')[0] : s).toUpperCase();
}

function shortYahooSymbol(sym: string | null | undefined): string {
  const s = sym?.trim();
  if (!s) return '—';
  return (s.includes('.') ? s.split('.')[0] : s).toUpperCase();
}

function isDividendPayer(r: DividendRow): boolean {
  if (r.error) return false;
  return Number.isFinite(r.estimatedAnnualIncomeEur) && r.estimatedAnnualIncomeEur > 0;
}

function nextFeedPayoutDate(row: DividendRow): string | null {
  const d = row.dividendDate || row.exDividendDate;
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

function fxToEur(currency: string | undefined, exchangeRates: Record<string, number>): number {
  const c = (currency || 'EUR').toUpperCase();
  if (c === 'EUR') return 1;
  return exchangeRates[c] ?? exchangeRates[currency ?? ''] ?? 0;
}

function assetPositionValueEur(
  a: Asset,
  marketPrices: Record<string, number>,
  exchangeRates: Record<string, number>
): number {
  const px = marketPrices[a.symbol] ?? a.averagePrice;
  const fx = fxToEur(a.currency, exchangeRates);
  const v = a.quantity * px * fx;
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

function assetsMatchingLink(assets: Asset[], linkedSymbol: string | null): Asset[] {
  if (!linkedSymbol?.trim()) return [];
  const t = linkedSymbol.trim().toUpperCase();
  return assets.filter(
    (a) =>
      (a.symbol && a.symbol.toUpperCase() === t) ||
      (a.displaySymbol != null && String(a.displaySymbol).toUpperCase() === t)
  );
}

function effectiveManualDenominatorEur(
  m: ManualDividendPosition,
  assets: Asset[],
  marketPrices: Record<string, number>,
  exchangeRates: Record<string, number>
): number | null {
  const linked = assetsMatchingLink(assets, m.linkedSymbol);
  if (linked.length) {
    const v = linked.reduce((s, a) => s + assetPositionValueEur(a, marketPrices, exchangeRates), 0);
    return v > 0 ? v : null;
  }
  if (m.notionalValueEur != null && m.notionalValueEur > 0) return m.notionalValueEur;
  return null;
}

function effectiveManualUnits(m: ManualDividendPosition, assets: Asset[]): number | null {
  if (m.units != null && m.units > 0) return m.units;
  const linked = assetsMatchingLink(assets, m.linkedSymbol);
  if (linked.length) {
    const q = linked.reduce((s, a) => s + (Number.isFinite(a.quantity) ? a.quantity : 0), 0);
    return q > 0 ? q : null;
  }
  return null;
}

function manualYieldPercent(
  m: ManualDividendPosition,
  assets: Asset[],
  marketPrices: Record<string, number>,
  exchangeRates: Record<string, number>
): number | null {
  const den = effectiveManualDenominatorEur(m, assets, marketPrices, exchangeRates);
  if (den != null && den > 0 && Number.isFinite(m.annualIncomeEur)) {
    return (m.annualIncomeEur / den) * 100;
  }
  return null;
}

/** Display / fallback only — yield and income use server EUR fields when present. */
function feedAnnualPerShareEur(row: DividendRow, exchangeRates: Record<string, number>): number | null {
  if (row.annualDividendPerShareEur != null && Number.isFinite(row.annualDividendPerShareEur)) {
    return row.annualDividendPerShareEur;
  }
  const annual = row.annualDividendPerShare;
  if (annual == null || !Number.isFinite(annual)) return null;
  const fx = fxToEur(row.quoteCurrency, exchangeRates);
  return fx > 0 ? annual * fx : null;
}

function feedYieldPercent(
  row: DividendRow,
  asset: Asset | undefined,
  marketPrices: Record<string, number>,
  exchangeRates: Record<string, number>
): number | null {
  if (!asset) return row.dividendYieldPercent ?? null;
  const px = marketPrices[asset.symbol] ?? asset.averagePrice;
  if (!(px > 0)) return row.dividendYieldPercent ?? null;
  const priceFx = fxToEur(asset.currency, exchangeRates);
  const divCcy = (row.quoteCurrency || 'USD').toUpperCase();
  const divFx = fxToEur(divCcy, exchangeRates);
  const annual = row.annualDividendPerShare;
  if (annual != null && annual > 0 && divFx > 0 && priceFx > 0) {
    return Math.round(((annual * divFx) / (px * priceFx)) * 10000) / 100;
  }
  if (row.annualDividendPerShareEur != null && row.annualDividendPerShareEur > 0 && priceFx > 0) {
    return Math.round((row.annualDividendPerShareEur / (px * priceFx)) * 10000) / 100;
  }
  const den = assetPositionValueEur(asset, marketPrices, exchangeRates);
  if (!(den > 0)) return row.dividendYieldPercent ?? null;
  if (!Number.isFinite(row.estimatedAnnualIncomeEur) || row.estimatedAnnualIncomeEur <= 0) return null;
  return Math.round((row.estimatedAnnualIncomeEur / den) * 10000) / 100;
}

function manualAnnualDividendPerShareEur(m: ManualDividendPosition, assets: Asset[]): number | null {
  const u = effectiveManualUnits(m, assets);
  if (u != null && u > 0 && Number.isFinite(m.annualIncomeEur)) {
    return m.annualIncomeEur / u;
  }
  return null;
}

type BarDatum = {
  key: string;
  label: string;
  /** Full holding / row name for tooltip */
  fullName: string;
  monthlyEur: number;
  source: 'api' | 'manual';
  tooltipDetail?: string;
};

export function DividendsEngine({
  assets,
  marketPrices,
  exchangeRates,
}: {
  assets: Asset[];
  marketPrices: Record<string, number>;
  exchangeRates: Record<string, number>;
}) {
  const [data, setData] = useState<DividendsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [manualRows, setManualRows] = useState<ManualDividendPosition[]>(() => loadManualDividendPositions());
  const [holdingsMenuOpen, setHoldingsMenuOpen] = useState(false);
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [editingManualId, setEditingManualId] = useState<string | null>(null);
  const [draftAnnual, setDraftAnnual] = useState('');
  const [draftLinkedSymbol, setDraftLinkedSymbol] = useState('');
  const [draftUnits, setDraftUnits] = useState('');
  const [draftFrequency, setDraftFrequency] = useState<DividendPayoutFrequency>('quarterly');
  const [draftPayoutDate, setDraftPayoutDate] = useState('');
  const holdingsMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    saveManualDividendPositions(manualRows);
  }, [manualRows]);

  useEffect(() => {
    if (!holdingsMenuOpen) return;
    const close = (e: MouseEvent) => {
      if (holdingsMenuRef.current && !holdingsMenuRef.current.contains(e.target as Node)) {
        setHoldingsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [holdingsMenuOpen]);

  const load = useCallback(async () => {
    if (assets.length === 0) {
      setData({
        rows: [],
        totalAnnualIncomeEur: 0,
        totalHoldingsValueEur: 0,
        averagePortfolioYieldPercent: 0,
      });
      setErr(null);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const holdings = assets.map((a) => ({
        symbol: a.symbol,
        displaySymbol: a.displaySymbol ?? null,
        quantity: a.quantity,
        currency: a.currency,
        livePrice: marketPrices[a.symbol],
        averagePrice: a.averagePrice,
      }));
      const res = await fetch('/api/portfolio/dividends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ holdings, baseCurrency: 'EUR' }),
        cache: 'no-store',
      });
      const raw = await res.text();
      let j: DividendsPayload | { error?: string; detail?: string } = {};
      try {
        j = JSON.parse(raw) as typeof j;
      } catch {
        /* ignore */
      }
      if (!res.ok) {
        const msg =
          typeof j === 'object' && j && 'error' in j
            ? `${(j as { error?: string }).error ?? 'Request failed'}${(j as { detail?: string }).detail ? `: ${(j as { detail?: string }).detail}` : ''}`
            : `Dividend request failed (${res.status}). Restart the dev server if this persists.`;
        throw new Error(msg);
      }
      const payload = j as DividendsPayload;
      if (!Array.isArray(payload.rows)) {
        throw new Error('Invalid dividends response from server.');
      }
      setData(payload);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load dividends');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [assets, marketPrices, exchangeRates]);

  useEffect(() => {
    void load();
  }, [load]);

  const dividendPayingRows = useMemo(() => {
    if (!data?.rows.length) return [] as { row: DividendRow; index: number }[];
    return data.rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => isDividendPayer(row));
  }, [data]);

  const apiSummaryStats = useMemo(() => {
    if (!dividendPayingRows.length) {
      return { totalAnnualEur: 0, totalValueEur: 0, avgYieldPercent: 0 };
    }
    let totalAnnualEur = 0;
    let totalValueEur = 0;
    for (const { row, index } of dividendPayingRows) {
      totalAnnualEur += row.estimatedAnnualIncomeEur;
      const a = assets[index];
      if (a) {
        const px = marketPrices[a.symbol] ?? a.averagePrice;
        const fx = fxToEur(a.currency, exchangeRates);
        totalValueEur += a.quantity * px * fx;
      }
    }
    const avgYieldPercent = totalValueEur > 0 ? (totalAnnualEur / totalValueEur) * 100 : 0;
    return {
      totalAnnualEur: Math.round(totalAnnualEur * 100) / 100,
      totalValueEur: Math.round(totalValueEur * 100) / 100,
      avgYieldPercent: Math.round(avgYieldPercent * 100) / 100,
    };
  }, [dividendPayingRows, assets, marketPrices, exchangeRates]);

  const manualAnnualSum = useMemo(
    () => manualRows.reduce((s, m) => s + (Number.isFinite(m.annualIncomeEur) ? m.annualIncomeEur : 0), 0),
    [manualRows]
  );
  const manualDenominatorSum = useMemo(
    () =>
      manualRows.reduce((s, m) => {
        const d = effectiveManualDenominatorEur(m, assets, marketPrices, exchangeRates);
        return s + (d != null && Number.isFinite(d) ? d : 0);
      }, 0),
    [manualRows, assets, marketPrices, exchangeRates]
  );

  const displaySummary = useMemo(() => {
    const totalAnnualEur = Math.round((apiSummaryStats.totalAnnualEur + manualAnnualSum) * 100) / 100;
    const denom = apiSummaryStats.totalValueEur + manualDenominatorSum;
    const avgYieldPercent =
      denom > 0 ? Math.round(((totalAnnualEur / denom) * 100) * 100) / 100 : apiSummaryStats.avgYieldPercent;
    return { totalAnnualEur, avgYieldPercent };
  }, [apiSummaryStats, manualAnnualSum, manualDenominatorSum]);

  const barData = useMemo((): BarDatum[] => {
    const apiBars: BarDatum[] = dividendPayingRows.map(({ row, index }) => {
      const a = assets[index];
      const fullName = row.name || a?.name || 'Holding';
      const label = displayTickerForAsset(a);
      const monthlyEur = averageMonthlyIncomeEur(row.estimatedAnnualIncomeEur);
      return {
        key: `api-${index}-${row.symbol}`,
        label,
        fullName,
        monthlyEur,
        source: 'api',
        tooltipDetail: 'Average monthly (annual ÷ 12)',
      };
    });
    const manualBars: BarDatum[] = manualRows.map((m) => {
      const linked = m.linkedSymbol ? assetsMatchingLink(assets, m.linkedSymbol) : [];
      const a = linked[0];
      const fullName = a?.name ?? m.name;
      const label = a ? displayTickerForAsset(a) : shortYahooSymbol(m.linkedSymbol);
      const monthlyEur = averageMonthlyIncomeEur(m.annualIncomeEur);
      const perPay = perPaymentAmountEur(m.annualIncomeEur, m.payoutFrequency);
      return {
        key: `manual-${m.id}`,
        label,
        fullName,
        monthlyEur,
        source: 'manual',
        tooltipDetail: `Avg monthly (annual ÷ 12) · ~${formatCurrency(perPay, 'EUR')} per ${frequencyLabel(m.payoutFrequency).toLowerCase()} payment`,
      };
    });
    return [...apiBars, ...manualBars].sort((a, b) => b.monthlyEur - a.monthlyEur);
  }, [dividendPayingRows, assets, manualRows]);

  const payoutEvents = useMemo(() => {
    const out: { name: string; date: string; estimated: boolean }[] = [];
    const today = todayIsoDateHelsinki();
    for (const { row } of dividendPayingRows) {
      const dates =
        row.calendarPayoutDates && row.calendarPayoutDates.length > 0
          ? row.calendarPayoutDates
          : row.dividendDate
            ? [row.dividendDate]
            : [];
      const estimated = row.calendarPayoutSource === 'estimated';
      for (const date of dates) {
        out.push({ name: row.name, date, estimated });
      }
    }
    for (const m of manualRows) {
      for (const ev of manualPositionPayoutEvents(m)) {
        out.push({ name: ev.name, date: ev.date, estimated: false });
      }
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    const past = out.filter((e) => e.date < today);
    const future = out.filter((e) => e.date >= today);
    const recentPast = past.slice(-6);
    const nearFuture = future.slice(0, 24);
    return [...recentPast, ...nearFuture];
  }, [dividendPayingRows, manualRows]);

  const resetDrafts = () => {
    setDraftAnnual('');
    setDraftLinkedSymbol('');
    setDraftUnits('');
    setDraftFrequency('quarterly');
    setDraftPayoutDate('');
    setEditingManualId(null);
  };

  const openManualModal = () => {
    if (assets.length === 0) return;
    setHoldingsMenuOpen(false);
    resetDrafts();
    setManualModalOpen(true);
  };

  const openEditManual = (m: ManualDividendPosition) => {
    setHoldingsMenuOpen(false);
    setEditingManualId(m.id);
    setDraftAnnual(String(m.annualIncomeEur));
    setDraftLinkedSymbol(
      m.linkedSymbol ? assetsMatchingLink(assets, m.linkedSymbol)[0]?.symbol ?? m.linkedSymbol : ''
    );
    setDraftUnits(m.units != null ? String(m.units) : '');
    setDraftFrequency(m.payoutFrequency);
    setDraftPayoutDate(m.payoutAnchorDate ?? '');
    setManualModalOpen(true);
  };

  const saveManual = () => {
    const annual = parseFloat(draftAnnual.replace(',', '.'));
    const unitsRaw = draftUnits.trim();
    const unitsParsed = unitsRaw === '' ? null : parseFloat(unitsRaw.replace(',', '.'));
    const units =
      unitsParsed != null && Number.isFinite(unitsParsed) && unitsParsed > 0 ? unitsParsed : null;
    if (!Number.isFinite(annual) || annual < 0) return;
    const payoutAnchorDate =
      draftPayoutDate.trim() === '' ? null : draftPayoutDate.trim();
    if (payoutAnchorDate && !/^\d{4}-\d{2}-\d{2}$/.test(payoutAnchorDate)) return;
    const linkTrim = draftLinkedSymbol.trim();
    const matchedForSave = assetsMatchingLink(assets, linkTrim || null);
    if (matchedForSave.length === 0) return;
    const primary = matchedForSave[0];
    const linkedSymbol = primary.symbol;
    const name = primary.name.trim() || primary.symbol;
    const row: ManualDividendPosition = {
      id: editingManualId ?? crypto.randomUUID(),
      name,
      annualIncomeEur: annual,
      notionalValueEur: null,
      linkedSymbol,
      units,
      payoutFrequency: draftFrequency,
      payoutAnchorDate,
    };
    setManualRows((prev) => {
      if (editingManualId) return prev.map((p) => (p.id === editingManualId ? row : p));
      return [...prev, row];
    });
    setManualModalOpen(false);
    resetDrafts();
  };

  const removeManual = (id: string) => {
    setManualRows((prev) => prev.filter((m) => m.id !== id));
  };

  const hasAnyDividendDisplay = dividendPayingRows.length > 0 || manualRows.length > 0;
  const manualCalendarReady = manualRows.some((m) => m.payoutAnchorDate);

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-black tracking-tight text-white uppercase">Dividends Engine</h2>

      {err && (
        <div className="rounded-xl border border-red/40 bg-red/10 px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-red-200">
          {err}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="glass-panel p-8 flex flex-col justify-center min-h-[140px]">
          <h3 className="card-title mb-0">Total annual dividend income</h3>
          <div className="stat-value text-5xl font-black tracking-tighter text-text-p tabular-nums">
            {formatCurrency(displaySummary.totalAnnualEur, 'EUR')}
          </div>
        </div>
        <div className="glass-panel p-8 flex flex-col justify-center min-h-[140px]">
          <h3 className="card-title mb-0">Average yield (blended)</h3>
          <div className="stat-value text-5xl font-black tracking-tighter text-accent tabular-nums">
            {displaySummary.avgYieldPercent.toFixed(2)}%
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="glass-panel p-6 min-h-[320px] flex flex-col">
          <h3 className="card-title mb-4">Monthly dividend income (by holding)</h3>
          {assets.length === 0 && manualRows.length === 0 ? (
            <p className="text-text-s text-sm py-12 text-center opacity-50 font-mono uppercase tracking-widest text-[10px]">
              Add holdings on the Dashboard, then add a per-holding dividend estimate here if needed.
            </p>
          ) : barData.length === 0 ? (
            <p className="text-text-s text-sm py-12 text-center opacity-50 font-mono uppercase tracking-widest text-[10px]">
              {loading ? 'Loading…' : 'No dividend-paying holdings (or estimates are all zero).'}
            </p>
          ) : (
            <div className="h-[280px] w-full flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData} margin={{ top: 8, right: 8, left: 0, bottom: 28 }} barCategoryGap="18%">
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: 'var(--color-text-s)', fontSize: 11, fontWeight: 600 }}
                    interval={0}
                    angle={0}
                    textAnchor="middle"
                    height={48}
                    tickMargin={8}
                  />
                  <YAxis
                    tick={{ fill: 'var(--color-text-s)', fontSize: 10, opacity: 0.7 }}
                    tickFormatter={(v) => formatCurrency(Number(v), 'EUR')}
                    width={72}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(255,255,255,0.06)' }}
                    contentStyle={{
                      backgroundColor: 'var(--color-card)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                    formatter={(value: number | undefined, _name: string, item: { payload?: BarDatum }) => {
                      const detail = item?.payload?.tooltipDetail;
                      const main = formatCurrency(Number(value), 'EUR');
                      return [detail ? `${main} (${detail})` : main, 'Avg monthly (est.)'];
                    }}
                    labelStyle={{ color: 'var(--color-text-s)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}
                    labelFormatter={(_label, payload) => {
                      const p = payload?.[0]?.payload as BarDatum | undefined;
                      return p?.fullName ?? String(_label);
                    }}
                  />
                  <Bar dataKey="monthlyEur" radius={[6, 6, 0, 0]} fill={BAR_COLOR} fillOpacity={0.9} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="glass-panel p-6 min-h-[320px] flex flex-col">
          <h3 className="card-title mb-4">Upcoming payout calendar</h3>
          {payoutEvents.length === 0 ? (
            <p className="text-text-s text-sm py-8 text-center opacity-50 font-mono uppercase tracking-widest text-[10px]">
              {assets.length === 0 && manualRows.length === 0
                ? 'No holdings.'
                : loading
                  ? 'Loading…'
                  : manualRows.length > 0 && !manualCalendarReady
                    ? 'No payout dates yet — set an anchor pay date on manual estimates.'
                    : 'No payout dates yet.'}
            </p>
          ) : (
            <ul className="space-y-2 max-h-[280px] overflow-y-auto pr-1 flex-1 min-h-0">
              {payoutEvents.map((e, i) => (
                <li
                  key={`${e.name}-${e.date}-${i}-${e.estimated ? 'e' : 'a'}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-bg/40 outline outline-1 outline-border/50 px-4 py-3 text-xs font-mono font-bold"
                >
                  <span className="text-text-p text-sm font-sans font-bold max-w-[55%] truncate" title={e.name}>
                    {e.name}
                  </span>
                  <span className="flex items-center gap-2 shrink-0 tabular-nums text-xs text-text-s/80">
                    {formatDateFi(e.date)}
                    {e.estimated ? (
                      <span className="text-[9px] text-text-s/45 font-mono uppercase tracking-widest">est.</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="glass-panel p-8 bg-[#0e0e10]/80">
        <div className="flex items-center justify-between mb-2">
          <h3 className="card-title mb-0">Holdings detail</h3>
          <div className="relative shrink-0" ref={holdingsMenuRef}>
            <button
              type="button"
              onClick={() => setHoldingsMenuOpen((o) => !o)}
              className="p-2.5 text-text-s hover:text-accent hover:bg-accent/10 rounded-lg transition-all border border-transparent hover:border-border/50"
              aria-label="Holdings detail menu"
            >
              <MoreVertical className="w-4 h-4" />
            </button>
            {holdingsMenuOpen && (
              <div className="absolute right-0 top-full mt-2 z-50 min-w-[200px] rounded-xl border border-border bg-card shadow-2xl py-1">
                <button
                  type="button"
                  onClick={openManualModal}
                  disabled={assets.length === 0}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-widest text-text-p hover:bg-white/5 disabled:opacity-40 disabled:pointer-events-none"
                >
                  <Plus className="w-3.5 h-3.5 text-accent" />
                  Add dividend estimate
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-separate border-spacing-y-2">
            <thead>
              <tr className="text-[9px] font-bold text-text-s uppercase tracking-[0.25em] opacity-50">
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2 text-right">Yield %</th>
                <th className="px-4 py-2 text-right">Annual / share</th>
                <th className="px-4 py-2 text-right">Est. annual income</th>
                <th className="px-4 py-2 text-right whitespace-nowrap">Pay freq.</th>
                <th className="px-4 py-2 text-right whitespace-nowrap">Next / anchor</th>
                <th className="px-4 py-2 text-right w-24" />
              </tr>
            </thead>
            <tbody className="text-xs font-mono font-bold">
              {loading && !data ? (
                <tr>
                  <td colSpan={7} className="px-6 py-16 text-center text-text-s opacity-50 text-[10px] uppercase tracking-widest font-bold">
                    Loading dividend data…
                  </td>
                </tr>
              ) : !data && assets.length > 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-16 text-center text-text-s opacity-50 text-[10px] uppercase tracking-widest font-bold">
                    No data.
                  </td>
                </tr>
              ) : !hasAnyDividendDisplay && !loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-16 text-center text-text-s opacity-50 text-[10px] uppercase tracking-widest font-bold">
                    {assets.length === 0 && manualRows.length === 0
                      ? 'No holdings or manual rows.'
                      : 'No feed dividend data — add an estimate from your Dashboard holdings via the menu.'}
                  </td>
                </tr>
              ) : (
                <>
                  {dividendPayingRows.map(({ row, index }) => {
                    const a = assets[index];
                    const tick = a ? displayTickerForAsset(a) : null;
                    const feedYld = feedYieldPercent(row, a, marketPrices, exchangeRates);
                    const annualShareEur = feedAnnualPerShareEur(row, exchangeRates);
                    return (
                    <tr
                      key={`api-${index}-${row.symbol}`}
                      className="group bg-bg/40 hover:bg-bg transition-all outline outline-1 outline-border/50 hover:outline-accent/30 rounded-2xl"
                    >
                      <td className="px-4 py-3 rounded-l-2xl max-w-[220px]">
                        <div className="text-text-p text-sm font-sans font-bold truncate" title={row.name}>
                          {row.name}
                        </div>
                        {tick ? (
                          <div className="text-[9px] text-text-s/60 font-mono uppercase tracking-widest truncate">
                            {tick}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-text-p">
                        {feedYld != null ? `${feedYld.toFixed(2)}%` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-text-s/60">
                        {annualShareEur != null ? formatCurrency(annualShareEur, 'EUR') : '—'}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-text-p tracking-tighter">
                        {formatCurrency(row.estimatedAnnualIncomeEur, 'EUR')}
                      </td>
                      <td className="px-4 py-3 text-right text-text-s/60 text-[11px] uppercase tracking-wider">
                        {row.payoutFrequency ? frequencyLabel(row.payoutFrequency) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-text-s/80 text-[11px]">
                        {formatDateFi(nextFeedPayoutDate(row))}
                      </td>
                      <td className="px-4 py-3 text-right rounded-r-2xl" />
                    </tr>
                  );
                  })}
                  {manualRows.map((m) => {
                    const yld = manualYieldPercent(m, assets, marketPrices, exchangeRates);
                    const perShareEur = manualAnnualDividendPerShareEur(m, assets);
                    const linkedAs = m.linkedSymbol ? assetsMatchingLink(assets, m.linkedSymbol)[0] : undefined;
                    const title = linkedAs?.name ?? m.name;
                    return (
                      <tr
                        key={m.id}
                        className="group bg-bg/40 hover:bg-bg transition-all outline outline-1 outline-border/50 hover:outline-accent/30 rounded-2xl"
                      >
                        <td className="px-4 py-3 rounded-l-2xl max-w-[220px]">
                          <div className="text-text-p text-sm font-sans font-bold truncate" title={title}>
                            {title}
                          </div>
                          {linkedAs ? (
                            <div className="text-[9px] text-text-s/60 font-mono uppercase tracking-widest truncate">
                              {displayTickerForAsset(linkedAs)}
                            </div>
                          ) : (
                            <div className="text-[9px] text-text-s/50 font-mono uppercase tracking-widest">
                              Link holding on edit
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-text-p">
                          {yld != null ? `${yld.toFixed(2)}%` : '—'}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-text-s/60">
                          {perShareEur != null ? formatCurrency(perShareEur, 'EUR') : '—'}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-text-p tracking-tighter">
                          {formatCurrency(m.annualIncomeEur, 'EUR')}
                        </td>
                        <td className="px-4 py-3 text-right text-text-s/60 text-[11px] uppercase tracking-wider">
                          {frequencyLabel(m.payoutFrequency)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-text-s/80 text-[11px]">
                          {formatDateFi(m.payoutAnchorDate)}
                        </td>
                        <td className="px-4 py-3 text-right rounded-r-2xl">
                          <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-all">
                            <button
                              type="button"
                              onClick={() => openEditManual(m)}
                              className="p-2.5 text-text-s hover:text-accent hover:bg-accent/10 rounded-lg transition-all"
                              aria-label="Edit manual position"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeManual(m.id)}
                              className="p-2.5 text-text-s hover:text-red hover:bg-red/10 rounded-lg transition-all"
                              aria-label="Remove manual position"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {manualModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
            onClick={() => {
              setManualModalOpen(false);
              resetDrafts();
            }}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              className="glass-panel w-full max-w-md p-8 shadow-2xl max-h-[90vh] overflow-y-auto border-accent/20"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-black uppercase tracking-tight text-text-p">
                  {editingManualId ? 'Edit dividend estimate' : 'Add dividend estimate'}
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setManualModalOpen(false);
                    resetDrafts();
                  }}
                  className="p-2 text-text-s hover:text-text-p hover:bg-white/5 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <label className="text-[9px] font-bold text-text-s uppercase tracking-widest block mb-2 ml-1">
                Holding (from Dashboard)
              </label>
              <select
                value={draftLinkedSymbol}
                onChange={(e) => {
                  const v = e.target.value;
                  setDraftLinkedSymbol(v);
                  if (v) {
                    const matched = assetsMatchingLink(assets, v);
                    const q = matched.reduce((s, a) => s + (Number.isFinite(a.quantity) ? a.quantity : 0), 0);
                    setDraftUnits(q > 0 ? String(q) : '');
                  } else {
                    setDraftUnits('');
                  }
                }}
                className="w-full mb-3 bg-bg/50 border border-border rounded-xl px-4 py-3 text-sm text-text-p focus:outline-none focus:border-accent/50"
              >
                <option value="">Select a holding…</option>
                {assets.map((a) => (
                  <option key={a.id ?? `${a.symbol}-${a.name}`} value={a.symbol}>
                    {a.name} ({a.displaySymbol ?? a.symbol}) · qty {a.quantity}
                  </option>
                ))}
              </select>
              <p className="text-[10px] font-mono text-text-s/60 mb-5 leading-relaxed">
                Yield % uses this position’s EUR value on the Dashboard (quantity × price × FX). Leave units blank to
                use the same quantity for annual/share.
              </p>
              <label className="text-[9px] font-bold text-text-s uppercase tracking-widest block mb-2 ml-1">
                Annual dividend income (EUR)
              </label>
              <input
                value={draftAnnual}
                onChange={(e) => setDraftAnnual(e.target.value)}
                inputMode="decimal"
                className="w-full mb-5 bg-bg/50 border border-border rounded-xl px-4 py-3 text-sm font-mono text-text-p focus:outline-none focus:border-accent/50"
                placeholder="0"
              />
              <label className="text-[9px] font-bold text-text-s uppercase tracking-widest block mb-2 ml-1">
                Units / shares (optional)
              </label>
              <input
                value={draftUnits}
                onChange={(e) => setDraftUnits(e.target.value)}
                inputMode="decimal"
                className="w-full mb-2 bg-bg/50 border border-border rounded-xl px-4 py-3 text-sm font-mono text-text-p focus:outline-none focus:border-accent/50"
                placeholder={draftLinkedSymbol.trim() ? 'Leave blank to use holding quantity' : 'Optional override'}
              />
              <p className="text-[9px] font-mono text-text-s/50 mb-5 leading-relaxed">
                Annual/share = annual income ÷ units.
              </p>
              <label className="text-[9px] font-bold text-text-s uppercase tracking-widest block mb-2 ml-1">
                Payout frequency
              </label>
              <select
                value={draftFrequency}
                onChange={(e) => setDraftFrequency(e.target.value as DividendPayoutFrequency)}
                className="w-full mb-5 bg-bg/50 border border-border rounded-xl px-4 py-3 text-sm text-text-p focus:outline-none focus:border-accent/50"
              >
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
              </select>
              <label className="text-[9px] font-bold text-text-s uppercase tracking-widest block mb-2 ml-1">
                Anchor pay date
              </label>
              <input
                type="date"
                value={draftPayoutDate}
                onChange={(e) => setDraftPayoutDate(e.target.value)}
                className="w-full mb-8 bg-bg/50 border border-border rounded-xl px-4 py-3 text-sm font-mono text-text-p focus:outline-none focus:border-accent/50"
              />
              <div className="flex flex-wrap justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setManualModalOpen(false);
                    resetDrafts();
                  }}
                  className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 border border-border/60 text-[10px] font-black uppercase tracking-widest text-text-p"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveManual}
                  disabled={!draftLinkedSymbol.trim()}
                  className="px-4 py-2.5 rounded-lg bg-accent text-white text-[10px] font-black uppercase tracking-widest shadow-lg shadow-accent/20 hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                >
                  Save
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
