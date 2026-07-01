import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { AnimatePresence, motion } from 'motion/react';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import type { Asset } from './types';
import { formatCurrency } from './formatCurrency';
import { formatDecimalFi, formatDecimalInputFi, formatPercentFi, parseDecimalInput, parseShareInput, formatShareInput, formatShares, sanitizeShareDraft } from './formatNumber';
import { EurAmountInput } from './EurAmountField';
import {
  computeBlendedYieldSummary,
  isDividendPayerRow,
  manualRowsForBlendedSummary,
  manualSupersededByApiRow,
} from './blendedYieldSummary';
import { DividendInfoLinkCell } from './DividendInfoLinkCell';
import {
  dividendInfoLinkKeyForManual,
  dividendInfoLinkKeyForSymbol,
  loadDividendInfoLinks,
  saveDividendInfoLinks,
} from './dividendInfoLinks';
import { HoldingsDetailTable } from './HoldingsDetailTable';
import { AssetNameCell } from './AssetNameCell';
import { displayTickerForAsset } from './assetLogo';
import {
  type ManualDividendPosition,
  type DividendPayoutFrequency,
  loadManualDividendPositions,
  saveManualDividendPositions,
  frequencyLabel,
} from './manualDividends';
import { DividendPayoutCalendar } from './DividendPayoutCalendar';
import { SummaryStatCard } from './SummaryStatCard';
import { SkeletonBarChart, buildTableSkeletonRows } from './SkeletonPulse';
import {
  resolveApiNextPayDate,
  type ApiDividendPaymentInput,
  type ManualDividendPaymentInput,
} from './dividendRedemptions';

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

const BAR_COLOR = 'var(--color-accent)';

const SECTION_HEAD = 'flex items-center justify-between mb-2 gap-2';

const HOLDINGS_DETAIL_COLUMN_KEYS = [
  'asset',
  'yield',
  'annualShare',
  'income',
  'freq',
  'infoLink',
  'actions',
] as const;

function shortYahooSymbol(sym: string | null | undefined): string {
  const s = sym?.trim();
  if (!s) return '—';
  return (s.includes('.') ? s.split('.')[0] : s).toUpperCase();
}

function shortSymbolKey(sym: string): string {
  const s = sym.trim().toUpperCase();
  return s.includes('.') ? (s.split('.')[0] ?? s) : s;
}

function apiRowForSymbol(data: DividendsPayload | null, symbol: string | null | undefined): DividendRow | null {
  const t = symbol?.trim().toUpperCase();
  if (!t || !data?.rows?.length) return null;
  return (
    data.rows.find((r) => {
      if (r.error) return false;
      const rs = r.symbol.trim().toUpperCase();
      return rs === t || shortSymbolKey(rs) === t || shortSymbolKey(t) === rs;
    }) ?? null
  );
}

function manualSupersededByApi(data: DividendsPayload | null, m: ManualDividendPosition): boolean {
  return manualSupersededByApiRow(data?.rows ?? [], m);
}

function sourceBadge(kind: 'api' | 'manual') {
  const label = kind === 'api' ? 'Feed' : 'Manual';
  const cls =
    kind === 'api'
      ? 'text-accent/90 bg-accent/10 border-accent/25'
      : 'text-text-s/80 bg-white/5 border-border/60';
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[8px] font-bold uppercase tracking-widest ${cls}`}
    >
      {label}
    </span>
  );
}

function effectivePayoutFrequency(
  manual: ManualDividendPosition,
  apiRow: DividendRow | null
): DividendPayoutFrequency {
  if (apiRow?.payoutFrequency) return apiRow.payoutFrequency;
  return manual.payoutFrequency;
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
  const base = shortSymbolKey(t);
  return assets.filter((a) => {
    const sym = a.symbol?.trim().toUpperCase() ?? '';
    const disp = a.displaySymbol != null ? String(a.displaySymbol).trim().toUpperCase() : '';
    return (
      sym === t ||
      disp === t ||
      shortSymbolKey(sym) === base ||
      (disp !== '' && shortSymbolKey(disp) === base)
    );
  });
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
  annualEur: number;
  source: 'api' | 'manual';
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
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [editingManualId, setEditingManualId] = useState<string | null>(null);
  const [draftAnnual, setDraftAnnual] = useState('');
  const [draftLinkedSymbol, setDraftLinkedSymbol] = useState('');
  const [draftUnits, setDraftUnits] = useState('');
  const [draftFrequency, setDraftFrequency] = useState<DividendPayoutFrequency>('quarterly');
  const [draftPayoutDate, setDraftPayoutDate] = useState('');
  const [infoLinks, setInfoLinks] = useState<Record<string, string>>(() => loadDividendInfoLinks());

  const setInfoLink = useCallback((key: string, url: string | null) => {
    const k = key.toUpperCase();
    setInfoLinks((prev) => {
      const next = { ...prev };
      if (url) next[k] = url;
      else delete next[k];
      saveDividendInfoLinks(next);
      return next;
    });
  }, []);

  useEffect(() => {
    saveManualDividendPositions(manualRows);
  }, [manualRows]);

  useEffect(() => {
    if (!data?.rows?.length) return;
    setManualRows((prev) => {
      let changed = false;
      const next = prev.map((m) => {
        if (!m.linkedSymbol?.trim()) return m;
        const api = apiRowForSymbol(data, m.linkedSymbol);
        if (!api?.payoutFrequency || api.payoutFrequency === m.payoutFrequency) return m;
        changed = true;
        return { ...m, payoutFrequency: api.payoutFrequency };
      });
      return changed ? next : prev;
    });
  }, [data]);

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
      .filter(({ row }) => isDividendPayerRow(row))
      .sort((a, b) => b.row.estimatedAnnualIncomeEur - a.row.estimatedAnnualIncomeEur);
  }, [data]);

  const sortedManualRows = useMemo(
    () => [...manualRows].sort((a, b) => b.annualIncomeEur - a.annualIncomeEur),
    [manualRows]
  );

  const holdingsDetailRows = useMemo(() => {
    const api = dividendPayingRows.map(({ row, index }) => ({
      kind: 'api' as const,
      income: row.estimatedAnnualIncomeEur,
      row,
      index,
    }));
    const manual = sortedManualRows
      .filter((m) => !manualSupersededByApi(data, m))
      .map((m) => ({
        kind: 'manual' as const,
        income: m.annualIncomeEur,
        m,
      }));
    return [...api, ...manual].sort((a, b) => b.income - a.income);
  }, [dividendPayingRows, sortedManualRows, data]);

  const displaySummary = useMemo(() => {
    if (!data?.rows?.length) {
      return { totalAnnualEur: 0, avgYieldPercent: 0, capitalBaseEur: 0 };
    }
    const rates = {
      EUR: 1,
      ...exchangeRates,
      ...((data as { rates?: Record<string, number> }).rates ?? {}),
    };
    return computeBlendedYieldSummary(assets, data.rows, manualRows, marketPrices, rates);
  }, [data, assets, manualRows, marketPrices, exchangeRates]);

  const barData = useMemo((): BarDatum[] => {
    const apiBars: BarDatum[] = dividendPayingRows.map(({ row, index }) => {
      const a = assets[index];
      const fullName = row.name || a?.name || 'Holding';
      const label = displayTickerForAsset(a);
      return {
        key: `api-${index}-${row.symbol}`,
        label,
        fullName,
        annualEur: row.estimatedAnnualIncomeEur,
        source: 'api',
      };
    });
    const manualBars: BarDatum[] = manualRows
      .filter((m) => !manualSupersededByApi(data, m))
      .map((m) => {
        const linked = m.linkedSymbol ? assetsMatchingLink(assets, m.linkedSymbol) : [];
        const a = linked[0];
        const fullName = a?.name ?? m.name;
        const label = a ? displayTickerForAsset(a) : shortYahooSymbol(m.linkedSymbol);
        return {
          key: `manual-${m.id}`,
          label,
          fullName,
          annualEur: m.annualIncomeEur,
          source: 'manual',
        };
      });
    return [...apiBars, ...manualBars].sort((a, b) => b.annualEur - a.annualEur);
  }, [dividendPayingRows, assets, manualRows, data]);

  const calendarApiRows = useMemo((): ApiDividendPaymentInput[] => {
    return dividendPayingRows.map(({ row, index }) => {
      const a = assets[index];
      const resolved = resolveApiNextPayDate({
        calendarPayoutDates: row.calendarPayoutDates,
        dividendDate: row.dividendDate,
        calendarPayoutSource: row.calendarPayoutSource,
      });
      return {
        symbol: row.symbol,
        name: a?.name?.trim() || row.name || row.symbol,
        ticker: a ? displayTickerForAsset(a) : shortYahooSymbol(row.symbol),
        estimatedAnnualIncomeEur: row.estimatedAnnualIncomeEur,
        payoutFrequency: row.payoutFrequency,
        nextPayDateYmd: resolved?.nextPayDateYmd ?? null,
        payDateSource: resolved?.payDateSource ?? row.calendarPayoutSource ?? 'none',
      };
    });
  }, [dividendPayingRows, assets]);

  const manualRowsForBlended = useMemo(
    () => manualRowsForBlendedSummary(manualRows, data?.rows ?? []),
    [manualRows, data]
  );

  const calendarManualRows = useMemo((): ManualDividendPaymentInput[] => {
    return manualRowsForBlended.map((m) => {
      const linked = m.linkedSymbol ? assetsMatchingLink(assets, m.linkedSymbol) : [];
      const a = linked[0];
      return {
        id: m.id,
        name: a?.name?.trim() || m.name,
        ticker: a ? displayTickerForAsset(a) : shortYahooSymbol(m.linkedSymbol),
        annualIncomeEur: m.annualIncomeEur,
        payoutFrequency: effectivePayoutFrequency(m, apiRowForSymbol(data, m.linkedSymbol)),
        payoutAnchorDate: m.payoutAnchorDate,
      };
    });
  }, [manualRowsForBlended, assets, data]);

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
    resetDrafts();
    setManualModalOpen(true);
  };

  const openEditManual = (m: ManualDividendPosition) => {
    setEditingManualId(m.id);
    setDraftAnnual(formatDecimalFi(m.annualIncomeEur, 2));
    setDraftLinkedSymbol(
      m.linkedSymbol ? assetsMatchingLink(assets, m.linkedSymbol)[0]?.symbol ?? m.linkedSymbol : ''
    );
    setDraftUnits(m.units != null ? formatShares(m.units) : '');
    const api = apiRowForSymbol(data, m.linkedSymbol);
    setDraftFrequency(effectivePayoutFrequency(m, api));
    setDraftPayoutDate(m.payoutAnchorDate ?? '');
    setManualModalOpen(true);
  };

  const saveManual = () => {
    const annual = parseDecimalInput(draftAnnual, 0);
    const unitsRaw = draftUnits.trim();
    const unitsParsed = unitsRaw === '' ? null : parseShareInput(unitsRaw, NaN);
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

  /** API fetch in flight and no payload yet — manual rows must not render ahead of holdings detail. */
  const dividendsFetchPending = loading && data == null;

  const holdingsDetailSkeletonRows = useMemo(
    () =>
      buildTableSkeletonRows(
        Math.min(Math.max(assets.length + manualRows.length, 4), 8),
        [...HOLDINGS_DETAIL_COLUMN_KEYS]
      ),
    [assets.length, manualRows.length]
  );

  const holdingsDetailEmptyState = useMemo(() => {
    if (dividendsFetchPending) {
      return null;
    }
    if (!data && assets.length > 0) {
      return (
        <p className="text-text-s opacity-50 text-[10px] uppercase tracking-widest font-bold">No data.</p>
      );
    }
    if (!hasAnyDividendDisplay && !loading) {
      return (
        <p className="text-text-s opacity-50 text-[10px] uppercase tracking-widest font-bold">
          {assets.length === 0 && manualRows.length === 0
            ? 'No holdings or manual rows.'
            : 'No Yahoo dividend feed for these holdings — add a manual estimate or link a listing with feed data (e.g. .MI for UCITS ETFs).'}
        </p>
      );
    }
    return null;
  }, [dividendsFetchPending, data, assets.length, hasAnyDividendDisplay, manualRows.length]);

  const holdingsDetailTableRows = useMemo(() => {
    if (holdingsDetailEmptyState != null) return [];
    return holdingsDetailRows.map((entry) => {
      if (entry.kind === 'api') {
        const { row, index } = entry;
        const a = assets[index];
        const tick = a ? displayTickerForAsset(a) : null;
        const yahooSym = a?.symbol ?? row.symbol;
        const feedYld = feedYieldPercent(row, a, marketPrices, exchangeRates);
        const annualShareEur = feedAnnualPerShareEur(row, exchangeRates);
        return {
          asset: (
            <div className="flex items-center gap-2 min-w-0">
              <div className="min-w-0 flex-1">
                <AssetNameCell
                  name={row.name}
                  ticker={tick ?? ''}
                  yahooSymbol={yahooSym}
                  type={a?.type}
                />
              </div>
              {sourceBadge('api')}
            </div>
          ),
          yield: feedYld != null ? formatPercentFi(feedYld, 2) : '—',
          annualShare:
            annualShareEur != null ? (
              <span className="text-text-s/50">{formatCurrency(annualShareEur, 'EUR')}</span>
            ) : (
              '—'
            ),
          income: formatCurrency(row.estimatedAnnualIncomeEur, 'EUR'),
          freq: (
            <span className="text-text-s/50 text-[11px] uppercase tracking-wider">
              {row.payoutFrequency ? frequencyLabel(row.payoutFrequency) : '—'}
            </span>
          ),
          infoLink: (() => {
            const linkKey = dividendInfoLinkKeyForSymbol(row.symbol);
            if (!linkKey) return '—';
            return (
              <DividendInfoLinkCell
                url={infoLinks[linkKey] ?? null}
                onSave={(url) => setInfoLink(linkKey, url)}
              />
            );
          })(),
          actions: '',
        };
      }

      const m = entry.m;
      const apiMatch = apiRowForSymbol(data, m.linkedSymbol);
      const yld = manualYieldPercent(m, assets, marketPrices, exchangeRates);
      const perShareEur = manualAnnualDividendPerShareEur(m, assets);
      const linkedAs = m.linkedSymbol ? assetsMatchingLink(assets, m.linkedSymbol)[0] : undefined;
      const title = linkedAs?.name ?? m.name;
      return {
        asset: (
          <div className="flex items-center gap-2 min-w-0">
            <div className="min-w-0 flex-1">
              <AssetNameCell
                name={title}
                ticker={linkedAs ? displayTickerForAsset(linkedAs) : ''}
                yahooSymbol={linkedAs?.symbol ?? m.linkedSymbol}
                type={linkedAs?.type}
                subline={linkedAs ? undefined : 'Link holding on edit'}
              />
            </div>
            {sourceBadge('manual')}
          </div>
        ),
        yield: yld != null ? formatPercentFi(yld, 2) : '—',
        annualShare:
          perShareEur != null ? (
            <span className="text-text-s/50">{formatCurrency(perShareEur, 'EUR')}</span>
          ) : (
            '—'
          ),
        income: formatCurrency(m.annualIncomeEur, 'EUR'),
        freq: (
          <span className="text-text-s/50 text-[11px] uppercase tracking-wider">
            {frequencyLabel(effectivePayoutFrequency(m, apiMatch))}
          </span>
        ),
        infoLink: (() => {
          const linkKey = dividendInfoLinkKeyForManual(m.linkedSymbol, m.id);
          return (
            <DividendInfoLinkCell
              url={infoLinks[linkKey] ?? null}
              onSave={(url) => setInfoLink(linkKey, url)}
            />
          );
        })(),
        actions: (
          <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={() => openEditManual(m)}
              className="p-1.5 text-text-s hover:text-accent hover:bg-accent/10 rounded-lg transition-all shrink-0"
              aria-label="Edit manual position"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => removeManual(m.id)}
              className="p-1.5 text-text-s hover:text-red hover:bg-red/10 rounded-lg transition-all shrink-0"
              aria-label="Remove manual position"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ),
      };
    });
  }, [
    holdingsDetailEmptyState,
    holdingsDetailRows,
    assets,
    marketPrices,
    exchangeRates,
    data,
    infoLinks,
    setInfoLink,
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="page-title">Dividend engine</h2>
      </div>
      {err && (
        <div className="error-banner">{err}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SummaryStatCard
          title="Total annual dividend income"
          hero={formatCurrency(displaySummary.totalAnnualEur, 'EUR')}
          footer={
            displaySummary.totalAnnualEur > 0 ? (
              <p className="stat-subline">
                ≈{' '}
                <span className="text-accent font-bold">
                  {formatCurrency(displaySummary.totalAnnualEur / 12, 'EUR')}
                </span>{' '}
                / month
              </p>
            ) : undefined
          }
          emptyFooter={<p className="stat-subline text-text-s/60">No dividend income yet</p>}
        />
        <SummaryStatCard
          title="Average yield (blended)"
          hero={formatPercentFi(displaySummary.avgYieldPercent, 2)}
          footer={
            displaySummary.capitalBaseEur > 0 ? (
              <p className="stat-subline">
                On{' '}
                <span className="text-accent font-bold">
                  {formatCurrency(displaySummary.capitalBaseEur, 'EUR')}
                </span>{' '}
                in dividend-paying holdings
              </p>
            ) : undefined
          }
          emptyFooter={
            <p className="stat-subline text-text-s/60">No dividend-paying capital base yet</p>
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="panel min-h-[360px] h-[360px] max-h-[360px] flex flex-col overflow-hidden">
          <div className={`${SECTION_HEAD} shrink-0`}>
            <h3 className="card-title mb-0">Annual dividend income (by holding)</h3>
          </div>
          {assets.length === 0 && manualRows.length === 0 ? (
            <p className="text-text-s py-12 text-center opacity-50 font-mono uppercase tracking-widest text-[10px] font-bold">
              Add holdings on the Dashboard, then add a per-holding dividend estimate here if needed.
            </p>
          ) : dividendsFetchPending ? (
            <div className="flex-1 min-h-0 flex flex-col justify-center">
              <div className="h-[238px] w-full shrink-0" role="status" aria-label="Loading dividend chart">
                <SkeletonBarChart />
              </div>
            </div>
          ) : barData.length === 0 ? (
            <p className="text-text-s py-12 text-center opacity-50 font-mono uppercase tracking-widest text-[10px] font-bold">
              No dividend-paying holdings (or estimates are all zero).
            </p>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col justify-center">
              <div className="h-[238px] w-full shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData} margin={{ top: 8, right: 8, left: 0, bottom: 24 }} barCategoryGap="18%">
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: 'var(--color-text-s)', fontSize: 11, fontWeight: 600 }}
                    interval={0}
                    angle={0}
                    textAnchor="middle"
                    height={44}
                    tickMargin={7}
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
                      padding: 12,
                    }}
                    labelStyle={{ color: 'var(--color-text-p)', fontWeight: 700, fontSize: 12, marginBottom: 4 }}
                    itemStyle={{ color: 'var(--color-accent)', fontWeight: 900, fontSize: 14 }}
                    formatter={(value: number | undefined) => [
                      formatCurrency(Number(value), 'EUR'),
                      'Annual income',
                    ]}
                    labelFormatter={(_label, payload) => {
                      const row = payload?.[0]?.payload as BarDatum | undefined;
                      return row?.fullName ?? row?.label ?? '';
                    }}
                  />
                  <Bar dataKey="annualEur" radius={[6, 6, 0, 0]} fill={BAR_COLOR} fillOpacity={0.9} />
                </BarChart>
              </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>

        <div className="panel min-h-[360px] h-[360px] max-h-[360px] flex flex-col overflow-hidden">
          <div className={`${SECTION_HEAD} shrink-0`}>
            <h3 className="card-title mb-0">Dividend calendar</h3>
          </div>
          <DividendPayoutCalendar
            apiRows={dividendsFetchPending ? [] : calendarApiRows}
            manualRows={dividendsFetchPending ? [] : calendarManualRows}
            loading={dividendsFetchPending}
            hasHoldings={assets.length > 0}
          />
        </div>
      </div>

      <div className="panel">
        <div className={SECTION_HEAD}>
          <h3 className="card-title mb-0">Holdings detail</h3>
          <button
            type="button"
            onClick={openManualModal}
            disabled={assets.length === 0}
            className="btn-primary text-[10px] py-1.5 px-3 disabled:opacity-40 disabled:pointer-events-none"
          >
            <Plus className="w-3.5 h-3.5" /> Add dividend estimate
          </button>
        </div>
        <HoldingsDetailTable
          rows={dividendsFetchPending ? holdingsDetailSkeletonRows : holdingsDetailTableRows}
          emptyState={holdingsDetailEmptyState ?? undefined}
        />
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
                    setDraftUnits(q > 0 ? formatShares(q) : '');
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
              <EurAmountInput
                wrapperClassName="mb-5"
                value={draftAnnual}
                onChange={(e) => setDraftAnnual(e.target.value)}
                onBlur={() => setDraftAnnual((v) => formatDecimalInputFi(v, 2))}
                className="py-3 text-sm"
                placeholder="0,00"
              />
              <label className="text-[9px] font-bold text-text-s uppercase tracking-widest block mb-2 ml-1">
                Units / shares (optional)
              </label>
              <input
                value={draftUnits}
                onChange={(e) => setDraftUnits(sanitizeShareDraft(e.target.value))}
                onBlur={() => setDraftUnits((v) => (v.trim() === '' ? '' : formatShareInput(v)))}
                inputMode="numeric"
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
