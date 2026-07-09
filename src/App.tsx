import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { 
  Plus, 
  TrendingUp, 
  TrendingDown,
  Wallet, 
  RefreshCcw,
  X,
  Activity,
  Zap,
  Trash2,
  Pencil,
  LayoutDashboard,
  Coins,
  Flame,
  Search,
  Settings,
  Download,
  Upload,
  History,
  Copy,
  ChevronDown,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { BorsMark } from './BorsMark';
import { Asset, PortfolioStats, HistoryPoint, PortfolioFlow } from './types';
import {
  buildAllocationPieCalloutMap,
  AllocationPieCalloutLayer,
  ALLOCATION_PIE_CHART_MARGIN,
  ALLOCATION_PIE_PADDING_ANGLE,
} from './allocationPieLabels';
import { AllocationPieDefs, allocationPieSliceChrome } from './allocationPieChrome';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import { formatCurrency, fxToEur, holdingQuoteFxToEur, portfolioFxReady } from './formatCurrency';
import { mergeHoldingPurchase } from './mergeHoldingPurchase';
import { formatDecimalEn, formatDecimalInputEn, formatPercentEn, parseDecimalInput, parseShareInput, formatShareInput, formatShares, sanitizeShareDraft } from './formatNumber';
import { formatDateEn, todayIsoDateHelsinki } from './formatDate';
import { DividendsEngine } from './DividendsEngine';
import { FireProjection } from './FireProjection';
import { DataListTable } from './DataListTable';
import { buildTableSkeletonRows, SkeletonBlock, SkeletonCurrency } from './SkeletonPulse';
import { GainDisplay, todayGainEurFromChange } from './GainDisplay';
import { EurAmountInput } from './EurAmountField';
import { AssetNameCell } from './AssetNameCell';
import { displayTickerForAsset } from './assetLogo';
import { MarketIntelligence } from './MarketIntelligence';
import { fetchJson } from './apiFetch';
import {
  dispatchFeedReconnected,
  subscribeAcceleratedFeedRetry,
} from './feedReconnect';
import {
  applyClientSettingsToLocalStorage,
  collectClientSettingsFromLocalStorage,
} from './clientSettings';
import {
  PORTFOLIO_CHART_RANGE_OPTIONS,
  computePortfolioChartYDomain,
  computePortfolioChartXAxis,
  applyLiveTodayPortfolioPoint,
  buildPortfolio1DaySeries,
  buildPortfolio1DaySeriesFromTodayGain,
  computePortfolioRangeReturnFromHistory,
  filterPortfolioChartByRange,
  formatPortfolioChartYTick,
  formatPortfolioChartTooltipValue,
  isPortfolioChartRangeAvailable,
  pickDefaultPortfolioChartRange,
  portfolioChartPoint,
  portfolioChartTooltipLabel,
  portfolioChartRangeGainLabel,
  portfolioRangeShowsNetContributions,
  type PortfolioChartPoint,
  type PortfolioChartRangeId,
} from './portfolioChartRange';
import { View, dedupeHistoryByDate, normalizeCashAmountEur, parseCashInputEur, formatCashEurTwoDecimals, isAbortError } from './portfolioHelpers';
import { HistoryPointModal } from './HistoryPointModal';
import { LoadingScreen, AppHeader } from './AppHeader';
import { NavButton } from './AppNav';
import { AddAssetModal } from './AddAssetModal';


// --- Main App Logic ---

export default function App() {
  const [loading, setLoading] = useState(true);
  const [dataStoreHint, setDataStoreHint] = useState<string>('SQLite');
  const [dataStorePath, setDataStorePath] = useState<string | null>(null);
  const [dbPathCopied, setDbPathCopied] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [portfolioFlows, setPortfolioFlows] = useState<PortfolioFlow[]>([]);
  const [portfolioChartRange, setPortfolioChartRange] = useState<PortfolioChartRangeId | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [historyModal, setHistoryModal] = useState<
    null | { type: 'edit'; point: HistoryPoint } | { type: 'add' }
  >(null);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [marketPrices, setMarketPrices] = useState<Record<string, number>>({});
  const [initialQuotesPending, setInitialQuotesPending] = useState(false);
  const [quoteCurrencies, setQuoteCurrencies] = useState<Record<string, string>>({});
  const [marketChanges, setMarketChanges] = useState<Record<string, number>>({});
  const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({ 'EUR': 1 });
  const [apiStatus, setApiStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [feedDetail, setFeedDetail] = useState<string | null>(null);
  const [feedRetrying, setFeedRetrying] = useState(false);
  const [quotesRefreshEpoch, setQuotesRefreshEpoch] = useState(0);
  const apiStatusRef = useRef(apiStatus);
  apiStatusRef.current = apiStatus;
  const [portfolioLoadError, setPortfolioLoadError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<View>(View.DASHBOARD);
  const importBackupRef = useRef<HTMLInputElement>(null);
  /** Bumped after server-backed portfolio writes so a slow initial bootstrap refetch cannot clobber newer state. */
  const portfolioMutationEpochRef = useRef(0);
  /** After first SQLite UI-prefs hydrate (or failed fetch); enables debounced PUT without clobbering server before read. */
  const uiPrefsRemoteHydratedRef = useRef(false);
  /** Strict Mode / remount: incremented on effect cleanup so stale async cannot apply portfolio state. */
  const portfolioBootstrapGenerationRef = useRef(0);
  const statsTotalValueRef = useRef(0);
  /** One automatic history backfill per app session after portfolio valuation is ready. */
  const historyBackfillDoneRef = useRef(false);
  const [historyBackfillBusy, setHistoryBackfillBusy] = useState(false);
  const [historyBackfillNote, setHistoryBackfillNote] = useState<string | null>(null);
  const [cashEur, setCashEur] = useState(0);
  const [cashInput, setCashInput] = useState('');
  const [cashSaving, setCashSaving] = useState(false);

  const cashLineEur = useMemo(() => {
    const n = normalizeCashAmountEur(cashEur);
    if (n !== null) return n;
    const raw = Number(cashEur);
    return Number.isFinite(raw) && raw >= 0 ? raw : 0;
  }, [cashEur]);

  const normalizeCashInputOnBlur = useCallback(() => {
    setCashInput((prev) => {
      const p = parseCashInputEur(prev);
      if (p !== null) return formatCashEurTwoDecimals(p);
      return prev.trim() === '' ? formatCashEurTwoDecimals(0) : formatCashEurTwoDecimals(cashLineEur);
    });
  }, [cashLineEur]);

  const checkYahooFeed = useCallback(async (opts?: { manual?: boolean }) => {
    if (opts?.manual) {
      setFeedRetrying(true);
      setApiStatus('connecting');
      setFeedDetail(null);
    }
    try {
      const res = await fetch('/api/health/yahoo', { cache: 'no-store' });
      const text = await res.text();
      let data: { status?: string; error?: string; message?: string } = {};
      try {
        data = JSON.parse(text) as typeof data;
      } catch {
        setApiStatus('error');
        setFeedDetail(
          res.ok
            ? 'Invalid JSON from /api/health/yahoo'
            : `HTTP ${res.status} — use npm run dev so API routes are served (not vite alone).`
        );
        return;
      }
      if (res.ok && data.status === 'connected') {
        const wasConnected = apiStatusRef.current === 'connected';
        setApiStatus('connected');
        setFeedDetail(null);
        if (!wasConnected) {
          dispatchFeedReconnected();
          setQuotesRefreshEpoch((n) => n + 1);
        }
      } else {
        setApiStatus('error');
        const hint =
          data.error ||
          data.message ||
          (typeof data.status === 'string' ? data.status : null) ||
          `HTTP ${res.status}`;
        setFeedDetail(hint);
      }
    } catch (e) {
      setApiStatus('error');
      const msg = e instanceof Error ? e.message : String(e);
      setFeedDetail(
        /failed to fetch|networkerror|load failed/i.test(msg)
          ? `${msg} — is the app server running (npm run dev on the same origin)?`
          : msg
      );
    } finally {
      if (opts?.manual) setFeedRetrying(false);
    }
  }, []);

  const retryYahooFeed = useCallback(() => {
    void checkYahooFeed({ manual: true });
  }, [checkYahooFeed]);

  useEffect(() => {
    void checkYahooFeed();
    const ms = apiStatus === 'connected' ? 30_000 : 8_000;
    const interval = window.setInterval(() => void checkYahooFeed(), ms);
    return () => window.clearInterval(interval);
  }, [checkYahooFeed, apiStatus]);

  useEffect(() => {
    if (apiStatus === 'connected') return;
    return subscribeAcceleratedFeedRetry(() => void checkYahooFeed());
  }, [apiStatus, checkYahooFeed]);

  useEffect(() => {
    const gen = portfolioBootstrapGenerationRef.current;
    let cancelled = false;
    const ac = new AbortController();
    const { signal } = ac;
    const pf = { signal, cache: 'no-store' as RequestCache };
    (async () => {
      try {
        if (!cancelled) setPortfolioLoadError(null);
        const statusRes = await fetch('/api/portfolio/status', pf);
        if (!statusRes.ok) {
          const port = typeof window !== 'undefined' ? window.location.port : '';
          const hint =
            port === '3847'
              ? 'Restart BÖRS from the Start menu. If it persists, reinstall the latest desktop build.'
              : 'Run npm run dev and open http://localhost:3000';
          throw new Error(
            `Portfolio API unavailable (HTTP ${statusRes.status ?? 'unknown'}). ${hint}`
          );
        }
        const s = await statusRes.json();
        if (s.dbPath && typeof s.dbPath === 'string') {
            const short = s.dbPath.replace(/\\/g, '/').split('/').slice(-2).join('/');
            if (!cancelled) {
              setDataStoreHint(`SQLite (${short})`);
              setDataStorePath(s.dbPath);
            }
          }

        let snapshot = portfolioMutationEpochRef.current;
        let assetsData: Asset[] = [];
        let historyData: HistoryPoint[] = [];
        let flowsData: PortfolioFlow[] = [];
        let hydrated = false;

        for (let attempt = 0; attempt < 12 && !cancelled; attempt++) {
          const assetsRes = await fetch('/api/portfolio/assets', pf);
          const historyRes = await fetch('/api/portfolio/history', pf);
          const flowsRes = await fetch('/api/portfolio/flows', pf);
          if (!assetsRes.ok || !historyRes.ok) {
            throw new Error(
              `Could not load portfolio (assets HTTP ${assetsRes.status}, history HTTP ${historyRes.status})`
            );
          }
          assetsData = await fetchJson<Asset[]>(assetsRes);
          historyData = await fetchJson<HistoryPoint[]>(historyRes);
          flowsData = flowsRes.ok ? await fetchJson<PortfolioFlow[]>(flowsRes) : [];

          if (cancelled) return;
          if (portfolioMutationEpochRef.current === snapshot) {
            if (portfolioBootstrapGenerationRef.current !== gen) return;
            setAssets(assetsData);
            setHistory(dedupeHistoryByDate(historyData));
            setPortfolioFlows(flowsData);
            hydrated = true;
            break;
          }
          snapshot = portfolioMutationEpochRef.current;
        }
        if (!cancelled && !hydrated && portfolioBootstrapGenerationRef.current === gen) {
          setAssets(assetsData);
          setHistory(dedupeHistoryByDate(historyData));
          setPortfolioFlows(flowsData);
        }

        // One cash read after assets/history are stable — avoids interleaving GET /cash with
        // in-flight PUT /cash during the retry loop (which could reapply stale cash in state).
        // Re-check `cancelled` after await: Strict Mode can unmount while GET /cash is in flight;
        // the aborted fetch must not call setCashEur (and .catch must not swallow AbortError).
        if (!cancelled) {
          try {
            const r = await fetch('/api/portfolio/cash', pf);
            if (cancelled || portfolioBootstrapGenerationRef.current !== gen) return;
            const cashData = (r.ok ? await r.json() : { amountEur: 0 }) as { amountEur?: unknown };
            if (cancelled || portfolioBootstrapGenerationRef.current !== gen) return;
            const loadedCash = normalizeCashAmountEur(cashData.amountEur) ?? 0;
            setCashEur(Number(loadedCash));
            setCashInput(formatCashEurTwoDecimals(loadedCash));
          } catch (e) {
            if (isAbortError(e)) return;
            if (!cancelled && portfolioBootstrapGenerationRef.current === gen) {
              setCashEur(0);
              setCashInput(formatCashEurTwoDecimals(0));
            }
          }
          try {
            const csr = await fetch('/api/portfolio/client-settings', pf);
            if (cancelled || portfolioBootstrapGenerationRef.current !== gen) return;
            if (csr.ok) {
              const snap = (await csr.json()) as Record<string, unknown>;
              if (Object.keys(snap).length > 0) {
                applyClientSettingsToLocalStorage(snap);
              } else {
                const local = collectClientSettingsFromLocalStorage();
                if (Object.keys(local).length > 0) {
                  await fetch('/api/portfolio/client-settings', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(local),
                    ...pf,
                  });
                }
              }
            }
          } catch (e) {
            if (!isAbortError(e)) console.warn('Client settings sync failed:', e);
          }
        }
      } catch (e) {
        if (isAbortError(e)) return;
        console.error('Portfolio load failed:', e);
        const msg = e instanceof Error ? e.message : String(e);
        if (!cancelled) setPortfolioLoadError(msg);
      } finally {
        if (!cancelled && portfolioBootstrapGenerationRef.current === gen) {
          uiPrefsRemoteHydratedRef.current = true;
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
      portfolioBootstrapGenerationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (loading) return;
    const push = () => {
      const snap = collectClientSettingsFromLocalStorage();
      if (Object.keys(snap).length === 0) return;
      void fetch('/api/portfolio/client-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snap),
        cache: 'no-store',
      });
    };
    const id = window.setInterval(push, 45_000);
    const onVis = () => {
      if (document.visibilityState === 'hidden') push();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
      push();
    };
  }, [loading]);

  // Real-time market data: Integrated Yahoo Finance Backend
  useEffect(() => {
    const fetchRealData = async (isInitial: boolean) => {
      const symbols = assets.map(a => a.symbol);
      if (symbols.length === 0) {
        setInitialQuotesPending(false);
        return;
      }

      if (isInitial) setInitialQuotesPending(true);
      try {
        const res = await fetch('/api/quotes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbols, baseCurrency: 'EUR' })
        });
        const data = await res.json();
        const newPrices: Record<string, number> = {};
        const newQuoteCurrencies: Record<string, string> = {};
        const newChanges: Record<string, number> = {};
        if (data.quotes) {
          data.quotes.forEach((item: any) => {
            if (item.price) newPrices[item.symbol] = item.price;
            if (item.currency) newQuoteCurrencies[item.symbol] = String(item.currency).toUpperCase();
            if (item.changePercent !== undefined) newChanges[item.symbol] = item.changePercent;
          });
        }
        if (data.rates) setExchangeRates(data.rates);
        setMarketPrices(prev => ({ ...prev, ...newPrices }));
        setQuoteCurrencies(prev => ({ ...prev, ...newQuoteCurrencies }));
        setMarketChanges(prev => ({ ...prev, ...newChanges }));
      } catch (e) {
        console.warn("Backend feed connection limited. Using local simulation vectors.");
      } finally {
        if (isInitial) setInitialQuotesPending(false);
      }
    };

    void fetchRealData(true);
    const dataInterval = setInterval(() => void fetchRealData(false), 15000);

    return () => {
      clearInterval(dataInterval);
    };
  }, [assets, quotesRefreshEpoch]);

  const holdingsTableSkeletonRows = useMemo(
    () =>
      buildTableSkeletonRows(Math.min(Math.max(assets.length, 4), 10), [
        'asset',
        'shares',
        'price',
        'value',
        'cost',
        'gain',
        'today',
        'actions',
      ]),
    [assets.length]
  );

  const removeAsset = async (id: string) => {
    try {
      const res = await fetch(`/api/portfolio/assets/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      const list: Asset[] = await fetch('/api/portfolio/assets').then((r) => r.json());
      setAssets(list);
      await reloadFlows();
    } catch (err) {
      console.error('Failed to remove position:', err);
    }
  };

  const holdingsStats = assets.reduce((acc, asset) => {
    const livePrice = marketPrices[asset.symbol] || asset.averagePrice;
    const priceFx = holdingQuoteFxToEur(asset.symbol, asset.currency, quoteCurrencies, exchangeRates);
    const costFx = fxToEur(asset.currency, exchangeRates) || 1;

    const valInEur = asset.quantity * livePrice * priceFx;
    const costInEur = asset.quantity * asset.averagePrice * costFx;

    acc.totalValue += valInEur;
    acc.totalCost += costInEur;
    return acc;
  }, { totalValue: 0, totalCost: 0 });

  const cashSafe = cashLineEur;
  const stats: PortfolioStats = {
    totalValue: holdingsStats.totalValue + cashSafe,
    totalCost: holdingsStats.totalCost + cashSafe,
    totalGain: holdingsStats.totalValue - holdingsStats.totalCost,
    totalGainPercent:
      holdingsStats.totalCost > 0
        ? ((holdingsStats.totalValue - holdingsStats.totalCost) / holdingsStats.totalCost) * 100
        : 0,
    dailyChange: 0,
    dailyChangePercent: 0,
  };

  statsTotalValueRef.current = stats.totalValue;

  // Real daily change calculation based on history
  const yesterday = history.length > 1 ? history[history.length - 2] : null;
  if (yesterday) {
    stats.dailyChange = stats.totalValue - yesterday.value;
    stats.dailyChangePercent = (stats.dailyChange / yesterday.value) * 100;
  } else {
    stats.dailyChange = 0;
    stats.dailyChangePercent = 0;
  }

  const portfolioChartData = useMemo(() => {
    const todayStr = todayIsoDateHelsinki();
    const baseData = history
      .filter((p, i, self) => i === self.findIndex((t) => t.date === p.date))
      .map((p) => portfolioChartPoint(p.date, p.value));
    return applyLiveTodayPortfolioPoint(baseData, stats.totalValue, todayStr);
  }, [history, stats.totalValue]);

  const defaultPortfolioChartRange = useMemo(
    () => pickDefaultPortfolioChartRange(portfolioChartData),
    [portfolioChartData]
  );
  const activePortfolioChartRange = portfolioChartRange ?? defaultPortfolioChartRange;

  useEffect(() => {
    if (
      portfolioChartRange != null &&
      !isPortfolioChartRangeAvailable(portfolioChartData, portfolioChartRange)
    ) {
      setPortfolioChartRange(null);
    }
  }, [portfolioChartData, portfolioChartRange]);

  const portfolioChartVisibleData = useMemo(
    () => filterPortfolioChartByRange(portfolioChartData, activePortfolioChartRange),
    [portfolioChartData, activePortfolioChartRange]
  );

  const portfolioHistoryValues = useMemo(
    () => history.map((point) => ({ date: point.date, value: point.value })),
    [history]
  );

  const portfolioTodayGain = useMemo(() => {
    let todayGainEur = 0;
    let portfolioValueEur = cashLineEur;
    for (const asset of assets) {
      const livePrice = marketPrices[asset.symbol] || asset.averagePrice;
      const priceFx = holdingQuoteFxToEur(asset.symbol, asset.currency, quoteCurrencies, exchangeRates);
      const valInEur = asset.quantity * livePrice * priceFx;
      portfolioValueEur += valInEur;
      todayGainEur += todayGainEurFromChange(valInEur, marketChanges[asset.symbol] || 0);
    }
    const priorValueEur = portfolioValueEur - todayGainEur;
    const todayGainPercent = priorValueEur > 0 ? (todayGainEur / priorValueEur) * 100 : 0;
    return { todayGainEur, todayGainPercent };
  }, [assets, marketPrices, quoteCurrencies, exchangeRates, marketChanges, cashLineEur]);

  const portfolioChartDisplayData = useMemo(() => {
    if (activePortfolioChartRange === '1D') {
      const oneDaySeries = buildPortfolio1DaySeriesFromTodayGain(
        stats.totalValue,
        portfolioTodayGain.todayGainEur
      );
      if (oneDaySeries) return oneDaySeries;
      const historyFallback = buildPortfolio1DaySeries(portfolioHistoryValues, stats.totalValue);
      if (historyFallback) return historyFallback;
    }
    return portfolioChartVisibleData;
  }, [
    activePortfolioChartRange,
    portfolioHistoryValues,
    portfolioTodayGain.todayGainEur,
    stats.totalValue,
    portfolioChartVisibleData,
  ]);

  const portfolioChartYDomain = useMemo(
    () => computePortfolioChartYDomain(portfolioChartDisplayData, activePortfolioChartRange),
    [portfolioChartDisplayData, activePortfolioChartRange]
  );

  const portfolioChartXAxis = useMemo(
    () => computePortfolioChartXAxis(portfolioChartDisplayData, activePortfolioChartRange),
    [portfolioChartDisplayData, activePortfolioChartRange]
  );

  const portfolioRangeGain = useMemo(() => {
    if (activePortfolioChartRange === '1D') {
      return {
        gainEur: portfolioTodayGain.todayGainEur,
        gainPercent: portfolioTodayGain.todayGainPercent,
        netContributionsEur: 0,
        flowAdjusted: false,
        useLiveQuoteFallback: false,
      };
    }
    return computePortfolioRangeReturnFromHistory(
      portfolioHistoryValues,
      portfolioFlows,
      stats.totalValue,
      activePortfolioChartRange
    );
  }, [
    activePortfolioChartRange,
    portfolioTodayGain,
    portfolioHistoryValues,
    portfolioFlows,
    stats.totalValue,
  ]);

  const allocationSlices = useMemo(() => {
    const assetRows = assets.map((a) => {
      const val =
        a.quantity *
        (marketPrices[a.symbol] || a.averagePrice) *
        holdingQuoteFxToEur(a.symbol, a.currency, quoteCurrencies, exchangeRates);
      return {
        key: a.id || a.symbol,
        name: a.name,
        label: displayTickerForAsset(a),
        value: val,
      };
    });
    const c = cashLineEur;
    const assetSum = assetRows.reduce((s, r) => s + r.value, 0);
    const t = assetSum + c;
    if (t <= 0) return [];
    const rows = assetRows
      .map((r) => ({ ...r, percent: (r.value / t) * 100 }))
      .sort((a, b) => b.value - a.value);
    if (c > 0) {
      rows.push({ key: 'cash', name: 'Cash', label: 'Cash', value: c, percent: (c / t) * 100 });
      rows.sort((a, b) => b.value - a.value);
    }
    return rows;
  }, [assets, marketPrices, quoteCurrencies, exchangeRates, cashLineEur]);

  const [allocationPieBox, setAllocationPieBox] = useState({ width: 0, height: 0 });

  const handleAllocationPieResize = useCallback((width: number, height: number) => {
    const w = Math.round(width);
    const h = Math.round(height);
    setAllocationPieBox((prev) =>
      prev.width === w && prev.height === h ? prev : { width: w, height: h }
    );
  }, []);

  const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState(false);

  /** Wait for first quote fetch + FX rates before trusting EUR totals for SQLite history. */
  const portfolioValuationReady = useMemo(() => {
    if (loading) return false;
    if (assets.length === 0) return true;
    if (initialQuotesPending) return false;
    return portfolioFxReady(assets, quoteCurrencies, exchangeRates);
  }, [loading, assets, initialQuotesPending, quoteCurrencies, exchangeRates]);

  /** Quotes/FX not ready, or Yahoo health still connecting — skeleton feed-dependent EUR fields. */
  const feedMetricsLoading = useMemo(() => {
    if (assets.length === 0) return false;
    if (apiStatus === 'connecting') return true;
    return !portfolioValuationReady;
  }, [assets.length, apiStatus, portfolioValuationReady]);

  const allocationPieCalloutMap = useMemo(
    () =>
      buildAllocationPieCalloutMap(
        allocationPieBox.width,
        allocationPieBox.height,
        allocationSlices,
        { ...ALLOCATION_PIE_CHART_MARGIN }
      ),
    [allocationPieBox.width, allocationPieBox.height, allocationSlices]
  );

  /** Persist today's total once FX/quotes are ready; upsert if an early save was wrong. */
  useEffect(() => {
    if (!portfolioValuationReady) return;
    const today = todayIsoDateHelsinki();
    if (statsTotalValueRef.current <= 0) return;

    const t = window.setTimeout(async () => {
      const val = statsTotalValueRef.current;
      if (val <= 0) return;
      const storedToday = history.find((p) => p.date === today);
      if (storedToday && Math.abs(storedToday.value - val) <= 0.01) return;

      try {
        const res = await fetch('/api/portfolio/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: today, value: val }),
        });
        if (!res.ok) throw new Error('History write failed');
        const list: HistoryPoint[] = await fetch('/api/portfolio/history').then((r) => r.json());
        setHistory(dedupeHistoryByDate(list));
        portfolioMutationEpochRef.current += 1;
      } catch (e) {
        console.error('History sync failed', e);
      }
    }, 2000);
    return () => window.clearTimeout(t);
  }, [history, portfolioValuationReady, assets.length, cashLineEur]);

  const runHistoryBackfill = useCallback(async () => {
    setHistoryBackfillBusy(true);
    try {
      const res = await fetch('/api/portfolio/history/backfill', {
        method: 'POST',
        cache: 'no-store',
      });
      if (!res.ok) {
        setHistoryBackfillNote('Backfill failed — check Yahoo connection.');
        return;
      }
      const json = (await res.json()) as { filled?: HistoryPoint[] };
      const n = json.filled?.length ?? 0;
      if (n > 0) {
        const list = await fetch('/api/portfolio/history', { cache: 'no-store' }).then((r) =>
          r.json()
        );
        setHistory(dedupeHistoryByDate(list as HistoryPoint[]));
        portfolioMutationEpochRef.current += 1;
        setHistoryBackfillNote(
          `Filled ${n} missing day${n === 1 ? '' : 's'} from historical closes.`
        );
      } else {
        setHistoryBackfillNote(null);
      }
    } catch (e) {
      console.warn('History backfill failed', e);
      setHistoryBackfillNote('Backfill failed — check Yahoo connection.');
    } finally {
      setHistoryBackfillBusy(false);
    }
  }, []);

  /** Backfill missed history days once per session (gap-only, up to yesterday). */
  useEffect(() => {
    if (loading || !portfolioValuationReady) return;
    if (historyBackfillDoneRef.current) return;
    historyBackfillDoneRef.current = true;
    void runHistoryBackfill();
  }, [loading, portfolioValuationReady, runHistoryBackfill]);

  const historyPanelRows = useMemo((): HistoryPoint[] => {
    const todayStr = todayIsoDateHelsinki();
    const sorted = [...history].sort((a, b) => b.date.localeCompare(a.date));
    const hasStoredToday = sorted.some((p) => p.date === todayStr);
    if (!hasStoredToday && stats.totalValue > 0) {
      return [
        { id: '__bors_live_today__', date: todayStr, value: stats.totalValue } as HistoryPoint,
        ...sorted,
      ];
    }
    return sorted;
  }, [history, stats.totalValue]);

  const copyDbPath = async () => {
    const path = dataStorePath ?? dataStoreHint;
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
      setDbPathCopied(true);
      window.setTimeout(() => setDbPathCopied(false), 2000);
    } catch {
      setDbPathCopied(false);
    }
  };

  const exportPortfolioBackup = async () => {
    try {
      const snap = collectClientSettingsFromLocalStorage();
      if (Object.keys(snap).length > 0) {
        await fetch('/api/portfolio/client-settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(snap),
        });
      }
      const res = await fetch('/api/portfolio/export');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bors-backup-${todayIsoDateHelsinki()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Export failed', e);
    }
  };

  const importPortfolioBackup = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text) as {
        assets?: Asset[];
        history?: HistoryPoint[];
        flows?: PortfolioFlow[];
        cashEur?: number;
        uiPrefs?: unknown;
        clientSettings?: unknown;
      };
      const payload: {
        assets: Asset[];
        history: HistoryPoint[];
        flows?: PortfolioFlow[];
        cashEur?: number;
        uiPrefs?: unknown;
        clientSettings?: unknown;
      } = {
        assets: data.assets ?? [],
        history: data.history ?? [],
      };
      if (Array.isArray(data.flows)) {
        payload.flows = data.flows;
      }
      if (data.cashEur !== undefined && data.cashEur !== null && Number.isFinite(data.cashEur)) {
        payload.cashEur = Math.max(0, data.cashEur);
      }
      if (data.uiPrefs && typeof data.uiPrefs === 'object' && !Array.isArray(data.uiPrefs)) {
        payload.uiPrefs = data.uiPrefs;
      }
      if (data.clientSettings && typeof data.clientSettings === 'object' && !Array.isArray(data.clientSettings)) {
        payload.clientSettings = data.clientSettings;
      }
      await fetch('/api/portfolio/import?mode=merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const pf = { cache: 'no-store' as RequestCache };
      const [a, h, flowsRes, cashRes] = await Promise.all([
        fetch('/api/portfolio/assets', pf).then((r) => r.json()),
        fetch('/api/portfolio/history', pf).then((r) => r.json()),
        fetch('/api/portfolio/flows', pf).then((r) => (r.ok ? r.json() : [])),
        fetch('/api/portfolio/cash', pf).then((r) => (r.ok ? r.json() : { amountEur: 0 })),
      ]);
      setAssets(a);
      setHistory(dedupeHistoryByDate(h));
      setPortfolioFlows(flowsRes as PortfolioFlow[]);
      const cv = normalizeCashAmountEur(cashRes.amountEur) ?? 0;
      setCashEur(Number(cv));
      setCashInput(formatCashEurTwoDecimals(cv));
      const csRes = await fetch('/api/portfolio/client-settings', pf);
      if (csRes.ok) {
        applyClientSettingsToLocalStorage((await csRes.json()) as Record<string, unknown>);
      } else if (data.clientSettings && typeof data.clientSettings === 'object') {
        applyClientSettingsToLocalStorage(data.clientSettings as Record<string, unknown>);
      }
      portfolioMutationEpochRef.current += 1;
    } catch (e) {
      console.error('Import failed', e);
    } finally {
      if (importBackupRef.current) importBackupRef.current.value = '';
    }
  };

  const saveCash = async () => {
    const parsed = parseCashInputEur(String(cashInput));
    const amount = parsed != null && parsed >= 0 ? parsed : 0;
    const prevEur = cashEur;
    const prevInput = cashInput;
    setCashEur(Number(amount));
    setCashInput(formatCashEurTwoDecimals(amount));
    setCashSaving(true);
    try {
      const res = await fetch('/api/portfolio/cash', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountEur: amount }),
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('Save failed');
      const j = (await res.json()) as { amountEur?: unknown };
      const v = normalizeCashAmountEur(j.amountEur) ?? amount;
      setCashEur(Number(v));
      setCashInput(formatCashEurTwoDecimals(v));
      await reloadFlows();
    } catch (e) {
      console.error('Cash save failed', e);
      setCashEur(prevEur);
      setCashInput(prevInput);
    } finally {
      setCashSaving(false);
    }
  };

  const reloadFlows = async () => {
    const list: PortfolioFlow[] = await fetch('/api/portfolio/flows').then((r) => r.json());
    setPortfolioFlows(list);
    portfolioMutationEpochRef.current += 1;
  };

  const persistAsset = async (
    asset: Asset,
    isEdit: boolean,
    opts?: { flowAmountEur?: number }
  ) => {
    const flowBody =
      opts?.flowAmountEur != null && Number.isFinite(opts.flowAmountEur)
        ? { flowAmountEur: opts.flowAmountEur }
        : {};
    if (isEdit && asset.id) {
      const res = await fetch(`/api/portfolio/assets/${encodeURIComponent(asset.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...asset, ...flowBody }),
      });
      if (!res.ok) throw new Error('Update failed');
    } else {
      const res = await fetch('/api/portfolio/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...asset, ...flowBody }),
      });
      if (!res.ok) throw new Error('Create failed');
    }
    const list: Asset[] = await fetch('/api/portfolio/assets').then((r) => r.json());
    setAssets(list);
    await reloadFlows();
  };

  const reloadHistory = async () => {
    const list: HistoryPoint[] = await fetch('/api/portfolio/history').then((r) => r.json());
    setHistory(dedupeHistoryByDate(list));
    portfolioMutationEpochRef.current += 1;
  };

  if (loading) return <LoadingScreen />;

  return (
    <div className="flex flex-col h-screen bg-bg overflow-hidden font-sans selection:bg-accent/30">
      <AppHeader
        apiStatus={apiStatus}
        feedDetail={feedDetail}
        onRetryFeed={retryYahooFeed}
        feedRetrying={feedRetrying || apiStatus === 'connecting'}
      />
      {(portfolioLoadError) && (
        <div
          className="mx-4 mt-2 px-4 py-3 rounded-xl border text-xs leading-relaxed border-red-500/40 bg-red-500/10 text-red-200"
        >
          <p>
            <span className="font-bold uppercase tracking-widest text-[10px]">Portfolio not loaded — </span>
            {portfolioLoadError}
          </p>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-20 xl:w-[5.5rem] min-w-[80px] border-r border-border bg-card flex flex-col items-center xl:items-stretch py-8 gap-6 xl:gap-2 xl:px-1.5 z-10 shadow-2xl shrink-0">
          <NavButton 
            active={activeView === View.DASHBOARD} 
            onClick={() => setActiveView(View.DASHBOARD)} 
            icon={<LayoutDashboard className="w-5 h-5" />} 
            label="Dashboard" 
          />
          <NavButton 
            active={activeView === View.DIVIDENDS} 
            onClick={() => setActiveView(View.DIVIDENDS)} 
            icon={<Coins className="w-5 h-5" />} 
            label="Dividend engine" 
          />
          <NavButton 
            active={activeView === View.FIRE} 
            onClick={() => setActiveView(View.FIRE)} 
            icon={<Flame className="w-5 h-5" />} 
            label="FIRE" 
          />
          <NavButton 
            active={activeView === View.MARKET_RECAP} 
            onClick={() => setActiveView(View.MARKET_RECAP)} 
            icon={<Activity className="w-5 h-5" />} 
            label="Market" 
          />
          <NavButton 
            active={activeView === View.OPTIONS} 
            onClick={() => setActiveView(View.OPTIONS)} 
            icon={<Settings className="w-5 h-5" />} 
            label="Options" 
          />
        </aside>

        <main className="flex-1 overflow-y-auto p-6 technical-grid">
          <AnimatePresence mode="wait">
            {activeView === View.DASHBOARD && (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-[1600px] mx-auto w-full dashboard-view space-y-4 pb-8"
              >
                <h2 className="page-title">Portfolio</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 lg:grid-rows-[auto_auto] gap-4">
                {/* Main Portfolio Performance */}
                <div className="lg:col-span-2 lg:row-span-2 glass-panel p-8 flex flex-col group h-full">
                  <div className="flex items-center justify-between mb-2 gap-2">
                    <h3 className="card-title mb-0">Portfolio Capital</h3>
                    <button
                      type="button"
                      title="Portfolio history"
                      onClick={() => setIsHistoryPanelOpen(!isHistoryPanelOpen)}
                      className={`shrink-0 p-1.5 rounded-lg transition-all ${isHistoryPanelOpen ? 'bg-accent text-white shadow-lg shadow-accent/20' : 'bg-white/5 text-text-s hover:bg-white/10'}`}
                    >
                      <History className="w-4 h-4" />
                    </button>
                  </div>

                  <AnimatePresence>
                    {isHistoryPanelOpen && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mb-4 overflow-hidden"
                      >
                        <div className="p-4 bg-white/5 rounded-xl border border-border/50 space-y-3">
                          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                            <div className="space-y-1.5">
                              <p className="text-[9px] text-text-s font-bold uppercase tracking-widest leading-relaxed">
                                Daily total value (EUR) in SQLite. Edit a row or add a past date you missed.
                              </p>
                              <p className="text-[8px] text-text-s/70 leading-relaxed max-w-prose">
                                Missing days are filled automatically when you open BÖRS (historical closes).
                                Uses current holdings — approximate if you traded while away.
                              </p>
                              {historyBackfillNote ? (
                                <p
                                  className={`text-[8px] font-bold uppercase tracking-widest ${
                                    historyBackfillNote.startsWith('Filled')
                                      ? 'text-green/90'
                                      : 'text-red/80'
                                  }`}
                                >
                                  {historyBackfillNote}
                                </p>
                              ) : null}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 shrink-0 self-start">
                              <button
                                type="button"
                                onClick={() => void runHistoryBackfill()}
                                disabled={historyBackfillBusy || apiStatus !== 'connected'}
                                title={
                                  apiStatus !== 'connected'
                                    ? 'Connect to Yahoo to backfill history'
                                    : 'Fill missing days from historical closes'
                                }
                                className="px-3 py-2 bg-white/5 text-text-s rounded-lg font-black uppercase tracking-widest text-[8px] border border-border/50 hover:bg-white/10 hover:text-text-p transition-all flex items-center justify-center gap-1.5 disabled:opacity-40"
                              >
                                <RefreshCcw
                                  className={`w-3.5 h-3.5 ${historyBackfillBusy ? 'animate-spin' : ''}`}
                                />
                                Backfill now
                              </button>
                              <button
                                type="button"
                                onClick={() => setHistoryModal({ type: 'add' })}
                                className="px-3 py-2 bg-accent text-white rounded-lg font-black uppercase tracking-widest text-[8px] shadow-lg shadow-accent/20 flex items-center justify-center gap-1.5"
                              >
                                <Plus className="w-3.5 h-3.5" /> Add entry
                              </button>
                            </div>
                          </div>
                          <div className="overflow-x-auto overflow-y-auto max-h-[min(40vh,280px)] rounded-lg border border-border/40">
                            <table className="w-full text-left text-xs">
                              <thead className="sticky top-0 z-[1] bg-[#121214]/95 backdrop-blur-sm">
                                <tr className="text-[8px] font-bold text-text-s uppercase tracking-widest border-b border-border/60">
                                  <th className="px-3 py-2 text-left">Date</th>
                                  <th className="px-3 py-2 text-left">Total (EUR)</th>
                                  <th className="px-3 py-2 text-right w-16">Edit</th>
                                </tr>
                              </thead>
                              <tbody>
                                {historyPanelRows.map((row) => (
                                    <tr
                                      key={row.id ?? row.date}
                                      className="border-b border-border/30 hover:bg-white/[0.03]"
                                    >
                                      <td className="px-3 py-2 font-mono text-text-p tabular-nums">
                                        {formatDateEn(row.date)}
                                        {row.id === '__bors_live_today__' ? (
                                          <span className="ml-2 text-[8px] uppercase text-text-s/45 font-bold tracking-widest">
                                            (live)
                                          </span>
                                        ) : null}
                                      </td>
                                      <td className="px-3 py-2 font-mono font-bold text-text-p tabular-nums">
                                        {row.id === '__bors_live_today__' && feedMetricsLoading ? (
                                          <SkeletonCurrency className="h-4 w-24" />
                                        ) : (
                                          formatCurrency(row.value, 'EUR')
                                        )}
                                      </td>
                                      <td className="px-3 py-2 text-right">
                                        <button
                                          type="button"
                                          onClick={() => setHistoryModal({ type: 'edit', point: row })}
                                          className="p-1.5 rounded-md text-text-s hover:text-accent hover:bg-white/5 transition-colors inline-flex"
                                          title="Edit"
                                        >
                                          <Pencil className="w-3.5 h-3.5" />
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                {historyPanelRows.length === 0 && (
                                  <tr>
                                    <td
                                      colSpan={3}
                                      className="px-3 py-8 text-center text-text-s text-[10px] uppercase tracking-widest"
                                    >
                                      No rows yet. They record automatically with a positive total, or use Add entry.
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div
                    className="stat-value text-6xl font-black tracking-tighter mb-4 flex items-baseline gap-2 tabular-nums"
                    aria-busy={feedMetricsLoading}
                  >
                    {feedMetricsLoading ? (
                      <SkeletonCurrency className="h-14 w-52" />
                    ) : (
                      formatCurrency(stats.totalValue, 'EUR')
                    )}
                  </div>
                  <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
                    <div>
                      <p
                        className="micro-label mb-1"
                        title={
                          activePortfolioChartRange === '1D'
                            ? "Sum of each holding's today gain from live quotes; cash excluded."
                            : 'Return from market movement using daily history; purchases and cash deposits are excluded.'
                        }
                      >
                        {portfolioChartRangeGainLabel(activePortfolioChartRange)}
                      </p>
                      <GainDisplay
                        amountEur={portfolioRangeGain.gainEur}
                        percent={portfolioRangeGain.gainPercent}
                        loading={feedMetricsLoading}
                      />
                      {portfolioRangeGain.flowAdjusted &&
                      portfolioRangeShowsNetContributions(activePortfolioChartRange) &&
                      portfolioRangeGain.netContributionsEur > 0 ? (
                        <p className="text-[10px] text-text-s/70 mt-1">
                          Net contributions {formatCurrency(portfolioRangeGain.netContributionsEur, 'EUR')}
                        </p>
                      ) : null}
                    </div>
                    <div>
                      <p className="micro-label mb-1" title="Holdings only vs average cost (EUR); cash excluded">
                        Unrealized gain
                      </p>
                      <GainDisplay
                        amountEur={stats.totalGain}
                        percent={stats.totalGainPercent}
                        loading={feedMetricsLoading}
                      />
                    </div>
                    <div className="border-l border-border/30 pl-6 shrink-0">
                      <p className="micro-label mb-1">Cash (EUR)</p>
                      <div className="flex items-center gap-2">
                        <EurAmountInput
                          compact
                          wrapperClassName="w-[6.75rem]"
                          placeholder="0.00"
                          value={cashInput}
                          onChange={(e) => setCashInput(e.target.value)}
                          onBlur={() => normalizeCashInputOnBlur()}
                        />
                        <button
                          type="button"
                          disabled={cashSaving}
                          onClick={() => void saveCash()}
                          className="btn-secondary min-w-[3.5rem] !h-8 !py-0 justify-center text-[10px] shrink-0 disabled:opacity-50"
                        >
                          {cashSaving ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="mt-8 space-y-3 flex-1 flex flex-col min-h-[220px]">
                    <div
                      className="flex flex-wrap items-center gap-x-1 gap-y-1 border-b border-border/40 pb-1"
                      role="tablist"
                      aria-label="Portfolio chart time range"
                    >
                      {PORTFOLIO_CHART_RANGE_OPTIONS.map(({ id, label }) => {
                        const available = isPortfolioChartRangeAvailable(portfolioChartData, id);
                        const active = activePortfolioChartRange === id;
                        return (
                          <button
                            key={id}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            disabled={!available}
                            title={
                              available
                                ? `Show ${label} range`
                                : 'Not enough history for this range'
                            }
                            onClick={() => setPortfolioChartRange(id)}
                            className={`relative px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                              active ? 'text-accent' : 'text-text-s hover:text-text-p'
                            }`}
                          >
                            {label}
                            {active && (
                              <span
                                className="absolute inset-x-1 -bottom-1 h-0.5 rounded-full bg-accent"
                                aria-hidden
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex-1 min-h-[180px] relative">
                      {portfolioChartData.length < 2 && (
                        <p className="absolute inset-0 flex items-center justify-center text-center text-[11px] text-text-s px-6 z-[2] pointer-events-none">
                          History builds as daily totals are recorded. Open the history icon above to add past dates.
                        </p>
                      )}
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart
                          key={activePortfolioChartRange}
                          data={portfolioChartDisplayData}
                          margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
                        >
                          <defs>
                            <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="var(--color-accent)" stopOpacity={0.2} />
                              <stop offset="95%" stopColor="var(--color-accent)" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="rgba(255,255,255,0.06)"
                            vertical={false}
                          />
                          <XAxis
                            type="number"
                            dataKey="chartTime"
                            domain={['dataMin', 'dataMax']}
                            scale="linear"
                            ticks={portfolioChartXAxis.ticks}
                            tickFormatter={(chartTime) =>
                              portfolioChartXAxis.formatTick(Number(chartTime))
                            }
                            tick={{ fill: 'var(--color-text-s)', fontSize: 10, fontWeight: 600 }}
                            tickMargin={8}
                            axisLine={{ stroke: 'var(--color-border)', strokeOpacity: 0.4 }}
                            tickLine={{ stroke: 'var(--color-border)', strokeOpacity: 0.25 }}
                          />
                          <YAxis
                            domain={portfolioChartYDomain}
                            allowDataOverflow={false}
                            tickCount={5}
                            tick={{ fill: 'var(--color-text-s)', fontSize: 10, opacity: 0.7 }}
                            tickFormatter={(v) => formatPortfolioChartYTick(Number(v))}
                            width={80}
                            axisLine={false}
                            tickLine={false}
                          />
                          <Tooltip
                            formatter={(value: number) => [
                              formatPortfolioChartTooltipValue(Number(value)),
                              '',
                            ]}
                            labelFormatter={(_, payload) => {
                              const row = payload?.[0]?.payload as PortfolioChartPoint | undefined;
                              return row ? portfolioChartTooltipLabel(row) : '—';
                            }}
                            separator=""
                            labelStyle={{
                              color: 'var(--color-text-s)',
                              fontSize: '11px',
                              marginBottom: '4px',
                              textTransform: 'uppercase',
                              fontWeight: 'bold',
                              opacity: 0.5,
                            }}
                            contentStyle={{
                              backgroundColor: 'var(--color-card)',
                              border: '1px solid var(--color-border)',
                              borderRadius: '12px',
                              padding: '12px',
                            }}
                            itemStyle={{
                              color: 'var(--color-accent)',
                              fontWeight: '900',
                              fontSize: '14px',
                            }}
                            cursor={{
                              stroke: 'var(--color-accent)',
                              strokeWidth: 1,
                              strokeDasharray: '4 4',
                            }}
                          />
                          <Area
                            type="linear"
                            dataKey="value"
                            stroke="var(--color-accent)"
                            fillOpacity={1}
                            fill="url(#colorValue)"
                            strokeWidth={3}
                            animationDuration={1000}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>

                <div className="lg:col-span-2 lg:row-span-2 flex flex-col gap-4 min-h-0">
                  <div className="glass-panel !overflow-visible p-6 flex flex-col flex-1 min-h-[480px] lg:min-h-[520px]">
                    <div className="mb-3">
                      <h3 className="card-title mb-0">Allocation</h3>
                    </div>
                    <div
                      className="allocation-pie-glow relative flex-1 w-full min-h-0 min-w-0"
                      aria-busy={feedMetricsLoading}
                    >
                      {feedMetricsLoading ? (
                        <div className="absolute inset-0 flex items-center justify-center z-[1]">
                          <SkeletonBlock className="h-44 w-44 rounded-full" />
                        </div>
                      ) : null}
                      <ResponsiveContainer
                        width="100%"
                        height="100%"
                        className={feedMetricsLoading ? 'opacity-0 pointer-events-none' : undefined}
                        onResize={handleAllocationPieResize}
                      >
                        <PieChart margin={{ ...ALLOCATION_PIE_CHART_MARGIN }}>
                          <AllocationPieDefs />
                          <Pie
                            key={
                              allocationSlices.length > 0
                                ? [...new Set(allocationSlices.map((r) => r.key))].sort().join('|')
                                : 'empty-allocation'
                            }
                            data={
                              allocationSlices.length > 0
                                ? allocationSlices
                                : [{ key: 'empty', name: 'No holdings', value: 1, percent: 0 }]
                            }
                            cx="50%"
                            cy="50%"
                            innerRadius="0%"
                            outerRadius="75%"
                            dataKey="value"
                            nameKey="name"
                            startAngle={90}
                            endAngle={-270}
                            paddingAngle={ALLOCATION_PIE_PADDING_ANGLE}
                            stroke="rgba(15, 23, 42, 0.85)"
                            strokeWidth={1.5}
                            isAnimationActive={false}
                            label={false}
                            labelLine={false}
                          >
                            {allocationSlices.length > 0 ? (
                              allocationSlices.map((row, index) => {
                                const chrome = allocationPieSliceChrome(
                                  row.key,
                                  index,
                                  allocationSlices.length
                                );
                                return (
                                  <Cell
                                    key={row.key}
                                    fill={`url(#${chrome.gradientId})`}
                                    stroke={chrome.stroke}
                                    strokeWidth={2}
                                  />
                                );
                              })
                            ) : (
                              <Cell fill="rgba(39, 39, 42, 0.6)" stroke="rgba(59, 130, 246, 0.2)" />
                            )}
                          </Pie>
                          <Tooltip
                            cursor={{ fill: 'rgba(255,255,255,0.06)' }}
                            content={({ active, payload }) => {
                              if (!active || !payload?.length) return null;
                              const row = payload[0].payload as {
                                name: string;
                                value: number;
                              };
                              return (
                                <div
                                  className="rounded-xl border border-border px-3 py-2.5 shadow-xl max-w-[min(100vw-24px,280px)]"
                                  style={{ backgroundColor: 'var(--color-card)' }}
                                >
                                  <div className="text-sm font-semibold text-text-p leading-snug">{row.name}</div>
                                  <div className="text-xs font-mono font-bold text-accent mt-1.5 tabular-nums">
                                    {formatCurrency(row.value, 'EUR')}
                                  </div>
                                </div>
                              );
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                      {!feedMetricsLoading &&
                      allocationSlices.length > 0 &&
                      allocationPieCalloutMap.size > 0 &&
                      allocationPieBox.width > 0 &&
                      allocationPieBox.height > 0 ? (
                        <svg
                          className="absolute left-0 top-0 z-[2] pointer-events-none"
                          width={allocationPieBox.width}
                          height={allocationPieBox.height}
                          style={{ overflow: 'visible' }}
                          aria-hidden
                        >
                          <AllocationPieCalloutLayer layout={allocationPieCalloutMap} />
                        </svg>
                      ) : null}
                    </div>
                  </div>
                </div>


                {/* Holdings Table Section */}
                <div className="lg:col-span-4 glass-panel p-8">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="card-title mb-0">Holdings</h3>
                    <button 
                      onClick={() => {
                        setEditingAsset(null);
                        setIsModalOpen(true);
                      }}
                      className="btn-primary text-[10px] py-1.5 px-3"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Asset
                    </button>
                  </div>

                  <DataListTable
                    minWidth={1120}
                    columns={[
                      { key: 'asset', label: 'Asset' },
                      { key: 'shares', label: 'Shares', align: 'right' },
                      { key: 'price', label: 'Share price', align: 'right' },
                      { key: 'value', label: 'Total value', align: 'right' },
                      { key: 'cost', label: 'Cost basis', align: 'right' },
                      { key: 'gain', label: 'Unrealized gain', align: 'right' },
                      { key: 'today', label: 'Today Gain', align: 'right' },
                      {
                        key: 'actions',
                        label: '',
                        align: 'right',
                        headerClassName: 'w-16',
                        cellClassName: 'px-3 py-2 text-right',
                      },
                    ]}
                    rows={
                      feedMetricsLoading
                        ? holdingsTableSkeletonRows
                        : [...assets]
                      .sort((a, b) => {
                        const valA =
                          a.quantity *
                          (marketPrices[a.symbol] || a.averagePrice) *
                          holdingQuoteFxToEur(a.symbol, a.currency, quoteCurrencies, exchangeRates);
                        const valB =
                          b.quantity *
                          (marketPrices[b.symbol] || b.averagePrice) *
                          holdingQuoteFxToEur(b.symbol, b.currency, quoteCurrencies, exchangeRates);
                        return valB - valA;
                      })
                      .map((item) => {
                        const price = marketPrices[item.symbol] || item.averagePrice;
                        const priceFx = holdingQuoteFxToEur(
                          item.symbol,
                          item.currency,
                          quoteCurrencies,
                          exchangeRates
                        );
                        const costFx = fxToEur(item.currency, exchangeRates) || 1;
                        const priceInEur = price * priceFx;
                        const costBasisInEur = item.quantity * item.averagePrice * costFx;
                        const totalValue = item.quantity * priceInEur;
                        const totalGainInEur = totalValue - costBasisInEur;
                        const totalGainPercent =
                          costBasisInEur > 0 ? (totalGainInEur / costBasisInEur) * 100 : 0;
                        const change = marketChanges[item.symbol] || 0;
                        const todayGainEur = todayGainEurFromChange(totalValue, change);
                        const ticker = displayTickerForAsset(item);

                        return {
                          asset: (
                            <AssetNameCell
                              name={item.name}
                              ticker={ticker}
                              yahooSymbol={item.symbol}
                              type={item.type}
                            />
                          ),
                          shares: formatShares(item.quantity),
                          price: formatCurrency(priceInEur, 'EUR'),
                          value: formatCurrency(totalValue, 'EUR'),
                          cost: (
                            <span className="text-text-s/50">{formatCurrency(costBasisInEur, 'EUR')}</span>
                          ),
                          gain: (
                            <GainDisplay amountEur={totalGainInEur} percent={totalGainPercent} />
                          ),
                          today: <GainDisplay amountEur={todayGainEur} percent={change} />,
                          actions: (
                            <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingAsset(item);
                                  setIsModalOpen(true);
                                }}
                                className="p-1.5 text-text-s hover:text-accent hover:bg-accent/10 rounded-lg transition-all shrink-0"
                                aria-label="Edit holding"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => removeAsset(item.id!)}
                                className="p-1.5 text-text-s hover:text-red hover:bg-red/10 rounded-lg transition-all shrink-0"
                                aria-label="Remove holding"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ),
                        };
                      })
                    }
                    emptyState={
                      <div className="flex flex-col items-center gap-4 opacity-50 py-8">
                        <Wallet className="w-12 h-12" />
                        <p className="text-[10px] uppercase font-bold tracking-widest">No Holdings Registered</p>
                      </div>
                    }
                  />
                </div>
                </div>
              </motion.div>
            )}

            {activeView === View.DIVIDENDS && (
              <motion.div
                key="dividends"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-[1400px] mx-auto w-full dashboard-view pb-8"
              >
                <DividendsEngine assets={assets} marketPrices={marketPrices} exchangeRates={exchangeRates} />
              </motion.div>
            )}

            {activeView === View.FIRE && (
              <motion.div
                key="fire"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-[1400px] mx-auto w-full dashboard-view pb-8"
              >
                <FireProjection
                  currentPortfolioEur={stats.totalValue}
                  portfolioMetricsLoading={feedMetricsLoading}
                />
              </motion.div>
            )}

            {activeView === View.MARKET_RECAP && (
              <motion.div
                key="market-recap"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-[1400px] mx-auto w-full dashboard-view pb-8"
              >
                <MarketIntelligence />
              </motion.div>
            )}

            {activeView === View.OPTIONS && (
              <motion.div
                key="options"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-4xl xl:max-w-5xl mx-auto w-full pb-8"
              >
                <div className="panel">
                  <h2 className="page-title mb-1">Options</h2>
                  <p className="page-subtitle mb-6">Integrations, data & backup</p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="p-5 rounded-xl border border-border/60 bg-white/[0.02]">
                      <h3 className="text-[10px] font-bold text-text-s uppercase tracking-widest mb-2">
                        Portfolio data (SQLite)
                      </h3>
                      {(dataStorePath ?? dataStoreHint) && (
                        <div className="space-y-2">
                          <p className="text-[10px] font-mono text-accent/90 break-all bg-bg/50 rounded-lg px-3 py-2 border border-border/50">
                            {dataStorePath ?? dataStoreHint}
                          </p>
                          <button
                            type="button"
                            onClick={() => void copyDbPath()}
                            disabled={!(dataStorePath ?? dataStoreHint)}
                            className="btn-secondary w-full justify-center py-2.5"
                          >
                            <Copy className="w-3.5 h-3.5" />
                            {dbPathCopied ? 'Copied' : 'Copy path'}
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="p-5 rounded-xl border border-border/60 bg-white/[0.02]">
                      <h3 className="text-[10px] font-bold text-text-s uppercase tracking-widest mb-2">
                        Portfolio backup
                      </h3>
                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={() => exportPortfolioBackup()}
                          className="btn-primary w-full justify-center py-2.5"
                        >
                          <Download className="w-4 h-4" /> Export JSON
                        </button>
                        <label className="btn-secondary w-full justify-center py-2.5 cursor-pointer">
                          <Upload className="w-4 h-4" /> Import JSON
                          <input
                            ref={importBackupRef}
                            type="file"
                            accept="application/json,.json"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) importPortfolioBackup(f);
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <AddAssetModal 
            key="asset-modal"
            onClose={() => {
              setIsModalOpen(false);
              setEditingAsset(null);
            }} 
            editAsset={editingAsset || undefined}
            onPersist={persistAsset}
            exchangeRates={exchangeRates}
          />
        )}
        {historyModal && (
          <HistoryPointModal
            key="history-modal"
            modal={historyModal}
            onClose={() => setHistoryModal(null)}
            onSaved={async () => {
              await reloadHistory();
              setHistoryModal(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

