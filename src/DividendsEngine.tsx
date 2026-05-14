import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';
import { AnimatePresence, motion } from 'motion/react';
import { Coins, MoreVertical, Pencil, Plus, RefreshCcw, Trash2, X } from 'lucide-react';
import type { Asset } from './types';
import { formatCurrency } from './formatCurrency';
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
  dividendYieldPercent: number | null;
  annualDividendPerShare: number | null;
  annualDividendPerShareEur: number | null;
  estimatedAnnualIncomeEur: number;
  exDividendDate: string | null;
  dividendDate: string | null;
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

const BAR_FEED = '#3b82f6';
const BAR_MANUAL = '#22c55e';

function truncateLabel(s: string, max: number): string {
  const t = s.trim() || '—';
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function isDividendPayer(r: DividendRow): boolean {
  if (r.error) return false;
  return Number.isFinite(r.estimatedAnnualIncomeEur) && r.estimatedAnnualIncomeEur > 0;
}

function nextFeedPayoutDate(row: DividendRow): string | null {
  const d = row.dividendDate || row.exDividendDate;
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

function assetPositionValueEur(
  a: Asset,
  marketPrices: Record<string, number>,
  exchangeRates: Record<string, number>
): number {
  const px = marketPrices[a.symbol] ?? a.averagePrice;
  const fx = exchangeRates[a.currency] ?? 1;
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
  const [draftName, setDraftName] = useState('');
  const [draftAnnual, setDraftAnnual] = useState('');
  const [draftNotional, setDraftNotional] = useState('');
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
  }, [assets, marketPrices]);

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
        const fx = exchangeRates[a.currency] ?? 1;
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
      const label = truncateLabel(row.name || a?.name || 'Holding', 18);
      const monthlyEur = averageMonthlyIncomeEur(row.estimatedAnnualIncomeEur);
      return {
        key: `api-${index}-${row.symbol}`,
        label,
        monthlyEur,
        source: 'api',
        tooltipDetail: 'Average monthly (annual ÷ 12)',
      };
    });
    const manualBars: BarDatum[] = manualRows.map((m) => {
      const monthlyEur = averageMonthlyIncomeEur(m.annualIncomeEur);
      const perPay = perPaymentAmountEur(m.annualIncomeEur, m.payoutFrequency);
      return {
        key: `manual-${m.id}`,
        label: truncateLabel(m.name, 18),
        monthlyEur,
        source: 'manual',
        tooltipDetail: `Avg monthly (annual ÷ 12) · ~${formatCurrency(perPay, 'EUR')} per ${frequencyLabel(m.payoutFrequency).toLowerCase()} payment`,
      };
    });
    return [...apiBars, ...manualBars].sort((a, b) => b.monthlyEur - a.monthlyEur);
  }, [dividendPayingRows, assets, manualRows]);

  const payoutEvents = useMemo(() => {
    const out: { name: string; kind: string; date: string }[] = [];
    const today = new Date().toISOString().slice(0, 10);
    for (const { row } of dividendPayingRows) {
      if (row.exDividendDate) out.push({ name: row.name, kind: 'Ex-dividend', date: row.exDividendDate });
      if (row.dividendDate) out.push({ name: row.name, kind: 'Dividend pay', date: row.dividendDate });
    }
    for (const m of manualRows) {
      out.push(...manualPositionPayoutEvents(m));
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    const future = out.filter((e) => e.date >= today);
    const past = out.filter((e) => e.date < today).slice(-6);
    return [...past, ...future].slice(-24);
  }, [dividendPayingRows, manualRows]);

  const resetDrafts = () => {
    setDraftName('');
    setDraftAnnual('');
    setDraftNotional('');
    setDraftLinkedSymbol('');
    setDraftUnits('');
    setDraftFrequency('quarterly');
    setDraftPayoutDate('');
    setEditingManualId(null);
  };

  const openManualModal = () => {
    setHoldingsMenuOpen(false);
    resetDrafts();
    setManualModalOpen(true);
  };

  const openEditManual = (m: ManualDividendPosition) => {
    setHoldingsMenuOpen(false);
    setEditingManualId(m.id);
    setDraftName(m.name);
    setDraftAnnual(String(m.annualIncomeEur));
    setDraftNotional(m.notionalValueEur != null ? String(m.notionalValueEur) : '');
    setDraftLinkedSymbol(
      m.linkedSymbol ? assetsMatchingLink(assets, m.linkedSymbol)[0]?.symbol ?? m.linkedSymbol : ''
    );
    setDraftUnits(m.units != null ? String(m.units) : '');
    setDraftFrequency(m.payoutFrequency);
    setDraftPayoutDate(m.payoutAnchorDate ?? '');
    setManualModalOpen(true);
  };

  const saveManual = () => {
    const name = draftName.trim();
    const annual = parseFloat(draftAnnual.replace(',', '.'));
    const notionalRaw = draftNotional.trim();
    const unitsRaw = draftUnits.trim();
    const notional =
      notionalRaw === '' ? null : parseFloat(notionalRaw.replace(',', '.'));
    const unitsParsed = unitsRaw === '' ? null : parseFloat(unitsRaw.replace(',', '.'));
    const units =
      unitsParsed != null && Number.isFinite(unitsParsed) && unitsParsed > 0 ? unitsParsed : null;
    if (!name || !Number.isFinite(annual) || annual < 0) return;
    const payoutAnchorDate =
      draftPayoutDate.trim() === '' ? null : draftPayoutDate.trim();
    if (payoutAnchorDate && !/^\d{4}-\d{2}-\d{2}$/.test(payoutAnchorDate)) return;
    const linkTrim = draftLinkedSymbol.trim();
    const matchedForSave = assetsMatchingLink(assets, linkTrim || null);
    const linkedSymbol =
      linkTrim === '' ? null : matchedForSave.length > 0 ? matchedForSave[0].symbol : linkTrim;
    const row: ManualDividendPosition = {
      id: editingManualId ?? crypto.randomUUID(),
      name,
      annualIncomeEur: annual,
      notionalValueEur:
        notional != null && Number.isFinite(notional) && notional > 0 ? notional : null,
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

  const draftLinkHint = useMemo(() => {
    const sym = draftLinkedSymbol.trim();
    if (!sym) return null;
    const matched = assetsMatchingLink(assets, sym);
    if (!matched.length) {
      return {
        kind: 'missing' as const,
        text: 'No dashboard holding uses this symbol — add it on the Dashboard or clear the link.',
      };
    }
    const valueEur = matched.reduce((s, a) => s + assetPositionValueEur(a, marketPrices, exchangeRates), 0);
    const quantity = matched.reduce((s, a) => s + (Number.isFinite(a.quantity) ? a.quantity : 0), 0);
    return {
      kind: 'ok' as const,
      text: `Yield % uses ~${formatCurrency(valueEur, 'EUR')} position value (${quantity} sh., live price × FX). Clear “Units” to use this quantity for annual/share.`,
    };
  }, [draftLinkedSymbol, assets, marketPrices, exchangeRates]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-2xl font-black tracking-tight text-white uppercase">Dividends Engine</h2>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="px-3 py-1.5 bg-accent text-white rounded-lg font-black uppercase tracking-widest text-[8px] shadow-lg shadow-accent/20 active:scale-[0.98] transition-all flex items-center gap-1.5 disabled:opacity-50"
        >
          <RefreshCcw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

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
          <div className="flex items-center gap-2 mb-4">
            <Coins className="w-4 h-4 text-accent shrink-0" aria-hidden />
            <h3 className="card-title mb-0">Monthly dividend income (by holding)</h3>
          </div>
          {assets.length === 0 && manualRows.length === 0 ? (
            <p className="text-text-s text-sm py-12 text-center opacity-50 font-mono uppercase tracking-widest text-[10px]">
              Add holdings on the Dashboard, or add a manual dividend row from Holdings detail.
            </p>
          ) : barData.length === 0 ? (
            <p className="text-text-s text-sm py-12 text-center opacity-50 font-mono uppercase tracking-widest text-[10px]">
              {loading ? 'Loading…' : 'No dividend-paying holdings (or estimates are all zero).'}
            </p>
          ) : (
            <div className="h-[260px] w-full flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData} margin={{ top: 8, right: 8, left: 0, bottom: 48 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: 'var(--color-text-s)', fontSize: 10, opacity: 0.7 }}
                    interval={0}
                    angle={-28}
                    textAnchor="end"
                    height={64}
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
                    labelFormatter={(label) => String(label)}
                  />
                  <Bar dataKey="monthlyEur" radius={[6, 6, 0, 0]}>
                    {barData.map((row) => (
                      <Cell
                        key={row.key}
                        fill={row.source === 'manual' ? BAR_MANUAL : BAR_FEED}
                        fillOpacity={0.9}
                      />
                    ))}
                  </Bar>
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
                    ? 'No payout dates yet — set an anchor pay date on manual rows, or wait for feed dates.'
                    : 'No payout dates for feed-backed positions or manual schedule.'}
            </p>
          ) : (
            <ul className="space-y-2 max-h-[280px] overflow-y-auto pr-1 flex-1">
              {payoutEvents.map((e, i) => (
                <li
                  key={`${e.name}-${e.kind}-${e.date}-${i}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-bg/40 outline outline-1 outline-border/50 px-4 py-3 text-xs font-mono font-bold"
                >
                  <span className="text-text-p text-sm font-sans font-bold max-w-[50%] truncate" title={e.name}>
                    {e.name}
                  </span>
                  <span className="text-[9px] text-text-s uppercase tracking-[0.2em] opacity-70">{e.kind}</span>
                  <span className="text-text-p tabular-nums text-xs">{e.date}</span>
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
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-widest text-text-p hover:bg-white/5"
                >
                  <Plus className="w-3.5 h-3.5 text-accent" />
                  Add manual position
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
                      : 'No dividend-paying feed data — use the menu to add a manual position.'}
                  </td>
                </tr>
              ) : (
                <>
                  {dividendPayingRows.map(({ row, index }) => (
                    <tr
                      key={`api-${index}-${row.symbol}`}
                      className="group bg-bg/40 hover:bg-bg transition-all outline outline-1 outline-border/50 hover:outline-accent/30 rounded-2xl"
                    >
                      <td className="px-4 py-3 rounded-l-2xl max-w-[220px]">
                        <div className="text-text-p text-sm font-sans font-bold truncate" title={row.name}>
                          {row.name}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-text-p">
                        {row.dividendYieldPercent != null ? `${row.dividendYieldPercent.toFixed(2)}%` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-text-s/60">
                        {row.annualDividendPerShare != null
                          ? formatCurrency(row.annualDividendPerShare, row.quoteCurrency)
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-text-p tracking-tighter">
                        {formatCurrency(row.estimatedAnnualIncomeEur, 'EUR')}
                      </td>
                      <td className="px-4 py-3 text-right text-text-s/60 text-[11px] uppercase tracking-wider">
                        {row.payoutFrequency ? frequencyLabel(row.payoutFrequency) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-text-s/80 text-[11px]">
                        {nextFeedPayoutDate(row) ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right rounded-r-2xl" />
                    </tr>
                  ))}
                  {manualRows.map((m) => {
                    const yld = manualYieldPercent(m, assets, marketPrices, exchangeRates);
                    const perShareEur = manualAnnualDividendPerShareEur(m, assets);
                    return (
                      <tr
                        key={m.id}
                        className="group bg-bg/40 hover:bg-bg transition-all outline outline-1 outline-emerald-500/25 hover:outline-accent/30 rounded-2xl"
                      >
                        <td className="px-4 py-3 rounded-l-2xl max-w-[220px]">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="text-text-p text-sm font-sans font-bold truncate" title={m.name}>
                              {m.name}
                            </div>
                            <span className="shrink-0 text-[8px] font-black uppercase tracking-widest text-green px-1.5 py-0.5 rounded bg-green/10">
                              Manual
                            </span>
                            {m.linkedSymbol ? (
                              <span
                                className="shrink-0 text-[8px] font-black uppercase tracking-widest text-accent px-1.5 py-0.5 rounded bg-accent/10"
                                title={`Yield & units from portfolio: ${m.linkedSymbol}`}
                              >
                                Portfolio
                              </span>
                            ) : null}
                          </div>
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
                        <td className="px-4 py-3 text-right text-text-p text-[11px] uppercase tracking-wider">
                          {frequencyLabel(m.payoutFrequency)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-text-s/80 text-[11px]">
                          {m.payoutAnchorDate ?? '—'}
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
                  {editingManualId ? 'Edit manual position' : 'Manual dividend position'}
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
              <label className="text-[9px] font-bold text-text-s uppercase tracking-widest block mb-2 ml-1">Name</label>
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                className="w-full mb-5 bg-bg/50 border border-border rounded-xl px-4 py-3 text-sm text-text-p focus:outline-none focus:border-accent/50"
                placeholder="e.g. Vanguard USD Corporate Bond"
              />
              <label className="text-[9px] font-bold text-text-s uppercase tracking-widest block mb-2 ml-1">
                Dashboard holding (optional)
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
                  }
                }}
                className="w-full mb-2 bg-bg/50 border border-border rounded-xl px-4 py-3 text-sm text-text-p focus:outline-none focus:border-accent/50"
              >
                <option value="">— None —</option>
                {assets.map((a) => (
                  <option key={a.id ?? `${a.symbol}-${a.name}`} value={a.symbol}>
                    {a.name} ({a.displaySymbol ?? a.symbol}) · qty {a.quantity}
                  </option>
                ))}
              </select>
              {draftLinkHint ? (
                <p
                  className={`text-[10px] font-mono font-bold leading-relaxed mb-5 ${
                    draftLinkHint.kind === 'missing' ? 'text-red-200/90' : 'text-text-s/75'
                  }`}
                >
                  {draftLinkHint.text}
                </p>
              ) : (
                <p className="text-[10px] font-mono text-text-s/55 mb-5 leading-relaxed">
                  {assets.length === 0
                    ? 'Add positions on the Dashboard to link yield % and annual/share to live quantity and value.'
                    : 'Link the same symbol as on the Dashboard to reuse quantity × price × FX for yield % (and quantity for annual/share when units are left blank).'}
                </p>
              )}
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
                placeholder={draftLinkedSymbol.trim() ? 'Leave blank to use linked holding quantity' : 'For annual dividend per share (EUR)'}
              />
              <p className="text-[9px] font-mono text-text-s/50 mb-5 leading-relaxed">
                Annual/share = annual income ÷ units. When linked, clearing this field uses the holding quantity.
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
                className="w-full mb-5 bg-bg/50 border border-border rounded-xl px-4 py-3 text-sm font-mono text-text-p focus:outline-none focus:border-accent/50"
              />
              {!draftLinkedSymbol.trim() ? (
                <>
                  <label className="text-[9px] font-bold text-text-s uppercase tracking-widest block mb-2 ml-1">
                    Position value for yield % (EUR, optional)
                  </label>
                  <input
                    value={draftNotional}
                    onChange={(e) => setDraftNotional(e.target.value)}
                    inputMode="decimal"
                    className="w-full mb-2 bg-bg/50 border border-border rounded-xl px-4 py-3 text-sm font-mono text-text-p focus:outline-none focus:border-accent/50"
                    placeholder="0"
                  />
                  <p className="text-[9px] font-mono text-text-s/50 mb-6 leading-relaxed">
                    Yield % = annual dividend ÷ this EUR amount. Use when this income is not tied to a Dashboard holding, or pick a holding above instead.
                  </p>
                </>
              ) : (
                <p className="text-[9px] font-mono text-text-s/55 mb-6 leading-relaxed">
                  Yield % uses the linked holding’s market value in EUR (same as the Dashboard). Clear the link to type a EUR amount by hand.
                </p>
              )}
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
                  className="px-4 py-2.5 rounded-lg bg-accent text-white text-[10px] font-black uppercase tracking-widest shadow-lg shadow-accent/20 hover:bg-accent/90 transition-colors"
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
