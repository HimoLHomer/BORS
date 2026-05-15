import React, { useState, useEffect, useRef, useMemo, useLayoutEffect, useCallback } from 'react';
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
  MoreVertical,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Asset, PortfolioStats, HistoryPoint } from './types';
import {
  buildAllocationPieCalloutMap,
  renderAllocationPieCalloutFromLayout,
  ALLOCATION_PIE_CHART_MARGIN,
  allocationPieMarginsWithNudge,
  loadAllocationLabelOffsets,
  saveAllocationLabelOffsets,
  loadAllocationChromePrefs,
  saveAllocationChromePrefs,
  type AllocationLabelOffset,
  type AllocationChromePrefs,
} from './allocationPieLabels';
import { AllocationPieDefs, allocationPieSliceChrome } from './allocationPieChrome';
import { 
  AreaChart, Area, XAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Treemap,
} from 'recharts';
import { GoogleGenAI } from "@google/genai";
import Markdown from 'react-markdown';
import { formatCurrency, fxToEur, holdingQuoteFxToEur } from './formatCurrency';
import { formatDateFi, formatShortMonthDayFi, formatTimeFi, todayIsoDateHelsinki } from './formatDate';
import { DividendsEngine } from './DividendsEngine';

// --- Types & Enums ---

enum View {
  DASHBOARD = 'DASHBOARD',
  DIVIDENDS = 'DIVIDENDS',
  FIRE = 'FIRE',
  MARKET_RECAP = 'MARKET_RECAP',
  OPTIONS = 'OPTIONS'
}

function dedupeHistoryByDate(points: HistoryPoint[]): HistoryPoint[] {
  const seen = new Set<string>();
  return [...points]
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter((p) => {
      if (seen.has(p.date)) return false;
      seen.add(p.date);
      return true;
    });
}

function normalizeCashAmountEur(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, raw);
  if (typeof raw === 'string') {
    const n = parseFloat(raw.replace(',', '.'));
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

/** Parses the cash text field (comma or dot decimals). */
function parseCashInputEur(raw: string): number | null {
  const t = raw.trim().replace(',', '.');
  if (t === '') return null;
  const n = parseFloat(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function formatCashEurTwoDecimals(n: number): string {
  return n.toFixed(2);
}

function isAbortError(e: unknown): boolean {
  return (
    (e instanceof DOMException && e.name === 'AbortError') ||
    (e instanceof Error && e.name === 'AbortError')
  );
}

function coerceRemoteLabelOffsets(raw: unknown): Record<string, AllocationLabelOffset> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, AllocationLabelOffset> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!k.trim() || !v || typeof v !== 'object') continue;
    const o = v as { dx?: unknown; dy?: unknown };
    const dx = typeof o.dx === 'number' && Number.isFinite(o.dx) ? o.dx : 0;
    const dy = typeof o.dy === 'number' && Number.isFinite(o.dy) ? o.dy : 0;
    out[k] = { dx, dy };
  }
  return Object.keys(out).length > 0 ? out : null;
}

function mergeAllocationChromeFromRemote(
  raw: unknown,
  prev: AllocationChromePrefs
): AllocationChromePrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return prev;
  const o = raw as Record<string, unknown>;
  const clamp = (v: unknown, min: number, max: number, def: number) => {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, n));
  };
  return {
    pieNudgeX: clamp(o.pieNudgeX, -120, 120, prev.pieNudgeX),
    pieNudgeY: clamp(o.pieNudgeY, -120, 120, prev.pieNudgeY),
    labelFontPx: clamp(o.labelFontPx, 8, 18, prev.labelFontPx),
  };
}

const HistoryPointModal = ({
  modal,
  onClose,
  onSaved,
}: {
  modal: { type: 'edit'; point: HistoryPoint } | { type: 'add' };
  onClose: () => void;
  onSaved: () => Promise<void>;
}) => {
  const [dateStr, setDateStr] = useState(
    modal.type === 'edit' ? modal.point.date : todayIsoDateHelsinki()
  );
  const [valueStr, setValueStr] = useState(
    modal.type === 'edit' ? String(modal.point.value) : ''
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    const val = parseFloat(valueStr.replace(',', '.'));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      setErr('Use date format YYYY-MM-DD');
      return;
    }
    if (!Number.isFinite(val)) {
      setErr('Enter a valid number');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/portfolio/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: dateStr, value: val }),
      });
      if (!res.ok) throw new Error('Save failed');
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (modal.type !== 'edit') return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/portfolio/history/${encodeURIComponent(modal.point.date)}`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 204) throw new Error('Delete failed');
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to delete');
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-bg/95 backdrop-blur-xl z-[60] flex items-center justify-center p-4"
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0, y: 12 }}
        className="glass-panel p-8 w-full max-w-md border-border bg-card/80 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-black uppercase tracking-tight text-text-p">
            {modal.type === 'edit' ? 'Edit history row' : 'Add history row'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-text-s hover:text-text-p hover:bg-white/5"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-[9px] font-bold text-text-s uppercase tracking-widest block mb-2">Date</label>
            <input
              type="date"
              className="w-full bg-bg/50 border border-border rounded-xl px-4 py-3 text-text-p font-mono text-sm focus:outline-none focus:border-accent/50"
              value={dateStr}
              disabled={modal.type === 'edit'}
              onChange={(e) => setDateStr(e.target.value)}
            />
            {modal.type === 'edit' && (
              <p className="text-[9px] text-text-s mt-1.5 opacity-70">Date cannot be changed; delete and re-add if needed.</p>
            )}
          </div>
          <div>
            <label className="text-[9px] font-bold text-text-s uppercase tracking-widest block mb-2">
              Total portfolio value (EUR)
            </label>
            <input
              type="text"
              inputMode="decimal"
              className="w-full bg-bg/50 border border-border rounded-xl px-4 py-3 text-text-p font-mono text-sm focus:outline-none focus:border-accent/50"
              placeholder="e.g. 125000.50"
              value={valueStr}
              onChange={(e) => setValueStr(e.target.value)}
            />
          </div>
          {err && (
            <p className="text-[10px] text-red font-bold uppercase tracking-widest">{err}</p>
          )}
        </div>

        <div className="flex flex-wrap gap-3 mt-8">
          <button
            type="button"
            disabled={busy}
            onClick={save}
            className="flex-1 min-w-[120px] py-3 bg-accent text-white rounded-xl font-black uppercase tracking-widest text-[10px] disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          {modal.type === 'edit' && modal.point.id !== '__bors_live_today__' && (
            <button
              type="button"
              disabled={busy}
              onClick={remove}
              className="px-4 py-3 rounded-xl border border-red/40 text-red font-black uppercase tracking-widest text-[10px] hover:bg-red/10 disabled:opacity-50"
            >
              Delete
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};

// --- Components ---

const LoadingScreen = () => (
  <div className="fixed inset-0 bg-bg flex items-center justify-center z-50">
    <div className="flex flex-col items-center gap-4">
      <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin"></div>
      <div className="font-black text-2xl tracking-tighter text-text-p uppercase">BÖRS</div>
      <p className="text-[10px] text-text-s font-mono uppercase tracking-widest animate-pulse">Initializing Market Feed</p>
    </div>
  </div>
);

const Header = ({
  apiStatus,
  feedDetail,
}: {
  apiStatus: 'connecting' | 'connected' | 'error';
  feedDetail: string | null;
}) => (
  <header className="border-b border-border bg-bg px-6 py-4 flex items-center justify-between">
    <div className="flex items-center gap-2">
      <div className="font-black text-xl tracking-tighter flex items-center gap-1 text-text-p uppercase">
        BÖRS
      </div>
    </div>
    
    <div className="flex items-center gap-8">
      <div className="hidden md:flex items-center gap-8 text-[10px] text-text-s font-bold uppercase tracking-widest">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            Feed: {apiStatus === 'connected' ? (
              <span className="text-green flex items-center gap-1.5"><RefreshCcw className="w-3 h-3 animate-spin-slow" />Yahoo Live</span>
            ) : apiStatus === 'connecting' ? (
              <span className="text-text-s flex items-center gap-1.5 animate-pulse">Connecting...</span>
            ) : (
              <span
                className="text-red flex items-center gap-1.5 max-w-[min(420px,45vw)] truncate cursor-help"
                title={feedDetail ?? 'Yahoo health check failed. Run npm run dev (Express + Vite) and ensure outbound network allows Yahoo Finance.'}
              >
                Offline
              </span>
            )}
          </div>
        </div>
        <div className="hidden lg:block border-l border-border pl-8">System Time: {formatTimeFi()}</div>
      </div>
    </div>
  </header>
);

// --- Main App Logic ---

export default function App() {
  const [loading, setLoading] = useState(true);
  const [dataStoreHint, setDataStoreHint] = useState<string>('SQLite');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [historyModal, setHistoryModal] = useState<
    null | { type: 'edit'; point: HistoryPoint } | { type: 'add' }
  >(null);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [marketPrices, setMarketPrices] = useState<Record<string, number>>({});
  const [quoteCurrencies, setQuoteCurrencies] = useState<Record<string, string>>({});
  const [marketChanges, setMarketChanges] = useState<Record<string, number>>({});
  const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({ 'EUR': 1 });
  const [apiStatus, setApiStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [feedDetail, setFeedDetail] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<View>(View.DASHBOARD);
  const importBackupRef = useRef<HTMLInputElement>(null);
  /** Bumped after server-backed portfolio writes so a slow initial bootstrap refetch cannot clobber newer state. */
  const portfolioMutationEpochRef = useRef(0);
  /** After first SQLite UI-prefs hydrate (or failed fetch); enables debounced PUT without clobbering server before read. */
  const uiPrefsRemoteHydratedRef = useRef(false);
  /** Strict Mode / remount: incremented on effect cleanup so stale async cannot apply portfolio state. */
  const portfolioBootstrapGenerationRef = useRef(0);
  const statsTotalValueRef = useRef(0);
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

  useEffect(() => {
    const checkApi = async () => {
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
          setApiStatus('connected');
          setFeedDetail(null);
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
      }
    };
    void checkApi();
    const interval = setInterval(() => void checkApi(), 30000); // Check every 30s
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const gen = portfolioBootstrapGenerationRef.current;
    let cancelled = false;
    const ac = new AbortController();
    const { signal } = ac;
    const pf = { signal, cache: 'no-store' as RequestCache };
    (async () => {
      try {
        const statusRes = await fetch('/api/portfolio/status', pf);
        if (statusRes.ok) {
          const s = await statusRes.json();
          if (s.dbPath && typeof s.dbPath === 'string') {
            const short = s.dbPath.replace(/\\/g, '/').split('/').slice(-2).join('/');
            if (!cancelled) setDataStoreHint(`SQLite (${short})`);
          }
        }

        let snapshot = portfolioMutationEpochRef.current;
        let assetsData: Asset[] = [];
        let historyData: HistoryPoint[] = [];
        let hydrated = false;

        for (let attempt = 0; attempt < 12 && !cancelled; attempt++) {
          assetsData = await fetch('/api/portfolio/assets', pf).then((r) => r.json());
          historyData = await fetch('/api/portfolio/history', pf).then((r) => r.json());

          if (assetsData.length === 0 && historyData.length === 0) {
            const raw = localStorage.getItem('alpha_os_assets');
            const rawH = localStorage.getItem('alpha_os_history');
            if (raw || rawH) {
              await fetch('/api/portfolio/import?mode=merge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  assets: raw ? (JSON.parse(raw) as Asset[]) : [],
                  history: rawH ? (JSON.parse(rawH) as HistoryPoint[]) : [],
                }),
                ...pf,
              });
              assetsData = await fetch('/api/portfolio/assets', pf).then((r) => r.json());
              historyData = await fetch('/api/portfolio/history', pf).then((r) => r.json());
            }
          }

          if (cancelled) return;
          if (portfolioMutationEpochRef.current === snapshot) {
            if (portfolioBootstrapGenerationRef.current !== gen) return;
            setAssets(assetsData);
            setHistory(dedupeHistoryByDate(historyData));
            hydrated = true;
            break;
          }
          snapshot = portfolioMutationEpochRef.current;
        }
        if (!cancelled && !hydrated && portfolioBootstrapGenerationRef.current === gen) {
          setAssets(assetsData);
          setHistory(dedupeHistoryByDate(historyData));
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
            setCashInput(loadedCash === 0 ? '0.00' : formatCashEurTwoDecimals(loadedCash));
          } catch (e) {
            if (isAbortError(e)) return;
            if (!cancelled && portfolioBootstrapGenerationRef.current === gen) {
              setCashEur(0);
              setCashInput('0.00');
            }
          }
          try {
            const ur = await fetch('/api/portfolio/ui-prefs', pf);
            if (cancelled || portfolioBootstrapGenerationRef.current !== gen) return;
            if (ur.ok) {
              const ui = (await ur.json()) as Record<string, unknown>;
              const lo = coerceRemoteLabelOffsets(ui.allocationLabelOffsets);
              if (lo) setAllocLabelOffsets(lo);
              setAllocChrome((c) => mergeAllocationChromeFromRemote(ui.allocationChrome, c));
            }
          } catch (e) {
            if (!isAbortError(e)) console.warn('UI prefs load failed:', e);
          }
        }
      } catch (e) {
        if (isAbortError(e)) return;
        console.error('Portfolio load failed:', e);
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

  // Real-time market data: Integrated Yahoo Finance Backend
  useEffect(() => {
    const fetchRealData = async () => {
      const symbols = assets.map(a => a.symbol);
      if (symbols.length === 0) return;

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
      }
    };

    fetchRealData();
    const dataInterval = setInterval(fetchRealData, 15000); // Fetch real data every 15s
    
    const heartbeatInterval = setInterval(() => {
      setMarketPrices(prev => {
        const next = { ...prev };
        assets.forEach(asset => {
          const base = prev[asset.symbol] || asset.averagePrice;
          const volatility = 0.0003; // Extremely subtle heartbeat for professional feel
          next[asset.symbol] = base * (1 + (Math.random() - 0.5) * volatility);
        });
        return next;
      });
    }, 5000); 

    return () => {
      clearInterval(dataInterval);
      clearInterval(heartbeatInterval);
    };
  }, [assets]);

  const removeAsset = async (id: string) => {
    try {
      const res = await fetch(`/api/portfolio/assets/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      const list: Asset[] = await fetch('/api/portfolio/assets').then((r) => r.json());
      setAssets(list);
      portfolioMutationEpochRef.current += 1;
    } catch (err) {
      console.error('Failed to remove position:', err);
    }
  };

  const stats: PortfolioStats = assets.reduce((acc, asset) => {
    const livePrice = marketPrices[asset.symbol] || asset.averagePrice;
    const priceFx = holdingQuoteFxToEur(asset.symbol, asset.currency, quoteCurrencies, exchangeRates);
    const costFx = fxToEur(asset.currency, exchangeRates) || 1;

    const valInEur = asset.quantity * livePrice * priceFx;
    const costInEur = asset.quantity * asset.averagePrice * costFx;
    
    acc.totalValue += valInEur;
    acc.totalCost += costInEur;
    return acc;
  }, { totalValue: 0, totalCost: 0, totalGain: 0, totalGainPercent: 0, dailyChange: 0, dailyChangePercent: 0 });

  const cashSafe = cashLineEur;
  stats.totalValue += cashSafe;
  stats.totalCost += cashSafe;

  stats.totalGain = stats.totalValue - stats.totalCost;
  stats.totalGainPercent = stats.totalCost > 0 ? (stats.totalGain / stats.totalCost) * 100 : 0;

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

  const allocationSlices = useMemo(() => {
    const assetRows = assets.map((a) => {
      const val =
        a.quantity *
        (marketPrices[a.symbol] || a.averagePrice) *
        holdingQuoteFxToEur(a.symbol, a.currency, quoteCurrencies, exchangeRates);
      return { key: a.id || a.symbol, name: a.name, value: val };
    });
    const c = cashLineEur;
    const assetSum = assetRows.reduce((s, r) => s + r.value, 0);
    const t = assetSum + c;
    if (t <= 0) return [];
    const rows = assetRows
      .map((r) => ({ ...r, percent: (r.value / t) * 100 }))
      .sort((a, b) => b.value - a.value);
    if (c > 0) {
      rows.push({ key: 'cash', name: 'Cash', value: c, percent: (c / t) * 100 });
      rows.sort((a, b) => b.value - a.value);
    }
    return rows;
  }, [assets, marketPrices, quoteCurrencies, exchangeRates, cashLineEur]);

  const allocationPieWrapRef = useRef<HTMLDivElement>(null);
  const [allocationPieBox, setAllocationPieBox] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = allocationPieWrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      let width = Math.round(rect.width) || el.clientWidth || 0;
      let height = Math.round(rect.height) || el.clientHeight || 0;
      if (width < 32) width = 320;
      if (height < 32) height = 300;
      setAllocationPieBox((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height }
      );
    };

    measure();
    const raf = requestAnimationFrame(measure);

    const ro = new ResizeObserver(() => measure());
    try {
      ro.observe(el, { box: 'border-box' });
    } catch {
      ro.observe(el);
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const [allocChrome, setAllocChrome] = useState<AllocationChromePrefs>(() => loadAllocationChromePrefs());

  useEffect(() => {
    saveAllocationChromePrefs(allocChrome);
  }, [allocChrome]);

  const allocChartMargins = useMemo(
    () =>
      allocationPieMarginsWithNudge(
        ALLOCATION_PIE_CHART_MARGIN,
        allocChrome.pieNudgeX,
        allocChrome.pieNudgeY
      ),
    [allocChrome.pieNudgeX, allocChrome.pieNudgeY]
  );

  const allocationPieCalloutMap = useMemo(
    () =>
      buildAllocationPieCalloutMap(
        allocationPieBox.width,
        allocationPieBox.height,
        allocationSlices,
        allocChartMargins
      ),
    [allocationPieBox.width, allocationPieBox.height, allocationSlices, allocChartMargins]
  );

  const [allocLabelOffsets, setAllocLabelOffsets] = useState<
    Record<string, AllocationLabelOffset>
  >(() => loadAllocationLabelOffsets());
  const allocLabelOffsetsRef = useRef(allocLabelOffsets);
  allocLabelOffsetsRef.current = allocLabelOffsets;

  const [allocLabelDragging, setAllocLabelDragging] = useState<string | null>(null);
  const [allocPieMenuOpen, setAllocPieMenuOpen] = useState(false);
  const allocPieMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!allocPieMenuOpen) return;
    const close = (e: MouseEvent) => {
      const el = allocPieMenuRef.current;
      if (el && !el.contains(e.target as Node)) setAllocPieMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [allocPieMenuOpen]);

  useEffect(() => {
    saveAllocationLabelOffsets(allocLabelOffsets);
  }, [allocLabelOffsets]);

  useEffect(() => {
    if (!uiPrefsRemoteHydratedRef.current) return;
    const ac = new AbortController();
    const t = window.setTimeout(() => {
      void fetch('/api/portfolio/ui-prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allocationLabelOffsets: allocLabelOffsets,
          allocationChrome: allocChrome,
        }),
        signal: ac.signal,
        cache: 'no-store',
      }).catch(() => {});
    }, 450);
    return () => {
      ac.abort();
      window.clearTimeout(t);
    };
  }, [allocLabelOffsets, allocChrome]);

  useEffect(() => {
    if (allocationSlices.length === 0) return;
    const keep = new Set(allocationSlices.map((s) => s.key));
    setAllocLabelOffsets((prev) => {
      const next: Record<string, AllocationLabelOffset> = { ...prev };
      let changed = false;
      for (const k of Object.keys(next)) {
        if (k === 'cash') continue;
        if (!keep.has(k)) {
          delete next[k];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [allocationSlices]);

  const onAllocCalloutPointerDown = useCallback((sliceKey: string, e: React.PointerEvent<SVGGElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const cur = allocLabelOffsetsRef.current[sliceKey] ?? { dx: 0, dy: 0 };
    const x0 = e.clientX;
    const y0 = e.clientY;
    setAllocLabelDragging(sliceKey);

    const move = (ev: PointerEvent) => {
      setAllocLabelOffsets((prev) => ({
        ...prev,
        [sliceKey]: {
          dx: cur.dx + ev.clientX - x0,
          dy: cur.dy + ev.clientY - y0,
        },
      }));
    };
    const up = () => {
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setAllocLabelDragging(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, []);

  const allocationPieLabelRenderer = useCallback(
    (p: Parameters<typeof renderAllocationPieCalloutFromLayout>[0]) =>
      renderAllocationPieCalloutFromLayout(p, allocationPieCalloutMap, allocLabelOffsets, {
        draggingKey: allocLabelDragging,
        onPointerDown: onAllocCalloutPointerDown,
        labelFontPx: allocChrome.labelFontPx,
      }),
    [
      allocationPieCalloutMap,
      allocLabelOffsets,
      allocLabelDragging,
      onAllocCalloutPointerDown,
      allocChrome.labelFontPx,
    ]
  );

  const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState(false);

  /** Persist today's total when missing. Deps avoid live quote ticks (they were resetting the timer before it fired). */
  useEffect(() => {
    if (loading) return;
    const today = todayIsoDateHelsinki();
    if (history.some((p) => p.date === today)) return;
    if (statsTotalValueRef.current <= 0) return;

    const t = window.setTimeout(async () => {
      const val = statsTotalValueRef.current;
      if (val <= 0) return;
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
  }, [history, loading, assets.length, cashLineEur]);

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

  const exportPortfolioBackup = async () => {
    try {
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
        cashEur?: number;
        uiPrefs?: unknown;
      };
      const payload: {
        assets: Asset[];
        history: HistoryPoint[];
        cashEur?: number;
        uiPrefs?: unknown;
      } = {
        assets: data.assets ?? [],
        history: data.history ?? [],
      };
      if (data.cashEur !== undefined && data.cashEur !== null && Number.isFinite(data.cashEur)) {
        payload.cashEur = Math.max(0, data.cashEur);
      }
      if (data.uiPrefs && typeof data.uiPrefs === 'object' && !Array.isArray(data.uiPrefs)) {
        payload.uiPrefs = data.uiPrefs;
      }
      await fetch('/api/portfolio/import?mode=merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const pf = { cache: 'no-store' as RequestCache };
      const [a, h, cashRes, uiRes] = await Promise.all([
        fetch('/api/portfolio/assets', pf).then((r) => r.json()),
        fetch('/api/portfolio/history', pf).then((r) => r.json()),
        fetch('/api/portfolio/cash', pf).then((r) => (r.ok ? r.json() : { amountEur: 0 })),
        fetch('/api/portfolio/ui-prefs', pf).then((r) => (r.ok ? r.json() : {})),
      ]);
      setAssets(a);
      setHistory(dedupeHistoryByDate(h));
      const cv = normalizeCashAmountEur(cashRes.amountEur) ?? 0;
      setCashEur(Number(cv));
      setCashInput(cv === 0 ? '0.00' : formatCashEurTwoDecimals(cv));
      const ui = uiRes as Record<string, unknown>;
      const lo = coerceRemoteLabelOffsets(ui.allocationLabelOffsets);
      if (lo) setAllocLabelOffsets(lo);
      setAllocChrome((c) => mergeAllocationChromeFromRemote(ui.allocationChrome, c));
      portfolioMutationEpochRef.current += 1;
    } catch (e) {
      console.error('Import failed', e);
    } finally {
      if (importBackupRef.current) importBackupRef.current.value = '';
    }
  };

  const saveCash = async () => {
    const parsed = parseFloat(String(cashInput).replace(',', '.'));
    const amount = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    const prevEur = cashEur;
    const prevInput = cashInput;
    setCashEur(Number(amount));
    setCashInput(amount === 0 ? '0.00' : formatCashEurTwoDecimals(amount));
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
      setCashInput(v === 0 ? '0.00' : formatCashEurTwoDecimals(v));
      portfolioMutationEpochRef.current += 1;
    } catch (e) {
      console.error('Cash save failed', e);
      setCashEur(prevEur);
      setCashInput(prevInput);
    } finally {
      setCashSaving(false);
    }
  };

  const persistAsset = async (asset: Asset, isEdit: boolean) => {
    if (isEdit && asset.id) {
      const res = await fetch(`/api/portfolio/assets/${encodeURIComponent(asset.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(asset),
      });
      if (!res.ok) throw new Error('Update failed');
    } else {
      const res = await fetch('/api/portfolio/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(asset),
      });
      if (!res.ok) throw new Error('Create failed');
    }
    const list: Asset[] = await fetch('/api/portfolio/assets').then((r) => r.json());
    setAssets(list);
    portfolioMutationEpochRef.current += 1;
  };

  const reloadHistory = async () => {
    const list: HistoryPoint[] = await fetch('/api/portfolio/history').then((r) => r.json());
    setHistory(dedupeHistoryByDate(list));
    portfolioMutationEpochRef.current += 1;
  };

  if (loading) return <LoadingScreen />;

  return (
    <div className="flex flex-col h-screen bg-bg overflow-hidden font-sans selection:bg-accent/30">
      <Header apiStatus={apiStatus} feedDetail={feedDetail} />
      
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-20 min-w-[80px] border-r border-border bg-card flex flex-col items-center py-8 gap-8 z-10 shadow-2xl">
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
            label="Dividends" 
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
            label="Recap" 
          />
          <NavButton 
            active={activeView === View.OPTIONS} 
            onClick={() => setActiveView(View.OPTIONS)} 
            icon={<Settings className="w-5 h-5" />} 
            label="Options" 
          />
        </aside>

        <main className="flex-1 overflow-y-auto technical-grid p-6">
          <AnimatePresence mode="wait">
            {activeView === View.DASHBOARD && (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="dashboard-view max-w-[1400px] mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 lg:grid-rows-[auto_auto] gap-4"
              >
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
                            <p className="text-[9px] text-text-s font-bold uppercase tracking-widest leading-relaxed">
                              Daily total value (EUR) in SQLite. Edit a row or add a past date you missed.
                            </p>
                            <button
                              type="button"
                              onClick={() => setHistoryModal({ type: 'add' })}
                              className="shrink-0 px-3 py-2 bg-accent text-white rounded-lg font-black uppercase tracking-widest text-[8px] shadow-lg shadow-accent/20 flex items-center justify-center gap-1.5 self-start"
                            >
                              <Plus className="w-3.5 h-3.5" /> Add entry
                            </button>
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
                                        {formatDateFi(row.date)}
                                        {row.id === '__bors_live_today__' ? (
                                          <span className="ml-2 text-[8px] uppercase text-text-s/45 font-bold tracking-widest">
                                            (live)
                                          </span>
                                        ) : null}
                                      </td>
                                      <td className="px-3 py-2 font-mono font-bold text-text-p tabular-nums">
                                        {formatCurrency(row.value, 'EUR')}
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

                  <div className="stat-value text-6xl mb-2 flex items-baseline gap-2 tabular-nums">
                    {formatCurrency(stats.totalValue, 'EUR')}
                  </div>
                  <div className={`flex items-center gap-2 text-sm font-bold ${stats.totalGain >= 0 ? 'text-green' : 'text-red'}`}>
                    <div className={`p-1 rounded-md ${stats.totalGain >= 0 ? 'bg-green/10' : 'bg-red/10'}`}>
                      {stats.totalGain >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    </div>
                    {Math.abs(stats.totalGainPercent).toFixed(2)}% 
                  </div>

                  <div className="flex-1 mt-8 min-h-[160px]">
                    <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={(() => {
                          const todayStr = todayIsoDateHelsinki();
                          // Map history and ensure unique dates (latest recorded for that day wins, though recording logic only allows one)
                          const baseData = history.filter((p, i, self) => i === self.findIndex(t => t.date === p.date)).map(p => ({
                            date: p.date,
                            name: formatShortMonthDayFi(p.date),
                            value: p.value
                          }));
                          
                          const hasStoredToday = history.some(p => p.date === todayStr);
                          
                          if (!hasStoredToday && stats.totalValue > 0) {
                            baseData.push({ 
                              date: todayStr,
                              name: 'Today', 
                              value: stats.totalValue 
                            });
                          }
                          
                          return baseData;
                        })()}>
                          <defs>
                            <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="var(--color-accent)" stopOpacity={0.2}/>
                              <stop offset="95%" stopColor="var(--color-accent)" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="name" hide />
                          <Tooltip 
                            formatter={(value: number) => [formatCurrency(value, 'EUR'), '']}
                            separator=""
                            labelStyle={{ color: 'var(--color-text-s)', fontSize: '11px', marginBottom: '4px', textTransform: 'uppercase', fontWeight: 'bold', opacity: 0.5 }}
                            contentStyle={{ backgroundColor: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: '12px', padding: '12px' }}
                            itemStyle={{ color: 'var(--color-accent)', fontWeight: '900', fontSize: '14px' }}
                            cursor={{ stroke: 'var(--color-accent)', strokeWidth: 1, strokeDasharray: '4 4' }}
                          />
                          <Area type="monotone" dataKey="value" stroke="var(--color-accent)" fillOpacity={1} fill="url(#colorValue)" strokeWidth={3} animationDuration={1000} />
                        </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="lg:col-span-2 lg:row-span-2 flex flex-col gap-4">
                  <div className="glass-panel !overflow-visible p-6 flex flex-col flex-1 min-h-[480px] lg:min-h-[520px]">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <h3 className="card-title mb-0">Allocation</h3>
                      <div className="relative shrink-0" ref={allocPieMenuRef}>
                        <button
                          type="button"
                          title="Chart options"
                          aria-expanded={allocPieMenuOpen}
                          aria-haspopup="true"
                          onClick={() => setAllocPieMenuOpen((o) => !o)}
                          className={`p-2 rounded-lg border transition-colors ${
                            allocPieMenuOpen
                              ? 'bg-accent text-white border-accent shadow-lg shadow-accent/20'
                              : 'bg-white/5 text-text-s border-border/60 hover:bg-white/10'
                          }`}
                        >
                          <MoreVertical className="w-4 h-4" aria-hidden />
                        </button>
                        {allocPieMenuOpen && (
                          <div
                            className="absolute right-0 top-full mt-2 w-[min(calc(100vw-3rem),18rem)] rounded-xl border border-border bg-card shadow-2xl z-[80] p-3 space-y-3"
                            style={{ backgroundColor: 'var(--color-card)' }}
                            role="menu"
                          >
                            <div className="space-y-3 text-[10px] text-text-s">
                              <label className="flex flex-col gap-1.5 min-w-0">
                                <span className="uppercase tracking-widest font-bold opacity-50">
                                  Pie horizontal
                                </span>
                                <input
                                  type="range"
                                  min={-80}
                                  max={80}
                                  step={2}
                                  value={allocChrome.pieNudgeX}
                                  onChange={(e) =>
                                    setAllocChrome((c) => ({ ...c, pieNudgeX: Number(e.target.value) }))
                                  }
                                  className="w-full h-1.5"
                                  style={{ accentColor: 'var(--color-accent)' }}
                                />
                              </label>
                              <label className="flex flex-col gap-1.5 min-w-0">
                                <span className="uppercase tracking-widest font-bold opacity-50">
                                  Pie vertical
                                </span>
                                <input
                                  type="range"
                                  min={-80}
                                  max={80}
                                  step={2}
                                  value={allocChrome.pieNudgeY}
                                  onChange={(e) =>
                                    setAllocChrome((c) => ({ ...c, pieNudgeY: Number(e.target.value) }))
                                  }
                                  className="w-full h-1.5"
                                  style={{ accentColor: 'var(--color-accent)' }}
                                />
                              </label>
                              <label className="flex flex-col gap-1.5 min-w-0">
                                <span className="uppercase tracking-widest font-bold opacity-50">
                                  Label size
                                </span>
                                <input
                                  type="range"
                                  min={8}
                                  max={18}
                                  step={1}
                                  value={allocChrome.labelFontPx}
                                  onChange={(e) =>
                                    setAllocChrome((c) => ({ ...c, labelFontPx: Number(e.target.value) }))
                                  }
                                  className="w-full h-1.5"
                                  style={{ accentColor: 'var(--color-accent)' }}
                                />
                              </label>
                            </div>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setAllocLabelOffsets({});
                                saveAllocationLabelOffsets({});
                                const defaults: AllocationChromePrefs = {
                                  pieNudgeX: 0,
                                  pieNudgeY: 0,
                                  labelFontPx: 11,
                                };
                                setAllocChrome(defaults);
                                saveAllocationChromePrefs(defaults);
                                setAllocPieMenuOpen(false);
                              }}
                              className="w-full px-2 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest text-text-s hover:text-accent hover:bg-white/5 border border-border/60 transition-colors"
                            >
                              Reset layout
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    <div
                      ref={allocationPieWrapRef}
                      className="allocation-pie-glow relative flex-1 w-full min-h-[300px] min-w-0"
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart margin={{ ...allocChartMargins }}>
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
                            innerRadius="36%"
                            outerRadius="58%"
                            dataKey="value"
                            nameKey="name"
                            startAngle={90}
                            endAngle={-270}
                            paddingAngle={1.2}
                            stroke="rgba(15, 23, 42, 0.85)"
                            strokeWidth={1.5}
                            isAnimationActive={false}
                            label={
                              allocationSlices.length > 0 ? allocationPieLabelRenderer : false
                            }
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
                    </div>
                  </div>
                </div>


                {/* Holdings Table Section */}
                <div className="lg:col-span-4 glass-panel p-8 bg-[#0e0e10]/80">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <h3 className="card-title mb-2">Holdings</h3>
                    </div>
                    <button 
                      onClick={() => {
                        setEditingAsset(null);
                        setIsModalOpen(true);
                      }}
                      className="px-3 py-1.5 bg-accent text-white rounded-lg font-black uppercase tracking-widest text-[8px] shadow-lg shadow-accent/20 active:scale-[0.98] transition-all flex items-center gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Asset
                    </button>
                  </div>

                  <div className="overflow-x-auto -mx-2 px-2">
                    <table className="w-full min-w-[920px] table-fixed text-left border-separate border-spacing-y-2 border-spacing-x-1">
                      <colgroup>
                        <col className="w-[26%]" />
                        <col className="w-[8%]" />
                        <col className="w-[12%]" />
                        <col className="w-[14%]" />
                        <col className="w-[14%]" />
                        <col className="w-[13%]" />
                        <col className="w-[8%]" />
                        <col className="w-[96px]" />
                      </colgroup>
                      <thead>
                        <tr className="text-[9px] font-bold text-text-s uppercase tracking-[0.25em] opacity-50">
                          <th className="pl-5 pr-6 py-2">Asset</th>
                          <th className="px-5 py-2 text-right">Shares</th>
                          <th className="pl-8 pr-5 py-2 text-right">Share price</th>
                          <th className="px-6 py-2 text-right">Total value</th>
                          <th className="px-6 py-2 text-right">Cost basis</th>
                          <th className="px-5 py-2 text-right">Total gain</th>
                          <th className="px-5 py-2 text-right">24h</th>
                          <th className="w-24 min-w-[96px] px-2 py-2" aria-hidden />
                        </tr>
                      </thead>
                      <tbody className="text-xs font-mono font-bold">
                        {[...assets].sort((a, b) => {
                          const valA =
                            a.quantity *
                            (marketPrices[a.symbol] || a.averagePrice) *
                            holdingQuoteFxToEur(a.symbol, a.currency, quoteCurrencies, exchangeRates);
                          const valB =
                            b.quantity *
                            (marketPrices[b.symbol] || b.averagePrice) *
                            holdingQuoteFxToEur(b.symbol, b.currency, quoteCurrencies, exchangeRates);
                          return valB - valA;
                        }).map((item, index) => {
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
                          const totalGainPercent = costBasisInEur > 0 ? (totalGainInEur / costBasisInEur) * 100 : 0;
                          const change = marketChanges[item.symbol] || 0;
                          
                          return (
                            <tr key={item.id || `row-${index}`} className="group bg-bg/40 hover:bg-bg transition-all outline outline-1 outline-border/50 hover:outline-accent/30 rounded-2xl">
                              <td className="pl-5 pr-6 py-3 rounded-l-2xl">
                                <div className="min-w-0">
                                  <div className="text-text-p text-sm font-sans truncate">{item.name}</div>
                                  <div className="mt-0.5 text-[9px] text-text-s/60 font-mono uppercase tracking-widest">
                                    {item.displaySymbol || (item.symbol.includes('.') ? item.symbol.split('.')[0] : item.symbol)}
                                  </div>
                                </div>
                              </td>
                              <td className="px-5 py-3 text-right text-text-p tabular-nums whitespace-nowrap">{item.quantity}</td>
                              <td className="pl-8 pr-5 py-3 text-right text-text-p tabular-nums whitespace-nowrap">
                                {formatCurrency(priceInEur, 'EUR')}
                              </td>
                              <td className="px-6 py-3 text-right text-text-p tabular-nums whitespace-nowrap">{formatCurrency(totalValue, 'EUR')}</td>
                              <td className="px-6 py-3 text-right text-text-s/40 tabular-nums whitespace-nowrap">{formatCurrency(costBasisInEur, 'EUR')}</td>
                              <td className="px-5 py-3 text-right tabular-nums whitespace-nowrap">
                                <div className={`inline-block text-right ${totalGainInEur >= 0 ? 'text-green' : 'text-red'}`}>
                                  <div className="text-[11px] font-sans font-bold tabular-nums">
                                    {formatCurrency(totalGainInEur, 'EUR')}
                                  </div>
                                  <div className="text-xs opacity-60 font-bold">
                                    {totalGainPercent >= 0 ? '+' : ''}
                                    {totalGainPercent.toFixed(2)}%
                                  </div>
                                </div>
                              </td>
                              <td className="px-5 pr-3 py-3 text-right tabular-nums whitespace-nowrap">
                                <span className={`inline-flex items-center justify-end gap-1 ${change >= 0 ? 'text-green' : 'text-red'}`}>
                                  {change >= 0 ? <TrendingUp className="w-3 h-3 shrink-0" /> : <TrendingDown className="w-3 h-3 shrink-0" />}
                                  {Math.abs(change).toFixed(2)}%
                                </span>
                              </td>
                              <td className="w-24 min-w-[96px] px-2 py-3 text-right rounded-r-2xl">
                                <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingAsset(item);
                                      setIsModalOpen(true);
                                    }}
                                    className="p-2 text-text-s hover:text-accent hover:bg-accent/10 rounded-lg transition-all shrink-0"
                                    aria-label="Edit holding"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => removeAsset(item.id!)}
                                    className="p-2 text-text-s hover:text-red hover:bg-red/10 rounded-lg transition-all shrink-0"
                                    aria-label="Remove holding"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        {assets.length === 0 && (
                          <tr className="bg-bg/40 opacity-20">
                            <td colSpan={8} className="px-6 py-20 text-center rounded-2xl">
                              <div className="flex flex-col items-center gap-4">
                                <Wallet className="w-12 h-12" />
                                <p className="text-[10px] uppercase font-bold tracking-widest">No Holdings Registered</p>
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-8 pt-8 border-t border-border/50">
                    <h3 className="card-title mb-3">Cash (EUR)</h3>
                    <div className="flex flex-wrap items-end gap-2">
                      <input
                        type="text"
                        inputMode="decimal"
                        className="flex-1 min-w-[140px] max-w-[240px] bg-bg/50 border border-border rounded-xl px-4 py-2.5 text-text-p font-mono text-sm focus:outline-none focus:border-accent/50 tabular-nums"
                        placeholder="0.00"
                        value={cashInput}
                        onChange={(e) => setCashInput(e.target.value)}
                        onBlur={() => normalizeCashInputOnBlur()}
                      />
                      <button
                        type="button"
                        disabled={cashSaving}
                        onClick={() => void saveCash()}
                        className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 border border-border/60 text-[10px] font-black uppercase tracking-widest text-text-p disabled:opacity-50"
                      >
                        {cashSaving ? 'Saving…' : 'Save'}
                      </button>
                    </div>
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
                className="max-w-[1400px] mx-auto w-full dashboard-view h-full overflow-y-auto"
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
                className="max-w-[1400px] mx-auto p-8 glass-panel h-full"
              >
                <div className="mb-8">
                  <h2 className="text-2xl font-black tracking-tight text-white uppercase">FIRE Projection</h2>
                  <p className="text-[10px] text-text-s font-bold uppercase tracking-[0.2em]">Financial Independence Exit Strategy</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                  <div className="bg-bg/40 rounded-2xl border border-border/50 p-8">
                    <p className="text-[10px] text-text-s uppercase font-bold mb-1">Independence Goal</p>
                    <div className="text-3xl font-black text-text-p">{formatCurrency(750000, 'EUR')}</div>
                    <div className="h-1 bg-border rounded-full mt-4 overflow-hidden">
                      <div className="h-full bg-accent" style={{ width: `${Math.min((stats.totalValue / 750000) * 100, 100)}%` }}></div>
                    </div>
                    <p className="text-[9px] text-accent mt-2 font-mono">{(stats.totalValue / 750000 * 100).toFixed(2)}% ACHIEVED</p>
                  </div>
                  <div className="md:col-span-2 bg-bg/40 rounded-2xl border border-border/50 p-8 flex items-center justify-center">
                    <div className="text-center">
                      <Flame className="w-12 h-12 text-red/40 mx-auto mb-4" />
                      <p className="text-text-s text-xs font-mono uppercase tracking-widest opacity-60">Retirement timeline simulation in process...</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeView === View.MARKET_RECAP && (
              <motion.div 
                key="market-recap"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-[1400px] mx-auto p-8 space-y-8"
              >
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                  <div>
                    <h2 className="text-2xl font-black tracking-tight text-white uppercase">Market Intelligence</h2>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green animate-pulse"></div>
                      <p className="text-[10px] text-text-s font-bold uppercase tracking-[0.2em]">Global Feed Active • Live Performance Data</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                  <div className="lg:col-span-3 space-y-8">
                    <div className="glass-panel p-6 min-h-[500px] flex flex-col">
                      <div className="flex items-center justify-between mb-6">
                        <h3 className="card-title">S&P 500 Heatmap</h3>
                        <span className="text-[9px] text-text-s font-mono uppercase tracking-widest px-3 py-1 bg-white/5 rounded-full">Top US Tech & Finance</span>
                      </div>
                      <div className="flex-1">
                        <ResponsiveContainer width="100%" height="100%">
                          <Treemap
                            data={[
                              { name: 'Technology', children: [{ name: 'AAPL', size: 3000, change: 1.2 }, { name: 'MSFT', size: 2800, change: -0.5 }, { name: 'NVDA', size: 2200, change: 3.8 }, { name: 'AVGO', size: 900, change: 2.1 }] },
                              { name: 'Comm Services', children: [{ name: 'GOOGL', size: 1800, change: 0.8 }, { name: 'META', size: 1500, change: -1.2 }, { name: 'NFLX', size: 600, change: 1.4 }] },
                              { name: 'Consumer', children: [{ name: 'AMZN', size: 1700, change: 0.5 }, { name: 'TSLA', size: 800, change: -2.4 }, { name: 'HD', size: 500, change: 0.2 }] },
                              { name: 'Finance', children: [{ name: 'BRK-B', size: 1000, change: 0.2 }, { name: 'JPM', size: 700, change: 0.1 }, { name: 'V', size: 600, change: 0.5 }] },
                              { name: 'Healthcare', children: [{ name: 'LLY', size: 850, change: 1.1 }, { name: 'UNH', size: 750, change: -0.4 }, { name: 'JNJ', size: 600, change: 0.2 }] }
                            ]}
                            dataKey="size"
                            stroke="#000"
                            fill="#0f172a"
                            content={<CustomTreemapContent />}
                          />
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div className="glass-panel p-6 min-h-[400px] flex flex-col">
                      <div className="flex items-center justify-between mb-6">
                        <h3 className="card-title">OMX Helsinki 25</h3>
                        <span className="text-[9px] text-text-s font-mono uppercase tracking-widest px-3 py-1 bg-white/5 rounded-full">Nordic Blue Chips</span>
                      </div>
                      <div className="flex-1">
                        <ResponsiveContainer width="100%" height="100%">
                          <Treemap
                            data={[
                              { name: 'Industrial', children: [{ name: 'NESTE', size: 120, change: -3.2 }, { name: 'UPM', size: 100, change: 0.5 }, { name: 'METSO', size: 85, change: 1.2 }, { name: 'FORTUM', size: 80, change: -1.1 }] },
                              { name: 'Finance', children: [{ name: 'SAMPO', size: 150, change: -0.1 }, { name: 'NDA-FI', size: 140, change: 0.8 }] },
                              { name: 'Technology', children: [{ name: 'NOKIA', size: 110, change: 1.5 }, { name: 'ELISA', size: 75, change: -0.2 }] },
                              { name: 'Retail', children: [{ name: 'KESKOB', size: 90, change: 2.1 }] }
                            ]}
                            dataKey="size"
                            stroke="#000"
                            fill="#0f172a"
                            aspectRatio={4/3}
                            content={<CustomTreemapContent />}
                          />
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>

                  <div className="lg:col-span-1">
                    <MarketAISummary />
                  </div>
                </div>
              </motion.div>
            )}

            {activeView === View.OPTIONS && (
              <motion.div
                key="options"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-2xl mx-auto w-full"
              >
                <div className="glass-panel p-8">
                  <h2 className="text-2xl font-black tracking-tight text-white uppercase mb-2">Options</h2>
                  <p className="text-[10px] text-text-s font-bold uppercase tracking-widest mb-8 opacity-80">
                    Data & backup
                  </p>

                  <div className="space-y-6">
                    <div className="p-5 rounded-xl border border-border/60 bg-white/[0.02]">
                      <h3 className="text-[10px] font-bold text-text-s uppercase tracking-widest mb-2">
                        Portfolio data (SQLite)
                      </h3>
                      <p className="text-xs text-text-s leading-relaxed mb-3">
                        Holdings, history, and related totals are stored locally. Copy the database file while the server is stopped,
                        or use JSON export/import to move data between machines.
                      </p>
                      {dataStoreHint && (
                        <p className="text-[10px] font-mono text-accent/90 break-all bg-bg/50 rounded-lg px-3 py-2 border border-border/50">
                          {dataStoreHint}
                        </p>
                      )}
                    </div>

                    <div className="p-5 rounded-xl border border-border/60 bg-white/[0.02]">
                      <h3 className="text-[10px] font-bold text-text-s uppercase tracking-widest mb-4">
                        Portfolio backup
                      </h3>
                      <div className="flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={() => exportPortfolioBackup()}
                          className="flex items-center gap-2 px-4 py-3 rounded-xl bg-accent text-white hover:bg-accent/90 text-[10px] font-black uppercase tracking-widest shadow-lg shadow-accent/20"
                        >
                          <Download className="w-4 h-4" /> Export JSON
                        </button>
                        <label className="flex items-center gap-2 px-4 py-3 rounded-xl bg-white/10 hover:bg-white/15 text-[10px] font-black uppercase tracking-widest text-text-p cursor-pointer border border-border/50">
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
                      <p className="text-[9px] text-text-s mt-4 uppercase tracking-widest opacity-60 leading-relaxed">
                        Import merges with existing data unless you replace from a full backup file.
                      </p>
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

// --- Internal Components ---

const CustomTreemapContent = (props: any) => {
  const { x, y, width, height, name, change } = props;
  if (width < 30 || height < 20) return null;
  
  const intensity = Math.min(Math.abs(change) * 20, 90);
  const color = change >= 0 
    ? `rgba(34, 197, 94, ${intensity / 100 + 0.1})` 
    : `rgba(239, 68, 68, ${intensity / 100 + 0.1})`;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        style={{
          fill: color,
          stroke: 'rgba(0,0,0,0.4)',
          strokeWidth: 2,
        }}
      />
      {width > 40 && height > 30 && (
        <>
          <text
            x={x + width / 2}
            y={y + height / 2 - 4}
            textAnchor="middle"
            fill="#fff"
            fontSize={Math.min(width, height) / 5}
            fontWeight="900"
            className="uppercase tracking-tighter"
          >
            {name}
          </text>
          <text
            x={x + width / 2}
            y={y + height / 2 + 10}
            textAnchor="middle"
            fill="#fff"
            fontSize={Math.min(width, height) / 7}
            opacity={0.8}
            fontWeight="bold"
          >
            {change >= 0 ? '+' : ''}{change.toFixed(2)}%
          </text>
        </>
      )}
    </g>
  );
};

const MarketAISummary = () => {
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(true);
  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY);

  useEffect(() => {
    if (!hasGeminiKey) {
      setSummary(
        'Running in **local-only** mode: portfolio and history live in SQLite on this computer. Quotes use the bundled Yahoo proxy when you are online. To enable this AI panel, add `GEMINI_API_KEY` to `.env.local` and restart the dev server.'
      );
      setLoading(false);
      return;
    }

    const generateSummary = async () => {
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: "Why are the global stock markets moving the way they are today? Provide a brief, professional summary of today's key market drivers, economic reports, and geopolitical factors. Focus on S&P 500 and Nordic markets.",
        });
        setSummary(response.text || 'Market intelligence feed currently being processed. Re-evaluating drivers...');
      } catch (e) {
        setSummary('Could not reach the AI service. Check your API key and network, or use the app without AI (local portfolio still works).');
      } finally {
        setLoading(false);
      }
    };
    generateSummary();
  }, [hasGeminiKey]);

  return (
    <div className="glass-panel p-8 h-full flex flex-col border-accent/20">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-accent/20 flex items-center justify-center">
          <Zap className="w-5 h-5 text-accent animate-pulse" />
        </div>
        <div>
          <h3 className="card-title leading-none">AI Market Summary</h3>
          <p className="text-[9px] text-text-s uppercase font-mono tracking-widest mt-1">
            {hasGeminiKey ? 'Optional: Google Gemini' : 'Disabled (no API key)'}
          </p>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="space-y-4">
            <div className="h-4 bg-white/5 rounded-full w-3/4 animate-pulse"></div>
            <div className="h-4 bg-white/5 rounded-full w-full animate-pulse"></div>
            <div className="h-4 bg-white/5 rounded-full w-5/6 animate-pulse"></div>
            <div className="h-4 bg-white/5 rounded-full w-2/3 animate-pulse"></div>
          </div>
        ) : (
          <div className="markdown-body text-text-p text-sm leading-relaxed prose prose-sm prose-invert max-w-none">
            <Markdown>{summary}</Markdown>
          </div>
        )}
      </div>
      
      {!loading && (
        <div className="mt-8 p-4 bg-white/5 rounded-xl border border-border/50">
          <p className="text-[8px] text-text-s uppercase font-mono text-center tracking-widest leading-normal">
            Information provided by Börs Intelligence is for informational purposes only. Not financial advice.
          </p>
        </div>
      )}
    </div>
  );
};

const NavButton = ({ active, onClick, icon, label }: { 
  active: boolean, 
  onClick: () => void, 
  icon: React.ReactNode, 
  label: string 
}) => (
  <button 
    onClick={onClick}
    className={`group relative p-3 rounded-xl transition-all ${active ? 'bg-accent text-white shadow-lg shadow-accent/20' : 'text-text-s hover:text-text-p hover:bg-white/5'}`}
  >
    {icon}
    <div className="absolute left-full ml-3 opacity-0 group-hover:opacity-100 transition-opacity bg-card border border-border px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest pointer-events-none whitespace-nowrap z-50">
      {label}
    </div>
  </button>
);

const AddAssetModal = ({ onClose, onPersist, editAsset }: { 
  onClose: () => void, 
  onPersist: (asset: Asset, isEdit: boolean) => Promise<void>,
  editAsset?: Asset
}) => {
  const [formData, setFormData] = useState({
    symbol: editAsset?.symbol || '',
    displaySymbol: editAsset?.displaySymbol || '',
    name: editAsset?.name || '',
    type: editAsset?.type || 'etf',
    quantity: editAsset?.quantity?.toString() || '',
    averagePrice: editAsset?.averagePrice?.toString() || '',
    currency: editAsset?.currency || 'EUR'
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      const raw = Array.isArray(data) ? data : [];
      const cleaned = raw.filter(
        (row: { symbol?: unknown }) =>
          row &&
          typeof row.symbol === 'string' &&
          row.symbol.trim().length > 0
      );
      setSearchResults(cleaned);
    } catch (e) {
      console.error("Search failed:", e);
    } finally {
      setIsSearching(false);
    }
  };

  const selectAsset = (asset: any) => {
    const displayName = asset.longName || asset.shortName || asset.name || asset.symbol;
    // Guess a cleaner display symbol (e.g. O instead of RY6.F)
    let displaySymbol = asset.symbol;
    if (displaySymbol.includes('.')) {
      displaySymbol = displaySymbol.split('.')[0];
    }
    
    setFormData(prev => ({
      ...prev,
      symbol: asset.symbol,
      displaySymbol: displaySymbol,
      name: displayName,
      currency: asset.currency || prev.currency,
      type: asset.quoteType?.toLowerCase().includes('etf') || asset.typeDisp?.toLowerCase().includes('etf') ? 'etf' : 
            asset.quoteType?.toLowerCase().includes('crypto') || asset.typeDisp?.toLowerCase().includes('crypto') ? 'crypto' : 'stock'
    }));
    setSearchResults([]);
    setSearchQuery('');
    setIsVerified(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log("Submit triggered for symbol:", formData.symbol);
    
    const newAsset: Asset = {
      ...(editAsset?.id ? { id: editAsset.id } : {}),
      ...formData,
      quantity: Number(formData.quantity),
      averagePrice: Number(formData.averagePrice),
      updatedAt: new Date().toISOString()
    } as Asset;

    setIsSubmitting(true);
    setError(null);
    try {
      await onPersist(newAsset, Boolean(editAsset?.id));
      onClose();
    } catch (err) {
      console.error("Submission failed:", err);
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Auto-fill label when symbol changes
  const checkSymbol = async (symbol: string) => {
    if (symbol.length < 2) return;
    setIsValidating(true);
    setIsVerified(false);
    try {
      const res = await fetch(`/api/quote/${symbol}`);
      const data = await res.json();
      if (data.name) {
        setFormData(prev => ({ 
          ...prev, 
          // Only auto-fill name if it is currently empty to prevent overwriting manual input
          name: prev.name === '' ? data.name : prev.name, 
          currency: data.currency || prev.currency 
        }));
        setIsVerified(true);
      } else {
        setIsVerified(false);
      }
    } catch (e) { 
      setIsVerified(false);
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-bg/95 backdrop-blur-xl z-50 flex items-center justify-center p-4"
    >
      <motion.div 
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 20 }}
        className="glass-panel p-10 w-full max-w-lg relative bg-card/50 border-accent/20 shadow-2xl overflow-hidden"
      >
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-accent/50 to-transparent"></div>
        <button onClick={onClose} className="absolute top-6 right-6 p-2 text-text-s hover:text-text-p transition-colors rounded-full hover:bg-white/5">
          <X className="w-5 h-5" />
        </button>
        
        <h2 className="text-2xl font-black tracking-tighter mb-1 text-text-p uppercase">{editAsset ? 'Edit Holding' : 'Add New Holding'}</h2>
        <p className="text-text-s mb-8 text-[10px] uppercase tracking-[0.25em] font-bold opacity-60">{editAsset ? 'Modify existing asset vector' : 'Add a new asset to your portfolio'}</p>
        
        <div className="mb-8 space-y-2 relative">
          <label className="text-[9px] font-bold text-text-s uppercase tracking-widest px-1 ml-1">Find Asset (Name or Ticker)</label>
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-s opacity-40" />
            <input 
              type="text"
              className="w-full bg-bg border border-border focus:border-accent rounded-xl pl-12 pr-5 py-4 text-text-p focus:outline-none transition-all text-sm placeholder:opacity-20 shadow-inner"
              placeholder="e.g. S&P 500 or AAPL"
              value={searchQuery}
              onChange={e => handleSearch(e.target.value)}
            />
            {isSearching && <RefreshCcw className="absolute right-4 top-1/2 -translate-y-1/2 w-3 h-3 animate-spin text-accent" />}
          </div>
          
          <AnimatePresence>
            {searchResults.length > 0 && (
              <motion.div 
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                className="absolute top-full left-0 w-full mt-2 bg-card border border-border rounded-xl shadow-2xl z-[60] max-h-60 overflow-y-auto divide-y divide-border/50"
              >
                {searchResults.map((result: any, i: number) => (
                  <button
                    key={`${String(result.symbol)}-${i}`}
                    type="button"
                    onClick={() => selectAsset(result)}
                    className="w-full px-5 py-3 text-left hover:bg-white/5 transition-colors group flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-text-p text-xs font-bold truncate">
                        {result.shortName || result.longName || result.name || result.symbol}
                      </div>
                      <div className="text-[10px] font-mono text-text-s group-hover:text-accent transition-colors truncate">
                        {result.symbol}
                        {result.price && (
                          <span className="ml-2 font-sans opacity-40 group-hover:opacity-100 transition-opacity">
                            •{' '}
                            {result.currency === 'EUR'
                              ? formatCurrency(result.price, 'EUR')
                              : `${result.price.toFixed(2)} ${result.currency}`}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0 flex flex-col items-end gap-0.5">
                      {typeof result.dividendYieldPercent === 'number' &&
                      Number.isFinite(result.dividendYieldPercent) &&
                      result.dividendYieldPercent > 0 ? (
                        <div
                          className="text-[10px] font-mono font-bold text-emerald-400/95 tabular-nums tracking-tight"
                          title="Trailing / indicated dividend yield (Yahoo)"
                        >
                          Div {result.dividendYieldPercent.toFixed(2)}%
                        </div>
                      ) : (
                        <div className="text-[9px] font-mono text-text-s/35 uppercase tracking-widest" title="No yield from Yahoo for this listing">
                          Div —
                        </div>
                      )}
                      <div className="text-[9px] font-bold text-text-s opacity-40 uppercase tracking-widest">
                        {result.exchange}
                      </div>
                      {result.typeDisp && (
                        <div className="text-[8px] text-text-s font-sans opacity-20 uppercase tracking-tighter max-w-[7rem] truncate">
                          {result.typeDisp}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          {error && (
            <div className="p-4 bg-red/10 border border-red/20 rounded-xl text-red text-[10px] uppercase font-bold tracking-widest animate-pulse">
              System Error: {error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <label className="text-[9px] font-bold text-text-s uppercase tracking-widest ml-1">Symbol (Ticker)</label>
                {isValidating && <RefreshCcw className="w-2.5 h-2.5 animate-spin text-accent" />}
                {isVerified && <div className="text-[8px] font-black text-green tracking-tighter uppercase flex items-center gap-1"><Zap className="w-2.5 h-2.5" /> Verified</div>}
              </div>
              <input 
                required
                autoFocus
                className={`w-full bg-bg/50 border ${isVerified ? 'border-green/30' : 'border-border'} focus:border-accent/50 rounded-xl px-5 py-4 text-text-p focus:outline-none transition-all font-mono text-sm placeholder:opacity-20`}
                placeholder="VWCE.DE"
                value={formData.symbol}
                onBlur={() => checkSymbol(formData.symbol)}
                onChange={e => setFormData({ ...formData, symbol: e.target.value.toUpperCase() })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[9px] font-bold text-text-s uppercase tracking-widest px-1 ml-1 text-accent">Display Symbol (Visual)</label>
              <input 
                className="w-full bg-bg/50 border border-border focus:border-accent/50 rounded-xl px-5 py-4 text-text-p focus:outline-none transition-all font-mono text-sm placeholder:opacity-20"
                placeholder="VWC"
                value={formData.displaySymbol}
                onChange={e => setFormData({ ...formData, displaySymbol: e.target.value.toUpperCase() })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[9px] font-bold text-text-s uppercase tracking-widest px-1 ml-1">Currency</label>
              <select 
                className="w-full bg-bg/50 border border-border focus:border-accent/50 rounded-xl px-5 py-4 text-text-p focus:outline-none transition-all text-sm appearance-none"
                value={formData.currency}
                onChange={e => setFormData({ ...formData, currency: e.target.value })}
              >
                <option value="EUR">EUR (€)</option>
                <option value="USD">USD ($)</option>
                <option value="GBP">GBP (£)</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[9px] font-bold text-text-s uppercase tracking-widest px-1 ml-1">Asset Label</label>
            <input 
              required
              className="w-full bg-bg/50 border border-border focus:border-accent/50 rounded-xl px-5 py-4 text-text-p focus:outline-none transition-all text-sm placeholder:opacity-20"
              placeholder="Vanguard FTSE All-World"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
            />
          </div>
          
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[9px] font-bold text-text-s uppercase tracking-widest px-1 ml-1">Quantity (Units)</label>
              <input 
                required
                type="number"
                step="any"
                className="w-full bg-bg/50 border border-border focus:border-accent/50 rounded-xl px-5 py-4 text-text-p focus:outline-none transition-all font-mono text-sm placeholder:opacity-20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                placeholder="0.00"
                value={formData.quantity}
                onChange={e => setFormData({ ...formData, quantity: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[9px] font-bold text-text-s uppercase tracking-widest px-1 ml-1">Cost Per Unit</label>
              <input 
                required
                type="number"
                step="any"
                className="w-full bg-bg/50 border border-border focus:border-accent/50 rounded-xl px-5 py-4 text-text-p focus:outline-none transition-all font-mono text-sm placeholder:opacity-20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                placeholder="0.00"
                value={formData.averagePrice}
                onChange={e => setFormData({ ...formData, averagePrice: e.target.value })}
              />
            </div>
          </div>
          
          <button 
            type="submit"
            disabled={isSubmitting}
            className="w-full py-5 bg-accent hover:bg-accent/90 disabled:opacity-50 text-white font-black uppercase tracking-[0.2em] text-[11px] rounded-xl transition-all shadow-xl shadow-accent/20 active:scale-[0.98] mt-4 flex items-center justify-center gap-3"
          >
            {isSubmitting ? (
              <RefreshCcw className="w-4 h-4 animate-spin" />
            ) : (
              editAsset ? 'Save Changes' : 'Add to Portfolio'
            )}
          </button>
        </form>
      </motion.div>
    </motion.div>
  );
};

// --- Static Feed Data ---
