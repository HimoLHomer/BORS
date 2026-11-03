import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { AnimatePresence } from 'motion/react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { Asset } from './types';
import { formatCurrency } from './formatCurrency';
import { formatDecimalFi, formatPercentFi, parseDecimalInput } from './formatNumber';
import { ManualDividendModal } from './ManualDividendModal';
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
import { InfoHint } from './InfoHint';
import { loadFireInputs, FIRE_INPUTS_CHANGED_EVENT } from './fireStorage';
import { SkeletonBarChart, SkeletonBlock, SkeletonCurrency, buildTableSkeletonRows } from './SkeletonPulse';
import {
  dividendsHoldingsKey,
  readDividendsPayloadCache,
  writeDividendsPayloadCache,
} from './dividendsPayloadCache';
import {
  forgetTrackedHoldings,
  manualHoldingKey,
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


const SECTION_HEAD = 'flex items-center justify-between mb-2 gap-2';

const HOLDINGS_DETAIL_COLUMN_KEYS = [
  'asset',
  'income',
  'yield',
  'annualShare',
  'freq',
  'actions',
  'infoLink',
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
      ? 'text-text-p bg-white/10 border-border'
      : 'text-text-s bg-white/5 border-border/60';
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium ${cls}`}
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
  const [holdingsStaggerKey, setHoldingsStaggerKey] = useState(0);
  const [editingManualId, setEditingManualId] = useState<string | null>(null);
  const [draftAnnual, setDraftAnnual] = useState('');
  const [draftLinkedSymbol, setDraftLinkedSymbol] = useState('');
  const [draftFrequency, setDraftFrequency] = useState<DividendPayoutFrequency>('quarterly');
  const [draftPayoutDate, setDraftPayoutDate] = useState('');
  const [manualSaveError, setManualSaveError] = useState<string | null>(null);
  const [infoLinks, setInfoLinks] = useState<Record<string, string>>(() => loadDividendInfoLinks());
  const [dividendTaxRatePercent, setDividendTaxRatePercent] = useState(
    () => loadFireInputs().capital.dividendTaxRatePercent
  );

  useEffect(() => {
    const syncTax = () => setDividendTaxRatePercent(loadFireInputs().capital.dividendTaxRatePercent);
    window.addEventListener(FIRE_INPUTS_CHANGED_EVENT, syncTax);
    return () => window.removeEventListener(FIRE_INPUTS_CHANGED_EVENT, syncTax);
  }, []);
  const taxRateLabel = formatPercentFi(dividendTaxRatePercent, dividendTaxRatePercent % 1 === 0 ? 0 : 2);
  const marketPricesRef = useRef(marketPrices);
  marketPricesRef.current = marketPrices;

  const holdingsKey = useMemo(() => dividendsHoldingsKey(assets), [assets]);

  const clearManualSaveError = useCallback(() => setManualSaveError(null), []);

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
    setHoldingsStaggerKey((k) => k + 1);
  }, []);

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
      setLoading(false);
      return;
    }

    const cached = readDividendsPayloadCache(holdingsKey);
    if (cached) {
      setData(cached.payload as DividendsPayload);
      setErr(null);
      if (cached.fresh) {
        setLoading(false);
        return;
      }
    } else {
      setLoading(true);
    }

    setErr(null);
    try {
      const prices = marketPricesRef.current;
      const holdings = assets.map((a) => ({
        symbol: a.symbol,
        displaySymbol: a.displaySymbol ?? null,
        quantity: a.quantity,
        currency: a.currency,
        livePrice: prices[a.symbol],
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
      writeDividendsPayloadCache(holdingsKey, payload);
      setData(payload);
    } catch (e) {
      if (!cached) {
        setErr(e instanceof Error ? e.message : 'Failed to load dividends');
        setData(null);
      }
    } finally {
      setLoading(false);
    }
  }, [assets, holdingsKey]);

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

  // An estimate linked to a holding that has since been sold pays nothing. It stays saved, so
  // it comes back if the holding is bought again.
  const heldManualRows = useMemo(
    () => manualRows.filter((m) => !m.linkedSymbol?.trim() || assetsMatchingLink(assets, m.linkedSymbol).length > 0),
    [manualRows, assets]
  );

  const sortedManualRows = useMemo(
    () => [...heldManualRows].sort((a, b) => b.annualIncomeEur - a.annualIncomeEur),
    [heldManualRows]
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

  const holdingsDetailRowKeys = useMemo(
    () =>
      holdingsDetailRows.map((entry) =>
        entry.kind === 'api' ? `api-${entry.row.symbol}` : `manual-${entry.m.id}`
      ),
    [holdingsDetailRows]
  );

  const displaySummary = useMemo(() => {
    if (!data?.rows?.length) {
      return { totalAnnualEur: 0, avgYieldPercent: 0, capitalBaseEur: 0 };
    }
    const rates = {
      EUR: 1,
      ...exchangeRates,
      ...((data as { rates?: Record<string, number> }).rates ?? {}),
    };
    return computeBlendedYieldSummary(assets, data.rows, heldManualRows, marketPrices, rates);
  }, [data, assets, heldManualRows, marketPrices, exchangeRates]);

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
    const manualBars: BarDatum[] = heldManualRows
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
  }, [dividendPayingRows, assets, heldManualRows, data]);

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
        calendarPayoutDates: row.calendarPayoutDates,
        nextPayDateYmd: resolved?.nextPayDateYmd ?? null,
        payDateSource: row.calendarPayoutSource ?? 'none',
      };
    });
  }, [dividendPayingRows, assets]);

  const manualRowsForBlended = useMemo(
    () => manualRowsForBlendedSummary(heldManualRows, data?.rows ?? []),
    [heldManualRows, data]
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

  const eligibleHoldings = useMemo(() => {
    const editingRow = editingManualId ? manualRows.find((m) => m.id === editingManualId) : null;
    const editingSymbol = editingRow?.linkedSymbol?.trim().toUpperCase() ?? null;
    const takenManualSymbols = new Set(
      manualRows
        .filter((m) => m.id !== editingManualId)
        .map((m) => m.linkedSymbol?.trim().toUpperCase())
        .filter((s): s is string => Boolean(s))
    );

    return assets.filter((a) => {
      const sym = a.symbol.trim().toUpperCase();
      if (editingSymbol && sym === editingSymbol) return true;
      if (takenManualSymbols.has(sym)) return false;
      if (manualSupersededByApi(data, { linkedSymbol: a.symbol } as ManualDividendPosition)) return false;
      return true;
    });
  }, [assets, manualRows, editingManualId, data]);

  const resetDrafts = () => {
    setDraftAnnual('');
    setDraftLinkedSymbol('');
    setDraftFrequency('quarterly');
    setDraftPayoutDate('');
    setEditingManualId(null);
    setManualSaveError(null);
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
    const api = apiRowForSymbol(data, m.linkedSymbol);
    setDraftFrequency(effectivePayoutFrequency(m, api));
    setDraftPayoutDate(m.payoutAnchorDate ?? '');
    setManualModalOpen(true);
  };

  const saveManual = () => {
    const annual = parseDecimalInput(draftAnnual, 0);
    if (!Number.isFinite(annual) || annual <= 0) return;
    const payoutAnchorDate =
      draftPayoutDate.trim() === '' ? null : draftPayoutDate.trim();
    if (payoutAnchorDate && !/^\d{4}-\d{2}-\d{2}$/.test(payoutAnchorDate)) return;
    const linkTrim = draftLinkedSymbol.trim();
    const matchedForSave = assetsMatchingLink(assets, linkTrim || null);
    if (matchedForSave.length === 0) return;
    const primary = matchedForSave[0];
    const linkedSymbol = primary.symbol;
    if (!editingManualId) {
      const dup = manualRows.find(
        (m) => m.linkedSymbol?.trim().toUpperCase() === linkedSymbol.trim().toUpperCase()
      );
      if (dup) {
        setManualSaveError('This holding already has an estimate—edit it from the table.');
        return;
      }
    }
    const name = primary.name.trim() || primary.symbol;
    const row: ManualDividendPosition = {
      id: editingManualId ?? crypto.randomUUID(),
      name,
      annualIncomeEur: annual,
      notionalValueEur: null,
      linkedSymbol,
      units: null,
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
    if (!window.confirm('Remove this dividend estimate?')) return;
    setManualRows((prev) => prev.filter((m) => m.id !== id));
    forgetTrackedHoldings([manualHoldingKey(id)]);
  };

  const hasAnyDividendDisplay = dividendPayingRows.length > 0 || heldManualRows.length > 0;

  /** API fetch in flight and no payload yet — manual rows must not render ahead of holdings detail. */
  const dividendsFetchPending = loading && data == null;

  const holdingsDetailSkeletonRows = useMemo(
    () =>
      buildTableSkeletonRows(
        Math.min(Math.max(assets.length + heldManualRows.length, 4), 8),
        [...HOLDINGS_DETAIL_COLUMN_KEYS]
      ),
    [assets.length, heldManualRows.length]
  );

  const holdingsDetailEmptyState = useMemo(() => {
    if (dividendsFetchPending) {
      return null;
    }
    if (!data && assets.length > 0) {
      return (
        <p className="text-text-s opacity-50 text-xs font-medium">No data.</p>
      );
    }
    if (!hasAnyDividendDisplay && !loading) {
      return (
        <p className="text-text-s opacity-50 text-xs font-medium">
          {assets.length === 0 && heldManualRows.length === 0
            ? 'No holdings or manual rows.'
            : 'No Yahoo dividend feed for these holdings — add a manual estimate or link a listing with feed data (e.g. .MI for UCITS ETFs).'}
        </p>
      );
    }
    return null;
  }, [dividendsFetchPending, data, assets.length, hasAnyDividendDisplay, heldManualRows.length]);

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
            <span className="text-text-s/50 text-xs">
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
          <span className="text-text-s/50 text-xs">
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
          glow
          title="Total annual dividend income"
          info={
            <>
              <p>
                <strong>Gross, before tax.</strong> For each holding: shares × its annual dividend per
                share (from Yahoo, or your manual entry), converted to EUR at today&rsquo;s rates. The
                monthly figure is this ÷ 12.
              </p>
              <p>
                Dividend tax is <strong>not</strong> deducted here. Your tax rate ({taxRateLabel}) is set
                under <strong>Dividend tax / withholding</strong> on the FIRE screen and is deducted in
                the Dividend calendar and the FIRE projection.
              </p>
            </>
          }
          hero={
            dividendsFetchPending ? (
              <SkeletonCurrency className="h-14 w-40" />
            ) : (
              formatCurrency(displaySummary.totalAnnualEur, 'EUR')
            )
          }
          footer={
            displaySummary.totalAnnualEur > 0 ? (
              <p className="stat-subline">
                ≈{' '}
                <span className="text-text-p font-bold">
                  {formatCurrency(displaySummary.totalAnnualEur / 12, 'EUR')}
                </span>{' '}
                / month
              </p>
            ) : undefined
          }
          emptyFooter={
            dividendsFetchPending ? (
              <SkeletonBlock className="h-3 w-44 mt-3" aria-busy aria-label="Loading" />
            ) : (
              <p className="stat-subline text-text-s/60">No dividend income yet</p>
            )
          }
        />
        <SummaryStatCard
          title="Average dividend yield"
          info={
            <>
              <p>
                Total annual dividend income ÷ today&rsquo;s value of the holdings that pay dividends.
                Holdings without dividends (e.g. accumulating ETFs) are left out.
              </p>
              <p>
                It&rsquo;s weighted by how much you hold of each payer, so larger positions count more.
                Gross, before tax.
              </p>
            </>
          }
          hero={
            dividendsFetchPending ? (
              <SkeletonCurrency className="h-14 w-28" />
            ) : (
              formatPercentFi(displaySummary.avgYieldPercent, 2)
            )
          }
          footer={
            displaySummary.capitalBaseEur > 0 ? (
              <p className="stat-subline">
                On{' '}
                <span className="text-text-p font-bold">
                  {formatCurrency(displaySummary.capitalBaseEur, 'EUR')}
                </span>{' '}
                in dividend-paying holdings
              </p>
            ) : undefined
          }
          emptyFooter={
            dividendsFetchPending ? (
              <SkeletonBlock className="h-3 w-52 mt-3" aria-busy aria-label="Loading" />
            ) : (
              <p className="stat-subline text-text-s/60">No dividend-paying capital base yet</p>
            )
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="panel min-h-[400px] h-[400px] max-h-[400px] flex flex-col overflow-hidden">
          <div className={`${SECTION_HEAD} shrink-0`}>
            <h3 className="card-title mb-0">Annual dividend income (by holding)</h3>
          </div>
          {assets.length === 0 && heldManualRows.length === 0 ? (
            <p className="text-text-s py-12 text-center opacity-50 font-mono text-xs font-medium">
              Add holdings on the Dashboard, then add a per-holding dividend estimate here if needed.
            </p>
          ) : dividendsFetchPending ? (
            <div className="flex-1 min-h-0 flex flex-col justify-center">
              <div className="h-[238px] w-full shrink-0" role="status" aria-label="Loading dividend chart">
                <SkeletonBarChart />
              </div>
            </div>
          ) : barData.length === 0 ? (
            <p className="text-text-s py-12 text-center opacity-50 font-mono text-xs font-medium">
              No dividend-paying holdings (or estimates are all zero).
            </p>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col justify-center">
              <div className="flex-1 min-h-[238px] w-full">
              <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 1, height: 1 }}>
                <BarChart data={barData} margin={{ top: 8, right: 8, left: 0, bottom: 24 }} barCategoryGap="18%">
                  <defs>
                    <linearGradient id="dividendBarFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-accent-400)" />
                      <stop offset="100%" stopColor="var(--color-accent-700)" stopOpacity={0.55} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="2 6" stroke="rgba(255,255,255,0.07)" vertical={false} />
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
                    tick={{ fill: 'var(--color-text-s)', fontSize: 11, fontWeight: 600 }}
                    tickFormatter={(v) => formatCurrency(Number(v), 'EUR')}
                    width={72}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(255,255,255,0.06)' }}
                    contentStyle={{
                      backgroundColor: 'rgb(16 19 26 / 0.92)',
                      border: '1px solid rgb(255 255 255 / 0.08)',
                      borderRadius: 14,
                      padding: '10px 14px',
                      boxShadow: '0 12px 30px -12px rgb(0 0 0 / 0.7)',
                    }}
                    labelStyle={{ color: 'var(--color-text-s)', fontWeight: 500, fontSize: 12, marginBottom: 2 }}
                    itemStyle={{ color: 'var(--color-text-p)', fontWeight: 600, fontSize: 15, padding: 0 }}
                    formatter={(value: number | undefined) => [
                      formatCurrency(Number(value), 'EUR'),
                      'Annual income',
                    ]}
                    labelFormatter={(_label, payload) => {
                      const row = payload?.[0]?.payload as BarDatum | undefined;
                      return row?.fullName ?? row?.label ?? '';
                    }}
                  />
                  <Bar dataKey="annualEur" radius={[8, 8, 2, 2]} fill="url(#dividendBarFill)" />
                </BarChart>
              </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>

        <div className="panel min-h-[400px] h-[400px] max-h-[400px] flex flex-col overflow-hidden">
          <div className={`${SECTION_HEAD} shrink-0`}>
            <div className="flex items-center gap-1.5 mb-2">
              <h3 className="card-title !mb-0">Dividend calendar</h3>
              <InfoHint label="About the dividend calendar">
                <p>
                  Each payment is the holding&rsquo;s annual dividend ÷ its payments per year (monthly,
                  quarterly or annual), <strong>after {taxRateLabel} dividend tax</strong>. The rate is set
                  under <strong>Dividend tax / withholding</strong> on the FIRE screen.
                </p>
                <p>
                  Dates come from Yahoo where available; <strong>~</strong> marks an estimated date.
                  Click a payment once it has arrived to move it to Received.
                </p>
              </InfoHint>
            </div>
          </div>
          <div className="flex-1 min-h-0 flex flex-col">
            <DividendPayoutCalendar
              apiRows={dividendsFetchPending ? [] : calendarApiRows}
              manualRows={dividendsFetchPending ? [] : calendarManualRows}
              loading={dividendsFetchPending}
              hasHoldings={assets.length > 0}
            />
          </div>
        </div>
      </div>

      <div className="panel">
        <div className={SECTION_HEAD}>
          <h3 className="card-title mb-0">Holdings detail</h3>
          <button
            type="button"
            onClick={openManualModal}
            disabled={assets.length === 0}
            className="btn-primary text-[11px] py-1.5 px-3 disabled:opacity-40 disabled:pointer-events-none"
          >
            <Plus className="w-3.5 h-3.5" /> Add dividend estimate
          </button>
        </div>
        <HoldingsDetailTable
          rows={dividendsFetchPending ? holdingsDetailSkeletonRows : holdingsDetailTableRows}
          emptyState={holdingsDetailEmptyState ?? undefined}
          rowKeys={dividendsFetchPending ? undefined : holdingsDetailRowKeys}
          enterStaggerKey={dividendsFetchPending ? undefined : holdingsStaggerKey}
          enterStaggerMax={12}
        />
      </div>

      <AnimatePresence>
        {manualModalOpen && (
          <ManualDividendModal
            open={manualModalOpen}
            editing={editingManualId != null}
            eligibleHoldings={eligibleHoldings}
            allAssets={assets}
            draftLinkedSymbol={draftLinkedSymbol}
            draftAnnual={draftAnnual}
            draftFrequency={draftFrequency}
            draftPayoutDate={draftPayoutDate}
            saveError={manualSaveError}
            onClose={() => {
              setManualModalOpen(false);
              resetDrafts();
            }}
            onSave={saveManual}
            onDraftLinkedSymbolChange={setDraftLinkedSymbol}
            onDraftAnnualChange={setDraftAnnual}
            onDraftFrequencyChange={setDraftFrequency}
            onDraftPayoutDateChange={setDraftPayoutDate}
            onClearSaveError={clearManualSaveError}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
